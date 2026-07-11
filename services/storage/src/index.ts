import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
  StorageProjectCreateRequestSchema,
  StorageProjectUpdateRequestSchema,
  StorageSessionCreateRequestSchema,
} from "@wireup/schemas";
import {
  ProjectStatus,
  type ApiResponse,
  type Session,
  type StorageProject,
  type StorageProjectUpdateRequest,
} from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerMetricsRoute,
} from "@wireup/utils";
import { randomUUID } from "crypto";
import { getDatabase, getMongoClient, withRetry } from "./db.js";
import type { Collection, WithId, Document } from "mongodb";

const serviceName = "storage";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

let projectsCollection: Collection;
let sessionsCollection: Collection;

const initMongo = async () => {
  const db = await getDatabase();
  projectsCollection = db.collection("projects");
  sessionsCollection = db.collection("sessions");

  await Promise.all([
    projectsCollection.createIndex({ ownerId: 1 }),
    projectsCollection.createIndex({ userId: 1 }),
    projectsCollection.createIndex({ projectId: 1 }),
    projectsCollection.createIndex({ createdAt: 1 }),
    projectsCollection.createIndex({ updatedAt: 1 }),
    sessionsCollection.createIndex({ userId: 1 }),
    sessionsCollection.createIndex({ createdAt: 1 }),
    sessionsCollection.createIndex({ updatedAt: 1 }),
  ]);
};

const toStorageProject = (doc: WithId<Document>): StorageProject => ({
  id: doc.projectId ?? String(doc._id),
  name: doc.name,
  description: doc.description,
  ownerId: doc.ownerId,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  status: doc.status,
  plannerOutput: doc.plannerOutput,
  generatorOutput: doc.generatorOutput,
  validatorOutput: doc.validatorOutput,
  simulationHistory: doc.simulationHistory ?? [],
  conversationHistory: doc.conversationHistory ?? [],
});

const buildProjectUpdate = (payload: StorageProjectUpdateRequest) => {
  const set: Record<string, unknown> = {};
  const push: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (payload.status) {
    set.status = payload.status;
    changes.status = payload.status;
  }
  if (payload.plannerOutput) {
    set.plannerOutput = payload.plannerOutput;
    changes.plannerOutput = true;
  }
  if (payload.generatorOutput) {
    set.generatorOutput = payload.generatorOutput;
    changes.generatorOutput = true;
  }
  if (payload.validatorOutput) {
    set.validatorOutput = payload.validatorOutput;
    changes.validatorOutput = true;
  }
  if (payload.simulationResult) {
    push.simulationHistory = payload.simulationResult;
    changes.simulationResult = true;
  }
  if (payload.conversationMessage) {
    push.conversationHistory = payload.conversationMessage;
    changes.conversationMessage = true;
  }

  set.updatedAt = new Date();

  if (Object.keys(changes).length > 0) {
    push.versionHistory = {
      timestamp: new Date(),
      changes,
    };
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(push).length > 0) {
    update.$push = push;
  }

  return update;
};

app.post("/api/storage/projects", async (c) => {
  const body = await c.req.json();
  const parsed = StorageProjectCreateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid project create request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<StorageProject>,
      400,
    );
  }

  const now = new Date();
  const projectId = randomUUID();
  const projectDoc = {
    _id: projectId,
    projectId,
    name: parsed.data.name,
    description: parsed.data.description,
    ownerId: parsed.data.ownerId,
    userId: parsed.data.ownerId,
    createdAt: now,
    updatedAt: now,
    status: ProjectStatus.CREATED,
    plannerOutput: undefined,
    generatorOutput: undefined,
    validatorOutput: undefined,
    simulationHistory: [],
    conversationHistory: [],
    metadata: {},
    versionHistory: [],
    userPrompt: parsed.data.description,
  };

  try {
    await withRetry(() => projectsCollection.insertOne(projectDoc));
    return c.json({
      success: true,
      data: toStorageProject(projectDoc),
    } satisfies ApiResponse<StorageProject>);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "STORAGE_WRITE_FAILED",
          message: error instanceof Error ? error.message : "Failed to create project",
        },
      } satisfies ApiResponse<StorageProject>,
      500,
    );
  }
});

app.get("/api/storage/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");

  try {
    const project = await withRetry(() =>
      projectsCollection.findOne({ _id: projectId }),
    );

    if (!project) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Project not found" },
        } satisfies ApiResponse<StorageProject>,
        404,
      );
    }

    return c.json({
      success: true,
      data: toStorageProject(project),
    } satisfies ApiResponse<StorageProject>);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "STORAGE_READ_FAILED",
          message: error instanceof Error ? error.message : "Failed to fetch project",
        },
      } satisfies ApiResponse<StorageProject>,
      500,
    );
  }
});

app.put("/api/storage/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const parsed = StorageProjectUpdateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid project update request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<StorageProject>,
      400,
    );
  }

  try {
    const update = buildProjectUpdate(parsed.data);
    const result = await withRetry(() =>
      projectsCollection.findOneAndUpdate(
        { _id: projectId },
        update,
        { returnDocument: "after" },
      ),
    );

    if (!result) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Project not found" },
        } satisfies ApiResponse<StorageProject>,
        404,
      );
    }

    return c.json({
      success: true,
      data: toStorageProject(result),
    } satisfies ApiResponse<StorageProject>);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "STORAGE_UPDATE_FAILED",
          message: error instanceof Error ? error.message : "Failed to update project",
        },
      } satisfies ApiResponse<StorageProject>,
      500,
    );
  }
});

app.post("/api/storage/sessions", async (c) => {
  const body = await c.req.json();
  const parsed = StorageSessionCreateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid session create request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<Session>,
      400,
    );
  }

  const now = new Date();
  const session: Session = {
    id: randomUUID(),
    userId: parsed.data.userId,
    projectId: parsed.data.projectId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
    isActive: true,
  };

  try {
    await withRetry(() =>
      sessionsCollection.insertOne({
        _id: session.id,
        ...session,
        updatedAt: now,
      }),
    );
    return c.json({ success: true, data: session } satisfies ApiResponse<Session>);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "SESSION_CREATE_FAILED",
          message: error instanceof Error ? error.message : "Failed to create session",
        },
      } satisfies ApiResponse<Session>,
      500,
    );
  }
});

app.get("/health", async (c) => {
  try {
    const client = await getMongoClient();
    await client.db().command({ ping: 1 });
    return c.json({ success: true, data: { status: "ok", mongo: "ok" } });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "MONGO_UNAVAILABLE",
          message: "MongoDB connection failed",
        },
      },
      503,
    );
  }
});

app.get("/ready", async (c) => {
  try {
    const client = await getMongoClient();
    await client.db().command({ ping: 1 });
    return c.json({ success: true, data: { status: "ready", service: serviceName } });
  } catch {
    return c.json({ success: false, error: { code: "MONGO_UNAVAILABLE", message: "MongoDB connection failed" } }, 503);
  }
});

app.get("/live", (c) => {
  return c.json({ success: true, data: { status: "live", service: serviceName } });
});

registerMetricsRoute(app, metrics, serviceName);

const port = runtimeConfig.port;

initMongo()
  .then(() => {
    logger.info("service_starting", { port });
    const server = serve({
      fetch: app.fetch,
      port,
    });
    registerGracefulShutdown(server as any, logger);
  })
  .catch((error) => {
    logger.error("storage_init_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });

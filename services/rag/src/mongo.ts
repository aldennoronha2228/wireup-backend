import { MongoClient } from "mongodb";
import type { RagConfig } from "./config.js";

export interface MongoFailureDetails {
  name: string;
  message: string;
  reason: string;
  code?: string | number;
  stack?: string;
  serverSelectionError?: string;
}

export interface MongoHealthReport {
  connected: boolean;
  database: string;
  reason: string;
  collections: string[];
  missingCollections: string[];
  missingSearchIndexes: string[];
  error?: MongoFailureDetails;
}

export interface MongoLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

const MAX_CONNECTION_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 250;

let clientPromise: Promise<MongoClient> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const maskMongoUri = (uri: string) => {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1$2:***@");
};

const safeMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown MongoDB error";
};

const getErrorName = (error: unknown) => {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "MongoError";
};

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybeError = error as { code?: string | number; codeName?: string };
  return maybeError.code ?? maybeError.codeName;
};

const getServerSelectionDetails = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybeError = error as { reason?: unknown; serverSelectionErrors?: unknown };
  if (maybeError.reason) {
    return String(maybeError.reason);
  }

  if (maybeError.serverSelectionErrors) {
    return JSON.stringify(maybeError.serverSelectionErrors);
  }

  return undefined;
};

export const classifyMongoFailure = (error: unknown): MongoFailureDetails => {
  const name = getErrorName(error);
  const message = safeMessage(error);
  const code = getErrorCode(error);
  const normalized = `${name} ${message} ${String(code ?? "")}`.toLowerCase();

  let reason = message;

  if (
    normalized.includes("authentication") ||
    normalized.includes("bad auth") ||
    normalized.includes("sasl") ||
    normalized.includes("unauthorized") ||
    normalized.includes("auth failed")
  ) {
    reason = "Authentication failed";
  } else if (
    normalized.includes("server selection timed out") ||
    normalized.includes("mongoserverselectionerror") ||
    normalized.includes("server selection")
  ) {
    reason = "Server selection timeout";
  } else if (
    normalized.includes("eai_again") ||
    normalized.includes("enotfound") ||
    normalized.includes("getaddrinfo") ||
    normalized.includes("dns")
  ) {
    reason = "DNS lookup failed";
  } else if (
    normalized.includes("tls") ||
    normalized.includes("ssl") ||
    normalized.includes("certificate") ||
    normalized.includes("unable to verify")
  ) {
    reason = "TLS error";
  } else if (
    normalized.includes("timed out") ||
    normalized.includes("etimedout") ||
    normalized.includes("timeout")
  ) {
    reason = "Connection timeout";
  } else if (
    normalized.includes("econnrefused") ||
    normalized.includes("network") ||
    normalized.includes("socket")
  ) {
    reason = "Network connection failed";
  }

  return {
    name,
    message,
    reason,
    code,
    stack: error instanceof Error ? error.stack : undefined,
    serverSelectionError: getServerSelectionDetails(error),
  };
};

const buildClient = (config: RagConfig) => {
  return new MongoClient(config.mongodbUri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    retryReads: true,
    retryWrites: true,
    serverSelectionTimeoutMS: config.mongoQueryTimeoutMs,
    connectTimeoutMS: config.mongoQueryTimeoutMs,
  });
};

const ensureCollections = async (
  client: MongoClient,
  config: RagConfig,
  logger?: MongoLogger,
) => {
  const db = client.db(config.mongodbDatabase);
  const requiredCollections = [
    config.mongodbCollectionDocuments,
    config.mongodbCollectionChunks,
    config.mongodbCollectionKnowledgeGraph,
  ];

  const existingCollections = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );

  for (const collectionName of requiredCollections) {
    if (!existingCollections.has(collectionName)) {
      await db.createCollection(collectionName);
      logger?.info("mongo_collection_created", { database: config.mongodbDatabase, collection: collectionName });
    }
  }

  return requiredCollections;
};

const listSearchIndexNames = async (client: MongoClient, databaseName: string, collectionName: string) => {
  const db = client.db(databaseName);

  try {
    const response = await db.command({ listSearchIndexes: collectionName });
    const batch = response?.cursor?.firstBatch;

    if (!Array.isArray(batch)) {
      return [] as string[];
    }

    return batch
      .map((index) => (index && typeof index === "object" ? String((index as { name?: string }).name ?? "") : ""))
      .filter((name) => name.length > 0);
  } catch {
    return [] as string[];
  }
};

const verifySearchIndexes = async (client: MongoClient, config: RagConfig, logger?: MongoLogger) => {
  const requiredIndexes = [
    { collection: config.mongodbCollectionChunks, index: config.mongodbVectorIndex },
    { collection: config.mongodbCollectionChunks, index: config.mongodbTextIndex },
    { collection: config.mongodbCollectionKnowledgeGraph, index: config.mongodbKgTextIndex },
  ];

  const missingSearchIndexes: string[] = [];

  for (const { collection, index } of requiredIndexes) {
    const indexNames = await listSearchIndexNames(client, config.mongodbDatabase, collection);
    if (indexNames.length === 0) {
      logger?.warn("mongo_search_indexes_unavailable", {
        database: config.mongodbDatabase,
        collection,
        requiredIndex: index,
        reason: "Atlas Search index listing is unavailable or unsupported",
      });
      continue;
    }

    if (!indexNames.includes(index)) {
      missingSearchIndexes.push(`${collection}.${index}`);
      logger?.warn("mongo_search_index_missing", {
        database: config.mongodbDatabase,
        collection,
        requiredIndex: index,
        availableIndexes: indexNames,
      });
    }
  }

  return missingSearchIndexes;
};

const logMongoFailure = (logger: MongoLogger | undefined, error: unknown, attempt: number) => {
  const details = classifyMongoFailure(error);

  logger?.error("mongo_connection_failed", {
    attempt,
    errorName: details.name,
    errorMessage: details.message,
    errorCode: details.code,
    reason: details.reason,
    serverSelectionError: details.serverSelectionError,
    stack: details.stack,
  });

  return details;
};

const connectAndValidate = async (config: RagConfig, logger?: MongoLogger) => {
  const client = buildClient(config);

  for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt += 1) {
    try {
      logger?.info("mongo_connect_attempt", {
        attempt,
        database: config.mongodbDatabase,
        uri: maskMongoUri(config.mongodbUri),
      });

      await client.connect();

      const db = client.db(config.mongodbDatabase);
      logger?.info("mongo_ping_attempt", { attempt, database: config.mongodbDatabase });
      await db.command({ ping: 1 });
      logger?.info("mongo_ping_success", { attempt, database: config.mongodbDatabase });

      const collections = await ensureCollections(client, config, logger);
      logger?.info("mongo_collections_verified", {
        database: config.mongodbDatabase,
        collections,
      });

      const missingSearchIndexes = await verifySearchIndexes(client, config, logger);
      if (missingSearchIndexes.length === 0) {
        logger?.info("mongo_search_indexes_verified", {
          database: config.mongodbDatabase,
          vectorIndex: config.mongodbVectorIndex,
          textIndex: config.mongodbTextIndex,
          kgTextIndex: config.mongodbKgTextIndex,
        });
      }

      logger?.info("mongo_connected", {
        database: config.mongodbDatabase,
        collections,
        vectorIndex: config.mongodbVectorIndex,
        textIndex: config.mongodbTextIndex,
        kgTextIndex: config.mongodbKgTextIndex,
      });

      return { client, collections, missingSearchIndexes };
    } catch (error) {
      const details = logMongoFailure(logger, error, attempt);

      if (attempt >= MAX_CONNECTION_ATTEMPTS) {
        await client.close().catch(() => undefined);
        throw error;
      }

      const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger?.warn("mongo_retry_scheduled", {
        attempt,
        nextAttempt: attempt + 1,
        backoffMs,
        reason: details.reason,
      });
      await sleep(backoffMs);
    }
  }

  throw new Error("MongoDB connection failed");
};

export const getMongoClient = async (config: RagConfig, logger?: MongoLogger) => {
  if (!clientPromise) {
    clientPromise = connectAndValidate(config, logger).then(({ client }) => client).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
};

export const getMongoHealthReport = async (config: RagConfig, logger?: MongoLogger): Promise<MongoHealthReport> => {
  try {
    const client = await getMongoClient(config, logger);
    const db = client.db(config.mongodbDatabase);
    await db.command({ ping: 1 });

    return {
      connected: true,
      database: config.mongodbDatabase,
      reason: "Connected",
      collections: [
        config.mongodbCollectionDocuments,
        config.mongodbCollectionChunks,
        config.mongodbCollectionKnowledgeGraph,
      ],
      missingCollections: [],
      missingSearchIndexes: [],
    };
  } catch (error) {
    const details = classifyMongoFailure(error);

    return {
      connected: false,
      database: config.mongodbDatabase,
      reason: details.reason,
      collections: [
        config.mongodbCollectionDocuments,
        config.mongodbCollectionChunks,
        config.mongodbCollectionKnowledgeGraph,
      ],
      missingCollections: [],
      missingSearchIndexes: [],
      error: details,
    };
  }
};

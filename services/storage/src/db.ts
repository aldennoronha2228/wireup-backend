import { MongoClient, MongoNetworkError, MongoServerSelectionError } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

const getMongoUri = () => process.env.MONGODB_URI || "mongodb://localhost:27017";
const getMongoDbName = () => process.env.MONGODB_DATABASE || "wireup";
const getMongoMaxPool = () => Number(process.env.MONGODB_MAX_POOL) || 20;
const getMongoMinPool = () => Number(process.env.MONGODB_MIN_POOL) || 2;
const getMongoTimeoutMs = () => Number(process.env.MONGODB_TIMEOUT_MS) || 5000;
const getMongoRetries = () => Number(process.env.MONGODB_RETRIES) || 2;

const maskMongoUri = (uri: string) => {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1$2:***@");
};

const serializeMongoError = (error: unknown) => {
  if (error instanceof Error) {
    const mongoError = error as Error & {
      code?: string | number;
      reason?: unknown;
      cause?: unknown;
      serverSelectionErrors?: unknown;
    };

    return {
      name: mongoError.name,
      message: mongoError.message,
      code: mongoError.code,
      reason: mongoError.reason ? String(mongoError.reason) : undefined,
      cause: mongoError.cause ? String(mongoError.cause) : undefined,
      serverSelectionErrors: mongoError.serverSelectionErrors,
      stack: mongoError.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
};

export const getMongoClient = async () => {
  if (!clientPromise) {
    const client = new MongoClient(getMongoUri(), {
      maxPoolSize: getMongoMaxPool(),
      minPoolSize: getMongoMinPool(),
      retryReads: true,
      retryWrites: true,
      serverSelectionTimeoutMS: getMongoTimeoutMs(),
    });

    clientPromise = (async () => {
      const mongoUri = getMongoUri();
      const mongoDbName = getMongoDbName();

      console.info("storage_mongo_connect_start", {
        database: mongoDbName,
        uri: maskMongoUri(mongoUri),
      });

      try {
        await client.connect();
        console.info("storage_mongo_connected", {
          database: mongoDbName,
          uri: maskMongoUri(mongoUri),
        });

        await client.db(mongoDbName).command({ ping: 1 });
        console.info("storage_mongo_ping_success", {
          database: mongoDbName,
          uri: maskMongoUri(mongoUri),
        });

        return client;
      } catch (error) {
        console.error("storage_mongo_connect_failed", {
          database: mongoDbName,
          uri: maskMongoUri(mongoUri),
          error: serializeMongoError(error),
        });
        throw error;
      }
    })();
  }

  return clientPromise;
};

export const getDatabase = async () => {
  const client = await getMongoClient();
  return client.db(getMongoDbName());
};

export const withRetry = async <T>(
  action: () => Promise<T>,
  retries = getMongoRetries(),
): Promise<T> => {
  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (error) {
      attempt += 1;
      const shouldRetry =
        error instanceof MongoNetworkError ||
        error instanceof MongoServerSelectionError;
      if (!shouldRetry || attempt > retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
};

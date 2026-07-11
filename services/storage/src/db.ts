import { MongoClient, MongoNetworkError, MongoServerSelectionError } from "mongodb";

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const mongoDbName = process.env.MONGODB_DATABASE || "wireup";

let clientPromise: Promise<MongoClient> | null = null;

export const getMongoClient = async () => {
  if (!clientPromise) {
    const client = new MongoClient(mongoUri, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL) || 20,
      minPoolSize: Number(process.env.MONGODB_MIN_POOL) || 2,
      retryReads: true,
      retryWrites: true,
      serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS) || 5000,
    });
    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
};

export const getDatabase = async () => {
  const client = await getMongoClient();
  return client.db(mongoDbName);
};

export const withRetry = async <T>(
  action: () => Promise<T>,
  retries = Number(process.env.MONGODB_RETRIES) || 2,
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

import { MongoClient } from "mongodb";
import type { RagConfig } from "./config.js";

let clientPromise: Promise<MongoClient> | null = null;

export const getMongoClient = async (config: RagConfig) => {
  if (!clientPromise) {
    const client = new MongoClient(config.mongodbUri, {
      maxPoolSize: 10,
      minPoolSize: 1,
      retryReads: true,
      retryWrites: true,
    });
    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
};

import { createHash } from "crypto";
import type { RagConfig } from "./config.js";

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

const buildLocalEmbedding = (text: string, dimension: number) => {
  const hash = createHash("sha256").update(text).digest();
  const vector: number[] = new Array(dimension);
  for (let i = 0; i < dimension; i += 1) {
    vector[i] = hash[i % hash.length] / 255;
  }
  return vector;
};

export const getEmbedding = async (text: string, config: RagConfig) => {
  if (config.embeddingProvider === "local") {
    return buildLocalEmbedding(text, config.embeddingDimension);
  }

  const response = await fetch(`${config.embeddingBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.embeddingApiKey}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text,
    }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as OpenAIEmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("Embedding response missing vector");
  }

  return embedding;
};

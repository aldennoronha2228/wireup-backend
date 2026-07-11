import type { Collection, Document } from "mongodb";
import type { RagConfig } from "./config.js";
import { getEmbedding } from "./embedding.js";

export interface SearchResult {
  id: string;
  type: "vector" | "knowledge_graph";
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface ChunkDocument extends Document {
  _id: unknown;
  document_id: unknown;
  content: string;
  metadata?: Record<string, unknown>;
  similarity: number;
  document_title?: string;
  document_source?: string;
}

interface KnowledgeGraphDocument extends Document {
  _id: unknown;
  content: string;
  metadata?: Record<string, unknown>;
  similarity: number;
}

const toStringId = (value: unknown) => String(value);

export const reciprocalRankFusion = (lists: SearchResult[][], k = 60) => {
  const scores = new Map<string, number>();
  const items = new Map<string, SearchResult>();

  lists.forEach((results) => {
    results.forEach((result, index) => {
      const score = 1 / (k + index + 1);
      const existing = scores.get(result.id) ?? 0;
      scores.set(result.id, existing + score);
      const existingItem = items.get(result.id);
      if (!existingItem || result.score > existingItem.score) {
        items.set(result.id, result);
      }
    });
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => {
      const item = items.get(id);
      if (!item) return null;
      return { ...item, score };
    })
    .filter((item): item is SearchResult => item !== null);
};

export const dedupeResults = (results: SearchResult[]) => {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const contentKey = result.content.trim().toLowerCase();
    if (seenIds.has(result.id) || seenContent.has(contentKey)) {
      continue;
    }
    seenIds.add(result.id);
    seenContent.add(contentKey);
    deduped.push(result);
  }

  return deduped;
};

export const rerankResults = (results: SearchResult[]) => {
  if (results.length === 0) return results;
  const scores = results.map((result) => result.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore || 1;

  return [...results]
    .map((result) => ({
      ...result,
      score: (result.score - minScore) / range,
    }))
    .sort((a, b) => b.score - a.score);
};

const buildChunkMetadata = (doc: ChunkDocument) => ({
  ...(doc.metadata ?? {}),
  documentTitle: doc.document_title,
  documentSource: doc.document_source,
});

export const vectorSearch = async (
  collection: Collection,
  config: RagConfig,
  query: string,
  matchCount: number,
): Promise<SearchResult[]> => {
  const embedding = await getEmbedding(query, config);

  const pipeline = [
    {
      $vectorSearch: {
        index: config.mongodbVectorIndex,
        queryVector: embedding,
        path: "embedding",
        numCandidates: Math.max(matchCount * 10, 100),
        limit: matchCount,
      },
    },
    {
      $lookup: {
        from: config.mongodbCollectionDocuments,
        localField: "document_id",
        foreignField: "_id",
        as: "document_info",
      },
    },
    { $unwind: "$document_info" },
    {
      $project: {
        content: 1,
        metadata: 1,
        similarity: { $meta: "vectorSearchScore" },
        document_title: "$document_info.title",
        document_source: "$document_info.source",
      },
    },
  ];

  const cursor = collection.aggregate<ChunkDocument>(pipeline, {
    maxTimeMS: config.mongoQueryTimeoutMs,
  });

  const docs = await cursor.toArray();
  return docs.slice(0, matchCount).map((doc) => ({
    id: toStringId(doc._id),
    type: "vector",
    content: doc.content,
    score: doc.similarity,
    metadata: buildChunkMetadata(doc),
  }));
};

export const textSearch = async (
  collection: Collection,
  config: RagConfig,
  query: string,
  matchCount: number,
): Promise<SearchResult[]> => {
  const pipeline = [
    {
      $search: {
        index: config.mongodbTextIndex,
        text: {
          query,
          path: "content",
          fuzzy: { maxEdits: 2, prefixLength: 3 },
        },
      },
    },
    { $limit: matchCount * 2 },
    {
      $lookup: {
        from: config.mongodbCollectionDocuments,
        localField: "document_id",
        foreignField: "_id",
        as: "document_info",
      },
    },
    { $unwind: "$document_info" },
    {
      $project: {
        content: 1,
        metadata: 1,
        similarity: { $meta: "searchScore" },
        document_title: "$document_info.title",
        document_source: "$document_info.source",
      },
    },
  ];

  const cursor = collection.aggregate<ChunkDocument>(pipeline, {
    maxTimeMS: config.mongoQueryTimeoutMs,
  });

  const docs = await cursor.toArray();
  return docs.slice(0, matchCount * 2).map((doc) => ({
    id: toStringId(doc._id),
    type: "vector",
    content: doc.content,
    score: doc.similarity,
    metadata: buildChunkMetadata(doc),
  }));
};

export const knowledgeGraphSearch = async (
  collection: Collection,
  config: RagConfig,
  query: string,
  matchCount: number,
): Promise<SearchResult[]> => {
  const pipeline = [
    {
      $search: {
        index: config.mongodbKgTextIndex,
        text: {
          query,
          path: "content",
          fuzzy: { maxEdits: 1, prefixLength: 2 },
        },
      },
    },
    { $limit: matchCount },
    {
      $project: {
        content: 1,
        metadata: 1,
        similarity: { $meta: "searchScore" },
      },
    },
  ];

  const cursor = collection.aggregate<KnowledgeGraphDocument>(pipeline, {
    maxTimeMS: config.mongoQueryTimeoutMs,
  });

  const docs = await cursor.toArray();
  return docs.slice(0, matchCount).map((doc) => ({
    id: toStringId(doc._id),
    type: "knowledge_graph",
    content: doc.content,
    score: doc.similarity,
    metadata: doc.metadata ?? {},
  }));
};

export const hybridSearch = async (
  collection: Collection,
  config: RagConfig,
  query: string,
  matchCount: number,
): Promise<SearchResult[]> => {
  const fetchCount = Math.min(matchCount * 2, config.maxMatchCount);
  const [vectorResult, textResult] = await Promise.allSettled([
    vectorSearch(collection, config, query, fetchCount),
    textSearch(collection, config, query, fetchCount),
  ]);

  const vectorResults =
    vectorResult.status === "fulfilled" ? vectorResult.value : [];
  const textResults =
    textResult.status === "fulfilled" ? textResult.value : [];

  if (vectorResults.length === 0 && textResults.length === 0) {
    return [];
  }

  const merged = reciprocalRankFusion([vectorResults, textResults]);
  return merged.slice(0, matchCount).map((result) => ({
    ...result,
    metadata: {
      ...result.metadata,
      sources: [
        vectorResults.find((item) => item.id === result.id) ? "vector" : null,
        textResults.find((item) => item.id === result.id) ? "text" : null,
      ].filter(Boolean),
    },
  }));
};

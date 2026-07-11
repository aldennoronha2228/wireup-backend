import type { SearchResult } from "./search.js";

export const VENDOR_RAG_REPOSITORY = "vendor/wireup-hybrid-rag";

export interface VendorSearchSummary {
  implementationSource: string;
  stages: string[];
  results: SearchResult[];
}

export const buildVendorSearchSummary = (
  hybridResults: SearchResult[],
  knowledgeGraphResults: SearchResult[],
  matchCount: number,
): VendorSearchSummary => {
  const merged = new Map<string, SearchResult>();

  [...hybridResults, ...knowledgeGraphResults].forEach((item) => {
    const existing = merged.get(item.id);
    if (!existing || item.score > existing.score) {
      merged.set(item.id, item);
    }
  });

  const ranked = Array.from(merged.values()).sort((left, right) => right.score - left.score);

  return {
    implementationSource: VENDOR_RAG_REPOSITORY,
    stages: ["hybrid", "knowledge_graph", "rrf"],
    results: ranked.slice(0, matchCount),
  };
};

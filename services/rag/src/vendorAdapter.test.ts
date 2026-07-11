import { describe, expect, it } from "vitest";
import { buildVendorSearchSummary, VENDOR_RAG_REPOSITORY } from "./vendorAdapter.js";

describe("buildVendorSearchSummary", () => {
  it("merges hybrid and knowledge-graph results and records the vendor source", () => {
    const summary = buildVendorSearchSummary(
      [
        { id: "a", type: "vector", content: "alpha", score: 0.8, metadata: {} },
        { id: "b", type: "vector", content: "beta", score: 0.6, metadata: {} },
      ],
      [
        { id: "b", type: "knowledge_graph", content: "beta", score: 0.9, metadata: {} },
        { id: "c", type: "knowledge_graph", content: "gamma", score: 0.5, metadata: {} },
      ],
      3,
    );

    expect(summary.implementationSource).toBe(VENDOR_RAG_REPOSITORY);
    expect(summary.stages).toEqual(["hybrid", "knowledge_graph", "rrf"]);
    expect(summary.results.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

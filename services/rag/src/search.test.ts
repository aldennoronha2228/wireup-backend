import { describe, expect, it } from "vitest";
import { dedupeResults, reciprocalRankFusion, rerankResults } from "./search.js";

const baseResults = (prefix: string) =>
  Array.from({ length: 3 }).map((_, index) => ({
    id: `${prefix}-${index}`,
    type: "vector" as const,
    content: `${prefix} content ${index}`,
    score: 1 - index * 0.1,
    metadata: {},
  }));

describe("reciprocalRankFusion", () => {
  it("merges and re-scores results", () => {
    const listA = baseResults("a");
    const listB = [listA[1], ...baseResults("b")];

    const merged = reciprocalRankFusion([listA, listB]);

    expect(merged.length).toBe(5);
    expect(merged[0].id).toBe(listA[1].id);
    expect(merged[0].score).toBeGreaterThan(merged[1].score);
  });
});

describe("dedupeResults", () => {
  it("removes duplicate ids and content", () => {
    const results = [
      { id: "1", type: "vector" as const, content: "Same", score: 0.9, metadata: {} },
      { id: "1", type: "vector" as const, content: "Same", score: 0.8, metadata: {} },
      { id: "2", type: "vector" as const, content: " same ", score: 0.7, metadata: {} },
      { id: "3", type: "vector" as const, content: "Unique", score: 0.6, metadata: {} },
    ];

    const deduped = dedupeResults(results);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((item) => item.id)).toEqual(["1", "3"]);
  });
});

describe("rerankResults", () => {
  it("normalizes and sorts by score", () => {
    const results = [
      { id: "1", type: "vector" as const, content: "A", score: 10, metadata: {} },
      { id: "2", type: "vector" as const, content: "B", score: 5, metadata: {} },
    ];

    const reranked = rerankResults(results);

    expect(reranked[0].id).toBe("1");
    expect(reranked[0].score).toBe(1);
    expect(reranked[1].score).toBe(0);
  });
});

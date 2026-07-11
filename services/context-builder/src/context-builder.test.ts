import { describe, expect, it } from "vitest";
import { buildOptimizedContext } from "./context-builder.js";
import type { RagContextItem } from "@wireup/types";

const makeItem = (id: string, content: string, score: number): RagContextItem => ({
  id,
  type: "vector",
  content,
  score,
  metadata: { documentTitle: "Doc", documentSource: "src" },
});

describe("buildOptimizedContext", () => {
  it("dedupes, merges, and compresses", () => {
    const context: RagContextItem[] = [
      makeItem("1", "Alpha content.", 0.9),
      makeItem("2", "Alpha content.", 0.8),
      makeItem("3", "Beta content.", 0.7),
    ];

    const result = buildOptimizedContext(context, {
      maxContextChars: 50,
      maxItems: 10,
    });

    expect(result.context.length).toBe(1);
    expect(result.context[0].metadata.citations).toBeDefined();
    expect(result.compressionRatio).toBeGreaterThan(0);
  });
});

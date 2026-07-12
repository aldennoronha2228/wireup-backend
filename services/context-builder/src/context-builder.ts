import type { RagContextItem } from "@wireup/types";

export interface ContextBuilderOptions {
  maxContextChars: number;
  maxItems: number;
}

export interface OptimizedContextResult {
  context: RagContextItem[];
  compressionRatio: number;
}

const normalize = (value: string) => value.trim().toLowerCase();

const extractCitation = (item: RagContextItem) => {
  const metadata = item.metadata ?? {};
  const title = typeof (metadata as Record<string, unknown>).documentTitle === "string"
    ? (metadata as Record<string, unknown>).documentTitle as string
    : undefined;
  const source = typeof (metadata as Record<string, unknown>).documentSource === "string"
    ? (metadata as Record<string, unknown>).documentSource as string
    : undefined;
  if (title || source) {
    return { title, source };
  }
  return null;
};

const compressContent = (content: string, maxChars: number) => {
  if (content.length <= maxChars) return content;
  const truncated = content.slice(0, maxChars);
  const lastSentence = truncated.lastIndexOf(".");
  if (lastSentence > 200) {
    return truncated.slice(0, lastSentence + 1);
  }
  return truncated.trimEnd();
};

export const buildOptimizedContext = (
  ragContext: RagContextItem[],
  options: ContextBuilderOptions,
): OptimizedContextResult => {
  const originalChars = ragContext.reduce(
    (sum, item) => sum + item.content.length,
    0,
  );

  const dedupeMap = new Map<string, RagContextItem>();
  ragContext.forEach((item) => {
    const key = `${normalize(item.content)}::${item.type}`;
    if (!dedupeMap.has(key) || (item.score ?? 0) > (dedupeMap.get(key)?.score ?? 0)) {
      dedupeMap.set(key, item);
    }
  });

  const grouped = new Map<string, RagContextItem[]>();
  Array.from(dedupeMap.values()).forEach((item) => {
    const metadata = item.metadata ?? {};
    const documentKey =
      typeof metadata.documentSource === "string"
        ? metadata.documentSource
        : typeof metadata.documentTitle === "string"
          ? metadata.documentTitle
          : "unknown";
    const list = grouped.get(documentKey) ?? [];
    list.push(item);
    grouped.set(documentKey, list);
  });

  const mergedItems: RagContextItem[] = [];
  grouped.forEach((items, key) => {
    const sorted = [...items].sort((a, b) => b.score - a.score);
    const combinedContent = sorted
      .map((item) => item.content)
      .filter(Boolean)
      .join("\n\n");

    const citations = sorted
      .map(extractCitation)
      .filter((citation): citation is { title: string | undefined; source: string | undefined } =>
        citation !== null,
      );

    const topItem = sorted[0];
    mergedItems.push({
      id: topItem.id,
      type: topItem.type,
      content: compressContent(combinedContent, options.maxContextChars),
      metadata: {
        ...topItem.metadata,
        documentKey: key,
        citations,
        mergedFrom: sorted.map((item) => item.id),
      },
      score: topItem.score,
    });
  });

  const reranked = mergedItems
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxItems);

  const compressedChars = reranked.reduce(
    (sum, item) => sum + item.content.length,
    0,
  );

  return {
    context: reranked,
    compressionRatio: originalChars === 0 ? 1 : compressedChars / originalChars,
  };
};

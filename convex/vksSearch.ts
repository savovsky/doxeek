// convex/vksSearch.ts
// Public search action — called from the React UI via useAction().
// "use node" required because rag.search() calls Cohere for query embedding (S16).
"use node";

import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import type { EntryFilter } from "@convex-dev/rag";
import { rag } from "./rag.config";

type VksFilterTypes = {
  department: string;
  actYear:    string;
  // sectionType REMOVED
};

type DecisionResult = {
  score:      number | null;   // null for keyword results (BM25 has no cosine score)
  chunkText:  string;
  ragKey:     string;
  actId:      string;
  actTitle:   string;
  actUrl:     string;
  actDate:    string;
  actNumber:  string;
  caseNumber: string;
  caseYear:   string;
  department: string;
  chunkIndex: number;
  // sectionType REMOVED
};

type MetadataRow = {
  ragKey:     string;
  actId:      string;
  actTitle:   string;
  actUrl:     string;
  actDate:    string;
  actNumber:  string;
  caseNumber: string;
  caseYear:   string;
  department: string;
  chunkIndex: number;
  // sectionType REMOVED
} | null;

/**
 * Keyword (BM25) search — action wrapper around keywordSearchDecisions query.
 * Deduplicates results by actId: fetches up to limit×10 chunks internally,
 * keeps the first (highest-ranked) chunk per decision, then returns up to limit
 * unique decisions. This prevents the same decision from appearing multiple times
 * when many of its chunks match the query.
 */
export const keywordSearchDecisions = action({
  args: {
    query:      v.string(),
    department: v.optional(v.string()),
    actYear:    v.optional(v.string()),
    limit:      v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    const limit = args.limit ?? 20;

    // Fetch more chunks than needed so we have enough unique decisions after dedup.
    // With ~20 chunks/decision on average, limit×10 gives a safe margin.
    const fetchLimit = Math.min(limit * 10, 200);

    const rows = await ctx.runQuery(api.vksSearchQueries.keywordSearchDecisions, {
      ...args,
      limit: fetchLimit,
    });

    // Deduplicate: keep only the first (best-ranked) chunk per decision.
    const seen = new Set<string>();
    const deduped = rows.filter(row => {
      if (seen.has(row.actId)) return false;
      seen.add(row.actId);
      return true;
    });

    return deduped.slice(0, limit);
  },
});

export const searchDecisions = action({
  args: {
    query:       v.string(),
    namespace:   v.optional(v.string()),
    department:  v.optional(v.string()),
    actYear:     v.optional(v.string()),
    limit:       v.optional(v.number()),
    vectorScoreThreshold: v.optional(v.number()),
    // sectionType REMOVED
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    // Build filters — only include fields that were provided.
    // Omitting a filter = search across all values for that dimension.
    const filters: EntryFilter<VksFilterTypes>[] = [];
    // sectionType filter REMOVED
    if (args.department) filters.push({ name: "department" as const, value: args.department });
    if (args.actYear)    filters.push({ name: "actYear"    as const, value: args.actYear });

    // 1. Vector similarity search
    // When filtering by year, request more results internally to compensate for
    // cross-year results that will be removed in the post-filter step below.
    // (The RAG filter is unreliable for entries ingested before the S9 filterNames
    // change; we apply a reliable post-filter using vksChunkMetadata.actDate.)
    const requestedLimit  = args.limit ?? 20;
    const internalLimit   = args.actYear
      ? Math.min(requestedLimit * 6, 120)
      : requestedLimit;

    const { results, entries } = await rag.search(ctx, {
      namespace:            args.namespace ?? "vks-commercial",
      query:                args.query,
      limit:                internalLimit,
      vectorScoreThreshold: args.vectorScoreThreshold ?? 0.4, // S17: unchanged from S16 — score distribution identical (55–67%), boilerplate at 61–63% not fixable by threshold alone. S18 will lower to 0.3 for wider re-ranking net.
      ...(filters.length > 0 ? { filters } : {}),
    });

    // 2. Extract ragKeys from entries.
    // Confirmed from SearchEntry type: key?: string | undefined
    const ragKeys = entries
      .map((e) => e.key)
      .filter((k): k is string => Boolean(k));

    // 3. Look up display metadata from our vksChunkMetadata table
    const metadataMap: Record<string, MetadataRow> = await ctx.runQuery(
      internal.vksSearchQueries.getMetadataByKeys,
      { ragKeys },
    );

    // 4. Join, deduplicate by actId (keep highest-scoring chunk per decision),
    // and post-filter by actYear using actDate from vksChunkMetadata.
    // The post-filter is the reliable source of truth — the RAG filter index
    // may be stale for entries ingested before the S9 filterNames change.
    const seen = new Set<string>();
    return results
      .map((result) => {
        const entry    = entries.find((e) => e.entryId === result.entryId);
        const ragKey   = entry?.key ?? "";
        const metadata = metadataMap[ragKey];
        return {
          score:      result.score,
          chunkText:  result.content.map((c) => c.text).join("\n"),
          ragKey,
          actId:      metadata?.actId      ?? "",
          actTitle:   metadata?.actTitle    ?? "",
          actUrl:     metadata?.actUrl      ?? "",
          actDate:    metadata?.actDate     ?? "",
          actNumber:  metadata?.actNumber   ?? "",
          caseNumber: metadata?.caseNumber  ?? "",
          caseYear:   metadata?.caseYear    ?? "",
          department: metadata?.department  ?? "",
          chunkIndex: metadata?.chunkIndex  ?? 0,
        };
      })
      .filter((r) => {
        // Drop entries with no metadata (stale RAG vectors with no vksChunkMetadata row)
        if (!r.actId) return false;
        // Post-filter by year — reliable because actDate comes from our own table
        if (args.actYear && !r.actDate.startsWith(args.actYear)) return false;
        // Deduplicate: keep best-scoring chunk per decision
        if (seen.has(r.actId)) return false;
        seen.add(r.actId);
        return true;
      })
      .slice(0, requestedLimit);
  },
});

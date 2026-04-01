// convex/vksSearch.ts
// Public search action — called from the React UI via useAction().
// "use node" required because rag.search() calls OpenAI for query embedding.
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
 * Keyword (BM25) search — thin action wrapper around keywordSearchDecisions query.
 * Using an action lets the UI call it via useAction, exactly like searchDecisions,
 * so both modes share the same fire-on-Submit pattern.
 */
export const keywordSearchDecisions = action({
  args: {
    query:      v.string(),
    department: v.optional(v.string()),
    actYear:    v.optional(v.string()),
    limit:      v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    return await ctx.runQuery(api.vksSearchQueries.keywordSearchDecisions, args);
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
    const { results, entries } = await rag.search(ctx, {
      namespace:            args.namespace ?? "vks-commercial",
      query:                args.query,
      limit:                args.limit ?? 20,
      vectorScoreThreshold: args.vectorScoreThreshold ?? 0.4, // 0.4 production default; pass 0 to debug
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

    // 4. Join and return enriched results
    return results.map((result) => {
      const entry    = entries.find((e) => e.entryId === result.entryId);
      const ragKey   = entry?.key ?? "";
      const metadata = metadataMap[ragKey];

      return {
        score:       result.score,
        chunkText:   result.content.map((c) => c.text).join("\n"),
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
        // sectionType REMOVED
      };
    });
  },
});

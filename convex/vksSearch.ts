// convex/vksSearch.ts
// Public search action — called from the React UI via useAction().
// "use node" required because rag.search() calls OpenAI for query embedding.
"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { EntryFilter } from "@convex-dev/rag";
import { rag } from "./rag.config";

type VksFilterTypes = {
  sectionType: string;
  department:  string;
  actYear:     string;
};

type DecisionResult = {
  score:       number;
  chunkText:   string;
  ragKey:      string;
  actId:       string;
  actTitle:    string;
  actUrl:      string;
  actDate:     string;
  actNumber:   string;
  caseNumber:  string;
  caseYear:    string;
  department:  string;
  sectionType: string;
  chunkIndex:  number;
};

type MetadataRow = {
  ragKey:      string;
  actId:       string;
  actTitle:    string;
  actUrl:      string;
  actDate:     string;
  actNumber:   string;
  caseNumber:  string;
  caseYear:    string;
  department:  string;
  sectionType: string;
  chunkIndex:  number;
} | null;

export const searchDecisions = action({
  args: {
    query:       v.string(),
    namespace:   v.optional(v.string()),
    sectionType: v.optional(v.string()), // "header"|"reasoning"|"ruling"|undefined=all
    department:  v.optional(v.string()), // "commercial"|"civil"|undefined=all
    actYear:     v.optional(v.string()), // exact year string e.g. "2016"|undefined=all
    limit:       v.optional(v.number()),
    vectorScoreThreshold: v.optional(v.number()), // default 0.4; pass 0 to test with no threshold
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    // Build filters — only include fields that were provided.
    // Omitting a filter = search across all values for that dimension.
    const filters: EntryFilter<VksFilterTypes>[] = [];
    if (args.sectionType) filters.push({ name: "sectionType" as const, value: args.sectionType });
    if (args.department)  filters.push({ name: "department"  as const, value: args.department });
    if (args.actYear)     filters.push({ name: "actYear"     as const, value: args.actYear });

    // 1. Vector similarity search
    const { results, entries } = await rag.search(ctx, {
      namespace:            args.namespace ?? "vks-commercial",
      query:                args.query,
      limit:                args.limit ?? 20,
      vectorScoreThreshold: args.vectorScoreThreshold ?? 0, // TODO: raise to 0.4 after full ingest
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
        actId:       metadata?.actId      ?? "",
        actTitle:    metadata?.actTitle    ?? "",
        actUrl:      metadata?.actUrl      ?? "",
        actDate:     metadata?.actDate     ?? "",
        actNumber:   metadata?.actNumber   ?? "",
        caseNumber:  metadata?.caseNumber  ?? "",
        caseYear:    metadata?.caseYear    ?? "",
        department:  metadata?.department  ?? "",
        sectionType: metadata?.sectionType ?? "",
        chunkIndex:  metadata?.chunkIndex  ?? 0,
      };
    });
  },
});

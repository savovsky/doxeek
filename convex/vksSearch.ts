// convex/vksSearch.ts
// Public search action — called from the React UI via useAction().
// "use node" required because rag.search() calls Cohere for query embedding (S16).
"use node";

import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import type { EntryFilter } from "@convex-dev/rag";
import { rag } from "./rag.config";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

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

// ── LLM re-ranking helper ────────────────────────────────────────────────────
// Takes query + candidate chunks (already deduplicated by actId) and asks
// GPT-4o-mini to score each 0–10 for relevance to the query.
// Returns one score per ragKey so the caller can filter and sort.

interface RerankCandidate {
  ragKey:    string;
  chunkText: string;
  actTitle:  string;
  actId:     string;
}

interface RerankResult {
  ragKey:         string;
  relevanceScore: number; // 0–10
}

async function rerankWithLLM(
  query: string,
  candidates: RerankCandidate[],
): Promise<RerankResult[]> {
  const chunksText = candidates
    .map((c, i) => `[${i}] (${c.actTitle})\n${c.chunkText}`)
    .join("\n\n---\n\n");

  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: z.object({
      rankings: z.array(z.object({
        index:          z.number().describe("The chunk index [0], [1], etc."),
        relevanceScore: z.number().min(0).max(10).describe("0 = completely irrelevant, 10 = directly answers the query"),
      })),
    }),
    prompt:
`You are a Bulgarian legal research assistant specialising in commercial court decisions from the Supreme Court of Cassation (ВКС).

Given the user's search query and the following text chunks from court decisions, rate each chunk's relevance to the query on a scale of 0–10:

- 10: Directly discusses the exact legal topic of the query
- 7-9: Closely related, discusses the same legal concept or issue
- 4-6: Tangentially related, mentions similar concepts but different context
- 1-3: Barely related, only shares common legal vocabulary
- 0: Completely irrelevant

USER QUERY: ${query}

CHUNKS:
${chunksText}

Rate ALL ${candidates.length} chunks. Be strict — only rate 7+ if the chunk genuinely discusses the query topic, not just because it uses similar legal terms.`,
    temperature: 0,
  });

  return object.rankings.map((r) => ({
    ragKey:         candidates[r.index]?.ragKey ?? "",
    relevanceScore: r.relevanceScore,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const filters: EntryFilter<VksFilterTypes>[] = [];
    if (args.department) filters.push({ name: "department" as const, value: args.department });
    // actYear is intentionally NOT added to RAG-level filters.
    // Chunks ingested before S16 were stored without actYear in their filterValues,
    // so the RAG index silently drops them when the filter is applied.
    // We post-filter reliably by actDate from our own vksChunkMetadata table instead.

    // ── Step 1: Wide vector retrieval ──────────────────────────────────────
    // Cast a much wider net than the final result count so the LLM re-ranker
    // has a good pool of candidates. Lower threshold = more recall.
    const requestedLimit = args.limit ?? 10;
    const retrievalLimit = args.actYear
      ? Math.min(requestedLimit * 10, 200)  // extra margin: many cross-year results get post-filtered
      : Math.min(requestedLimit * 5,  100);

    const { results, entries } = await rag.search(ctx, {
      namespace:            args.namespace ?? "vks-commercial",
      query:                args.query,
      limit:                retrievalLimit,
      vectorScoreThreshold: args.vectorScoreThreshold ?? 0.3,  // S18: wider net (was 0.4)
      ...(filters.length > 0 ? { filters } : {}),
    });

    // ── Step 2: Look up metadata ────────────────────────────────────────────
    const ragKeys = entries
      .map((e) => e.key)
      .filter((k): k is string => Boolean(k));

    const metadataMap: Record<string, MetadataRow> = await ctx.runQuery(
      internal.vksSearchQueries.getMetadataByKeys,
      { ragKeys },
    );

    // ── Step 3: Join + deduplicate + post-filter ────────────────────────────
    // Keep only the highest-scoring chunk per decision; apply year post-filter.
    const seen = new Set<string>();
    const candidates = results
      .map((result) => {
        const entry    = entries.find((e) => e.entryId === result.entryId);
        const ragKey   = entry?.key ?? "";
        const metadata = metadataMap[ragKey];
        return {
          vectorScore: result.score,
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
          chunkIndex:  metadata?.chunkIndex  ?? 0,
        };
      })
      .filter((r) => {
        if (!r.actId) return false;                                          // no metadata → stale vector
        if (args.actYear && !r.actDate.startsWith(args.actYear)) return false; // reliable year post-filter
        if (seen.has(r.actId)) return false;                                 // deduplicate by decision
        seen.add(r.actId);
        return true;
      });

    if (candidates.length === 0) return [];

    // ── Step 4: LLM re-ranking ──────────────────────────────────────────────
    // Send the top 20 unique decisions to GPT-4o-mini for relevance scoring.
    // Cap at 20 to keep LLM cost (~$0.001/query) and latency (~2s) predictable.
    const rerankInput = candidates.slice(0, 20).map((c) => ({
      ragKey:    c.ragKey,
      chunkText: c.chunkText,
      actTitle:  c.actTitle,
      actId:     c.actId,
    }));

    const reranked = await rerankWithLLM(args.query, rerankInput);

    // ── Step 5: Filter + sort by LLM score ─────────────────────────────────
    // Only surface decisions the LLM rated ≥ 7/10 (genuinely relevant).
    // Normalize score to 0–1 so the existing ResultCard badge (e.g. "90%")
    // continues to work without any UI changes.
    const RERANK_THRESHOLD = 7.5;  // S18: raised from 7 → 7.5 to cut borderline false positives
    const rerankedMap = new Map(reranked.map((r) => [r.ragKey, r.relevanceScore]));

    return candidates
      .filter((c)    => (rerankedMap.get(c.ragKey) ?? 0) >= RERANK_THRESHOLD)
      .sort((a, b)   => (rerankedMap.get(b.ragKey) ?? 0) - (rerankedMap.get(a.ragKey) ?? 0))
      .slice(0, requestedLimit)
      .map((c) => ({
        score:      (rerankedMap.get(c.ragKey) ?? 0) / 10,  // 0–10 → 0–1 for % badge
        chunkText:  c.chunkText,
        ragKey:     c.ragKey,
        actId:      c.actId,
        actTitle:   c.actTitle,
        actUrl:     c.actUrl,
        actDate:    c.actDate,
        actNumber:  c.actNumber,
        caseNumber: c.caseNumber,
        caseYear:   c.caseYear,
        department: c.department,
        chunkIndex: c.chunkIndex,
      }));
  },
});

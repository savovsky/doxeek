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
  department: string;
  chunkIndex: number;
};

type MetadataRow = {
  ragKey:     string;
  actId:      string;
  actTitle:   string;
  actUrl:     string;
  actDate:    string;
  department: string;
  chunkIndex: number;
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
    query:       v.string(),
    department:  v.optional(v.string()),
    actYearFrom: v.optional(v.string()),   // range start (inclusive)
    actYearTo:   v.optional(v.string()),   // range end   (inclusive)
    limit:       v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    const limit = args.limit ?? 20;

    // Fetch more chunks than needed so we have enough unique decisions after dedup.
    // With ~20 chunks/decision on average, limit×10 gives a safe margin.
    const fetchLimit = Math.min(limit * 10, 200);

    // BM25 index only supports exact-match year filter (not ranges).
    // Pass actYear only when the caller wants a single exact year; otherwise
    // fetch without year filter and post-filter on actDate below.
    const exactYear = (args.actYearFrom && args.actYearFrom === args.actYearTo)
      ? args.actYearFrom
      : undefined;

    const rows = await ctx.runQuery(api.vksSearchQueries.keywordSearchDecisions, {
      query:      args.query,
      department: args.department,
      actYear:    exactYear,
      limit:      fetchLimit,
    });

    // Post-filter by date range (handles the non-exact-match case).
    const filtered = rows.filter(row => {
      if (args.actYearFrom && row.actDate < `${args.actYearFrom}-01-01`) return false;
      if (args.actYearTo   && row.actDate > `${args.actYearTo}-12-31`)   return false;
      return true;
    });

    // Deduplicate: keep only the first (best-ranked) chunk per decision.
    const seen = new Set<string>();
    const deduped = filtered.filter(row => {
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

// ── Reciprocal Rank Fusion ───────────────────────────────────────────────────
// Merges a vector-ranked list and a keyword-ranked list into a single ranked
// list. Deduplicates at the decision level (by actId). Items appearing in both
// lists get a combined score; items in only one list get a single-source score.
// Higher RRF score = more relevant.

const RRF_K = 60; // Standard RRF dampening constant

interface RankedItem {
  ragKey:     string;
  actId:      string;
  chunkText:  string;
  actTitle:   string;
  actUrl:     string;
  actDate:    string;
  department: string;
  chunkIndex: number;
  score:      number | null;
}

function reciprocalRankFusion(
  vectorResults:  RankedItem[],
  keywordResults: RankedItem[],
): (RankedItem & { rrfScore: number })[] {
  const scoreMap = new Map<string, { item: RankedItem; rrfScore: number }>();

  // Vector results are already deduplicated (one chunk per decision).
  vectorResults.forEach((item, rank) => {
    const existing     = scoreMap.get(item.actId);
    const contribution = 1 / (RRF_K + rank + 1); // rank is 0-based; RRF uses 1-based
    if (existing) {
      existing.rrfScore += contribution;
    } else {
      scoreMap.set(item.actId, { item, rrfScore: contribution });
    }
  });

  // Keyword results may have multiple chunks per decision — each boosts the score,
  // which correctly signals that this decision is highly relevant.
  keywordResults.forEach((item, rank) => {
    const existing     = scoreMap.get(item.actId);
    const contribution = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.rrfScore += contribution;
    } else {
      scoreMap.set(item.actId, { item, rrfScore: contribution });
    }
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ item, rrfScore }) => ({ ...item, rrfScore }));
}

// ─────────────────────────────────────────────────────────────────────────────

export const searchDecisions = action({
  args: {
    query:       v.string(),
    namespace:   v.optional(v.string()),
    department:  v.optional(v.string()),
    actYearFrom: v.optional(v.string()),   // range start (inclusive)
    actYearTo:   v.optional(v.string()),   // range end   (inclusive)
    limit:       v.optional(v.number()),
    vectorScoreThreshold: v.optional(v.number()),
    // sectionType REMOVED
  },
  handler: async (ctx, args): Promise<DecisionResult[]> => {
    const requestedLimit = args.limit ?? 10;

    // ── Step 1: Build RAG filters ─────────────────────────────────────────
    const filters: EntryFilter<VksFilterTypes>[] = [];
    if (args.department) filters.push({ name: "department" as const, value: args.department });
    // actYear is intentionally NOT added to RAG-level filters.
    // Chunks ingested before S16 were stored without actYear in their filterValues,
    // so the RAG index silently drops them when the filter is applied.
    // We post-filter reliably by actDate from our own vksChunkMetadata table instead.

    // ── Step 2: Parallel retrieval (vector + keyword) ─────────────────────
    // Vector and keyword search run concurrently; BM25 finishes long before
    // Cohere embedding completes, so Promise.all adds near-zero latency.
    const retrievalLimit = (args.actYearFrom || args.actYearTo)
      ? Math.min(requestedLimit * 10, 200) // extra margin: many cross-year results get post-filtered
      : Math.min(requestedLimit * 5,  100);

    // Inner helper: RAG vector search + metadata lookup + dedup + year post-filter.
    const getVectorCandidates = async (): Promise<RankedItem[]> => {
      const { results, entries } = await rag.search(ctx, {
        namespace:            args.namespace ?? "vks",
        query:                args.query,
        limit:                retrievalLimit,
        vectorScoreThreshold: args.vectorScoreThreshold ?? 0.3, // wider net than S18's 0.4
        ...(filters.length > 0 ? { filters } : {}),
      });

      const ragKeys = entries
        .map((e) => e.key)
        .filter((k): k is string => Boolean(k));

      const metadataMap: Record<string, MetadataRow> = await ctx.runQuery(
        internal.vksSearchQueries.getMetadataByKeys,
        { ragKeys },
      );

      // Keep only the highest-scoring chunk per decision; apply year post-filter.
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
            department: metadata?.department  ?? "",
            chunkIndex: metadata?.chunkIndex  ?? 0,
          };
        })
        .filter((r) => {
          if (!r.actId) return false;                                                        // no metadata → stale vector
          // TODO S27: re-enable RAG-level actYear filter when actYearFrom === actYearTo
          if (args.actYearFrom && r.actDate < `${args.actYearFrom}-01-01`) return false;    // year range post-filter
          if (args.actYearTo   && r.actDate > `${args.actYearTo}-12-31`)   return false;    // year range post-filter
          if (seen.has(r.actId)) return false;                                               // deduplicate by decision
          seen.add(r.actId);
          return true;
        });
    };

    const [vectorCandidates, rawKeywordCandidates] = await Promise.all([
      getVectorCandidates(),
      // BM25 handles exact single-year matches natively; for ranges it returns
      // all years and we post-filter on actDate below.
      ctx.runQuery(api.vksSearchQueries.keywordSearchDecisions, {
        query:      args.query,
        department: args.department,
        // BM25 only supports exact-match year filter — pass actYear only for single-year exact match
        actYear:    (args.actYearFrom && args.actYearFrom === args.actYearTo) ? args.actYearFrom : undefined,
        limit:      30,
      }),
    ]);

    // Post-filter keyword candidates by year range (mirrors the vector path).
    // Necessary when actYearFrom !== actYearTo — BM25 returns all years in that case.
    const keywordCandidates = rawKeywordCandidates.filter(row => {
      if (args.actYearFrom && row.actDate < `${args.actYearFrom}-01-01`) return false;
      if (args.actYearTo   && row.actDate > `${args.actYearTo}-12-31`)   return false;
      return true;
    });

    // ── Step 3: Merge with Reciprocal Rank Fusion ─────────────────────────
    // Decisions appearing in both lists get a combined RRF score; decisions
    // found by only one method still enter the pool (graceful degradation).
    const merged = reciprocalRankFusion(vectorCandidates, keywordCandidates);

    if (merged.length === 0) return [];

    // ── Step 4: LLM re-ranking ─────────────────────────────────────────────
    // Send the top 20 merged decisions to GPT-4o-mini for relevance scoring.
    // Cap at 20 to keep LLM cost (~$0.001/query) and latency (~2s) predictable.
    const rerankInput = merged.slice(0, 20).map((c) => ({
      ragKey:    c.ragKey,
      chunkText: c.chunkText,
      actTitle:  c.actTitle,
      actId:     c.actId,
    }));

    const reranked = await rerankWithLLM(args.query, rerankInput);

    // ── Step 5: Filter + sort by LLM score ────────────────────────────────
    // Only surface decisions the LLM rated ≥ 7.5/10 (genuinely relevant).
    // Normalise score to 0–1 so the existing ResultCard badge (e.g. "90%")
    // continues to work without any UI changes.
    const RERANK_THRESHOLD = 7.5; // raised from 7 → 7.5 in S18 to cut borderline false positives
    const rerankedMap = new Map(reranked.map((r) => [r.ragKey, r.relevanceScore]));

    return merged
      .filter((c)  => (rerankedMap.get(c.ragKey) ?? 0) >= RERANK_THRESHOLD)
      .sort((a, b) => (rerankedMap.get(b.ragKey) ?? 0) - (rerankedMap.get(a.ragKey) ?? 0))
      .slice(0, requestedLimit)
      .map((c) => ({
        score:      (rerankedMap.get(c.ragKey) ?? 0) / 10, // 0–10 → 0–1 for % badge
        chunkText:  c.chunkText,
        ragKey:     c.ragKey,
        actId:      c.actId,
        actTitle:   c.actTitle,
        actUrl:     c.actUrl,
        actDate:    c.actDate,
        department: c.department,
        chunkIndex: c.chunkIndex,
      }));
  },
});

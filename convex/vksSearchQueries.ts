// convex/vksSearchQueries.ts
// Internal query — enriches RAG search results with display metadata.
// Called by vksSearch.ts action via ctx.runQuery().
// Also exports the public keywordSearchDecisions query for BM25 keyword search.
import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const getMetadataByKeys = internalQuery({
  args: { ragKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.ragKeys.map((key) =>
        ctx.db
          .query("vksChunkMetadata")
          .withIndex("by_ragKey", (q) => q.eq("ragKey", key))
          .unique(),
      ),
    );
    // Return map of ragKey → metadata row for O(1) lookup in the action
    const map: Record<string, typeof rows[number]> = {};
    for (const row of rows) {
      if (row) map[row.ragKey] = row;
    }
    return map;
  },
});

/**
 * Public Convex BM25 keyword search over ingested VKS chunks.
 *
 * Why a query (not action): uses ctx.db directly — no OpenAI call, no cost.
 * Reactive via useQuery; can also be triggered manually via controlled args.
 *
 * Returns the same shape as searchDecisions, except score is null
 * (keyword search has no cosine similarity score). The UI hides the
 * score badge when score is null.
 */
export const keywordSearchDecisions = query({
  args: {
    query:      v.string(),
    department: v.optional(v.string()),
    actYear:    v.optional(v.string()),
    limit:      v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const rows = await ctx.db
      .query("vksChunkMetadata")
      .withSearchIndex("search_by_text", (q) => {
        let search = q.search("text", args.query);
        if (args.actYear)    search = search.eq("actYear",    args.actYear);
        if (args.department) search = search.eq("department", args.department);
        return search;
      })
      .take(limit);

    return rows.map((row) => ({
      score:      null as number | null,  // keyword search has no cosine score
      chunkText:  row.text,
      ragKey:     row.ragKey,
      actId:      row.actId,
      actTitle:   row.actTitle,
      actUrl:     row.actUrl,
      actDate:    row.actDate,
      actNumber:  row.actNumber,
      caseNumber: row.caseNumber,
      caseYear:   row.caseYear,
      department: row.department,
      chunkIndex: row.chunkIndex,
    }));
  },
});

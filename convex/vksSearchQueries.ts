// convex/vksSearchQueries.ts
// Internal query — enriches RAG search results with display metadata.
// Called by vksSearch.ts action via ctx.runQuery().
import { internalQuery } from "./_generated/server";
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

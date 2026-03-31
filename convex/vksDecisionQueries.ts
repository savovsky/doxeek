// convex/vksDecisionQueries.ts
// Returns all chunks for a decision in document order.
// Used by the DecisionPanel UI to reconstruct the full decision content.
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getDecisionChunks = query({
  args: { actId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("vksChunkMetadata")
      .withIndex("by_actId_chunkIndex", (q) => q.eq("actId", args.actId))
      .order("asc")
      .collect();

    return chunks;
  },
});

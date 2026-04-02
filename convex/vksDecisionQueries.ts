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

// Returns the original full text (nothing stripped) for a single decision.
// Used by the Decision Panel to display the complete document.
export const getDecisionFullText = query({
  args: { actId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vksDecisions")
      .withIndex("by_actId", (q) => q.eq("actId", args.actId))
      .first();
  },
});

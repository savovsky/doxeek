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

// Returns the storage URL for the original full text of a single decision.
// Client (DecisionPanel) fetches the text via fetch(textUrl).then(r => r.text()).
export const getDecisionFullText = query({
  args: { actId: v.string() },
  handler: async (ctx, args) => {
    const decision = await ctx.db
      .query("vksDecisions")
      .withIndex("by_actId", (q) => q.eq("actId", args.actId))
      .first();

    if (!decision) return null;

    const textUrl = await ctx.storage.getUrl(decision.storageId);

    return {
      actId:      decision.actId,
      actTitle:   decision.actTitle,
      actUrl:     decision.actUrl,
      actDate:    decision.actDate,
      department: decision.department,
      caseNumber: decision.caseNumber,
      caseYear:   decision.caseYear,
      textUrl,    // signed Convex storage URL — client fetches text from here
    };
  },
});

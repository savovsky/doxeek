// convex/vksIngestMutations.ts
// Separated from vksIngest.ts because Convex requires that "use node" actions
// and queries/mutations never share a file.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const storeChunkMetadata = internalMutation({
  args: {
    ragKey:     v.string(),
    actId:      v.string(),
    actDate:    v.string(),
    actTitle:   v.string(),
    actUrl:     v.string(),
    caseNumber: v.string(),
    caseYear:   v.string(),
    department: v.string(),
    actYear:    v.string(),   // required (fresh start)
    chunkIndex: v.number(),
    text:       v.string(),
    storageId:  v.optional(v.id("_storage")),  // Id<"_storage"> | undefined — only on chunk 0
    // actNumber REMOVED (S22)
  },
  handler: async (ctx, args) => {
    // Destructure fields that don't belong in vksChunkMetadata
    const { storageId, caseNumber, caseYear, ...chunkMeta } = args;

    const existing = await ctx.db
      .query("vksChunkMetadata")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", args.ragKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, chunkMeta);
    } else {
      await ctx.db.insert("vksChunkMetadata", chunkMeta);
    }

    // Upsert vksDecisions on chunk 0
    if (args.chunkIndex === 0 && args.storageId) {
      const existingDecision = await ctx.db
        .query("vksDecisions")
        .withIndex("by_actId", (q) => q.eq("actId", args.actId))
        .first();

      const decisionData = {
        actTitle:   args.actTitle,
        actUrl:     args.actUrl,
        storageId:  args.storageId,
        caseNumber: args.caseNumber,
        caseYear:   args.caseYear,
        actDate:    args.actDate,
        department: args.department,
      };

      if (existingDecision) {
        // On re-ingest: delete the old blob before saving the new storageId.
        // ctx.storage.delete() works in mutations (ID-based, no Blob upload).
        await ctx.storage.delete(existingDecision.storageId);
        await ctx.db.patch(existingDecision._id, decisionData);
      } else {
        await ctx.db.insert("vksDecisions", { actId: args.actId, ...decisionData });
      }
    }
  },
});

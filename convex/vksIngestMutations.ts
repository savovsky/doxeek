// convex/vksIngestMutations.ts
// Separated from vksIngest.ts because Convex requires that "use node" actions
// and queries/mutations never share a file.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const storeChunkMetadata = internalMutation({
  args: {
    ragKey:      v.string(),
    actId:       v.string(),
    actNumber:   v.string(),
    actDate:     v.string(),
    actTitle:    v.string(),
    actUrl:      v.string(),
    caseNumber:  v.string(),
    caseYear:    v.string(),
    department:  v.string(),
    sectionType: v.string(),
    chunkIndex:  v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("vksChunkMetadata")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", args.ragKey))
      .unique();

    if (!existing) {
      await ctx.db.insert("vksChunkMetadata", args);
    }
    // If already exists — skip. Re-running ingest is idempotent.
  },
});

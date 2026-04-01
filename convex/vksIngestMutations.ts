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
    actYear:     v.optional(v.string()),   // NEW: "2016" — needed for searchIndex filterField
    chunkIndex:  v.number(),
    text:        v.string(),
    // sectionType REMOVED
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("vksChunkMetadata")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", args.ragKey))
      .unique();

    if (existing) {
      // Upsert — update existing row (backfills text on re-ingest)
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("vksChunkMetadata", args);
    }
  },
});

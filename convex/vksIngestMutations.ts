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
    fullText:    v.optional(v.string()),   // S17: original actPlainText, only present on chunk 0
    // sectionType REMOVED
  },
  handler: async (ctx, args) => {
    // Destructure fullText out — it lives in vksDecisions, not vksChunkMetadata
    const { fullText, ...chunkMeta } = args;

    const existing = await ctx.db
      .query("vksChunkMetadata")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", args.ragKey))
      .unique();

    if (existing) {
      // Upsert — update existing row (backfills text on re-ingest)
      await ctx.db.patch(existing._id, chunkMeta);
    } else {
      await ctx.db.insert("vksChunkMetadata", chunkMeta);
    }

    // When chunkIndex === 0, upsert the full decision text into vksDecisions.
    // This stores the original unstripped actPlainText for the Decision Panel to display.
    if (args.chunkIndex === 0 && args.fullText) {
      const existingDecision = await ctx.db
        .query("vksDecisions")
        .withIndex("by_actId", (q) => q.eq("actId", args.actId))
        .first();

      if (existingDecision) {
        await ctx.db.patch(existingDecision._id, {
          actTitle: args.actTitle,
          actUrl:   args.actUrl,
          fullText: args.fullText,
        });
      } else {
        await ctx.db.insert("vksDecisions", {
          actId:    args.actId,
          actTitle: args.actTitle,
          actUrl:   args.actUrl,
          fullText: args.fullText,
        });
      }
    }
  },
});

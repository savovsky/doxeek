// convex/vksIngest.ts
// "use node" required — rag.add() calls OpenAI (external HTTP).
"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { rag } from "./rag.config";

const chunkValidator = v.object({
  text: v.string(),
  metadata: v.object({
    actId:       v.string(),
    actNumber:   v.string(),
    actDate:     v.string(),
    actTitle:    v.string(),
    actUrl:      v.string(),
    caseNumber:  v.string(),
    caseYear:    v.string(),
    department:  v.string(),
    chunkIndex:  v.number(),
    // sectionType REMOVED
  }),
});

export const ingestBatch = internalAction({
  args: {
    namespace: v.string(),
    chunks:    v.array(chunkValidator),
  },
  handler: async (ctx, args) => {
    let ingested = 0;

    for (const chunk of args.chunks) {
      const {
        actId, actNumber, actDate, actTitle, actUrl,
        caseNumber, caseYear, department, chunkIndex,
      } = chunk.metadata;

      const ragKey = `${actId}_${chunkIndex}`;

      // 1. Embed + store in RAG vector store
      await rag.add(ctx, {
        namespace: args.namespace,
        key:       ragKey,
        chunks:    [chunk.text],
        filterValues: [
          { name: "department", value: department },
          { name: "actYear",   value: actDate.slice(0, 4) }, // "2016-04-22" → "2016"
          // sectionType REMOVED
        ],
      });

      // 2. Store display metadata in our own table
      await ctx.runMutation(internal.vksIngestMutations.storeChunkMetadata, {
        ragKey, actId, actNumber, actDate, actTitle, actUrl,
        caseNumber, caseYear, department,
        actYear: actDate.slice(0, 4), // NEW
        chunkIndex,
        text: chunk.text,
        // sectionType REMOVED
      });

      ingested++;
    }

    return { ingested };
  },
});

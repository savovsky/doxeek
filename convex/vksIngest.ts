// convex/vksIngest.ts
// "use node" required — rag.add() calls OpenAI (external HTTP).
"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { rag } from "./rag.config";

const chunkValidator = v.object({
  text: v.string(),
  metadata: v.object({
    actId:       v.string(),
    actDate:     v.string(),
    actTitle:    v.string(),
    actUrl:      v.string(),
    caseNumber:  v.string(),
    caseYear:    v.string(),
    department:  v.string(),
    chunkIndex:  v.number(),
    fullText:    v.optional(v.string()),   // original actPlainText, only on chunk 0
    actNumber:   v.optional(v.string()),   // present in old JSONL — accepted but ignored
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
        actId, actDate, actTitle, actUrl,
        caseNumber, caseYear, department, chunkIndex, fullText,
      } = chunk.metadata;

      const ragKey  = `${actId}_${chunkIndex}`;
      const actYear = actDate.slice(0, 4); // "2016-04-22" → "2016"

      // 1. Embed + store in RAG vector store
      await rag.add(ctx, {
        namespace: args.namespace,
        key:       ragKey,
        chunks:    [chunk.text],
        filterValues: [
          { name: "department", value: department },
          { name: "actYear",   value: actYear },
        ],
      });

      // 2. If this is chunk 0, store the full text as a File Storage blob.
      //    ctx.storage.store() (Blob upload) is only available in actions — NOT mutations.
      //    The resulting storageId is passed to the mutation as a plain ID reference.
      let storageId: Id<"_storage"> | undefined;
      if (chunkIndex === 0 && fullText) {
        storageId = await ctx.storage.store(
          new Blob([fullText], { type: "text/plain" })
        );
      }

      // 3. Store display metadata in our own table
      await ctx.runMutation(internal.vksIngestMutations.storeChunkMetadata, {
        ragKey, actId, actDate, actTitle, actUrl,
        caseNumber, caseYear, department, actYear,
        chunkIndex,
        text: chunk.text,
        storageId,   // Id<"_storage"> | undefined — only present on chunk 0
      });

      ingested++;
    }

    return { ingested };
  },
});

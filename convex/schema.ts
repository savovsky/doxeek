import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export default defineSchema({
  ...authTables,
  numbers: defineTable({
    value: v.number(),
  }),

  // Stores display metadata for each ingested RAG chunk.
  // ragKey = actId + "_" + chunkIndex — matches the key passed to rag.add().
  // Looked up after rag.search() to enrich results with actTitle, actUrl, etc.
  vksChunkMetadata: defineTable({
    ragKey:      v.string(),
    actId:       v.string(),
    actNumber:   v.string(),
    actDate:     v.string(),   // ISO 8601 "YYYY-MM-DD"
    actTitle:    v.string(),
    actUrl:      v.string(),
    caseNumber:  v.string(),
    caseYear:    v.string(),
    department:  v.string(),
    sectionType: v.string(),
    chunkIndex:  v.number(),
  }).index("by_ragKey", ["ragKey"]),
});

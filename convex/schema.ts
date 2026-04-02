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
    actYear:     v.optional(v.string()),   // "2016" — set at ingest; optional for backwards-compat with pre-S9 records (re-ingested in S11)
    sectionType: v.optional(v.string()),   // DEPRECATED — present in pre-S9 test records only; not written by new ingest; removed after S11 re-ingest
    chunkIndex:  v.number(),
    text:        v.string(),   // chunk's embeddable text content
  })
    .index("by_ragKey",           ["ragKey"])
    .index("by_actId_chunkIndex", ["actId", "chunkIndex"])
    .searchIndex("search_by_text", {
      searchField:  "text",
      filterFields: ["department", "actYear"],
    }),

  // Stores the original full text of each ingested decision (one row per decision).
  // Used by the Decision Panel to display the complete document including header and footer.
  // The actPlainText is stored unstripped — nothing is removed.
  vksDecisions: defineTable({
    actId:    v.string(),
    actTitle: v.string(),
    actUrl:   v.string(),
    fullText: v.string(),   // original actPlainText — nothing stripped
  }).index("by_actId", ["actId"]),
});

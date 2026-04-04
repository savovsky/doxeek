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
    ragKey:     v.string(),
    actId:      v.string(),
    actDate:    v.string(),   // ISO 8601 "YYYY-MM-DD"
    actTitle:   v.string(),
    actUrl:     v.string(),
    department: v.string(),   // "commercial" | "civil"
    actYear:    v.string(),   // "2016" — required (fresh start, no backwards-compat)
    chunkIndex: v.number(),
    text:       v.string(),   // chunk's embeddable text content
  })
    .index("by_ragKey",           ["ragKey"])
    .index("by_actId_chunkIndex", ["actId", "chunkIndex"])
    .searchIndex("search_by_text", {
      searchField:  "text",
      filterFields: ["department", "actYear"],
    }),

  // Stores the original full text of each ingested decision (one row per decision).
  // Used by the Decision Panel to display the complete document including header and footer.
  vksDecisions: defineTable({
    actId:      v.string(),
    actTitle:   v.string(),
    actUrl:     v.string(),
    storageId:  v.id("_storage"),  // Convex File Storage — full unstripped decision text
    caseNumber: v.string(),   // docket number — for future case lookup feature
    caseYear:   v.string(),   // year case was filed — for future case lookup feature
    actDate:    v.string(),   // ISO 8601 "YYYY-MM-DD" — for future sort by date
    department: v.string(),   // "commercial" | "civil" — for panel label
  }).index("by_actId", ["actId"])
    .index("by_case",  ["caseNumber", "caseYear"]),  // for direct case lookup (O4)
});

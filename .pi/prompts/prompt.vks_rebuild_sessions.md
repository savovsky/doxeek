# How to start a VKS Rebuild session

Read these two files in order before doing anything:

1. `docs/VKS_REBUILD_PLAN.md` — architecture decisions, target schema, key API facts,
   file map, session table, cost reference
2. Your session's plan — link is in the session table in `VKS_REBUILD_PLAN.md`

Then confirm you have read both and summarise:

- Which session you are starting
- Which files you will create or edit
- The done criteria for this session

Then ask for permission to start implementing.

---

## Context you must know before coding

- Convex is **empty** — fresh rebuild, no existing data to migrate or preserve
- RAG namespace is `"vks"` (unified — not `"vks-commercial"`)
- `department` filter (`"commercial"` | `"civil"`) distinguishes departments in both RAG and BM25
- `actNumber` does not exist anywhere in the codebase — do not add it
- `fullText` is stored in **Convex File Storage** as `storageId`, not as a DB string
- Year filtering uses `actYearFrom` / `actYearTo` (range), not a single `actYear`
- Historical sessions S1–S20 are documented in `docs/VKS_SEARCH_PLAN.md` — read only
  if you need to understand why a specific decision was made.
  **Do NOT import code patterns from S1–S20** — those sessions used the old schema.
- **Do NOT run full ingest (S26) until S23 is complete** — S22 deploys `fullText: v.string()`
  as a temporary placeholder; S23 converts it to File Storage. Ingesting data between
  S22 and S23 would create rows that need manual cleanup.

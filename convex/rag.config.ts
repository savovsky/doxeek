// convex/rag.config.ts
// Single source of truth for the RAG instance.
// Import `rag` from here wherever rag.add() or rag.search() is called.
//
// CRITICAL: textEmbeddingModel + embeddingDimension must NEVER change after
// first ingest. Changing either requires a full re-ingest.

import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { components } from "./_generated/api";

type VksFilterTypes = {
  department: string; // "commercial" | "civil"
  actYear: string;    // "2016" — 4-char string extracted from actDate
  // sectionType REMOVED
};

export const rag = new RAG<VksFilterTypes>(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
  filterNames: ["department", "actYear"],  // sectionType REMOVED
});

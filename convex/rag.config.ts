// convex/rag.config.ts
// Single source of truth for the RAG instance.
// Import `rag` from here wherever rag.add() or rag.search() is called.
//
// CRITICAL: textEmbeddingModel + embeddingDimension must NEVER change after
// first ingest. Changing either requires a full re-ingest.
//
// S16: Switched from OpenAI text-embedding-3-large (3072 dims) to Cohere
// embed-multilingual-v3.0 (1024 dims). OpenAI embeddings produced 41–56%
// scores on Bulgarian legal text with effectively random relevance.
// Cohere is purpose-built for multilingual semantic similarity.

import { RAG } from "@convex-dev/rag";
import { cohere } from "@ai-sdk/cohere";
import { components } from "./_generated/api";

type VksFilterTypes = {
  department: string; // "commercial" | "civil"
  actYear: string;    // "2016" — 4-char string extracted from actDate
  // sectionType REMOVED
};

export const rag = new RAG<VksFilterTypes>(components.rag, {
  textEmbeddingModel: cohere.embedding("embed-multilingual-v3.0"),  // S16: Cohere multilingual, purpose-built for non-English
  embeddingDimension: 1024,                                          // S16: Cohere v3 outputs 1024 dims
  filterNames: ["department", "actYear"],  // sectionType REMOVED
});

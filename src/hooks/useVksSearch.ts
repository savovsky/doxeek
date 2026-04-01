import { useAction }  from "convex/react";
import { api }        from "../../convex/_generated/api";
import { useState }   from "react";

export type SearchMode = "vector" | "keyword";

/**
 * Unified result shape for both vector and keyword search.
 * score is null for keyword results (BM25 has no cosine similarity score).
 */
export type SearchResult = {
  score:      number | null;
  chunkText:  string;
  ragKey:     string;
  actId:      string;
  actTitle:   string;
  actUrl:     string;
  actDate:    string;
  actNumber:  string;
  caseNumber: string;
  caseYear:   string;
  department: string;
  chunkIndex: number;
};

export interface SearchParams {
  query:      string;
  department?: string;
  actYear?:   string;
  limit?:     number;
  // sectionType REMOVED in S9
}

export function useVksSearch() {
  const vectorSearch  = useAction(api.vksSearch.searchDecisions);
  const keywordSearch = useAction(api.vksSearch.keywordSearchDecisions);

  const [results,     setResults]     = useState<SearchResult[]>([]);
  const [isLoading,   setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMode,  setSearchMode]  = useState<SearchMode>("vector");

  const search = async (params: SearchParams) => {
    if (!params.query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res: SearchResult[] = searchMode === "vector"
        ? await vectorSearch(params)
        : await keywordSearch(params);

      console.log(`[useVksSearch] ${searchMode} results:`, res.length);
      setResults(res);
      setHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => { setResults([]); setError(null); setHasSearched(false); };

  return { search, results, isLoading, error, hasSearched, searchMode, setSearchMode, clear };
}

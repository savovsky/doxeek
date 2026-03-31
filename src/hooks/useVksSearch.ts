import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";

// Infer the return type from the action signature — stays in sync automatically.
type SearchResult = Awaited<ReturnType<typeof api.vksSearch.searchDecisions>>[number];

export interface SearchParams {
  query:        string;
  sectionType?: string;
  department?:  string;
  actYear?:     string;
  limit?:       number;
}

export type { SearchResult };

export function useVksSearch() {
  const searchAction            = useAction(api.vksSearch.searchDecisions);
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [isLoading, setLoading]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const search = async (params: SearchParams) => {
    if (!params.query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchAction(params);
      console.log('[useVksSearch] raw results:', res);
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

  return { search, results, isLoading, error, hasSearched, clear };
}

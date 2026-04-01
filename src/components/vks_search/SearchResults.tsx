import Alert            from "@mui/material/Alert";
import Box              from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack            from "@mui/material/Stack";
import Typography       from "@mui/material/Typography";
import { ResultCard }   from "./ResultCard";
import type { SearchResult, SearchMode } from "../../hooks/useVksSearch";

interface Props {
  results:        SearchResult[];
  isLoading:      boolean;
  error:          string | null;
  hasSearched:    boolean;
  selectedRagKey: string | null;
  onSelectResult: (result: SearchResult) => void;
  searchMode?:    SearchMode;
}

export function SearchResults({
  results, isLoading, error, hasSearched, selectedRagKey, onSelectResult, searchMode,
}: Props) {
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (error) {
    return <Alert severity="error" sx={{ mt: 3 }}>{error}</Alert>;
  }
  if (hasSearched && results.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 3 }}>
        No results found. Try a different query or broaden your filters.
      </Alert>
    );
  }
  if (results.length === 0) return null;

  return (
    <Stack spacing={2} sx={{ mt: 3 }}>
      <Typography variant="caption" color="text.secondary">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </Typography>
      {results.map((r, i) => (
        <ResultCard
          key={r.ragKey + i}
          result={r}
          isSelected={r.ragKey === selectedRagKey}
          onSelect={onSelectResult}
          searchMode={searchMode}
        />
      ))}
    </Stack>
  );
}

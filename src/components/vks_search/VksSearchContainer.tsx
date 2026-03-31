import Box        from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { SearchBar }     from "./SearchBar";
import { SearchResults } from "./SearchResults";
import { useVksSearch }  from "../../hooks/useVksSearch";

export function VksSearchContainer() {
  const { search, results, isLoading, error, hasSearched } = useVksSearch();

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", py: 2 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 3 }}>
        VKS Decision Search
      </Typography>
      <SearchBar onSearch={search} isLoading={isLoading} />
      <SearchResults results={results} isLoading={isLoading} error={error} hasSearched={hasSearched} />
    </Box>
  );
}

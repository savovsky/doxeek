import { useState }        from "react";
import Box                 from "@mui/material/Box";
import Divider             from "@mui/material/Divider";
import Paper               from "@mui/material/Paper";
import Typography          from "@mui/material/Typography";
import { SearchBar }       from "./SearchBar";
import { SearchResults }   from "./SearchResults";
import { DecisionPanel }   from "./DecisionPanel";
import { useVksSearch }    from "../../hooks/useVksSearch";
import type { SearchResult } from "../../hooks/useVksSearch";

export function VksSearchContainer() {
  const { search, results, isLoading, error, hasSearched } = useVksSearch();
  const [selected, setSelected] = useState<SearchResult | null>(null);

  const handleSelectResult = (result: SearchResult) => {
    // Toggle off if the same card is clicked again
    setSelected((prev) => prev?.ragKey === result.ragKey ? null : result);
  };

  const showPanel = selected !== null;

  return (
    <Box sx={{ py: 2 }}>
      {/* Search bar — always full width */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 3 }}>
        VKS Decision Search
      </Typography>
      <SearchBar
        onSearch={(params) => { setSelected(null); search(params); }}
        isLoading={isLoading}
      />

      {/* Results + optional side panel */}
      <Box sx={{ display: "flex", gap: 2, mt: 3, alignItems: "flex-start" }}>

        {/* Results column */}
        <Box
          sx={{
            flex:       showPanel ? "0 0 40%" : "1 1 100%",
            minWidth:   0,
            transition: "flex 0.2s",
          }}
        >
          <SearchResults
            results={results}
            isLoading={isLoading}
            error={error}
            hasSearched={hasSearched}
            selectedRagKey={selected?.ragKey ?? null}
            onSelectResult={handleSelectResult}
          />
        </Box>

        {/* Decision panel */}
        {showPanel && (
          <>
            <Divider orientation="vertical" flexItem />
            <Paper
              variant="outlined"
              sx={{
                flex:          "0 0 58%",
                minWidth:      0,
                height:        "80vh",
                display:       "flex",
                flexDirection: "column",
                overflow:      "hidden",
              }}
            >
              <DecisionPanel
                actId={selected.actId}
                actTitle={selected.actTitle}
                actUrl={selected.actUrl}
                highlightRagKey={selected.ragKey}
              />
            </Paper>
          </>
        )}
      </Box>
    </Box>
  );
}

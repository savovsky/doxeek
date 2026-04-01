import { useState }         from "react";
import Box                  from "@mui/material/Box";
import Button               from "@mui/material/Button";
import Stack                from "@mui/material/Stack";
import TextField            from "@mui/material/TextField";
import ToggleButton         from "@mui/material/ToggleButton";
import ToggleButtonGroup    from "@mui/material/ToggleButtonGroup";
import type { SearchParams, SearchMode } from "../../hooks/useVksSearch";

interface Props {
  onSearch:     (params: SearchParams) => void;
  isLoading:    boolean;
  searchMode:   SearchMode;
  onModeChange: (mode: SearchMode) => void;
}

export function SearchBar({ onSearch, isLoading, searchMode, onModeChange }: Props) {
  const [query,   setQuery]   = useState("");
  const [actYear, setActYear] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      query,
      department: "commercial",   // hardcoded for POC — remove when civil is ingested
      actYear:    actYear || undefined,
      limit:      20,
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>

        {/* Row 1: query input + Search button + mode toggle */}
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            fullWidth
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions… (Bulgarian or English)"
            variant="outlined"
          />
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading || !query.trim()}
            sx={{ whiteSpace: "nowrap", minWidth: 100 }}
          >
            {isLoading ? "Searching…" : "Search"}
          </Button>
          <ToggleButtonGroup
            value={searchMode}
            exclusive
            size="small"
            onChange={(_, val: SearchMode | null) => { if (val) onModeChange(val); }}
            sx={{ whiteSpace: "nowrap" }}
          >
            <ToggleButton value="vector"  sx={{ px: 1.5, fontSize: 13 }}>≈ Semantic</ToggleButton>
            <ToggleButton value="keyword" sx={{ px: 1.5, fontSize: 13 }}>Aa Keyword</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {/* Row 2: year filter only (section filter removed in S9/S10) */}
        <Stack direction="row" spacing={2}>
          <TextField
            size="small"
            label="Year"
            value={actYear}
            onChange={(e) => setActYear(e.target.value)}
            placeholder="e.g. 2016"
            inputProps={{ maxLength: 4 }}
            sx={{ width: 120 }}
          />
        </Stack>

      </Stack>
    </Box>
  );
}

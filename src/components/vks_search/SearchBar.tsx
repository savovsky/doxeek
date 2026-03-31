import { useState }  from "react";
import Box           from "@mui/material/Box";
import Button        from "@mui/material/Button";
import MenuItem      from "@mui/material/MenuItem";
import Stack         from "@mui/material/Stack";
import TextField     from "@mui/material/TextField";
import type { SearchParams } from "../../hooks/useVksSearch";

interface Props {
  onSearch:  (params: SearchParams) => void;
  isLoading: boolean;
}

const SECTION_TYPES = [
  { value: "",          label: "All sections" },
  { value: "reasoning", label: "Reasoning" },
  { value: "ruling",    label: "Ruling" },
  { value: "header",    label: "Header" },
];

export function SearchBar({ onSearch, isLoading }: Props) {
  const [query,       setQuery]       = useState("");
  const [sectionType, setSectionType] = useState("");
  const [actYear,     setActYear]     = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({
      query,
      sectionType: sectionType || undefined,
      department:  "commercial",   // hardcoded for POC — remove when civil is ingested
      actYear:     actYear || undefined,
      limit:       20,
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1}>
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
        </Stack>

        <Stack direction="row" spacing={2}>
          <TextField
            select
            size="small"
            label="Section"
            value={sectionType}
            onChange={(e) => setSectionType(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            {SECTION_TYPES.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

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

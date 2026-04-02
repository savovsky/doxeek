import { useState }        from "react";
import Box                 from "@mui/material/Box";
import Button              from "@mui/material/Button";
import Stack               from "@mui/material/Stack";
import TextField           from "@mui/material/TextField";
import ToggleButton        from "@mui/material/ToggleButton";
import ToggleButtonGroup   from "@mui/material/ToggleButtonGroup";
import Typography          from "@mui/material/Typography";
import { TextareaAutosize } from "@mui/material";
import { useTheme }        from "@mui/material/styles";
import type { SearchMode, SearchParams } from "../../hooks/useVksSearch";

// No query length limits — the hybrid + LLM re-ranking pipeline handles
// natural language descriptions well. Longer queries give the re-ranker
// more context and produce better results.

interface Props {
  onSearch:     (params: SearchParams) => void;
  isLoading:    boolean;
  searchMode:   SearchMode;
  onModeChange: (mode: SearchMode) => void;
}

export function SearchBar({ onSearch, isLoading, searchMode, onModeChange }: Props) {
  const [query,   setQuery]   = useState("");
  const [actYear, setActYear] = useState("");
  const theme = useTheme();

  const isSemanticMode = searchMode === "vector";

  const textareaBorderColor = theme.palette.divider;

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSearch({
      query,
      department: "commercial",   // hardcoded for POC
      actYear:    actYear || undefined,
      limit:      20,
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={2}>

        {/* Row 1: query input + Search button + mode toggle */}
        <Stack direction="row" spacing={1} alignItems="flex-start">

          {/* Textarea + counter wrapper */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <TextareaAutosize
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isSemanticMode
                  ? "Опишете правния въпрос… напр. 'строителен договор, изпълнителят не завърши работата и отказва плащане'"
                  : "Въведете точни термини… напр. 'чл.647 ТЗ', 'обр.19', 'неоснователно обогатяване'"
              }
              style={{
                boxSizing:   "border-box",
                width:       "100%",
                fontSize:    "1rem",
                fontFamily:  "Inter, sans-serif",
                fontWeight:  400,
                lineHeight:  1.5,
                padding:     12,
                outline:     0,
                resize:      "none",
                borderRadius: 4,
                border:      `1.5px solid ${textareaBorderColor}`,
                transition:  "border-color 0.2s",
              }}
            />

            {/* Tip — shown when field is empty */}
            {query.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, px: 0.5, display: "block" }}>
                {isSemanticMode
                  ? "Съвет: опишете казуса с ваши думи — повече контекст подобрява резултатите"
                  : "Съвет: въведете точни правни термини, членове или специфични изрази"}
              </Typography>
            )}
          </Box>

          {/* Search button + mode toggle */}
          <Stack spacing={1} alignItems="stretch">
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
        </Stack>

        {/* Row 2: year filter */}
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

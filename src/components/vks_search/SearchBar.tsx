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

// Limits apply to semantic (vector) mode only — keyword mode is unrestricted.
const SEMANTIC_MAX_WORDS = 10;
const SEMANTIC_MAX_CHARS = 150;

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

  // ── Semantic query limits ────────────────────────────────────────────────
  const wordCount = query.trim() === "" ? 0 : query.trim().split(/\s+/).length;
  const charCount = query.length;

  const isSemanticMode   = searchMode === "vector";
  const isOverWordLimit  = isSemanticMode && wordCount > SEMANTIC_MAX_WORDS;
  const isOverCharLimit  = isSemanticMode && charCount > SEMANTIC_MAX_CHARS;
  const isOverLimit      = isOverWordLimit || isOverCharLimit;

  // Counter colour: grey → amber (>80% of either limit) → red (over limit)
  const wordRatio  = wordCount / SEMANTIC_MAX_WORDS;
  const charRatio  = charCount / SEMANTIC_MAX_CHARS;
  const ratio      = Math.max(wordRatio, charRatio);
  const counterColor =
    !isSemanticMode ? "text.disabled"
    : ratio > 1    ? "error.main"
    : ratio > 0.8  ? "warning.main"
    :                "text.disabled";

  const textareaBorderColor =
    isOverLimit
      ? theme.palette.error.main
      : ratio > 0.8
      ? theme.palette.warning.main
      : theme.palette.divider;

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isOverLimit || !query.trim()) return;
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
                  ? "Short topic query… e.g. 'строителен договор неплащане' (max 10 words)"
                  : "Search decisions… (Bulgarian or English)"
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

            {/* Counter + hint — shown only in semantic mode */}
            {isSemanticMode && query.length > 0 && (
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mt: 0.5, px: 0.5 }}
              >
                <Typography variant="caption" color="text.disabled">
                  {isOverLimit
                    ? isOverWordLimit
                      ? `Too long — max ${SEMANTIC_MAX_WORDS} words for semantic search`
                      : `Too long — max ${SEMANTIC_MAX_CHARS} characters for semantic search`
                    : "Short, focused queries give the best results"}
                </Typography>
                <Typography variant="caption" color={counterColor} sx={{ whiteSpace: "nowrap", ml: 1 }}>
                  {wordCount}/{SEMANTIC_MAX_WORDS} words · {charCount}/{SEMANTIC_MAX_CHARS} chars
                </Typography>
              </Stack>
            )}

            {/* Hint when field is empty and in semantic mode */}
            {isSemanticMode && query.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, px: 0.5, display: "block" }}>
                Tip: use 3–10 words describing the legal topic, not a full sentence
              </Typography>
            )}
          </Box>

          {/* Search button + mode toggle */}
          <Stack spacing={1} alignItems="stretch">
            <Button
              type="submit"
              variant="contained"
              disabled={isLoading || !query.trim() || isOverLimit}
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

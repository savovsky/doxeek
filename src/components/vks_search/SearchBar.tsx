import { useState }        from "react";
import Autocomplete       from "@mui/material/Autocomplete";
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
  const [query,      setQuery]      = useState("");
  const [department, setDepartment] = useState<"commercial" | "civil" | "all">("all");
  const [yearFrom,   setYearFrom]   = useState("");
  const [yearTo,     setYearTo]     = useState("");
  const theme = useTheme();

  // VKS decisions span 2008–present; newest first for a more useful dropdown
  // TODO: after S26 ingest, replace with a Convex query on vksChunkMetadata
  // to derive the actual set of years present in the corpus
  const availableYears = Array.from(
    { length: new Date().getFullYear() - 2007 },
    (_, i) => String(new Date().getFullYear() - i)
  );

  const isSemanticMode = searchMode === "vector";

  const textareaBorderColor = theme.palette.divider;

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSearch({
      query,
      department:  department === "all" ? undefined : department,
      actYearFrom: yearFrom || undefined,
      actYearTo:   yearTo   || undefined,
      limit:       20,
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

        {/* Row 2: department toggle + year range */}
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">

          {/* Department toggle */}
          <ToggleButtonGroup
            value={department}
            exclusive
            size="small"
            onChange={(_, val) => { if (val) setDepartment(val); }}
          >
            <ToggleButton value="all"        sx={{ px: 1.5, fontSize: 13 }}>И двете</ToggleButton>
            <ToggleButton value="commercial" sx={{ px: 1.5, fontSize: 13 }}>Търговско</ToggleButton>
            <ToggleButton value="civil"      sx={{ px: 1.5, fontSize: 13 }}>Гражданско</ToggleButton>
          </ToggleButtonGroup>

          {/* Year range */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Autocomplete
              options={availableYears}
              value={yearFrom || null}
              onChange={(_, val) => setYearFrom(val ?? "")}
              renderInput={(params) => (
                <TextField {...params} size="small" label="От година" sx={{ width: 130 }} />
              )}
              freeSolo
            />
            <Typography variant="body2" color="text.secondary">—</Typography>
            <Autocomplete
              options={availableYears}
              value={yearTo || null}
              onChange={(_, val) => setYearTo(val ?? "")}
              renderInput={(params) => (
                <TextField {...params} size="small" label="До година" sx={{ width: 130 }} />
              )}
              freeSolo
            />
          </Stack>

        </Stack>

      </Stack>
    </Box>
  );
}

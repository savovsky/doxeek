import { useEffect, useRef, type JSX } from "react";
import { useQuery }           from "convex/react";
import { api }                from "../../../convex/_generated/api";
import type { Doc }           from "../../../convex/_generated/dataModel";
import type { SearchMode }    from "../../hooks/useVksSearch";
import Box                    from "@mui/material/Box";
import CircularProgress       from "@mui/material/CircularProgress";
import Divider                from "@mui/material/Divider";
import IconButton             from "@mui/material/IconButton";
import OpenInNewIcon          from "@mui/icons-material/OpenInNew";
import Stack                  from "@mui/material/Stack";
import Typography             from "@mui/material/Typography";
import { alpha, useTheme }    from "@mui/material/styles";

interface Props {
  actId:           string;
  actTitle:        string;
  actUrl:          string;
  highlightRagKey: string;
  searchQuery?:    string;
  searchMode?:     SearchMode;
}

/**
 * Highlights query words within a text string.
 * Returns a JSX fragment with <mark> spans around each matched word.
 * Matching is case-insensitive; words shorter than 2 chars are skipped.
 */
function highlightWords(text: string, query: string, color: string): JSX.Element {
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return <>{text}</>;

  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex   = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts   = text.split(regex);
  // split() with a single capture group places matched text at odd indices (1, 3, 5…)

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            style={{
              backgroundColor: color,
              borderRadius:    2,
              padding:         '0 2px',
              fontStyle:       'inherit',
            }}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function DecisionPanel({ actId, actTitle, actUrl, highlightRagKey, searchQuery, searchMode }: Props) {
  const theme        = useTheme();
  const wordMarkColor = alpha(theme.palette.primary.main, 0.3);
  const chunks       = useQuery(api.vksDecisionQueries.getDecisionChunks, { actId });
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to highlighted chunk whenever selection changes
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightRagKey, chunks]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1, lineHeight: 1.4 }}>
          {actTitle}
        </Typography>
        <IconButton
          size="small"
          href={actUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
        >
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Divider />

      {/* Chunks */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
        {!chunks ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={2}>
            {chunks.map((chunk: Doc<"vksChunkMetadata">) => {
              const isHighlighted = chunk.ragKey === highlightRagKey;
              return (
                <Box
                  key={chunk.ragKey}
                  ref={isHighlighted ? highlightRef : null}
                  sx={{
                    p:               1.5,
                    borderRadius:    1,
                    // In keyword mode: no paragraph background — only words are highlighted
                    backgroundColor: isHighlighted && searchMode !== "keyword"
                      ? (theme) => alpha(theme.palette.primary.main, 0.08)
                      : "transparent",
                    border:          "1.5px solid",
                    borderColor:     isHighlighted && searchMode !== "keyword"
                      ? "primary.light"
                      : "transparent",
                    transition:      "background-color 0.2s",
                  }}
                >
                  <Typography variant="body2" sx={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {searchMode === "keyword" && searchQuery
                      ? highlightWords(chunk.text, searchQuery, wordMarkColor)
                      : chunk.text}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

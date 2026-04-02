import { useEffect, useRef, type JSX } from "react";
import { useQuery }           from "convex/react";
import { api }                from "../../../convex/_generated/api";
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
  actId:             string;
  actTitle:          string;
  actUrl:            string;
  highlightRagKey:   string;
  matchedChunkText?: string;   // semantic mode: text of the RAG-matched chunk
  searchQuery?:      string;
  searchMode?:       SearchMode;
}

// ── Keyword-mode helper ───────────────────────────────────────────────────────

/**
 * Highlights individual query words throughout a text string.
 * Returns a JSX fragment with <mark> spans around each matched word.
 * Matching is case-insensitive; words shorter than 2 chars are skipped.
 */
function highlightWords(text: string, query: string, color: string): JSX.Element {
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return <>{text}</>;

  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex   = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts   = text.split(regex);

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

// ── Semantic-mode helper ──────────────────────────────────────────────────────

/**
 * Locates the matched chunk text within the full decision text.
 *
 * Strategy: use the first 80 characters of the chunk as an anchor to find
 * the start position in fullText, then extend to the chunk's full length.
 * Returns null if the anchor is not found (graceful fallback to word-highlight).
 */
function findChunkInFullText(
  fullText:  string,
  chunkText: string,
): { before: string; match: string; after: string } | null {
  const trimmedChunk = chunkText.trim();
  if (!trimmedChunk) return null;

  // Use first 80 chars as a reliable anchor (paragraph starts are verbatim in fullText)
  const anchor = trimmedChunk.substring(0, 80);
  const pos    = fullText.indexOf(anchor);
  if (pos === -1) return null;

  const end = Math.min(pos + trimmedChunk.length, fullText.length);
  return {
    before: fullText.slice(0, pos),
    match:  fullText.slice(pos, end),
    after:  fullText.slice(end),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DecisionPanel({
  actId, actTitle, actUrl,
  matchedChunkText, searchQuery, searchMode,
}: Props) {
  const theme         = useTheme();
  const wordMarkColor = alpha(theme.palette.primary.main, 0.3);
  const chunkMarkBg   = alpha(theme.palette.primary.main, 0.10);

  const scrollRef  = useRef<HTMLDivElement | null>(null);
  const matchRef   = useRef<HTMLSpanElement | null>(null);

  // Load the original full text from vksDecisions (stored unstripped at ingest)
  const decision = useQuery(api.vksDecisionQueries.getDecisionFullText, { actId });

  // Semantic mode: locate the matched chunk inside fullText
  const splitResult =
    searchMode === "vector" && matchedChunkText && decision?.fullText
      ? findChunkInFullText(decision.fullText, matchedChunkText)
      : null;

  // Scroll to the matched chunk span when it becomes available or selection changes
  useEffect(() => {
    if (matchRef.current) {
      matchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [actId, decision, splitResult]);

  // ── Render full text content ─────────────────────────────────────────────

  function renderContent(fullText: string): JSX.Element {
    // Semantic mode: highlight the matched chunk block + scroll to it
    if (splitResult) {
      return (
        <Typography
          component="div"
          variant="body2"
          sx={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}
        >
          {splitResult.before}
          <Box
            component="span"
            ref={matchRef}
            sx={{
              display:         "inline",
              backgroundColor: chunkMarkBg,
              borderRadius:    "2px",
            }}
          >
            {splitResult.match}
          </Box>
          {splitResult.after}
        </Typography>
      );
    }

    // Keyword mode (or semantic fallback): highlight individual query words
    if (searchQuery) {
      return (
        <Typography variant="body2" sx={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
          {highlightWords(fullText, searchQuery, wordMarkColor)}
        </Typography>
      );
    }

    // No highlights
    return (
      <Typography variant="body2" sx={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
        {fullText}
      </Typography>
    );
  }

  // ── JSX ──────────────────────────────────────────────────────────────────

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

      {/* Full decision text */}
      <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}>
        {decision === undefined ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : decision === null ? (
          // Decision not yet in vksDecisions (ingested before S17) — show notice
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
            Full text not available for this decision. Please re-ingest to enable full-text view.
          </Typography>
        ) : (
          renderContent(decision.fullText)
        )}
      </Box>
    </Box>
  );
}

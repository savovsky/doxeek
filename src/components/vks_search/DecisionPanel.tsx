import { useEffect, useRef }  from "react";
import { useQuery }           from "convex/react";
import { api }                from "../../../convex/_generated/api";
import type { Doc }           from "../../../convex/_generated/dataModel";
import Box                    from "@mui/material/Box";
import CircularProgress       from "@mui/material/CircularProgress";
import Divider                from "@mui/material/Divider";
import IconButton             from "@mui/material/IconButton";
import OpenInNewIcon          from "@mui/icons-material/OpenInNew";
import Stack                  from "@mui/material/Stack";
import Typography             from "@mui/material/Typography";
import { alpha }              from "@mui/material/styles";

interface Props {
  actId:           string;
  actTitle:        string;
  actUrl:          string;
  highlightRagKey: string;
}

export function DecisionPanel({ actId, actTitle, actUrl, highlightRagKey }: Props) {
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
                    backgroundColor: isHighlighted
                      ? (theme) => alpha(theme.palette.primary.main, 0.08)
                      : "transparent",
                    border:          "1.5px solid",
                    borderColor:     isHighlighted ? "primary.light" : "transparent",
                    transition:      "background-color 0.2s",
                  }}
                >
                  <Typography variant="body2" sx={{ lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {chunk.text}
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

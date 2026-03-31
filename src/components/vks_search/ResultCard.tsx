import Card          from "@mui/material/Card";
import CardContent   from "@mui/material/CardContent";
import IconButton    from "@mui/material/IconButton";
import Link          from "@mui/material/Link";
import Stack         from "@mui/material/Stack";
import Typography    from "@mui/material/Typography";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { SearchResult } from "../../hooks/useVksSearch";

interface Props {
  result:     SearchResult;
  isSelected: boolean;
  onSelect:   (result: SearchResult) => void;
}

export function ResultCard({ result, isSelected, onSelect }: Props) {
  const pct = Math.round(result.score * 100);

  return (
    <Card
      variant="outlined"
      sx={{
        cursor:      "pointer",
        borderColor: isSelected ? "primary.main" : "divider",
        borderWidth: isSelected ? 2 : 1,
        "&:hover":   { borderColor: "primary.light" },
        transition:  "border-color 0.15s",
      }}
      onClick={() => onSelect(result)}
    >
      <CardContent>
        <Stack spacing={1}>
          {/* Title row */}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ lineHeight: 1.4, flex: 1, color: "primary.main" }}
            >
              {result.actTitle}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {pct}%
              </Typography>
              <Link
                href={result.actUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <IconButton size="small" tabIndex={-1}>
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Link>
            </Stack>
          </Stack>

          {/* Chunk text excerpt */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display:           "-webkit-box",
              WebkitLineClamp:   4,
              WebkitBoxOrient:   "vertical",
              overflow:          "hidden",
              lineHeight:        1.6,
            }}
          >
            {result.chunkText}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

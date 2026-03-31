import Card        from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip        from "@mui/material/Chip";
import Link        from "@mui/material/Link";
import Stack       from "@mui/material/Stack";
import Typography  from "@mui/material/Typography";
import type { SearchResult } from "../../hooks/useVksSearch";

const SECTION_COLOURS = {
  header:    "default",
  reasoning: "primary",
  ruling:    "success",
} as const;

export function ResultCard({ result }: { result: SearchResult }) {
  const pct = Math.round(result.score * 100);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Link
              href={result.actUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              fontWeight={600}
              sx={{ lineHeight: 1.4 }}
            >
              {result.actTitle}
            </Link>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              {pct}%
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip
              label={result.sectionType}
              size="small"
              color={SECTION_COLOURS[result.sectionType as keyof typeof SECTION_COLOURS] ?? "default"}
            />
            {result.actDate && (
              <Chip label={result.actDate} size="small" variant="outlined" />
            )}
            {result.caseNumber && result.caseYear && (
              <Chip
                label={`Case ${result.caseNumber}/${result.caseYear}`}
                size="small"
                variant="outlined"
              />
            )}
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.6,
            }}
          >
            {result.chunkText}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import RelatedDoc from './RelatedDoc';

type Decision = {
  actId: string;
  actPlainText: string;
  actTitle: string;
  actUrl: string;
};

const RelatedDocsContainer: FC = () => {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDecisions = async () => {
      try {
        const response = await fetch(
          '/downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl',
        );
        const text = await response.text();

        // Parse JSONL format (one JSON object per line)
        const lines = text.trim().split('\n');
        const parsedDecisions: Decision[] = lines
          .filter((line) => line.trim().length > 0)
          .map((line) => {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            return {
              actId: String(parsed.actId),
              actPlainText: String(parsed.actPlainText),
              actTitle: String(parsed.actTitle),
              actUrl: String(parsed.actUrl),
            };
          });

        setDecisions(parsedDecisions);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load documents');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDecisions();
  }, []);

  if (isLoading) {
    return (
      <Box
        data-testid='related-docs-container'
        sx={{ padding: 2, marginTop: 2, display: 'flex', justifyContent: 'center' }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box data-testid='related-docs-container' sx={{ padding: 2, marginTop: 2 }}>
        <Typography color='error'>Error loading documents: {error}</Typography>
      </Box>
    );
  }

  const MAX_DOCS_RENDER = 499;

  return (
    <Box data-testid='related-docs-container' sx={{ p: 2 }}>
      <Typography variant='h6'>Related Documents ({decisions.length})</Typography>
      <Stack spacing={10}>
        {decisions.map((item, index) => {
          if (index > MAX_DOCS_RENDER) {
            return null;
          }
          return (
            <RelatedDoc
              key={item.actId}
              index={index}
              docContent={item.actPlainText}
              docTitle={item.actTitle}
              docLinkVksDomino={item.actUrl}
              docLinkVks={`https://www.vks.bg/pregled-akt.jsp?type=ot-spisak&id=${item.actId}`}
            />
          );
        })}
      </Stack>
    </Box>
  );
};

export default RelatedDocsContainer;

import type { FC } from 'react';
import { Box, Paper, Typography } from '@mui/material';

type Props = {
  index: number;
  docContent: string;
  docTitle: string;
  docLinkVksDomino: string;
  docLinkVks: string;
};

const RelatedDoc: FC<Props> = ({ index, docContent, docTitle, docLinkVksDomino, docLinkVks }) => {
  return (
    <Paper data-testid='related-doc' sx={{ p: 4, m: 4 }} elevation={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant='h5'>{docTitle}</Typography>
        <Typography variant='h4' sx={{ color: 'primary.main' }}>
          #{index + 1}
        </Typography>
      </Box>

      <Typography variant='body2' sx={{ my: 1 }}>
        <a href={docLinkVksDomino} target='_blank' rel='noopener noreferrer'>
          {docLinkVksDomino}
        </a>
      </Typography>
      <Typography variant='body2'>
        <a href={docLinkVks} target='_blank' rel='noopener noreferrer'>
          {docLinkVks}
        </a>
      </Typography>
      <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontFamily: 'inherit' }}>
        <Typography variant='body1'>{docContent}</Typography>
      </pre>
    </Paper>
  );
};

export default RelatedDoc;

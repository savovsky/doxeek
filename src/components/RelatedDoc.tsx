import type { FC } from 'react';
import { Paper, Typography } from '@mui/material';

type Props = {
  docContent: string;
  docTitle: string;
  docLinkVksDomino: string;
  docLinkVks: string;
};

const RelatedDoc: FC<Props> = ({ docContent, docTitle, docLinkVksDomino, docLinkVks }) => {
  return (
    <Paper data-testid='related-doc' sx={{ p: 4, m: 4 }} elevation={2}>
      <Typography variant='h5'>{docTitle}</Typography>
      <Typography variant='body2'>
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

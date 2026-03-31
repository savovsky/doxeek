import type { FC } from 'react';
import Paper from '@mui/material/Paper';
import { alpha } from '@mui/material/styles';
import RelatedDocsContainer from './RelatedDocsContainer';
import { VksSearchContainer } from './vks_search/VksSearchContainer';

const OPACITY = 0.05;
const ELEVATION = 1;
const GREY_LEVEL = 100;

const LayoutMain: FC = () => {
  return (
    <>
      <Paper
        elevation={ELEVATION}
        sx={{ p: 2, m: 2, backgroundColor: (theme) => alpha(theme.palette.grey[GREY_LEVEL], OPACITY) }}
      >
        <VksSearchContainer />
      </Paper>
      <RelatedDocsContainer />
    </>
  );
};

export default LayoutMain;

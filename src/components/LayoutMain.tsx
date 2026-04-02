import type { FC } from 'react';
import { useState } from 'react';
import Paper from '@mui/material/Paper';
import { Checkbox, FormControlLabel, alpha } from '@mui/material';
import RelatedDocsContainer from './RelatedDocsContainer';
import { VksSearchContainer } from './vks_search/VksSearchContainer';

const OPACITY = 0.05;
const ELEVATION = 1;
const GREY_LEVEL = 100;

const LayoutMain: FC = () => {
  const [isRelatedDocsShown, setIsRelatedDocsShown] = useState(true);

  return (
    <>
      <Paper
        elevation={ELEVATION}
        sx={{ p: 2, m: 2, backgroundColor: (theme) => alpha(theme.palette.grey[GREY_LEVEL], OPACITY) }}
      >
        <VksSearchContainer />
      </Paper>
      <FormControlLabel
        control={
          <Checkbox checked={isRelatedDocsShown} onChange={(e) => setIsRelatedDocsShown(e.target.checked)} />
        }
        label='Show Related Documents'
        sx={{ p: 2 }}
      />
      {isRelatedDocsShown && <RelatedDocsContainer />}
    </>
  );
};

export default LayoutMain;

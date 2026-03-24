import { type FC, StrictMode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import AuthShell from './AuthShell';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

const App: FC = () => {
  return (
    <StrictMode>
      <ConvexAuthProvider client={convex}>
        <CssBaseline />
        <AuthShell />
      </ConvexAuthProvider>
    </StrictMode>
  );
};

export default App;

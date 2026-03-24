import type { FC } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { Authenticated, Unauthenticated, useConvexAuth } from 'convex/react';
import Auth from './Auth';
import LayoutMain from './LayoutMain';

const SignOutButton: FC = () => {
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  return <>{isAuthenticated && <button onClick={() => void signOut()}>Sign out</button>}</>;
};

const AuthShell: FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <header>
        <h1>Doxeek</h1>
        <SignOutButton />
      </header>
      <main style={{ background: 'salmon', flex: 1 }}>
        <Authenticated>
          <LayoutMain />
        </Authenticated>

        <Unauthenticated>
          <Auth />
        </Unauthenticated>
      </main>
      <footer />
    </div>
  );
};

export default AuthShell;

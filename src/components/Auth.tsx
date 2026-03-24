import { FC, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';

const SignInForm: FC = () => {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.target as HTMLFormElement);
          formData.set('flow', flow);
          void signIn('password', formData).catch((error: unknown) => {
            if (error instanceof Error) {
              setError(error.message);
            } else {
              setError('An unknown error occurred');
            }
          });
        }}
      >
        <input type='email' name='email' placeholder='Email' />
        <input type='password' name='password' placeholder='Password' />
        <button type='submit'>{flow === 'signIn' ? 'Sign in' : 'Sign up'}</button>
        <div className='flex flex-row gap-2'>
          <span>{flow === 'signIn' ? "Don't have an account?" : 'Already have an account?'}</span>
          <span onClick={() => setFlow(flow === 'signIn' ? 'signUp' : 'signIn')}>
            {flow === 'signIn' ? 'Sign up instead' : 'Sign in instead'}
          </span>
        </div>
        {error && (
          <div>
            <p>Error signing in: {error}</p>
          </div>
        )}
      </form>
    </div>
  );
};

export default SignInForm;

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { SignIn, SignUp, useUser, useAuth } from '@clerk/clerk-react';
import api from '../lib/api';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const botLink = searchParams.get('bot_link');
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    if (botLink) {
      sessionStorage.setItem('bot_link', botLink);
    }
  }, [botLink]);

  useEffect(() => {
    const syncUser = async () => {
      if (isSignedIn && user) {
        try {
          await getToken();
          await api.post('/auth/clerk-sync', {
            clerkId: user.id,
            email: user.primaryEmailAddress?.emailAddress,
            name: user.fullName,
          });

          const storedBotLink = sessionStorage.getItem('bot_link');
          if (storedBotLink) {
            await api.post('/bot/link', { linkToken: storedBotLink });
            sessionStorage.removeItem('bot_link');
          }

          navigate('/dashboard');
        } catch (error) {
          console.error('Failed to sync user:', error);
        }
      }
    };

    syncUser();
  }, [isSignedIn, user, navigate, getToken]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
      <div className="max-w-md w-full space-y-8 bg-gray-800 p-8 rounded-xl shadow-2xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold">Postly Authentication</h2>
          <p className="mt-2 text-gray-400">
            {botLink ? 'Link your account to continue on WhatsApp/Telegram' : 'Login or sign up to manage your posts'}
          </p>
        </div>

        <div className="flex justify-center space-x-4 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`px-4 py-2 rounded-md ${mode === 'login' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            className={`px-4 py-2 rounded-md ${mode === 'register' ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            Sign Up
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex justify-center">
            {mode === 'login' ? (
              <SignIn appearance={{ baseTheme: undefined }} />
            ) : (
              <SignUp appearance={{ baseTheme: undefined }} />
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Or use your traditional credentials if enabled.</p>
        </div>
      </div>
    </div>
  );
}

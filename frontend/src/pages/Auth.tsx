import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSignIn, useUser, useClerk } from '@clerk/clerk-react';
import { Send, Sparkles, Mail, Lock, User as UserIcon, AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { getCookie, setCookie } from '../lib/cookies';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const botLink = searchParams.get('bot_link');
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  // Clerk hooks
  const { signIn, isLoaded } = useSignIn();
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  // Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (botLink) {
      sessionStorage.setItem('bot_link', botLink);
    }
  }, [botLink]);

  // If local token exists (or can be refreshed), redirect to dashboard immediately
  useEffect(() => {
    const checkRedirect = async () => {
      let token = getCookie('access_token');
      if (!token) {
        const refreshToken = getCookie('refresh_token');
        if (refreshToken) {
          try {
            const res = await api.post('/auth/refresh', { refresh_token: refreshToken });
            if (res.status === 200 && res.data.access_token) {
              setCookie('access_token', res.data.access_token, 7);
              setCookie('refresh_token', res.data.refresh_token, 7);
              token = res.data.access_token;
            }
          } catch (e) {
            // Ignore, user will just see the login form
          }
        }
      }
      if (token) {
        navigate('/dashboard');
      }
    };
    checkRedirect();
  }, [navigate]);

  // Clerk session synchronization
  useEffect(() => {
    const syncUser = async () => {
      if (isSignedIn && user) {
        try {
          const userEmail = user.primaryEmailAddress?.emailAddress || (user.emailAddresses && user.emailAddresses[0]?.emailAddress);
          const userName = user.fullName || user.username || user.firstName || 'Clerk User';

          if (!userEmail) {
            console.error('Clerk user has no associated email address:', user);
            setError('Your social account does not have a verified email address.');
            return;
          }

          const res = await api.post('/auth/clerk-sync', {
            clerkId: user.id,
            email: userEmail,
            name: userName,
          });

          if (res.data.access_token) {
            setCookie('access_token', res.data.access_token, 7);
          }
          if (res.data.refresh_token) {
            setCookie('refresh_token', res.data.refresh_token, 7);
          }

          const storedBotLink = sessionStorage.getItem('bot_link');
          if (storedBotLink) {
            await api.post('/bot/link', { linkToken: storedBotLink });
            sessionStorage.removeItem('bot_link');
          }

          navigate('/dashboard');
        } catch (error) {
          console.error('Failed to sync user:', error);
          setError('Failed to synchronize Clerk session with server.');
        }
      }
    };

    syncUser();
  }, [isSignedIn, user, navigate]);

  // Handle native credentials form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await api.post('/auth/login', { email, password });
        if (res.data.access_token) {
          setCookie('access_token', res.data.access_token, 7);
        }
        if (res.data.refresh_token) {
          setCookie('refresh_token', res.data.refresh_token, 7);
        }
      } else {
        const res = await api.post('/auth/register', { email, password, name });
        if (res.data.access_token) {
          setCookie('access_token', res.data.access_token, 7);
        }
        if (res.data.refresh_token) {
          setCookie('refresh_token', res.data.refresh_token, 7);
        }
      }

      const storedBotLink = sessionStorage.getItem('bot_link');
      if (storedBotLink) {
        await api.post('/bot/link', { linkToken: storedBotLink });
        sessionStorage.removeItem('bot_link');
      }

      navigate('/dashboard');
    } catch (err: any) {
      console.error('Failed to authenticate:', err);
      setError(err.response?.data?.error || err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle social login redirect using Clerk
  const handleSocialLogin = async (strategy: 'oauth_google' | 'oauth_linkedin' | 'oauth_facebook') => {
    if (!isLoaded || !signIn) return;
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/auth', // redirect back to /auth to trigger clerk-sync useEffect
      });
    } catch (err: any) {
      console.error(`${strategy} authentication failed:`, err);
      setError(err.message || 'Social authentication redirect failed.');
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#070a13] relative overflow-hidden font-sans p-4">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-md w-full relative z-10 glass-panel border border-slate-800/80 p-8 rounded-2xl shadow-2xl flex flex-col items-center">
        
        {/* Logo and branding */}
        <div className="flex flex-col items-center mb-6">
          <div className="bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-3 rounded-2xl shadow-xl shadow-indigo-500/20 mb-3 flex items-center justify-center">
            <Send size={24} className="text-white" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight font-outfit text-white">
            Postly
          </h2>
          <p className="text-slate-400 mt-2 text-xs text-center max-w-[280px] leading-relaxed">
            {botLink 
              ? 'Authenticate to link your account to WhatsApp / Telegram bot.' 
              : 'Login or sign up to orchestrate multi-platform AI campaigns.'
            }
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 w-full mb-6">
          <button
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition duration-200 cursor-pointer ${
              mode === 'login' 
                ? 'bg-indigo-600 text-white shadow' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition duration-200 cursor-pointer ${
              mode === 'register' 
                ? 'bg-indigo-600 text-white shadow' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error Widget */}
        {error && (
          <div className="w-full mb-4 p-3 border border-red-500/20 bg-red-500/10 rounded-xl flex flex-col gap-1.5 text-xs text-red-400">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
            {isSignedIn && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    setLoading(true);
                    await signOut();
                    setError(null);
                  } catch (e: any) {
                    console.error('Sign out failed:', e);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold underline text-left mt-1 cursor-pointer ml-6"
              >
                Reset session & try again
              </button>
            )}
          </div>
        )}

        {/* Social Logins */}
        <div className="w-full flex flex-col items-center">
          <div className="grid grid-cols-3 gap-3 w-full mb-2">
            <button
              type="button"
              onClick={() => handleSocialLogin('oauth_google')}
              className="flex items-center justify-center py-2.5 px-4 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-white rounded-xl transition duration-200 cursor-pointer shadow-sm group"
              title="Sign in with Google"
            >
              <svg className="w-5 h-5 group-hover:scale-105 transition-transform" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.23-.67-.36-1.38-.36-2.11s.13-1.44.36-2.11l-2.85 2.22z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('oauth_linkedin')}
              className="flex items-center justify-center py-2.5 px-4 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-white rounded-xl transition duration-200 cursor-pointer shadow-sm group"
              title="Sign in with LinkedIn"
            >
              <svg className="w-5 h-5 text-[#0A66C2] group-hover:scale-105 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
              </svg>
            </button>

            <button
              type="button"
              onClick={() => handleSocialLogin('oauth_facebook')}
              className="flex items-center justify-center py-2.5 px-4 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-white rounded-xl transition duration-200 cursor-pointer shadow-sm group"
              title="Sign in with Facebook"
            >
              <svg className="w-5 h-5 text-[#1877F2] group-hover:scale-105 transition-transform" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </button>
          </div>

          <div className="relative flex py-4 items-center w-full">
            <div className="flex-grow border-t border-slate-800/80"></div>
            <span className="flex-shrink mx-4 text-[10px] text-slate-500 uppercase font-bold tracking-wider">or</span>
            <div className="flex-grow border-t border-slate-800/80"></div>
          </div>
        </div>

        {/* Native Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {mode === 'register' && (
            <div className="flex flex-col">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5 ml-1">
                Full Name
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                  <UserIcon size={14} />
                </span>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5 ml-1">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                <Mail size={14} />
              </span>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
              />
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5 ml-1">
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                <Lock size={14} />
              </span>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold py-2.5 transition shadow-lg shadow-indigo-600/10 w-full cursor-pointer flex items-center justify-center gap-1.5 mt-6 disabled:opacity-50"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
            ) : (
              <>
                <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                <Send size={12} />
              </>
            )}
          </button>
        </form>

        {/* Footer tip */}
        <div className="mt-8 pt-4 border-t border-slate-800/40 text-center text-[10px] text-slate-500 flex items-center gap-1">
          <Sparkles size={10} className="text-indigo-400" />
          <span>Secured encryption & multi-factor verification active.</span>
        </div>

      </div>
    </div>
  );
}

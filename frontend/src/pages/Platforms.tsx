import { useEffect, useState } from 'react';
import { RefreshCw, Link as LinkIcon, Unlink, Loader2, ArrowLeft, CheckCircle2, AlertCircle, X } from 'lucide-react';
import api from '../lib/api';
import { getCookie } from '../lib/cookies';

// Where to send the user back to after they finish managing platform
// connections, if they arrived here from a bot's "connect your account" link.
const BOT_RETURN_LINKS: Record<string, { label: string; url?: string }> = {
  telegram: { label: 'Telegram', url: import.meta.env.VITE_TELEGRAM_BOT_URL },
  whatsapp: { label: 'WhatsApp', url: import.meta.env.VITE_WHATSAPP_URL },
};

const BOT_RETURN_STORAGE_KEY = 'platforms_return_to';

interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  connectedAt: string;
  lastSync?: string;
}

const SUPPORTED_PLATFORMS = [
  { 
    id: 'TWITTER', 
    label: 'X (Twitter)', 
    icon: (
      <svg className="w-8 h-8 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    ), 
    color: 'bg-black border-slate-700/80' 
  },
  { 
    id: 'LINKEDIN', 
    label: 'LinkedIn', 
    icon: (
      <svg className="w-8 h-8 fill-[#0a66c2]" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"/></svg>
    ), 
    color: 'bg-[#0a66c2]/5 border-[#0a66c2]/20' 
  },
  { 
    id: 'FACEBOOK', 
    label: 'Facebook', 
    icon: (
      <svg className="w-8 h-8 fill-[#1877f2]" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
    ), 
    color: 'bg-[#1877f2]/5 border-[#1877f2]/20' 
  },
  { 
    id: 'INSTAGRAM', 
    label: 'Instagram', 
    icon: (
      <svg className="w-8 h-8 fill-[#e1306c]" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
    ), 
    color: 'bg-[#e1306c]/5 border-[#e1306c]/20' 
  },
];

export default function Platforms() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const fetchAccounts = async () => {
    try {
      const res = await api.get('/user/social-accounts');
      setAccounts(res.data.accounts || []);
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();

    // Handle the redirect back from the OAuth callback (?connected=/?error=)
    // and remember where to send the user back to if they arrived via a
    // bot "connect your account" link (?from=telegram|whatsapp).
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    const from = params.get('from');

    if (from) sessionStorage.setItem(BOT_RETURN_STORAGE_KEY, from);
    const storedReturnTo = sessionStorage.getItem(BOT_RETURN_STORAGE_KEY);
    if (storedReturnTo && BOT_RETURN_LINKS[storedReturnTo]) setReturnTo(storedReturnTo);

    if (connected) {
      setNotice({ type: 'success', message: `${connected[0].toUpperCase()}${connected.slice(1)} account connected successfully.` });
    } else if (error) {
      setNotice({ type: 'error', message: `Connection failed: ${error.replace(/_/g, ' ')}` });
    }

    if (connected || error || from) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const connectPlatform = async (platform: string) => {
    try {
      // Fetch user profile first to verify/refresh token via Axios interceptors
      await api.get('/auth/me');
    } catch (err) {
      console.error('Failed to verify token before redirecting:', err);
    }
    const token = getCookie('access_token');
    const fromParam = returnTo ? `&from=${returnTo}` : '';
    window.location.href = `${import.meta.env.VITE_API_URL}/oauth/${platform.toLowerCase()}/connect?token=${token}${fromParam}`;
  };

  const disconnectPlatform = async (id: string) => {
    if (!confirm('Are you sure you want to disconnect this platform?')) return;
    try {
      await api.delete(`/user/social-accounts/${id}`);
      fetchAccounts();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-slate-400">
        <Loader2 className="animate-spin text-indigo-500 mb-4" size={40} />
        <p className="font-medium animate-pulse">Loading channel configurations...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 font-sans">
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight font-outfit text-white">
          Social Integrations
        </h1>
        <p className="text-slate-400 mt-2 text-sm md:text-base">
          Establish secure OAuth 2.0 links to publish automatically from your connected bots.
        </p>
      </header>

      {notice && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
          notice.type === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            : 'border-rose-500/20 bg-rose-500/10 text-rose-400'
        }`}>
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{notice.message}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-current/70 hover:text-current transition">
            <X size={14} />
          </button>
        </div>
      )}

      {returnTo && BOT_RETURN_LINKS[returnTo]?.url && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm">
          <span className="text-indigo-300">
            Finished connecting your accounts? Head back to {BOT_RETURN_LINKS[returnTo].label} to continue.
          </span>
          <a
            href={BOT_RETURN_LINKS[returnTo].url}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold transition duration-300 whitespace-nowrap"
          >
            <ArrowLeft size={14} />
            Return to {BOT_RETURN_LINKS[returnTo].label}
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SUPPORTED_PLATFORMS.map((p) => {
          const account = accounts.find((a) => a.platform === p.id);
          return (
            <div 
              key={p.id} 
              className={`glass-card rounded-2xl p-6 border transition-all flex flex-col justify-between h-[240px] relative overflow-hidden ${
                account ? 'border-indigo-500/20' : 'border-slate-800/80 hover:border-slate-700/60'
              }`}
            >
              {account && (
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
              )}
              
              <div className="flex justify-between items-start">
                <div className="flex items-center space-x-4">
                  <div className={`p-3 rounded-xl border flex items-center justify-center ${p.color}`}>
                    {p.icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white font-outfit">{p.label}</h2>
                    {account ? (
                      <p className="text-indigo-400 text-sm font-medium mt-0.5">@{account.handle}</p>
                    ) : (
                      <p className="text-slate-500 text-sm mt-0.5">Disconnected</p>
                    )}
                  </div>
                </div>
                
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  account 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                    : 'bg-slate-900/60 border-slate-800 text-slate-500'
                }`}>
                  {account ? 'Connected' : 'Offline'}
                </div>
              </div>

              <div className="mt-8 flex items-center justify-between border-t border-slate-800/60 pt-4">
                <div className="text-xs text-slate-500">
                  {account ? (
                    <div className="flex items-center gap-1.5 font-medium">
                      <RefreshCw size={11} className="text-slate-500 animate-spin-slow" />
                      <span>
                        Sync: {account.lastSync ? new Date(account.lastSync).toLocaleDateString() : 'Just now'}
                      </span>
                    </div>
                  ) : (
                    'Requires authorization'
                  )}
                </div>
                
                {account ? (
                  <button
                    onClick={() => disconnectPlatform(account.id)}
                    className="flex items-center space-x-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-3.5 py-2 rounded-xl transition duration-300 text-xs font-semibold"
                  >
                    <Unlink size={14} />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    onClick={() => connectPlatform(p.id)}
                    className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white px-4 py-2 rounded-xl transition duration-300 text-xs font-semibold shadow-md shadow-indigo-600/15"
                  >
                    <LinkIcon size={14} />
                    <span>Connect Account</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

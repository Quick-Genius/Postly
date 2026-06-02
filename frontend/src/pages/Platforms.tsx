import { useEffect, useState } from 'react';
import { Share2, RefreshCw, Link as LinkIcon, Unlink } from 'lucide-react';
import api from '../lib/api';

interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  connectedAt: string;
  lastSync?: string;
}

const SUPPORTED_PLATFORMS = [
  { id: 'TWITTER', label: 'X (Twitter)', icon: '🐦' },
  { id: 'LINKEDIN', label: 'LinkedIn', icon: '💼' },
  { id: 'FACEBOOK', label: 'Facebook', icon: '👥' },
  { id: 'INSTAGRAM', label: 'Instagram', icon: '📸' },
];

export default function Platforms() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = async () => {
    try {
      const res = await api.get('/user/social-accounts');
      setAccounts(res.data);
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const connectPlatform = (platform: string) => {
    window.location.href = `${import.meta.env.VITE_API_URL}/api/oauth/${platform.toLowerCase()}/connect`;
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

  if (loading) return <div className="p-8 text-gray-400">Loading platforms...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white">Connected Platforms</h1>
        <p className="text-gray-400 mt-2">Manage your social media authorizations. We use official OAuth only.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {SUPPORTED_PLATFORMS.map((p) => {
          const account = accounts.find((a) => a.platform === p.id);
          return (
            <div key={p.id} className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div className="flex items-center space-x-4">
                  <span className="text-4xl">{p.icon}</span>
                  <div>
                    <h2 className="text-xl font-bold text-white">{p.label}</h2>
                    {account ? (
                      <p className="text-blue-400 text-sm">@{account.handle}</p>
                    ) : (
                      <p className="text-gray-500 text-sm">Not connected</p>
                    )}
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                  account ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'
                }`}>
                  {account ? 'Connected' : 'Disconnected'}
                </div>
              </div>

              <div className="mt-8 flex items-center justify-between border-t border-gray-700 pt-4">
                <div className="text-xs text-gray-500">
                  {account ? (
                    <>
                      <div className="flex items-center gap-1">
                        <RefreshCw size={10} />
                        Last sync: {account.lastSync ? new Date(account.lastSync).toLocaleDateString() : 'Just now'}
                      </div>
                    </>
                  ) : (
                    'No active authorization'
                  )}
                </div>
                
                {account ? (
                  <button
                    onClick={() => disconnectPlatform(account.id)}
                    className="flex items-center space-x-2 text-red-400 hover:text-red-300 transition text-sm font-medium"
                  >
                    <Unlink size={16} />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    onClick={() => connectPlatform(p.id)}
                    className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition text-sm font-medium shadow-md"
                  >
                    <LinkIcon size={16} />
                    <span>Connect {p.label}</span>
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

import { Shield, LogOut, Mail, Calendar, Key, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

export default function Profile() {
  const navigate = useNavigate();
  const [dbUser, setDbUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get('/auth/me');
        setDbUser(res.data.user);
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        navigate('/auth');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [navigate]);

  const handleSignOut = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!dbUser) return null;

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-8 font-sans">
      <h1 className="text-4xl font-extrabold tracking-tight font-outfit text-white">
        Profile Settings
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Profile Card */}
        <div className="md:col-span-1 glass-panel border border-slate-800/80 rounded-2xl p-6 text-center flex flex-col justify-between items-center h-[340px]">
          <div className="flex flex-col items-center mt-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/10 text-3xl uppercase">
              {(dbUser.name || 'U').substring(0, 2)}
            </div>
            
            <h2 className="text-xl font-bold text-white font-outfit mt-4 leading-none">
              {dbUser.name || 'User'}
            </h2>
            <p className="text-slate-500 text-xs mt-1.5 font-medium truncate max-w-[180px]">
              {dbUser.email}
            </p>
          </div>

          <button
            onClick={handleSignOut}
            className="flex items-center justify-center space-x-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 w-full py-2.5 rounded-xl transition duration-300 text-xs font-semibold cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Identity Details Card */}
        <div className="md:col-span-2 glass-panel border border-slate-800/80 rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-white font-outfit border-b border-slate-800/60 pb-3">
            Account Telemetry
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-xl flex items-center space-x-3.5">
              <div className="p-2.5 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/25">
                <Shield size={18} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Internal Role</p>
                <p className="text-white text-sm font-semibold mt-0.5">
                  {dbUser?.role || 'USER'}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-xl flex items-center space-x-3.5">
              <div className="p-2.5 bg-purple-500/10 rounded-lg text-purple-400 border border-purple-500/25">
                <Calendar size={18} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Member Since</p>
                <p className="text-white text-sm font-semibold mt-0.5">
                  {new Date(dbUser.createdAt || '').toLocaleDateString(undefined, {
                    month: 'short',
                    year: 'numeric'
                  })}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-xl flex items-center space-x-3.5">
              <div className="p-2.5 bg-amber-500/10 rounded-lg text-amber-400 border border-amber-500/25">
                <Mail size={18} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Email Connection</p>
                <p className="text-white text-sm font-semibold mt-0.5 truncate max-w-[200px]" title={dbUser.email}>
                  {dbUser.email}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-xl flex items-center space-x-3.5">
              <div className="p-2.5 bg-teal-500/10 rounded-lg text-teal-400 border border-teal-500/25">
                <Key size={18} />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Authentication</p>
                <p className="text-white text-sm font-semibold mt-0.5">Native Credentials</p>
              </div>
            </div>

          </div>

          <div className="p-4 border border-indigo-500/10 bg-indigo-500/5 rounded-xl flex items-start space-x-3 text-xs text-indigo-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              Your profile information is stored securely in your Postly account database. To update your profile photo, full name, or update your password credentials, please contact support or update via settings if enabled.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

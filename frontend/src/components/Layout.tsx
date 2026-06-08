import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, User, LogOut, Send, ShieldCheck, Share2, History as HistoryIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      navigate('/auth');
      return;
    }

    const fetchRole = async () => {
      try {
        const res = await api.get('/auth/me');
        setRole(res.data.user.role);
        setName(res.data.user.name || '');
        setEmail(res.data.user.email || '');
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch role:', err);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        navigate('/auth');
      }
    };
    fetchRole();
  }, [navigate]);

  const handleSignOut = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    navigate('/auth');
  };

  const navItems = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Platforms', icon: Share2, path: '/platforms' },
    { label: 'History', icon: HistoryIcon, path: '/history' },
    { label: 'Profile', icon: User, path: '/profile' },
  ];

  if (role === 'ADMIN') {
    navItems.splice(1, 0, { label: 'Admin Panel', icon: ShieldCheck, path: '/admin' });
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-[#070a13] text-gray-100 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#070a13] text-gray-100 w-full overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0c1020]/80 backdrop-blur-xl border-r border-slate-800/60 flex flex-col justify-between">
        <div>
          {/* Brand Header */}
          <div className="p-6 flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-2.5 rounded-xl shadow-lg shadow-indigo-500/30 flex items-center justify-center">
              <Send size={20} className="text-white" />
            </div>
            <div>
              <span className="text-2xl font-extrabold tracking-tight font-outfit bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Postly
              </span>
              <span className="text-[10px] block font-semibold text-indigo-400 tracking-wider uppercase ml-0.5">
                Publishing Engine
              </span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="px-4 space-y-1.5 mt-6">
            <span className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-3">
              Menu
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 relative group ${
                    active
                      ? 'bg-gradient-to-r from-indigo-600/15 to-purple-600/5 text-white border-l-4 border-indigo-500 shadow-sm shadow-indigo-500/5'
                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-100 border-l-4 border-transparent'
                  }`}
                >
                  <Icon
                    size={18}
                    className={`transition-colors duration-300 ${
                      active ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span className="font-medium text-sm">{item.label}</span>

                  {/* Active Indicator Glow */}
                  {active && (
                    <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Profile / Logout section */}
        <div className="p-4 border-t border-slate-800/60 space-y-4">
          {name && (
            <div className="flex items-center space-x-3 px-2 py-1.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-md text-sm uppercase">
                {name.substring(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate">{name}</p>
                <p className="text-[10px] text-slate-500 truncate">{email}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center space-x-3 w-full px-4 py-2.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300 text-sm font-medium cursor-pointer"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[#080c14] relative">
        {/* Subtle background glow blobs */}
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

        <div className="relative z-10 min-h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

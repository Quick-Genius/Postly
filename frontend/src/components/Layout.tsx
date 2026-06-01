import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, User, LogOut, Send, ShieldCheck } from 'lucide-react';
import { useClerk, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function Layout() {
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const res = await api.get('/auth/me');
        setRole(res.data.user.role);
      } catch (err) {
        console.error('Failed to fetch role:', err);
      }
    };
    fetchRole();
  }, []);

  const navItems = [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Profile', icon: User, path: '/profile' },
  ];

  if (role === 'ADMIN') {
    navItems.splice(1, 0, { label: 'Admin', icon: ShieldCheck, path: '/admin' });
  }

  return (
    <>
      <SignedIn>
        <div className="flex h-screen bg-gray-900 text-white w-full">
          {/* Sidebar */}
          <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
            <div className="p-6 flex items-center space-x-2">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Send size={24} className="text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">Postly</span>
            </div>

            <nav className="flex-1 px-4 space-y-2 mt-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                      active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="p-4 border-t border-gray-700">
              <button
                onClick={() => signOut(() => navigate('/auth'))}
                className="flex items-center space-x-3 w-full px-4 py-3 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-lg transition"
              >
                <LogOut size={20} />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-auto bg-gray-900">
            <Outlet />
          </main>
        </div>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

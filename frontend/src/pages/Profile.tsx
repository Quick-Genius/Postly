import { useUser, useClerk } from '@clerk/clerk-react';
import { User, Shield, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function Profile() {
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const [dbUser, setDbUser] = useState<any>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get('/auth/me');
        setDbUser(res.data.user);
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      }
    };
    fetchProfile();
  }, []);

  if (!clerkUser) return null;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold text-white mb-8">User Profile</h1>

      <div className="bg-gray-800 rounded-xl p-8 shadow-lg border border-gray-700 space-y-6">
        <div className="flex items-center space-x-4">
          <div className="bg-blue-600 p-4 rounded-full">
            <User size={32} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{clerkUser.fullName || 'User'}</h2>
            <p className="text-gray-400">{clerkUser.primaryEmailAddress?.emailAddress}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-700 rounded-lg flex items-center space-x-3">
            <Shield className="text-blue-400" />
            <div>
              <p className="text-xs text-gray-400 uppercase font-bold">Account Role</p>
              <p className="text-white font-medium">{dbUser?.role || 'Loading...'}</p>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-700">
          <button
            onClick={() => signOut()}
            className="flex items-center space-x-2 text-red-400 hover:text-red-300 transition"
          >
            <LogOut size={20} />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

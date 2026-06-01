import { useEffect, useState } from 'react';
import { Users, FileText, TrendingUp, BarChart3, Clock, Layout } from 'lucide-react';
import api from '../lib/api';

interface PlatformStat {
  platform: string;
  count: number;
}

interface TopicStat {
  name: string;
  count: number;
}

interface GlobalStats {
  users: number;
  posts: number;
  platforms: PlatformStat[];
  trendingTopics: TopicStat[];
}

interface UserAnalytic {
  id: string;
  email: string;
  name: string;
  role: string;
  postCount: number;
  recentActivity: Array<{
    createdAt: string;
    status: string;
    platformPosts: Array<{ platform: string }>;
  }>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [users, setUsers] = useState<UserAnalytic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        const [statsRes, usersRes] = await Promise.all([
          api.get('/admin/stats'),
          api.get('/admin/users'),
        ]);
        setStats(statsRes.data);
        setUsers(usersRes.data);
      } catch (error) {
        console.error('Failed to fetch admin data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAdminData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="animate-pulse flex flex-col items-center">
          <BarChart3 size={48} className="mb-4" />
          <p>Loading administrative insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-gray-900 min-h-screen text-gray-100">
      <header>
        <h1 className="text-4xl font-extrabold text-white tracking-tight">System Administration</h1>
        <p className="text-gray-400 mt-2 text-lg">Real-time metrics and user activity across Postly</p>
      </header>

      {/* Global Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Users" 
          value={stats?.users || 0} 
          icon={<Users className="text-blue-500" />} 
          subtitle="Registered accounts"
        />
        <StatCard 
          title="Total Posts" 
          value={stats?.posts || 0} 
          icon={<FileText className="text-green-500" />} 
          subtitle="AI generated content"
        />
        <StatCard 
          title="Active Platforms" 
          value={stats?.platforms.length || 0} 
          icon={<Layout className="text-purple-500" />} 
          subtitle="Connected ecosystems"
        />
        <StatCard 
          title="Trending Topics" 
          value={stats?.trendingTopics.length || 0} 
          icon={<TrendingUp className="text-orange-500" />} 
          subtitle="Unique categories"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* User Activity Table */}
        <div className="lg:col-span-2 bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users size={20} className="text-blue-400" />
              User Engagement
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-gray-400 text-sm border-b border-gray-700">
                  <th className="pb-4 font-semibold">User</th>
                  <th className="pb-4 font-semibold">Role</th>
                  <th className="pb-4 font-semibold text-center">Posts</th>
                  <th className="pb-4 font-semibold">Recent Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {users.map((user) => (
                  <tr key={user.id} className="text-sm group hover:bg-gray-750 transition">
                    <td className="py-4">
                      <div className="font-medium text-white">{user.name}</div>
                      <div className="text-gray-500 text-xs">{user.email}</div>
                    </td>
                    <td className="py-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                        user.role === 'ADMIN' ? 'bg-red-900/50 text-red-300' : 
                        user.role === 'GUEST' ? 'bg-gray-700 text-gray-300' : 'bg-blue-900/50 text-blue-300'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-4 text-center font-mono text-blue-400">{user.postCount}</td>
                    <td className="py-4">
                      <div className="flex gap-1">
                        {user.recentActivity.map((post, i) => (
                          <div key={i} className="w-2 h-2 rounded-full bg-blue-600" title={post.status}></div>
                        ))}
                        {user.recentActivity.length === 0 && <span className="text-gray-600 italic text-xs">No activity</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sidebar: Insights */}
        <div className="space-y-8">
          {/* Trending Topics */}
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-orange-400" />
              Top Topics
            </h2>
            <div className="space-y-3">
              {stats?.trendingTopics.map((topic, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-300 text-sm">#{topic.name}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 bg-gray-700 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-orange-500 h-full" 
                        style={{ width: `${(topic.count / stats.trendingTopics[0].count) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-500 font-mono w-4">{topic.count}</span>
                  </div>
                </div>
              ))}
              {(!stats?.trendingTopics || stats.trendingTopics.length === 0) && (
                <p className="text-gray-500 text-sm italic text-center py-4">Insufficient data for topics</p>
              )}
            </div>
          </div>

          {/* Platform Distribution */}
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-purple-400" />
              Platform Mix
            </h2>
            <div className="space-y-4">
              {stats?.platforms.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-xl">
                  <span className="capitalize text-sm font-medium">{p.platform}</span>
                  <span className="text-blue-400 font-bold">{p.count}</span>
                </div>
              ))}
              {(!stats?.platforms || stats.platforms.length === 0) && (
                <p className="text-gray-500 text-sm italic text-center py-4">No published posts yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, subtitle }: { title: string; value: number | string; icon: React.ReactNode; subtitle: string }) {
  return (
    <div className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700 hover:border-gray-600 transition">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-gray-900 rounded-xl">
          {icon}
        </div>
      </div>
      <div>
        <h3 className="text-gray-400 text-sm font-medium">{title}</h3>
        <div className="text-3xl font-bold text-white mt-1">{value}</div>
        <p className="text-gray-500 text-xs mt-2 flex items-center gap-1">
          <Clock size={12} />
          {subtitle}
        </p>
      </div>
    </div>
  );
}

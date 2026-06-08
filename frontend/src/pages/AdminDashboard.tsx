import { useEffect, useState } from 'react';
import { Users, FileText, TrendingUp, BarChart3, Clock, Layout, Loader2 } from 'lucide-react';
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
      <div className="flex flex-col items-center justify-center h-full min-h-[65vh] text-slate-400">
        <Loader2 className="animate-spin text-indigo-500 mb-4" size={40} />
        <p className="font-medium animate-pulse">Running administrative diagnostics...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 font-sans">
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight font-outfit text-white">
          System Administration
        </h1>
        <p className="text-slate-400 mt-2 text-sm md:text-base font-medium">
          Global metrics, user activity pipelines, and content trends across Postly.
        </p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Users" 
          value={stats?.users || 0} 
          icon={<Users className="text-indigo-400" size={20} />} 
          subtitle="Registered accounts"
        />
        <StatCard 
          title="Total Posts" 
          value={stats?.posts || 0} 
          icon={<FileText className="text-purple-400" size={20} />} 
          subtitle="AI generated posts"
        />
        <StatCard 
          title="Active Platforms" 
          value={stats?.platforms.length || 0} 
          icon={<Layout className="text-emerald-400" size={20} />} 
          subtitle="Connected systems"
        />
        <StatCard 
          title="Trending Topics" 
          value={stats?.trendingTopics.length || 0} 
          icon={<TrendingUp className="text-amber-400" size={20} />} 
          subtitle="Unique categories"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* User Activity Table */}
        <div className="lg:col-span-2 glass-panel border border-slate-800/80 rounded-2xl p-6">
          <div className="flex items-center space-x-2.5 mb-6">
            <Users size={20} className="text-indigo-400" />
            <h2 className="text-lg font-bold text-white font-outfit">User Engagement</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-800 pb-3">
                  <th className="pb-3.5 pl-2">User details</th>
                  <th className="pb-3.5">Role</th>
                  <th className="pb-3.5 text-center">Drafts</th>
                  <th className="pb-3.5 pr-2">Recent activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((user) => (
                  <tr key={user.id} className="text-sm hover:bg-slate-900/40 transition">
                    <td className="py-4 pl-2">
                      <div className="font-semibold text-slate-100">{user.name}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{user.email}</div>
                    </td>
                    <td className="py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        user.role === 'ADMIN' 
                          ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                          : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="py-4 text-center font-mono font-bold text-indigo-400">{user.postCount}</td>
                    <td className="py-4 pr-2">
                      <div className="flex gap-1.5 items-center">
                        {user.recentActivity.map((post, i) => (
                          <div 
                            key={i} 
                            className={`w-2.5 h-2.5 rounded-full shadow-sm ${
                              post.status === 'PUBLISHED' ? 'bg-emerald-500 shadow-emerald-500/20' :
                              post.status === 'FAILED' ? 'bg-rose-500 shadow-rose-500/20' :
                              'bg-amber-500 shadow-amber-500/20'
                            }`} 
                            title={`${post.status} post`}
                          />
                        ))}
                        {user.recentActivity.length === 0 && (
                          <span className="text-slate-600 italic text-xs">No activity</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sidebar: Insights */}
        <div className="space-y-6">
          
          {/* Trending Topics */}
          <div className="glass-panel border border-slate-800/80 rounded-2xl p-6">
            <h2 className="text-base font-bold text-white font-outfit mb-5 flex items-center gap-2">
              <TrendingUp size={18} className="text-amber-400" />
              Top Tags / Topics
            </h2>
            
            <div className="space-y-4">
              {stats?.trendingTopics.map((topic, i) => {
                const maxVal = stats.trendingTopics[0]?.count || 1;
                const pct = Math.round((topic.count / maxVal) * 100);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-200 font-semibold">#{topic.name}</span>
                      <span className="text-slate-500 font-mono">{topic.count}</span>
                    </div>
                    <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800/50">
                      <div 
                        className="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full transition-all duration-500" 
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {(!stats?.trendingTopics || stats.trendingTopics.length === 0) && (
                <p className="text-slate-500 text-xs italic text-center py-6">No tags logged by users yet.</p>
              )}
            </div>
          </div>

          {/* Platform Distribution */}
          <div className="glass-panel border border-slate-800/80 rounded-2xl p-6">
            <h2 className="text-base font-bold text-white font-outfit mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-purple-400" />
              Platform Distribution
            </h2>
            
            <div className="space-y-3">
              {stats?.platforms.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800/60 rounded-xl">
                  <span className="capitalize text-xs font-semibold text-slate-300 tracking-wide">{p.platform}</span>
                  <span className="text-indigo-400 font-bold font-mono text-sm">{p.count}</span>
                </div>
              ))}
              {(!stats?.platforms || stats.platforms.length === 0) && (
                <p className="text-slate-500 text-xs italic text-center py-6">No posts published yet.</p>
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
    <div className="glass-panel border border-slate-800/80 rounded-2xl p-6 hover:border-slate-700/60 transition duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
          {icon}
        </div>
      </div>
      <div>
        <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{title}</h3>
        <div className="text-3xl font-extrabold text-white mt-1.5 font-outfit">{value}</div>
        <p className="text-slate-500 text-[10px] mt-2.5 flex items-center gap-1 font-medium">
          <Clock size={12} />
          {subtitle}
        </p>
      </div>
    </div>
  );
}

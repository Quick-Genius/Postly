import { useEffect, useState } from 'react';
import { Share2, History, PlusCircle } from 'lucide-react';
import api from '../lib/api';

interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  connectedAt: string;
}

interface Post {
  id: string;
  idea: string;
  status: string;
  createdAt: string;
  platformPosts: Array<{
    platform: string;
    status: string;
    publishedUrl?: string;
  }>;
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accountsRes, postsRes] = await Promise.all([
          api.get('/user/social-accounts'),
          api.get('/posts'),
        ]);
        setAccounts(accountsRes.data);
        setPosts(postsRes.data.data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const connectPlatform = (platform: string) => {
    window.location.href = `http://localhost:3000/api/oauth/${platform}/connect?token=${localStorage.getItem('access_token')}`;
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  return (
    <div className="space-y-8 p-6 max-w-6xl mx-auto">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400">Manage your social connections and posts</p>
        </div>
        <button className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
          <PlusCircle size={20} />
          <span>New Post Idea</span>
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Connected Platforms */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700">
          <div className="flex items-center space-x-2 mb-6">
            <Share2 className="text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Connected Platforms</h2>
          </div>
          <div className="space-y-4">
            {['twitter', 'linkedin', 'facebook', 'instagram'].map((p) => {
              const connected = accounts.find(a => a.platform.toLowerCase() === p);
              return (
                <div key={p} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <span className="capitalize text-white font-medium">{p}</span>
                    {connected && <span className="text-xs text-gray-400">@{connected.handle}</span>}
                  </div>
                  {connected ? (
                    <span className="text-green-400 text-sm font-medium">Connected</span>
                  ) : (
                    <button 
                      onClick={() => connectPlatform(p)}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Posts */}
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700">
          <div className="flex items-center space-x-2 mb-6">
            <History className="text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Recent Posts</h2>
          </div>
          <div className="space-y-4">
            {posts.length > 0 ? posts.slice(0, 5).map((post) => (
              <div key={post.id} className="p-3 bg-gray-700 rounded-lg space-y-2">
                <div className="flex justify-between items-start">
                  <p className="text-white text-sm line-clamp-1 flex-1">{post.idea}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ml-2 ${
                    post.status === 'PUBLISHED' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
                  }`}>
                    {post.status}
                  </span>
                </div>
                <div className="flex space-x-2">
                  {post.platformPosts.map((pp, idx) => (
                    <span key={idx} className="text-[10px] text-gray-400 border border-gray-600 px-1 rounded">
                      {pp.platform}
                    </span>
                  ))}
                </div>
              </div>
            )) : (
              <p className="text-center text-gray-500 py-8">No posts yet</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

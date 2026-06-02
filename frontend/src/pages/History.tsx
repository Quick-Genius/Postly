import { useEffect, useState } from 'react';
import { History as HistoryIcon, ExternalLink, AlertCircle, CheckCircle2, Clock, Search, Filter } from 'lucide-react';
import api from '../lib/api';

interface Post {
  id: string;
  idea: string;
  status: string;
  createdAt: string;
  platformPosts: Array<{
    platform: string;
    status: string;
    publishedUrl?: string;
    errorMessage?: string;
  }>;
}

export default function History() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await api.get('/posts');
        setPosts(res.data.data);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  const filteredPosts = posts.filter((p) => {
    const matchesSearch = p.idea.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'ALL' || p.status === filter;
    return matchesSearch && matchesFilter;
  });

  if (loading) return <div className="p-8 text-gray-400">Loading history...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <HistoryIcon className="text-blue-500" />
            Post History
          </h1>
          <p className="text-gray-400 mt-1">Review and track your multi-platform publications.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              type="text"
              placeholder="Search ideas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white w-64"
            />
          </div>
          <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
            {['ALL', 'PUBLISHED', 'FAILED', 'SCHEDULED'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                  filter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {filteredPosts.map((post) => (
          <div key={post.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-lg group hover:border-gray-600 transition">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock size={12} />
                  {new Date(post.createdAt).toLocaleString()}
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                  post.status === 'PUBLISHED' ? 'bg-green-900/40 text-green-400' :
                  post.status === 'FAILED' ? 'bg-red-900/40 text-red-400' :
                  'bg-yellow-900/40 text-yellow-400'
                }`}>
                  {post.status}
                </div>
              </div>

              <p className="text-white text-lg font-medium mb-6 line-clamp-2 leading-relaxed">
                {post.idea}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {post.platformPosts.map((pp, i) => (
                  <div key={i} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50 flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{pp.platform}</span>
                      {pp.status === 'PUBLISHED' ? (
                        <CheckCircle2 size={14} className="text-green-500" />
                      ) : pp.status === 'FAILED' ? (
                        <AlertCircle size={14} className="text-red-500" />
                      ) : (
                        <Clock size={14} className="text-yellow-500" />
                      )}
                    </div>
                    
                    {pp.publishedUrl ? (
                      <a
                        href={pp.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1 group/link transition"
                      >
                        View Post <ExternalLink size={10} className="group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                      </a>
                    ) : pp.errorMessage ? (
                      <span className="text-red-500/80 text-[10px] line-clamp-1 italic" title={pp.errorMessage}>
                        {pp.errorMessage}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-[10px] italic">In progress...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        {filteredPosts.length === 0 && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-20 text-center">
            <AlertCircle className="mx-auto text-gray-600 mb-4" size={48} />
            <h3 className="text-xl font-bold text-gray-400">No posts found</h3>
            <p className="text-gray-500 mt-2">Try adjusting your filters or create a new post from WhatsApp.</p>
          </div>
        )}
      </div>
    </div>
  );
}

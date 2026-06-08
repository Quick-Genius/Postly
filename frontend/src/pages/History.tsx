import { useEffect, useState } from 'react';
import { History as HistoryIcon, ExternalLink, AlertCircle, CheckCircle2, Clock, Search, Loader2, Trash2, RefreshCcw } from 'lucide-react';
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await api.get('/posts');
      setPosts(res.data.data || []);
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const deletePost = async (id: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    setActionLoading(id);
    try {
      await api.delete(`/posts/${id}`);
      await fetchHistory();
    } catch (error) {
      console.error('Failed to delete post:', error);
      alert('Failed to delete post.');
    } finally {
      setActionLoading(null);
    }
  };

  const retryPost = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/posts/${id}/retry`);
      await fetchHistory();
      alert('Failed jobs enqueued for retry!');
    } catch (error) {
      console.error('Failed to retry post:', error);
      alert('Failed to retry publication.');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredPosts = posts.filter((p) => {
    const matchesSearch = p.idea.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'ALL' || p.status === filter;
    return matchesSearch && matchesFilter;
  });

  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'twitter':
        return (
          <svg className="w-3.5 h-3.5 fill-slate-300" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        );
      case 'linkedin':
        return (
          <svg className="w-3.5 h-3.5 fill-[#0a66c2]" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"/></svg>
        );
      case 'instagram':
        return (
          <svg className="w-3.5 h-3.5 fill-[#e1306c]" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-slate-400">
        <Loader2 className="animate-spin text-indigo-500 mb-4" size={40} />
        <p className="font-medium animate-pulse">Retrieving submission logs...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 font-sans">
      
      {/* Header & Filter Controls */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight font-outfit text-white flex items-center gap-3">
            <HistoryIcon className="text-indigo-400" size={32} />
            Post History
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Review, debug, or retry multi-platform campaign publication logs.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3.5">
          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Search concepts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-900/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-white w-full transition-all"
            />
          </div>

          {/* Filter switches */}
          <div className="flex bg-slate-900/60 p-1.5 rounded-xl border border-slate-800/80 w-full sm:w-auto overflow-x-auto">
            {['ALL', 'PUBLISHED', 'FAILED', 'SCHEDULED'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 cursor-pointer ${
                  filter === f ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* History Feed */}
      <div className="space-y-5">
        {filteredPosts.map((post) => (
          <div key={post.id} className="glass-card rounded-2xl border border-slate-800/80 overflow-hidden relative">
            <div className="p-6">
              
              {/* Header card details */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
                  <Clock size={12} className="text-slate-500" />
                  {new Date(post.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
                
                <div className="flex items-center space-x-3">
                  <span className={`text-[10px] px-2.5 py-1 rounded-md font-extrabold uppercase tracking-wider border ${
                    post.status === 'PUBLISHED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                    post.status === 'FAILED' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                    'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  }`}>
                    {post.status}
                  </span>

                  {/* Retry option for failed posts */}
                  {post.status === 'FAILED' && (
                    <button
                      onClick={() => retryPost(post.id)}
                      disabled={actionLoading !== null}
                      className="text-xs bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 p-1.5 rounded-lg transition"
                      title="Retry publication"
                    >
                      <RefreshCcw size={12} className={actionLoading === post.id ? 'animate-spin' : ''} />
                    </button>
                  )}

                  {/* Soft Delete */}
                  <button
                    onClick={() => deletePost(post.id)}
                    disabled={actionLoading !== null}
                    className="text-xs hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 p-1.5 rounded-lg transition"
                    title="Delete record"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Main Content Idea */}
              <p className="text-slate-100 text-base md:text-lg font-medium mb-6 leading-relaxed">
                {post.idea}
              </p>

              {/* Channel columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {post.platformPosts.map((pp, i) => (
                  <div key={i} className="bg-slate-900/40 rounded-xl p-3.5 border border-slate-800/60 flex flex-col justify-between h-24">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-2">
                        {getPlatformIcon(pp.platform)}
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{pp.platform}</span>
                      </div>
                      
                      {pp.status === 'PUBLISHED' ? (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      ) : pp.status === 'FAILED' ? (
                        <AlertCircle size={14} className="text-rose-500" />
                      ) : (
                        <Clock size={14} className="text-amber-500" />
                      )}
                    </div>
                    
                    {pp.publishedUrl ? (
                      <a
                        href={pp.publishedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 text-xs flex items-center gap-1 font-semibold group/link transition mt-3"
                      >
                        View Post 
                        <ExternalLink size={10} className="group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                      </a>
                    ) : pp.errorMessage ? (
                      <span className="text-rose-500/80 text-[10px] line-clamp-1 italic mt-3" title={pp.errorMessage}>
                        {pp.errorMessage}
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px] italic mt-3">Dispatched to adapters...</span>
                    )}
                  </div>
                ))}
              </div>

            </div>
          </div>
        ))}

        {filteredPosts.length === 0 && (
          <div className="glass-panel rounded-2xl border border-slate-800/80 p-20 text-center">
            <AlertCircle className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-xl font-bold text-slate-400 font-outfit">No records matched</h3>
            <p className="text-slate-500 mt-2 text-sm">
              Adjust search query, change filters, or generate a new concept from the composer.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

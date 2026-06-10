import { useEffect, useState } from 'react';
import { Share2, History, PlusCircle, Sparkles, Calendar, Clock, CheckCircle2, Loader2, Send, X } from 'lucide-react';
import api from '../lib/api';
import { getCookie } from '../lib/cookies';

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

interface GeneratedPlatformContent {
  content: string;
  char_count?: number;
  hashtags?: string[];
}

interface AiGenerationResult {
  generated: {
    twitter?: GeneratedPlatformContent;
    linkedin?: GeneratedPlatformContent;
    instagram?: GeneratedPlatformContent;
    threads?: GeneratedPlatformContent;
  };
  model_used: string;
  tokens_used: number;
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [idea, setIdea] = useState('');
  const [postType, setPostType] = useState('educational');
  const [tone, setTone] = useState('professional');
  const [model, setModel] = useState('openai');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['twitter', 'linkedin']);
  
  // AI Generation State
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<AiGenerationResult | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  
  // Publish / Schedule State
  const [publishing, setPublishing] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  const fetchData = async () => {
    try {
      const [accountsRes, postsRes] = await Promise.all([
        api.get('/user/social-accounts'),
        api.get('/posts'),
      ]);
      setAccounts(accountsRes.data.accounts || []);
      setPosts(postsRes.data.data || []);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const connectPlatform = async (platform: string) => {
    try {
      // Fetch user profile first to verify/refresh token via Axios interceptors
      await api.get('/auth/me');
    } catch (err) {
      console.error('Failed to verify token before redirecting:', err);
    }
    const token = getCookie('access_token');
    window.location.href = `${import.meta.env.VITE_API_URL}/oauth/${platform.toLowerCase()}/connect?token=${token}`;
  };

  const handlePlatformToggle = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform) 
        : [...prev, platform]
    );
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;
    setGenerating(true);
    setGenResult(null);
    setEditedContent({});
    try {
      const res = await api.post('/content/generate', {
        idea: idea.trim(),
        post_type: postType,
        platforms: selectedPlatforms,
        tone: tone,
        model: model
      });
      setGenResult(res.data);
      
      // Initialize edit fields
      const initialEdits: Record<string, string> = {};
      Object.entries(res.data.generated).forEach(([plat, data]) => {
        initialEdits[plat] = (data as GeneratedPlatformContent).content || '';
      });
      setEditedContent(initialEdits);
    } catch (err) {
      console.error('AI Generation failed:', err);
      alert('Failed to generate post content. Please verify your AI settings/keys.');
    } finally {
      setGenerating(false);
    }
  };

  const handlePublishOrSchedule = async (isScheduleMode: boolean) => {
    if (!genResult) return;
    setPublishing(true);

    const platformsPayload: Record<string, { content: string }> = {};
    Object.keys(genResult.generated).forEach(plat => {
      platformsPayload[plat] = {
        content: editedContent[plat] || ''
      };
    });

    const payload = {
      idea: idea,
      post_type: 'TEXT', // default TEXT wrapper
      tone,
      model_used: genResult.model_used,
      platforms: platformsPayload,
      topics: [],
      ...(isScheduleMode && { publishAt: new Date(scheduleDate).toISOString() })
    };

    try {
      if (isScheduleMode) {
        await api.post('/posts/schedule', payload);
      } else {
        await api.post('/posts/publish', payload);
      }
      setShowCreateModal(false);
      resetForm();
      fetchData();
      alert(isScheduleMode ? 'Post scheduled successfully!' : 'Post published successfully!');
    } catch (err) {
      console.error('Failed to submit post:', err);
      alert('Failed to publish/schedule the post.');
    } finally {
      setPublishing(false);
    }
  };

  const resetForm = () => {
    setIdea('');
    setGenResult(null);
    setEditedContent({});
    setScheduleDate('');
    setIsScheduling(false);
  };

  // Compute Stats
  const totalPosts = posts.length;
  const activePlatforms = accounts.length;
  const publishedPostsCount = posts.filter(p => p.status === 'PUBLISHED').length;
  const successRate = totalPosts > 0 ? Math.round((publishedPostsCount / totalPosts) * 100) : 0;
  const queueCount = posts.filter(p => ['QUEUED', 'SCHEDULED', 'PUBLISHING'].includes(p.status)).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-slate-400">
        <Loader2 className="animate-spin text-indigo-500 mb-4" size={40} />
        <p className="font-medium animate-pulse">Loading workspace telemetry...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-8 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight font-outfit text-white">
            Workspace Dashboard
          </h1>
          <p className="text-slate-400 mt-1 text-sm md:text-base">
            Configure integrations, draft content, and check system performance.
          </p>
        </div>
        <button
          onClick={() => { setShowCreateModal(true); resetForm(); }}
          className="flex items-center space-x-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:opacity-90 active:scale-95 text-white px-5 py-2.5 rounded-xl font-semibold shadow-lg shadow-indigo-500/20 transition-all cursor-pointer text-sm"
        >
          <PlusCircle size={18} />
          <span>New Post Idea</span>
        </button>
      </header>

      {/* Stats Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl" />
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Total Posts</h3>
          <p className="text-3xl font-extrabold text-white mt-2 font-outfit">{totalPosts}</p>
          <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
            <History size={12} /> Cumulative generations
          </p>
        </div>
        
        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full blur-xl" />
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Connected Accounts</h3>
          <p className="text-3xl font-extrabold text-white mt-2 font-outfit">{activePlatforms} / 4</p>
          <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
            <Share2 size={12} /> Active social ecosystems
          </p>
        </div>

        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-500/5 rounded-full blur-xl" />
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Success Rate</h3>
          <p className="text-3xl font-extrabold text-white mt-2 font-outfit">{successRate}%</p>
          <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
            <CheckCircle2 size={12} /> Successfully dispatched jobs
          </p>
        </div>

        <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 rounded-full blur-xl" />
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Active Queue</h3>
          <p className="text-3xl font-extrabold text-white mt-2 font-outfit">{queueCount}</p>
          <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
            <Clock size={12} /> Scheduled / pending tasks
          </p>
        </div>
      </section>

      {/* Main Sections Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Connected Platforms Panel */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800/60 lg:col-span-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-6">
              <Share2 className="text-indigo-400" size={20} />
              <h2 className="text-lg font-bold text-white font-outfit">Platform Status</h2>
            </div>
            
            <div className="space-y-4">
              {[
                { name: 'Twitter', key: 'twitter', icon: (
                  <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                ), color: 'bg-black' },
                { name: 'LinkedIn', key: 'linkedin', icon: (
                  <svg className="w-5 h-5 fill-[#0a66c2]" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"/></svg>
                ), color: 'bg-slate-900' },
                { name: 'Facebook', key: 'facebook', icon: (
                  <svg className="w-5 h-5 fill-[#1877f2]" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                ), color: 'bg-slate-900' },
                { name: 'Instagram', key: 'instagram', icon: (
                  <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                ), color: 'bg-slate-900' }
              ].map((p) => {
                const connected = accounts.find(a => a.platform.toLowerCase() === p.key);
                return (
                  <div key={p.key} className="flex items-center justify-between p-3.5 bg-slate-900/60 border border-slate-800/60 rounded-xl">
                    <div className="flex items-center space-x-3.5">
                      <div className={`p-2 rounded-lg ${p.color} border border-slate-800 flex items-center justify-center`}>
                        {p.icon}
                      </div>
                      <div>
                        <span className="text-white text-sm font-semibold tracking-wide">{p.name}</span>
                        {connected && (
                          <p className="text-[11px] text-indigo-400 mt-0.5">@{connected.handle}</p>
                        )}
                      </div>
                    </div>
                    {connected ? (
                      <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-medium">
                        Connected
                      </span>
                    ) : (
                      <button 
                        onClick={() => connectPlatform(p.key)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold border border-indigo-500/30 hover:border-indigo-500/60 px-3 py-1.5 rounded-lg transition-all"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-800/40 text-xs text-slate-500">
            Social authentications are secured via OAuth 2.0. No password storage.
          </div>
        </div>

        {/* Recent Posts Timeline */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800/60 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <History className="text-indigo-400" size={20} />
              <h2 className="text-lg font-bold text-white font-outfit">Recent Submissions</h2>
            </div>
          </div>

          <div className="space-y-4">
            {posts.length > 0 ? posts.slice(0, 5).map((post) => (
              <div key={post.id} className="p-4 bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/60 rounded-xl space-y-3 transition duration-300">
                <div className="flex justify-between items-start">
                  <p className="text-white text-sm font-medium line-clamp-2 leading-relaxed flex-1 pr-4">{post.idea}</p>
                  <span className={`text-[10px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider ${
                    post.status === 'PUBLISHED' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' :
                    post.status === 'FAILED' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' :
                    'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  }`}>
                    {post.status}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/30 text-xs text-slate-500">
                  <div className="flex space-x-2">
                    {post.platformPosts.map((pp, idx) => (
                      <span key={idx} className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700/60 px-2 py-0.5 rounded uppercase font-semibold">
                        {pp.platform}
                      </span>
                    ))}
                  </div>
                  <div>
                    {new Date(post.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/10">
                <Sparkles className="mx-auto text-slate-600 mb-3" size={32} />
                <p className="text-slate-400 text-sm font-medium">No publications drafted yet</p>
                <p className="text-slate-600 text-xs mt-1">Use the WhatsApp/Telegram bot or create a new post idea.</p>
              </div>
            )}
          </div>
        </div>

      </section>

      {/* AI Post Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto">
          <div className="bg-[#0b101d] border border-slate-800/90 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col my-8">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800/60 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Sparkles className="text-indigo-400 animate-pulse" size={22} />
                <h2 className="text-xl font-bold text-white font-outfit">AI Content Composer</h2>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white bg-slate-800/50 p-1.5 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto max-h-[70vh]">
              
              {/* Form Side */}
              <form onSubmit={handleGenerate} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Core Idea / Topic Prompt
                  </label>
                  <textarea
                    rows={4}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder="E.g., Write a thread summarizing the three best books about system design and SaaS metrics."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none"
                    required
                  />
                  <div className="text-right text-[10px] text-slate-500 mt-1">
                    {idea.length} / 500 characters
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Content Category
                    </label>
                    <select
                      value={postType}
                      onChange={(e) => setPostType(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value="educational">Educational</option>
                      <option value="announcement">Announcement</option>
                      <option value="promotional">Promotional</option>
                      <option value="opinion">Opinion</option>
                      <option value="story">Story</option>
                      <option value="thread">Thread</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Brand Tone
                    </label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value="professional">Professional</option>
                      <option value="casual">Casual</option>
                      <option value="witty">Witty</option>
                      <option value="friendly">Friendly</option>
                      <option value="authoritative">Authoritative</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      AI Model Selection
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value="openai">OpenAI (GPT-4o)</option>
                      <option value="anthropic">Anthropic (Claude 3.5)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Target Platforms
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {['twitter', 'linkedin', 'instagram', 'threads'].map(plat => {
                      const active = selectedPlatforms.includes(plat);
                      return (
                        <button
                          type="button"
                          key={plat}
                          onClick={() => handlePlatformToggle(plat)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all ${
                            active
                              ? 'bg-indigo-500/10 border-indigo-500/60 text-indigo-400'
                              : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                          }`}
                        >
                          {plat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={generating || !idea.trim() || selectedPlatforms.length === 0}
                  className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 rounded-xl transition duration-300 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-indigo-600/10"
                >
                  {generating ? (
                    <>
                      <Loader2 className="animate-spin" size={18} />
                      <span>Synthesizing Copy...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>Generate AI Snippets</span>
                    </>
                  )}
                </button>
              </form>

              {/* Preview & Edit Side */}
              <div className="bg-slate-900/40 border border-slate-850 rounded-xl p-5 flex flex-col min-h-[300px]">
                {generating ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                    <Loader2 className="animate-spin text-indigo-400 mb-3" size={32} />
                    <p className="text-sm font-medium animate-pulse">Running AI formatting parameters...</p>
                  </div>
                ) : genResult ? (
                  <div className="space-y-5 flex-1 flex flex-col justify-between">
                    <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-800/40">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Snippet Previews</span>
                        <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded uppercase font-bold">
                          {genResult.model_used}
                        </span>
                      </div>
                      
                      {Object.keys(genResult.generated).map(plat => {
                        const content = editedContent[plat] || '';
                        return (
                          <div key={plat} className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-bold text-slate-400 uppercase tracking-wider">{plat}</span>
                              <span className="text-slate-500 text-[10px]">
                                {content.length} chars
                              </span>
                            </div>
                            <textarea
                              rows={3}
                              value={content}
                              onChange={(e) => setEditedContent(prev => ({ ...prev, [plat]: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-800/60 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-slate-850/60 pt-4 space-y-4">
                      {/* Scheduler Toggle */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar size={14} className="text-indigo-400" />
                            Schedule for later?
                          </label>
                          <input
                            type="checkbox"
                            checked={isScheduling}
                            onChange={(e) => setIsScheduling(e.target.checked)}
                            className="w-4 h-4 text-indigo-600 border-slate-800 rounded bg-slate-900 focus:ring-indigo-500 focus:ring-offset-slate-900"
                          />
                        </div>
                        {isScheduling && (
                          <input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            required
                          />
                        )}
                      </div>

                      {/* Submission Buttons */}
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => handlePublishOrSchedule(isScheduling)}
                          disabled={publishing || (isScheduling && !scheduleDate)}
                          className="flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 text-white font-semibold py-2 rounded-xl text-xs transition duration-300 disabled:opacity-50"
                        >
                          {publishing ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <Send size={14} />
                          )}
                          <span>{isScheduling ? 'Schedule Publication' : 'Publish Snippets Now'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center">
                    <Sparkles className="text-slate-700 mb-2" size={32} />
                    <p className="text-xs font-medium">Input your idea prompt and select details on the left, then click Generate.</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

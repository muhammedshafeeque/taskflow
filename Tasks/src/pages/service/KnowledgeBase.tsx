import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { serviceApi, type KbArticle } from '../../lib/api';

export default function KnowledgeBase() {
  const { token } = useAuth();
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = () => {
    if (!token) return;
    if (search.trim()) {
      serviceApi.searchKb(search, token).then((res) => {
        if (res.success && res.data) setArticles(res.data as KbArticle[]);
      });
    } else {
      serviceApi.listKb(token).then((res) => {
        if (res.success && res.data) setArticles(res.data as KbArticle[]);
      });
    }
  };

  useEffect(() => { load(); }, [token, search]);

  const create = async () => {
    if (!token || !title.trim() || !body.trim()) return;
    await serviceApi.createKb({ title: title.trim(), body, published: true }, token);
    setTitle('');
    setBody('');
    load();
  };

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold mb-4">Knowledge base</h1>
      <input
        className="mb-4 w-full max-w-md rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
        placeholder="Search articles…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] p-4">
        <h2 className="font-medium mb-2 text-sm">New article</h2>
        <input
          className="w-full mb-2 rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-sm"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full mb-2 rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-sm min-h-[100px]"
          placeholder="Body (markdown or HTML)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="button" onClick={create} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">
          Publish
        </button>
      </div>
      <div className="space-y-3">
        {articles.map((a) => (
          <article key={a._id} className="rounded-xl border border-[color:var(--border-subtle)] p-4">
            <h3 className="font-medium">{a.title}</h3>
            <p className="text-xs text-[color:var(--text-muted)] mb-2">{a.category} · {a.published ? 'Published' : 'Draft'}</p>
            <div className="text-sm prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: a.body }} />
          </article>
        ))}
      </div>
    </div>
  );
}

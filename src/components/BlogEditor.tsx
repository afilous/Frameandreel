import { useState, useEffect, useCallback } from "react";
import { createEdgeSpark } from "@edgespark/client";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

interface BlogPost {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string;
  cover_image: string | null;
  author: string;
  status: string;
  featured: number;
  published_at: number | null;
  created_at: number;
  updated_at: number;
  tags?: string | null;
}

const emptyPost = {
  title: "", subtitle: "", body: "", cover_image: "",
  author: "Frame & Reel", status: "published" as const,
  featured: false, tags: "",
};

export default function BlogEditor() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [editing, setEditing] = useState<(typeof emptyPost) & { id?: number }>({ ...emptyPost });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "bulk">("posts");

  // Bulk import state
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkResults, setBulkResults] = useState<any>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.api.fetch("/api/blog-admin");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ── Selection helpers ──
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === posts.length
      ? new Set()
      : new Set(posts.map(p => p.id))
    );
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkAction("");
  };

  // ── Bulk action handler ──
  const applyBulkAction = async () => {
    if (selectedIds.size === 0 || !bulkAction) return;
    const ids = Array.from(selectedIds);

    if (bulkAction === "delete") {
      if (!confirm(`Permanently delete ${ids.length} article${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
      setBulkActionLoading(true);
      for (const id of ids) {
        await client.api.fetch(`/api/blog-admin/${id}`, { method: "DELETE" });
      }
      clearSelection();
      setBulkActionLoading(false);
      fetchPosts();
      return;
    }

    if (bulkAction === "published" || bulkAction === "draft") {
      setBulkActionLoading(true);
      for (const id of ids) {
        await client.api.fetch(`/api/blog-admin/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: bulkAction }),
        });
      }
      clearSelection();
      setBulkActionLoading(false);
      fetchPosts();
      return;
    }

    if (bulkAction === "feature" || bulkAction === "unfeature") {
      setBulkActionLoading(true);
      for (const id of ids) {
        await client.api.fetch(`/api/blog-admin/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featured: bulkAction === "feature" ? 1 : 0 }),
        });
      }
      clearSelection();
      setBulkActionLoading(false);
      fetchPosts();
      return;
    }
  };

  // ── Save single post ──
  const save = async () => {
    if (!editing.title.trim()) return alert("Title is required");
    setSaving(true);
    try {
      const payload = {
        title: editing.title,
        subtitle: editing.subtitle,
        body: editing.body,
        cover_image: editing.cover_image,
        author: editing.author,
        status: editing.status,
        featured: editing.featured ? 1 : 0,
        tags: editing.tags || "",
      };
      if (editing.id) {
        await client.api.fetch(`/api/blog-admin/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await client.api.fetch("/api/blog-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setEditing({ ...emptyPost });
      setShowForm(false);
      fetchPosts();
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const deletePost = async (id: number) => {
    if (!confirm("Delete this post?")) return;
    await client.api.fetch(`/api/blog-admin/${id}`, { method: "DELETE" });
    fetchPosts();
  };

  const statusBadge = (s: string) => {
    const cls = s === "published"
      ? "bg-green-100 text-green-700"
      : "bg-yellow-100 text-yellow-700";
    return <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${cls}`}>{s}</span>;
  };

  const fmtDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  // ── Bulk import ──
  const handleBulkDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      f => f.name.endsWith(".txt") || f.name.endsWith(".md")
    );
    if (files.length > 0) setBulkFiles(files);
  };

  // Client-side article parser — no backend route needed
  const parseArticle = (raw: string, filename: string) => {
    const content = raw.trim();
    const lines = content.split("\n");
     // Handle ==SECTION== format
    if (content.includes("==TITLE==")) {
      const titleMatch = content.match(/==TITLE==\s*\n([^\n]+)/);
      const excerptMatch = content.match(/==EXCERPT==\s*\n([^\n]+)/);
      const bodyMatch = content.match(/==BODY==\s*\n([\s\S]*?)(?=\n==|$)/);
      const title = titleMatch?.[1]?.trim() || filename.replace(/\.[^.]+$/, "");
      const excerpt = excerptMatch?.[1]?.trim() || "";
      const rawBody = bodyMatch?.[1]?.trim() || content;
      const lower = (title + " " + rawBody).toLowerCase();
      const tagMap: Record<string, string> = { "locandina": "locandina", "one-sheet": "one-sheet", "one sheet": "one-sheet", "italian": "italian", "french": "french", "authentication": "authentication", "reproduction": "reproduction", "linen": "linen-backed", "1960s": "1960s", "1970s": "1970s", "1950s": "1950s", "1980s": "1980s", "noir": "film-noir" };
      const tags = Object.entries(tagMap).filter(([k]) => lower.includes(k)).map(([, v]) => v);
      return { title, excerpt, body: rawBody, tags: [...new Set(tags)].slice(0, 8).join(",") };
    }

    // Extract title: first # heading or first substantial line
    let title = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("# ")) { title = t.replace(/^#+\s+/, ""); break; }
      if (t && !t.startsWith("By ") && !t.startsWith("*By") && t.length > 10 && t.length < 150 && !t.startsWith("==")) {
        title = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
        break;
      }
    }

    // Extract excerpt: first real paragraph (60+ chars)
    let excerpt = "";
    let pastTitle = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t === title || t.replace(/^#+\s+/, "") === title) { pastTitle = true; continue; }
      if (t.startsWith("By ") || t.startsWith("*By")) continue;
      if (pastTitle && t.length > 60 && !t.startsWith("#") && !t.startsWith("==") && !t.startsWith("•")) {
        excerpt = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").substring(0, 220);
        if (excerpt.length >= 220) excerpt = excerpt.substring(0, excerpt.lastIndexOf(" ")) + "...";
        break;
      }
    }

    // Clean body: strip markdown symbols
    const out: string[] = [];
    let prevBlank = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t) { if (!prevBlank) out.push(""); prevBlank = true; continue; }
      prevBlank = false;
      if (/^# /.test(t)) continue;
      if (/^## /.test(t)) { out.push(""); out.push(t.replace(/^#+\s+/, "").toUpperCase()); out.push(""); continue; }
      if (/^### /.test(t)) { out.push(""); out.push("— " + t.replace(/^#+\s+/, "")); continue; }
      if (/^---+$/.test(t)) { out.push(""); continue; }
      if (/^[-*]\s/.test(t)) { out.push("  • " + t.replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")); continue; }
      out.push(t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/\[(.+?)\]\(.+?\)/g, "$1").replace(/`(.+?)`/g, "$1"));
    }
    const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    // Auto-extract tags
    const lower = (title + " " + content).toLowerCase();
    const tagMap: Record<string, string> = {
      "locandina": "locandina", "one-sheet": "one-sheet", "one sheet": "one-sheet",
      "italian": "italian", "french": "french", "lobby card": "lobby-card",
      "authentication": "authentication", "reproduction": "reproduction", "fake": "reproduction",
      "linen": "linen-backed", "fold": "folded", "condition": "condition",
      "hitchcock": "hitchcock", "fellini": "fellini", "leone": "leone",
      "kubrick": "kubrick", "godard": "godard", "truffaut": "truffaut",
      "1960s": "1960s", "1970s": "1970s", "1950s": "1950s", "1980s": "1980s",
      "golden age": "golden-age", "spaghetti": "spaghetti-western", "noir": "film-noir",
    };
    const tags = Object.entries(tagMap).filter(([k]) => lower.includes(k)).map(([, v]) => v);
    return { title, excerpt, body, tags: [...new Set(tags)].slice(0, 8).join(",") };
  };

  const handleBulkImport = async () => {
    if (bulkFiles.length === 0) return;
    setBulkLoading(true);
    const results: any[] = [];

    for (const file of bulkFiles) {
      try {
        const raw = await file.text();
        const parsed = parseArticle(raw, file.name);
        const res = await client.api.fetch("/api/blog-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: parsed.title,
            subtitle: parsed.excerpt,
            body: parsed.body,
            author: "Frame & Reel",
            status: "published",
            featured: 0,
            tags: parsed.tags,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          results.push({ status: "SUCCESS", title: parsed.title, slug: data.post?.slug || data.slug || "", tags: parsed.tags, filename: file.name });
        } else {
          const err = await res.text();
          results.push({ status: "ERROR", error: err, filename: file.name });
        }
      } catch (err: any) {
        results.push({ status: "ERROR", error: String(err), filename: file.name });
      }
    }

    const success = results.filter(r => r.status === "SUCCESS").length;
    const errors = results.filter(r => r.status === "ERROR").length;
    setBulkResults({ results, summary: { success, errors } });
    if (success > 0) fetchPosts();
    setBulkLoading(false);
  };

  // ── Render ──
  return (
    <div className="space-y-4">

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setActiveTab("posts")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "posts" ? "bg-burgundy-500 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Posts {posts.length > 0 && <span className="ml-1 text-xs opacity-70">({posts.length})</span>}
        </button>
        <button
          onClick={() => setActiveTab("bulk")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "bulk" ? "bg-burgundy-500 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Import Articles
        </button>
      </div>

      {/* ── POSTS TAB ── */}
      {activeTab === "posts" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900">
                Blog Posts
                {selectedIds.size > 0 && (
                  <span className="ml-2 text-sm font-normal text-blue-600">{selectedIds.size} selected</span>
                )}
              </h2>
              <button
                onClick={() => { setEditing({ ...emptyPost }); setShowForm(true); }}
                className="text-sm bg-burgundy-500 text-white px-4 py-1.5 rounded-lg hover:bg-burgundy-600 font-medium"
              >
                + New Post
              </button>
            </div>

            {/* Bulk action bar — visible when anything is selected */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-blue-700 flex-shrink-0">
                  {selectedIds.size} of {posts.length} selected
                </span>
                <select
                  value={bulkAction}
                  onChange={e => setBulkAction(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white flex-1 max-w-[180px]"
                >
                  <option value="">Choose action...</option>
                  <option value="published">Set Published</option>
                  <option value="draft">Set Draft</option>
                  <option value="feature">Mark Featured</option>
                  <option value="unfeature">Remove Featured</option>
                  <option value="delete">🗑 Delete Selected</option>
                </select>
                <button
                  onClick={applyBulkAction}
                  disabled={!bulkAction || bulkActionLoading}
                  className={`text-xs px-3 py-1 rounded font-medium disabled:opacity-40 ${
                    bulkAction === "delete"
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {bulkActionLoading ? "Working..." : "Apply"}
                </button>
                <button
                  onClick={clearSelection}
                  className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Loading */}
          {loading ? (
            <div className="text-center py-8">
              <div className="w-5 h-5 border-2 border-burgundy-500 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No posts yet. Use the Import tab to add articles.
            </div>
          ) : (
            <>
              {/* Select All row */}
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedIds.size === posts.length && posts.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 accent-burgundy-500 cursor-pointer"
                />
                <span className="text-xs text-gray-500">
                  {selectedIds.size === posts.length && posts.length > 0 ? "Deselect all" : `Select all ${posts.length} posts`}
                </span>
              </div>

              {/* Post rows */}
              <div className="divide-y divide-gray-100">
                {posts.map(p => (
                  <div
                    key={p.id}
                    className={`px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors ${selectedIds.has(p.id) ? "bg-blue-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="w-4 h-4 rounded border-gray-300 accent-burgundy-500 cursor-pointer flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                        {statusBadge(p.status)}
                        {p.featured === 1 && (
                          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                            Featured
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDate(p.published_at || p.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      {p.status === "published" && (
                        <a
                          href={`#/blog/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View
                        </a>
                      )}
                      <button
                        onClick={() => {
                          setEditing({
                            id: p.id,
                            title: p.title,
                            subtitle: p.subtitle || "",
                            body: p.body || "",
                            cover_image: p.cover_image || "",
                            author: p.author,
                            status: p.status as any,
                            featured: p.featured === 1,
                            tags: p.tags || "",
                          });
                          setShowForm(true);
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deletePost(p.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── IMPORT TAB ── */}
      {activeTab === "bulk" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-bold text-gray-900">Import Articles</h2>
            <p className="text-sm text-gray-500 mt-1">
              Drop any <strong>.txt</strong> or <strong>.md</strong> files — title, summary, tags, and slug are extracted automatically. No special formatting required.
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* How it works */}
            <div className="bg-cream-50 border border-cream-200 rounded-lg p-4 text-sm text-gray-600 space-y-1">
              <p className="font-medium text-gray-800 mb-2">How it works</p>
              <p>• Drop any article file — raw text, markdown, or ==SECTION== format all work</p>
              <p>• <strong>Title</strong> is pulled from the first heading or first line</p>
              <p>• <strong>Summary</strong> is pulled from the first real paragraph</p>
              <p>• <strong>Tags</strong> are auto-detected from directors, formats, genres, topics mentioned in the text</p>
              <p>• <strong>Slug</strong> is generated from the title (e.g. "The Locandina Guide" → locandina-guide)</p>
              <p>• All markdown symbols (# ## ** * ---) are stripped — body renders as clean prose</p>
              <p>• Articles are published immediately, not saved as drafts</p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleBulkDrop}
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-burgundy-400 transition-colors"
            >
              <div className="text-4xl mb-3">📄</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Drop article files here</p>
              <p className="text-xs text-gray-400 mb-4">Accepts .txt and .md files — one file per article, any number of files</p>
              <input
                type="file"
                multiple
                accept=".txt,.md"
                id="bulk-file-input"
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []).filter(
                    f => f.name.endsWith(".txt") || f.name.endsWith(".md")
                  );
                  if (files.length > 0) setBulkFiles(files);
                }}
              />
              <label
                htmlFor="bulk-file-input"
                className="inline-block text-sm text-white bg-burgundy-500 hover:bg-burgundy-600 cursor-pointer font-medium px-4 py-2 rounded-lg"
              >
                Browse files
              </label>
            </div>

            {/* Selected files */}
            {bulkFiles.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">{bulkFiles.length} file{bulkFiles.length === 1 ? "" : "s"} ready to import:</p>
                  <button
                    onClick={() => setBulkFiles([])}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {bulkFiles.map((f, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">{f.name}</span>
                  ))}
                </div>
                <button
                  onClick={handleBulkImport}
                  disabled={bulkLoading}
                  className="w-full bg-burgundy-500 text-white px-4 py-2.5 rounded-lg hover:bg-burgundy-600 font-semibold disabled:opacity-50 text-sm"
                >
                  {bulkLoading ? `Importing ${bulkFiles.length} articles...` : `Import ${bulkFiles.length} article${bulkFiles.length === 1 ? "" : "s"}`}
                </button>
              </div>
            )}

            {/* Results */}
            {bulkResults && (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <h3 className="font-semibold text-gray-900">Import Results</h3>
                  <div className="flex gap-3 text-sm">
                    <span className="text-green-600 font-medium">✅ {bulkResults.summary?.success || 0} imported</span>
                    {(bulkResults.summary?.errors || 0) > 0 && (
                      <span className="text-red-500 font-medium">❌ {bulkResults.summary.errors} failed</span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  {bulkResults.results?.map((r: any, i: number) => (
                    <div key={i} className={`px-4 py-2.5 flex items-start gap-2 text-sm ${r.status === "SUCCESS" ? "" : "bg-red-50"}`}>
                      <span className="flex-shrink-0">{r.status === "SUCCESS" ? "✅" : "❌"}</span>
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${r.status === "SUCCESS" ? "text-gray-900" : "text-red-700"}`}>
                          {r.title || r.error || r.filename}
                        </p>
                        {r.status === "SUCCESS" && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            /{r.slug}
                            {r.tags ? ` · tags: ${r.tags}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <button
                    onClick={() => { setBulkResults(null); setBulkFiles([]); setActiveTab("posts"); }}
                    className="text-sm text-burgundy-500 font-medium hover:underline"
                  >
                    View all posts →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT / NEW POST FORM ── */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-bold text-gray-900">{editing.id ? "Edit Post" : "New Post"}</h2>
            <button onClick={() => { setEditing({ ...emptyPost }); setShowForm(false); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Title</label>
                <input
                  value={editing.title}
                  onChange={e => setEditing({ ...editing, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Subtitle / Summary</label>
                <input
                  value={editing.subtitle}
                  onChange={e => setEditing({ ...editing, subtitle: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500"
                  placeholder="One sentence summary"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Cover Image URL</label>
              <input
                value={editing.cover_image}
                onChange={e => setEditing({ ...editing, cover_image: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Body</label>
              <textarea
                value={editing.body}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={14}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500 font-mono"
                placeholder="Write your article here. Use blank lines between paragraphs. Headings are ALL CAPS. Sub-headings use — Prefix."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Tags (comma-separated)</label>
              <input
                value={editing.tags}
                onChange={e => setEditing({ ...editing, tags: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500"
                placeholder="leone, locandina, 1960s, authentication"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Author</label>
                <input
                  value={editing.author}
                  onChange={e => setEditing({ ...editing, author: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Status</label>
                <select
                  value={editing.status}
                  onChange={e => setEditing({ ...editing, status: e.target.value as any })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 cursor-pointer mt-auto pb-2">
                  <input
                    type="checkbox"
                    checked={!!editing.featured}
                    onChange={e => setEditing({ ...editing, featured: e.target.checked })}
                    className="w-4 h-4 accent-burgundy-500"
                  />
                  <span className="text-sm text-gray-700">Featured</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={save}
                disabled={saving}
                className="px-5 py-2 text-sm bg-burgundy-500 text-white rounded-lg hover:bg-burgundy-600 font-semibold disabled:opacity-50"
              >
                {saving ? "Saving..." : editing.id ? "Update Post" : "Create Post"}
              </button>
              <button
                onClick={() => { setEditing({ ...emptyPost }); setShowForm(false); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

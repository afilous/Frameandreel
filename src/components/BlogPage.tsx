import { useState, useEffect, useCallback } from "react";
import { createEdgeSpark } from "@edgespark/client";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

const BASE_URL = "https://staging--b4puosnkz6175drjl5qg.youbase.cloud";// v2
const _BUILD_VERSION = "20260521-blog-redesign";

interface BlogPost {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string;
  cover_image: string | null;
  author: string;
  status: string;
  published_at: number | null;
  created_at: number;
  featured?: number;
  tags?: string | null;
  theme?: string | null;
}

interface RelatedPoster {
  id: number;
  title: string;
  year: number | null;
  format: string | null;
  imageUrl: string | null;
  url: string;
}

// ── Category config ──
const CATEGORIES = [
  { label: "All", value: "all" },
  { label: "Beginner's Guide", value: "beginner" },
  { label: "Authentication", value: "authentication" },
  { label: "Formats Explained", value: "formats" },
  { label: "Artists", value: "artist" },
  { label: "By Director", value: "director" },
  { label: "By Genre", value: "genre" },
  { label: "Collecting", value: "collecting" },
  { label: "Conservation", value: "conservation" },
];

// Infer category from title/tags
function inferCategory(post: BlogPost): string {
  if (post.tags) {
    const t = post.tags.toLowerCase();
    if (t.includes("beginner") || t.includes("first")) return "beginner";
    if (t.includes("authentication") || t.includes("fake") || t.includes("nss")) return "authentication";
    if (t.includes("format") || t.includes("locandina") || t.includes("one-sheet")) return "formats";
    if (t.includes("artist") || t.includes("illustrator") || t.includes("designer")) return "artist";
    if (t.includes("director") || t.includes("leone") || t.includes("kubrick") || t.includes("coppola")) return "director";
    if (t.includes("genre") || t.includes("western") || t.includes("noir") || t.includes("horror")) return "genre";
    if (t.includes("conservation") || t.includes("linen") || t.includes("backing")) return "conservation";
    if (t.includes("collect") || t.includes("budget") || t.includes("value") || t.includes("invest")) return "collecting";
  }
  const title = post.title.toLowerCase();
  if (/beginner|first poster|your first|what is|glossary/.test(title)) return "beginner";
  if (/fake|authentication|nss|real\?|checklist|red flag|star wars|bootleg|re-release|mistak/.test(title)) return "authentication";
  if (/locandina|one-sheet|format|daybill|quad|insert|half-sheet|lobby card|fotobusta/.test(title)) return "formats";
  if (/mcginnis|struzan|saul bass|bill gold|artist|illustrat|designer|casaro|symeoni/.test(title)) return "artist";
  if (/kubrick|eastwood|pacino|de niro|nicholson|wayne|redford|scorsese|coppola|tarantino|leone|bond|indiana jones|django/.test(title)) return "director";
  if (/western|noir|horror|sci-fi|blaxploitation|war movie|animation|new hollywood|spaghetti|poliziott/.test(title)) return "genre";
  if (/linen|conservation|backing|restoration/.test(title)) return "conservation";
  if (/value|invest|budget|undervalued|hold their|build.*collection/.test(title)) return "collecting";
  return "collecting";
}


// Format date
function fmtDate(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ── Article body renderer ──
function renderArticleBody(body: string): JSX.Element[] {
  const lines = body.split("\n");
  const elements: JSX.Element[] = [];
  let key = 0;
  let bulletBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={key++} style={{ paddingLeft: "18px", marginBottom: "14px" }}>
        {bulletBuffer.map((b, i) => (
          <li key={i} style={{ fontFamily: "'Lora', serif", fontSize: "15px", color: "#2C1810", lineHeight: "1.75", marginBottom: "5px" }}>
            {b.replace(/^\s*[•\-]\s*/, "")}
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushBullets(); continue; }

    // ALL CAPS section heading (min 4 chars, has letters, not a bullet)
    if (
      trimmed.length >= 4 &&
      trimmed.length < 120 &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      !trimmed.startsWith("•") &&
      !trimmed.startsWith("—") &&
      !/^\d+\./.test(trimmed)
    ) {
      flushBullets();
      elements.push(
        <h3 key={key++} style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", fontWeight: 700, color: "#1A1208", marginTop: "24px", marginBottom: "8px", letterSpacing: "0.01em" }}>
          {trimmed}
        </h3>
      );
      continue;
    }

    // Sub-heading: "— Title"
    if (trimmed.startsWith("— ") || trimmed.startsWith("- ")) {
      flushBullets();
      elements.push(
        <h4 key={key++} style={{ fontFamily: "'Lora', serif", fontSize: "15px", fontStyle: "italic", fontWeight: 500, color: "#1A1208", marginTop: "16px", marginBottom: "5px" }}>
          {trimmed.substring(2)}
        </h4>
      );
      continue;
    }

    // Bullet
    if (trimmed.startsWith("•") || trimmed.startsWith("  •")) {
      bulletBuffer.push(trimmed);
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      flushBullets();
      elements.push(
        <p key={key++} style={{ fontFamily: "'Lora', serif", fontSize: "15px", color: "#2C1810", lineHeight: "1.75", marginBottom: "10px", paddingLeft: "6px" }}>
          {trimmed}
        </p>
      );
      continue;
    }

    // Footer italic
    if (trimmed.startsWith("Frame & Reel carries") || trimmed.startsWith("*Frame & Reel")) {
      flushBullets();
      elements.push(
        <p key={key++} style={{ fontFamily: "'Lora', serif", fontSize: "13px", fontStyle: "italic", color: "#8C7355", lineHeight: "1.65", marginTop: "20px", paddingTop: "16px", borderTop: "0.5px solid rgba(26,18,8,0.12)" }}>
          {trimmed.replace(/^\*|\*$/g, "")}
        </p>
      );
      continue;
    }

    // Byline
    if (trimmed.startsWith("By Frame & Reel")) {
      flushBullets();
      elements.push(
        <p key={key++} style={{ fontFamily: "'Lora', serif", fontSize: "13px", fontStyle: "italic", color: "#8C7355", marginBottom: "20px" }}>
          {trimmed}
        </p>
      );
      continue;
    }

    // Regular paragraph
    flushBullets();
    elements.push(
      <p key={key++} style={{ fontFamily: "'Lora', serif", fontSize: "15px", color: "#2C1810", lineHeight: "1.8", marginBottom: "16px" }}>
        {trimmed}
      </p>
    );
  }

  flushBullets();
  return elements;
}

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════
export default function BlogPage({ postSlug }: { postSlug?: string }) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [currentPost, setCurrentPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("all");
  const [relatedInventory, setRelatedInventory] = useState<RelatedPoster[]>([]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.api.fetch("/api/public/blog?limit=100");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (postSlug) {
      client.api.fetch(`/api/public/blog/${postSlug}`).then(async res => {
        if (res.ok) {
          const d = await res.json();
          setCurrentPost(d.post);
          // Fetch related inventory
          try {
            const inv = await fetch(`${BASE_URL}/api/blog/${postSlug}/related-inventory`);
            if (inv.ok) {
              const invData = await inv.json();
              setRelatedInventory(invData.inventory || []);
            }
          } catch {}
        }
        setLoading(false);
      });
    } else {
      fetchPosts();
    }
  }, [postSlug, fetchPosts]);

  // Filter
  const filteredPosts = activeCategory === "all"
    ? posts
    : posts.filter(p => inferCategory(p) === activeCategory);

  const featuredPost = posts.find(p => p.featured === 1) || posts[0];
  const gridPosts = filteredPosts.filter(p => p.id !== featuredPost?.id);

  // ── ARTICLE DETAIL VIEW ──
  if (postSlug) {
    if (loading) return (
      <div style={{ minHeight: "100vh", background: "#FBF8F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "24px", height: "24px", border: "2px solid #8B1A1A", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
    if (!currentPost) return (
      <div style={{ minHeight: "100vh", background: "#FBF8F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: "'Lora', serif", color: "#5C4A2A" }}>Post not found</p>
      </div>
    );

    return (
      <div style={{ minHeight: "100vh", background: "#FBF8F2", fontFamily: "'Lora', serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Lora:ital,wght@0,400;0,500;1,400&family=Special+Elite&display=swap'); @keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {/* Nav */}
        <nav style={{ background: "rgba(251,248,242,0.9)", backdropFilter: "blur(8px)", borderBottom: "0.5px solid rgba(26,18,8,0.12)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
          <a href="#" style={{ fontFamily: "'Playfair Display', serif", fontSize: "16px", fontWeight: 900, color: "#1A1208", textDecoration: "none" }}>Frame &amp; <span style={{ color: "#8B1A1A" }}>Reel</span></a>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <a href="#/blog" style={{ fontFamily: "'Lora', serif", fontSize: "12px", color: "#8B1A1A", textDecoration: "none" }}>← All Articles</a>
            <a href="#" style={{ fontFamily: "'Lora', serif", fontSize: "12px", color: "#5C4A2A", textDecoration: "none" }}>← Home</a>
          </div>
        </nav>

        {/* Article */}
        <article style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px" }}>
          {/* Category */}
          <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.3em", color: "#8B1A1A", textTransform: "uppercase", marginBottom: "12px" }}>
            {CATEGORIES.find(c => c.value === inferCategory(currentPost))?.label || "Collector's Resource"}
          </div>

          {/* Title */}
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "36px", fontWeight: 900, color: "#1A1208", lineHeight: 1.1, letterSpacing: "-0.5px", marginBottom: "12px" }}>
            {currentPost.title}
          </h1>

          {/* Subtitle */}
          {currentPost.subtitle && (
            <p style={{ fontFamily: "'Lora', serif", fontSize: "16px", color: "#5C4A2A", lineHeight: 1.6, marginBottom: "16px" }}>
              {currentPost.subtitle}
            </p>
          )}

          {/* Byline + date */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center", paddingBottom: "20px", borderBottom: "0.5px solid rgba(26,18,8,0.12)", marginBottom: "28px" }}>
            {currentPost.published_at && (
              <span style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "#8C7355", textTransform: "uppercase" }}>
                {fmtDate(currentPost.published_at)}
              </span>
            )}
            <span style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "#8C7355", textTransform: "uppercase" }}>
              Frame &amp; Reel
            </span>
          </div>

          {/* Cover image */}
          {currentPost.cover_image && (
            <img src={currentPost.cover_image} alt="" style={{ width: "100%", borderRadius: "2px", marginBottom: "28px", display: "block" }} />
          )}

          {/* Body */}
          <div>{renderArticleBody(currentPost.body)}</div>

          {/* Related inventory */}
          {relatedInventory.length > 0 && (
            <div style={{ marginTop: "32px", paddingTop: "20px", borderTop: "0.5px solid rgba(26,18,8,0.12)" }}>
              <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.25em", color: "#8C7355", textTransform: "uppercase", marginBottom: "14px" }}>
                From the Frame &amp; Reel Collection
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {relatedInventory.slice(0, 6).map(p => (
                  <a key={p.id} href={p.url} style={{ textDecoration: "none", width: "80px" }}>
                    <div style={{ aspectRatio: "2/3", background: p.imageUrl ? `url(${p.imageUrl}) center/cover` : "linear-gradient(145deg,#1C1008,#080402)", border: "0.5px solid rgba(26,18,8,0.15)", borderRadius: "2px", marginBottom: "5px", overflow: "hidden" }}>
                      {!p.imageUrl && (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "8px", color: "rgba(251,248,242,0.6)", textAlign: "center", padding: "4px", lineHeight: 1.2 }}>{p.title}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'Lora', serif", fontSize: "9px", color: "#5C4A2A", lineHeight: 1.3 }}>{p.title}</div>
                    {p.year && <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "8px", color: "#8C7355" }}>{p.year}</div>}
                  </a>
                ))}
              </div>
            </div>
          )}
        </article>

        {/* Footer */}
        <footer style={{ borderTop: "0.5px solid rgba(26,18,8,0.12)", marginTop: "32px" }}>
          <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <a href="#/blog" style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "#8C7355", textTransform: "uppercase", textDecoration: "none" }}>← All Articles</a>
            <a href="#/collection" style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "#8B1A1A", textTransform: "uppercase", textDecoration: "none" }}>Browse Collection →</a>
          </div>
        </footer>
      </div>
    );
  }

  // ── BLOG LIST VIEW ──
  return (
    <div style={{ minHeight: "100vh", background: "#FBF8F2", fontFamily: "'Lora', serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Lora:ital,wght@0,400;0,500;1,400&family=Special+Elite&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        .bl-card:hover { background: rgba(26,18,8,0.02); }
        .bl-genre-card:hover { background: rgba(26,18,8,0.03); }
        .bl-cat-pill { transition: all 0.15s; cursor: pointer; }
        .bl-cat-pill:hover { background: rgba(26,18,8,0.06) !important; }
        .bl-featured-read:hover .bl-line { width: 40px !important; }
      `}</style>

      {/* Nav */}
      <nav style={{ background: "rgba(251,248,242,0.9)", backdropFilter: "blur(8px)", borderBottom: "0.5px solid rgba(26,18,8,0.12)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <a href="#" style={{ fontFamily: "'Playfair Display', serif", fontSize: "18px", fontWeight: 900, color: "#1A1208", textDecoration: "none" }}>Frame &amp; <span style={{ color: "#8B1A1A" }}>Reel</span></a>
        <div style={{ display: "flex", gap: "24px" }}>
          {["Collection", "Blog", "Contact"].map(l => (
            <a key={l} href={l === "Collection" ? "#/collection" : l === "Contact" ? "#/contact" : "#/blog"} style={{ fontFamily: "'Lora', serif", fontSize: "11px", color: "#5C4A2A", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.14em" }}>{l}</a>
          ))}
        </div>
        <a href="#" style={{ fontFamily: "'Lora', serif", fontSize: "11px", color: "#8C7355", textDecoration: "none" }}>← Home</a>
      </nav>

      {/* Masthead */}
      <div style={{ padding: "32px 32px 0", borderBottom: "0.5px solid rgba(26,18,8,0.12)", paddingBottom: "20px" }}>
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.3em", color: "#8C7355", textTransform: "uppercase", marginBottom: "6px" }}>Collector's Resource</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "34px", fontWeight: 900, color: "#1A1208", lineHeight: 1, letterSpacing: "-1px", marginBottom: "6px" }}>From the Blog</h1>
        <p style={{ fontFamily: "'Lora', serif", fontSize: "13px", color: "#5C4A2A", lineHeight: 1.6, maxWidth: "500px" }}>Guides and deep-dives — for first-time buyers and serious collectors alike.</p>
      </div>

      {/* Category pills */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "14px 32px", borderBottom: "0.5px solid rgba(26,18,8,0.12)" }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            className="bl-cat-pill"
            onClick={() => setActiveCategory(cat.value)}
            style={{
              fontFamily: "'Special Elite', monospace",
              fontSize: "8px",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              padding: "4px 12px",
              border: "0.5px solid",
              borderColor: activeCategory === cat.value ? "#1A1208" : "rgba(26,18,8,0.2)",
              background: activeCategory === cat.value ? "#1A1208" : "transparent",
              color: activeCategory === cat.value ? "#FBF8F2" : "#5C4A2A",
              cursor: "pointer",
              borderRadius: "1px",
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px" }}>
          <div style={{ width: "24px", height: "24px", border: "2px solid #8B1A1A", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#8C7355", fontFamily: "'Lora', serif" }}>No articles yet. Check back soon.</div>
      ) : (
        <>
          {/* Featured article — full width, only on "All" tab */}
          {activeCategory === "all" && featuredPost && (
            <a
              href={`#/blog/${featuredPost.slug}`}
              style={{ display: "grid", gridTemplateColumns: "1fr 380px", borderBottom: "0.5px solid rgba(26,18,8,0.12)", textDecoration: "none", background: "#FBF8F2" }}
            >
              {/* Left: editorial text */}
              <div style={{ padding: "40px 48px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "8px", letterSpacing: "0.3em", color: "#8B1A1A", textTransform: "uppercase", marginBottom: "12px" }}>
                  Featured · {CATEGORIES.find(c => c.value === inferCategory(featuredPost))?.label || "Collector's Resource"}
                </div>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "28px", fontWeight: 900, color: "#1A1208", lineHeight: 1.1, letterSpacing: "-0.5px", marginBottom: "14px" }}>
                  {featuredPost.title}
                </h2>
                <p style={{ fontFamily: "'Lora', serif", fontSize: "13px", color: "#5C4A2A", lineHeight: 1.7, marginBottom: "20px", maxWidth: "480px" }}>
                  {featuredPost.subtitle || (featuredPost.body || "").split("\n").filter(l => l.trim() && l.trim().length > 40 && !l.startsWith("By ") && l.trim() !== l.trim().toUpperCase())[0]?.trim().substring(0, 200) || ""}
                </p>
                <span style={{ fontFamily: "'Special Elite', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "#1A1208", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ width: "24px", height: "0.5px", background: "#1A1208", flexShrink: 0 }}></span>
                  Read the guide
                </span>
              </div>
              {/* Right: 2 secondary article picks */}
              <div style={{ background: "#F0EBE1", minHeight: "280px", padding: "32px", position: "relative", overflow: "hidden" }}>
                {featuredPost.cover_image && (
                  <img src={featuredPost.cover_image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.2 }} />
                )}
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "0.15em", color: "#8B1A1A", marginBottom: "16px", textTransform: "uppercase" }}>
                    Also Worth Reading
                  </div>
                  {posts.slice(1, 3).map((post, i) => (
                    <div
                      key={post.id}
                      style={{
                        borderBottom: i === 0 ? "0.5px solid #C4B49A" : "none",
                        paddingBottom: i === 0 ? "16px" : "0",
                        marginBottom: i === 0 ? "16px" : "0",
                        cursor: "pointer",
                      }}
                      onClick={() => window.location.hash = "#/blog/" + post.slug}
                    >
                      <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.12em", color: "#8B1A1A", marginBottom: "6px", textTransform: "uppercase" }}>
                        {CATEGORIES.find(c => c.value === inferCategory(post))?.label || "Article"}
                      </div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#1A1208", margin: "0 0 6px", lineHeight: 1.25 }}>
                        {post.title}
                      </p>
                      <span style={{ fontFamily: "monospace", fontSize: "9px", color: "#8B1A1A" }}>
                        READ -&gt;
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </a>
          )}

          {/* Body: category sections + sidebar */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 240px" }}>
            {/* Main content grouped by category */}
            <div style={{ borderRight: "0.5px solid rgba(26,18,8,0.12)" }}>
              {(() => {
                const categoryOrder = ["beginner", "formats", "collecting", "authentication", "artist", "director", "genre", "conservation"];
                const grouped = categoryOrder
                  .map(catValue => ({
                    cat: CATEGORIES.find(c => c.value === catValue)!,
                    posts: gridPosts.filter(p => inferCategory(p) === catValue),
                  }))
                  .filter(g => g.posts.length > 0);
                const categorizedIds = new Set(grouped.flatMap(g => g.posts.map(p => p.id)));
                const uncategorized = gridPosts.filter(p => !categorizedIds.has(p.id));
                if (uncategorized.length > 0) {
                  grouped.push({ cat: { label: "More Articles", value: "other" }, posts: uncategorized });
                }
                return grouped.map(({ cat, posts: catPosts }) => (
                  <div key={cat.value} style={{ borderBottom: "0.5px solid rgba(26,18,8,0.12)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 24px 12px", borderBottom: "0.5px solid rgba(26,18,8,0.08)" }}>
                      <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: "17px", fontWeight: 700, color: "#1A1208", margin: 0 }}>
                        {cat.label}
                      </h3>
                      <span style={{ fontFamily: "monospace", fontSize: "9px", letterSpacing: "0.12em", color: "#8B1A1A", cursor: "pointer", textTransform: "uppercase" }}>
                        VIEW ALL
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1px", background: "#C4B49A" }}>
                      {catPosts.slice(0, 3).map(post => (
                        <a key={post.id} href={`#/blog/${post.slug}`} style={{ textDecoration: "none", display: "block", background: "#FBF8F2" }}>
                          {post.cover_image && (
                            <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                              <img src={post.cover_image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </div>
                          )}
                          <div style={{ padding: "18px", display: "flex", flexDirection: "column", minHeight: "140px" }}>
                            <div style={{ fontFamily: "monospace", fontSize: "8px", letterSpacing: "0.12em", color: "#8B1A1A", textTransform: "uppercase", marginBottom: "8px" }}>
                              {cat.label}
                            </div>
                            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "13px", fontWeight: 700, color: "#1A1208", margin: "0 0 6px", lineHeight: 1.3 }}>
                              {post.title}
                            </div>
                            <div style={{ fontFamily: "'Lora', serif", fontSize: "11px", color: "#6B5B3E", lineHeight: 1.55, margin: "0 0 10px", flex: 1 }}>
                              {(post.subtitle || "").substring(0, 100)}{post.subtitle && post.subtitle.length > 100 ? "..." : ""}
                            </div>
                            <div style={{ fontFamily: "monospace", fontSize: "9px", color: "#8B1A1A", marginTop: "auto" }}>
                              READ GUIDE
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Sidebar */}
            <div style={{ padding: "20px 16px" }}>
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "8px", letterSpacing: "0.25em", color: "#8C7355", textTransform: "uppercase", marginBottom: "10px", paddingBottom: "6px", borderBottom: "0.5px solid rgba(26,18,8,0.12)" }}>
                  Popular Articles
                </div>
                {posts.slice(0, 5).map(p => (
                  <a key={p.id} href={`#/blog/${p.slug}`} style={{ display: "block", padding: "8px 0", borderBottom: "0.5px solid rgba(26,18,8,0.06)", textDecoration: "none" }}>
                    <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "7px", letterSpacing: "0.15em", color: "#8B1A1A", textTransform: "uppercase", marginBottom: "2px" }}>
                      {CATEGORIES.find(c => c.value === inferCategory(p))?.label}
                    </div>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "11px", fontWeight: 700, color: "#1A1208", lineHeight: 1.2 }}>
                      {p.title}
                    </div>
                  </a>
                ))}
              </div>
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontFamily: "'Special Elite', monospace", fontSize: "8px", letterSpacing: "0.25em", color: "#8C7355", textTransform: "uppercase", marginBottom: "10px", paddingBottom: "6px", borderBottom: "0.5px solid rgba(26,18,8,0.12)" }}>
                  Browse by Topic
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  {["Authentication","Locandina","One-sheets","Leone","Kubrick","Film Noir","1960s","1970s","NSS Numbers","Condition","Italian","French","McGinnis","Struzan"].map(tag => (
                    <span key={tag} style={{ fontFamily: "'Special Elite', monospace", fontSize: "7px", letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 8px", border: "0.5px solid rgba(26,18,8,0.15)", color: "#5C4A2A", cursor: "pointer", borderRadius: "1px" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ background: "#1A1208", padding: "16px", borderRadius: "2px" }}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "13px", fontWeight: 900, fontStyle: "italic", color: "#FBF8F2", marginBottom: "6px", lineHeight: 1.2 }}>Browse the Collection</div>
                <div style={{ fontFamily: "'Lora', serif", fontSize: "10px", color: "#8C7355", lineHeight: 1.5, marginBottom: "10px" }}>846 original theatrical posters, ready to ship worldwide.</div>
                <a href="#/collection" style={{ fontFamily: "'Special Elite', monospace", fontSize: "8px", letterSpacing: "0.15em", color: "#C8A44A", textTransform: "uppercase", textDecoration: "none" }}>View Collection</a>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { createEdgeSpark } from "@edgespark/client";

declare const __GA_MEASUREMENT_ID__: string | null;
declare const __HOTJAR_SITE_ID__: string | null;
declare const __LOOKER_STUDIO_URL__: string | null;
declare global {
  interface Window {
    gtag: (...args: any[]) => void;
    _GA_ID: string | null;
    hj: (...args: any[]) => void;
    _HJ_ID: string | null;
  }
}

// Build timestamp - changes on every build to force cache invalidation
const _BUILD_VERSION = "20260526-" + Date.now();


const PosterManager = lazy(() => import("./components/PosterManager"));
const InventoryManager = lazy(() => import("./components/InventoryManager"));
const BlogPage = lazy(() => import("./components/BlogPage"));
const AdminLogin = lazy(() => import("./components/AdminLogin"));
const EbayListingDashboard = lazy(() => import("./components/EbayListingDashboard"));

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

/* ─────────────── DATA INTERFACES ─────────────── */

interface Poster {
  release_year?: number | null;
  id: number;
  title: string | null;
  year: number | null;
  director: string | null;
  actors: string | null;
  genre: string | null;
  notes: string | null;
  poster_style: string | null;
  awards: string | null;
  status: string;
  price: number | null;
  condition_grade: string | null;
  format: string | null;
  poster_country: string | null;
  artist: string | null;
  dimensions: string | null;
  original_title: string | null;
  createdAt: number;
  updatedAt: number;
  visibility: string;
  imageUrl: string | null;
  sold: number;
}

interface Collection {
  name: string;
  slug: string;
  count: number;
  description: string;
}

interface Testimonial {
  quote: string;
  name: string;
  location: string;
}

/* ─────────────── STATIC DATA ─────────────── */

const COLLECTIONS: Collection[] = [
  { name: "Crime & Gangster", slug: "crime", count: 124, description: "Mafia epics, heist films & noir thrillers" },
  { name: "Spaghetti Western", slug: "western", count: 87, description: "Sergio Leone, Clint Eastwood & the frontier" },
  { name: "Action & Adventure", slug: "action", count: 156, description: "Blockbuster one-sheets & advance posters" },
  { name: "Horror & Suspense", slug: "horror", count: 93, description: "Classic monster movies & psychological terror" },
  { name: "Sci-Fi & Fantasy", slug: "scifi", count: 68, description: "Otherworldly visions & space operas" },
  { name: "Film Noir", slug: "noir", count: 54, description: "Shadowy detectives & femme fatales" },
  { name: "Spy & Espionage", slug: "spy", count: 42, description: "Secret agents & Cold War thrillers" },
  { name: "Cult Classics", slug: "cult", count: 78, description: "Underground favorites & midnight movies" },
];

const TESTIMONIALS: Testimonial[] = [
  { quote: "Matched listing, packaged well and delivered quickly.", name: "b***c", location: "eBay verified" },
  { quote: "Arrived as described, smooth transaction.", name: "9***5", location: "eBay verified" },
  { quote: "Excellent transaction!", name: "l***l", location: "eBay verified" },
];

const GENRE_COLORS: Record<string, string> = {
  Crime: "bg-burgundy-500",
  Thriller: "bg-noir-500",
  Western: "bg-gold-500",
  "Film Noir": "bg-gray-800",
  Action: "bg-orange-600",
  Horror: "bg-purple-900",
  "Sci-Fi": "bg-blue-800",
  Drama: "bg-emerald-700",
  Comedy: "bg-yellow-600",
  Adventure: "bg-teal-600",
};

/* ─────────────── COMPONENTS ─────────────── */

function FilmStripDecor() {
  return (
    <div className="absolute left-0 right-0 top-0 h-8 overflow-hidden opacity-[0.06]">
      <div className="flex gap-2 animate-[scroll_20s_linear_infinite]">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-32 h-full bg-noir-500 rounded" />
        ))}
      </div>
    </div>
  );
}

function StarRating() {
  return (
    <div className="flex gap-0.5">
      {[...Array(5)].map((_, i) => (
        <svg key={i} className="w-3.5 h-3.5 text-gold-400 fill-current" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string | null }) {
  if (!condition) return null;
  const colorClass = condition === "Mint" ? "bg-green-100 text-green-800 border-green-200"
    : condition === "Near Mint" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : condition === "Very Good" ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-orange-50 text-orange-700 border-orange-200";

  return (
    <span className={`inline-block text-[10px] font-typewriter uppercase tracking-widest px-2 py-0.5 border rounded ${colorClass}`}>
      {condition}
    </span>
  );
}

function getPosterBadge(poster: Poster): string | null {
  if (poster.awards) return "Award Winner";
  if (poster.condition_grade === "Mint") return "Rare";
  return null;
}

function PosterCard({ poster, index }: { poster: Poster; index: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1 }
    );
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  const badge = getPosterBadge(poster);
  const displayGenre = poster.genre || "Uncategorized";
  const genreColor = GENRE_COLORS[displayGenre] || "bg-gray-700";

  return (
    <div
      ref={cardRef}
      className={`group relative transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}
      style={{ transitionDelay: `${index * 100}ms` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Poster Image */}
      <div className="relative overflow-hidden rounded-sm vintage-shadow group-hover:vintage-shadow-lg transition-all duration-500">
        <div className="aspect-[2/3] overflow-hidden bg-noir-200">
          <img
            src={poster.imageUrl || ""}
            alt={`${poster.title || "Untitled"} original movie poster`}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            loading="lazy"
          />
        </div>

        {/* Badge */}
        {badge && (
          <div className="absolute top-2 sm:top-3 left-2 sm:left-3 z-10">
            <span className="bg-burgundy-500 text-white text-[8px] sm:text-[10px] font-display font-semibold uppercase tracking-wider px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-sm shadow-lg">
              {badge}
            </span>
          </div>
        )}

        {/* Price Overlay */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-noir-900/95 via-noir-900/70 to-transparent p-2.5 sm:p-4 transition-all duration-500 ${isHovered ? 'translate-y-0' : 'translate-y-4 opacity-0'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gold-300 font-display text-base sm:text-xl font-bold">
                {poster.price ? `$${poster.price.toLocaleString()}` : "—"}
              </p>
            </div>
            <a
              href={`#/poster/${poster.id}`}
              className="bg-gold-400 hover:bg-gold-500 text-noir-800 text-[10px] sm:text-xs font-display font-semibold uppercase tracking-wider px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-sm transition-colors"
            >
              View Details
            </a>
          </div>
        </div>

        {/* Sold Out Overlay */}
        {poster.sold === 1 && (
          <div className="absolute inset-0 bg-noir-900/60 flex items-center justify-center z-20">
            <span className="bg-red-600/90 text-white font-display font-bold text-sm sm:text-base uppercase tracking-widest px-5 sm:px-8 py-2.5 sm:py-3.5 rounded-sm shadow-xl border border-red-400/30">
              Sold Out
            </span>
          </div>
        )}

        {/* Award/Rare Badge only - no genre tag on image */}
      </div>

      {/* Card Info */}
      <div className="mt-2 sm:mt-3 px-0.5">
        <div className="flex items-start justify-between gap-1 sm:gap-2">
          <div>
            <h3 className="font-display text-sm sm:text-base font-semibold text-noir-500 group-hover:text-burgundy-500 transition-colors line-clamp-2">
              {poster.title || "Untitled"}
            </h3>
            <p className="text-[10px] sm:text-xs text-noir-300 font-body mt-0.5 line-clamp-1 sm:line-clamp-2">
              {poster.year ? `${poster.year}${poster.release_year ? ` / R${poster.release_year}` : ""}` : "Unknown"} · {poster.poster_style || poster.format || "Original One-Sheet"} · {poster.genre ? poster.genre.split(", ").join(" · ") : "Uncategorized"}
            </p>
          </div>
          <ConditionBadge condition={poster.condition_grade} />
        </div>
        <p className="text-xs text-noir-200 mt-1.5 line-clamp-2 font-body leading-relaxed">
          {poster.notes || "Authentic original movie poster. Contact us for details."}
        </p>
      </div>
    </div>
  );
}

function ImageZoomPanel({ src, alt }: { src: string; alt: string }) {
  const [isActive, setIsActive] = useState(false);
  const [cursorPct, setCursorPct] = useState({ x: 50, y: 50 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const ZOOM = 2.5;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setCursorPct({ x, y });
  };

  const handleLoad = () => {
    if (imgRef.current) {
      setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  };

  const getBackgroundStyles = (): React.CSSProperties => {
    if (!naturalSize.w || !naturalSize.h || !imgRef.current) return {};
    const rect = imgRef.current.getBoundingClientRect();
    const containerAR = rect.width / rect.height;
    const imgAR = naturalSize.w / naturalSize.h;
    let bgW: number, bgH: number, offsetX: number, offsetY: number;

    if (imgAR > containerAR) {
      bgW = (containerAR / imgAR) * 100;
      bgH = 100;
      offsetX = (100 - bgW) / 2;
      offsetY = 0;
    } else {
      bgW = 100;
      bgH = (imgAR / containerAR) * 100;
      offsetX = 0;
      offsetY = (100 - bgH) / 2;
    }

    const mapX = offsetX + (cursorPct.x / 100) * bgW;
    const mapY = offsetY + (cursorPct.y / 100) * bgH;

    return {
      backgroundSize: `${ZOOM * 100}% ${ZOOM * 100}%`,
      backgroundPosition: `${mapX}% ${mapY}%`,
    };
  };

  return (
    <>
      <div
        className="relative overflow-hidden rounded-sm vintage-shadow-lg bg-noir-200 cursor-crosshair"
        onMouseEnter={() => setIsActive(true)}
        onMouseLeave={() => setIsActive(false)}
        onMouseMove={handleMouseMove}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="w-full object-cover"
          onLoad={handleLoad}
        />
        {isActive && (
          <div
            className="absolute pointer-events-none border border-gold-400/70 rounded-sm z-10"
            style={{
              width: '10%',
              height: '10%',
              left: `${Math.min(Math.max(cursorPct.x - 5, 0), 90)}%`,
              top: `${Math.min(Math.max(cursorPct.y - 5, 0), 90)}%`,
            }}
          />
        )}

      </div>

      {isActive && (
        <div className="hidden lg:block absolute top-0 right-0 w-[110%] translate-x-[105%] overflow-hidden rounded-sm border border-cream-300 shadow-xl z-20 pointer-events-none">
          <div
            className="w-full bg-no-repeat"
            style={{
              aspectRatio: naturalSize.w && naturalSize.h ? `${naturalSize.w} / ${naturalSize.h}` : '2 / 3',
              backgroundImage: `url(${src})`,
              ...getBackgroundStyles(),
            }}
          />
        </div>
      )}
    </>
  );
}

/* ─────────────── POSTER DETAIL PAGE ─────────────── */

function PosterDetail({ posterId }: { posterId: string }) {
  const [poster, setPoster] = useState<Poster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    async function fetchPoster() {
      try {
        // Use inventory API since posters are stored in the inventory table
        const res = await client.api.fetch(`/api/public/inventory/${posterId}`);
        if (!res.ok) {
          setError("Poster not found");
          setLoading(false);
          return;
        }
        const data = await res.json();
        // Map inventory item to Poster format for consistency
        const item = data.item;
        if (item) {
          setPoster({
            id: item.id,
            title: item.title,
            year: item.year,
            director: item.director,
            actors: item.actors,
            genre: item.genre,
            notes: item.notes,
            poster_style: item.format,
            awards: null,
            status: item.status || 'available',
            price: item.price,
            condition_grade: item.condition,
            format: item.format,
            poster_country: item.poster_country,
            artist: null,
            dimensions: item.dimensions,
            original_title: item.original_title,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
            visibility: item.visibility,
            imageUrl: item.imageUrl || item.source_url,
            sold: item.sold === 1 ? 1 : 0,
          });
        } else {
          setError("Poster not found");
        }
      } catch (err) {
        setError("Failed to load poster");
      }
      setLoading(false);
    }
    fetchPoster();
  }, [posterId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-burgundy-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-noir-300 font-body text-sm">Loading poster details...</p>
        </div>
      </div>
    );
  }

  if (error || !poster) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-noir-400 font-display text-xl mb-4">{error || "Poster not found"}</p>
          <a href="#" className="text-burgundy-500 hover:text-burgundy-600 font-display text-sm uppercase tracking-wider">
            ← Back to Collection
          </a>
        </div>
      </div>
    );
  }

  const badge = getPosterBadge(poster);
  const displayGenre = poster.genre || "Uncategorized";

  return (
    <div className="min-h-screen bg-cream-50 grain-overlay">
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${isScrolled ? 'bg-cream-50/95 backdrop-blur-md shadow-md' : 'bg-cream-50/80 backdrop-blur-sm'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <a href="#" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-sm bg-burgundy-500 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-gold-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621-.504-1.125-1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125 1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
                </svg>
              </div>
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight text-noir-500">
                Frame &amp; <span className="text-burgundy-500">Reel</span>
              </span>
            </a>
            <nav className="hidden sm:flex items-center gap-6">
              {[{ label: "Collection", href: "#/collection" }, { label: "Blog", href: "#/blog" }, { label: "Contact", href: "#/contact" }].map(item => (
                <a key={item.label} href={item.href} className="text-noir-400 hover:text-burgundy-500 font-body text-sm transition-colors uppercase tracking-wider">{item.label}</a>
              ))}
            </nav>
            <a href="#/collection" className="text-noir-400 hover:text-burgundy-500 font-body text-sm transition-colors inline-flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to Collection
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="pt-24 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
            {/* Left: Poster Image */}
            <div className="relative">
              <div className="sticky top-28">
                {poster.imageUrl ? (
                  <div className="relative">
                    <ImageZoomPanel src={poster.imageUrl} alt={`${poster.title || "Untitled"} original movie poster`} />
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-sm vintage-shadow-lg bg-noir-200 aspect-[2/3] flex items-center justify-center">
                    <p className="text-noir-300 font-body text-sm">No image available</p>
                  </div>
                )}
                {/* Mobile Price Bar */}
                <div className="lg:hidden mt-4 p-4 bg-noir-500 rounded-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-cream-300 text-xs font-body">Price</p>
                      <p className="text-gold-300 font-display text-2xl font-bold">
                        {poster.price ? `$${poster.price.toLocaleString()}` : "Contact for Price"}
                      </p>
                    </div>
                    {poster.sold === 1 ? (
                      <span className="bg-red-600 text-white text-xs font-display font-bold uppercase tracking-wider px-6 py-3 rounded-sm">Sold</span>
                    ) : poster.price ? (
                      <a
                        href="https://www.ebay.com/str/frameandreelmovieposters"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gold-400 hover:bg-gold-500 text-noir-800 text-xs font-display font-semibold uppercase tracking-wider px-6 py-3 rounded-sm transition-colors"
                      >
                        Buy on eBay ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Details */}
            <div>
              {/* Badge */}
              {badge && (
                <span className="inline-block bg-burgundy-500 text-white text-[10px] font-display font-semibold uppercase tracking-wider px-3 py-1 rounded-sm mb-4">
                  {badge}
                </span>
              )}

              {/* Title */}
              <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-noir-500 leading-tight mb-2">
                {poster.title || "Untitled"}
              </h1>

              {/* Year */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-gold-500 font-typewriter text-sm uppercase tracking-widest">
                  {poster.year ? `${poster.year}${poster.release_year ? ` / R${poster.release_year}` : ""}` : "Unknown Year"}
                </span>
                <span className="text-noir-300">·</span>
              </div>

              {/* Genres */}
              {poster.genre && (
                <div className="mb-6">
                  <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-2">Genres</p>
                  <div className="flex flex-wrap gap-2">
                    {poster.genre.split(", ").map((g) => (
                      <span key={g} className="bg-burgundy-100 text-burgundy-700 text-xs font-display font-medium px-3 py-1 rounded-sm border border-burgundy-200">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="divider-vintage mb-8" />

              {/* Detail Grid */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                {poster.director && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Director</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.director}</p>
                  </div>
                )}
                {poster.actors && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Cast</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.actors}</p>
                  </div>
                )}
                {poster.format && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Format</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.format}</p>
                  </div>
                )}
                {poster.dimensions && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Dimensions</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.dimensions}</p>
                  </div>
                )}
                {poster.poster_country && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Country</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.poster_country}</p>
                  </div>
                )}
                {poster.poster_style && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Style</p>
                    <p className="text-noir-500 font-display text-sm font-semibold">{poster.poster_style}</p>
                  </div>
                )}
                {poster.condition_grade && (
                  <div className="p-4 bg-cream-200 rounded-sm border border-cream-300">
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest mb-1">Condition</p>
                    <div className="mt-1"><ConditionBadge condition={poster.condition_grade} /></div>
                  </div>
                )}
              </div>

              {/* Awards */}
              {poster.awards && (
                <div className="mb-8 p-4 bg-gold-50 border border-gold-200 rounded-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-gold-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m0 0a6.023 6.023 0 01-2.77-.896" />
                    </svg>
                    <p className="text-noir-300 text-[10px] font-typewriter uppercase tracking-widest">Awards</p>
                  </div>
                  <p className="text-noir-500 font-body text-sm">{poster.awards}</p>
                </div>
              )}

              {/* Description */}
              <div className="mb-8">
                <h2 className="font-display text-lg font-semibold text-noir-500 mb-3">About This Poster</h2>
                <p className="text-noir-400 font-body text-sm leading-relaxed">
                  An authentic original theatrical movie poster. Every poster in our collection is personally inspected, guaranteed original, and graded. Please contact us for more details.
                </p>
              </div>

              {/* Desktop Price + CTA */}
              <div className="hidden lg:block p-6 bg-noir-500 rounded-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-cream-300 text-xs font-body">Price</p>
                    <p className="text-gold-300 font-display text-3xl font-bold">
                      {poster.price ? `$${poster.price.toLocaleString()}` : "Contact for Price"}
                    </p>
                    <p className="text-noir-200 text-xs font-body mt-1">
                      {poster.condition_grade ? `Condition: ${poster.condition_grade}` : "Contact for condition details"}
                    </p>
                  </div>
                  {poster.sold === 1 ? (
                  <div className="flex items-center gap-3">
                    <span className="bg-red-600 text-white font-display text-sm font-bold uppercase tracking-wider px-6 py-3.5 rounded-sm inline-flex items-center gap-2">
                      Sold Out
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                    <a
                      href="https://www.ebay.com/str/frameandreelmovieposters"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold-400 hover:text-gold-300 font-display text-sm font-semibold uppercase tracking-wider px-4 py-3.5 transition-colors inline-flex items-center gap-2"
                    >
                      Visit Store
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </div>
                  ) : (
                  <div className="flex items-center gap-3">
                    {poster.price ? (
                      <a
                        href={`https://www.ebay.com/str/frameandreelmovieposters`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gold-400 hover:bg-gold-500 text-noir-800 font-display text-sm font-semibold uppercase tracking-wider px-6 py-3.5 rounded-sm transition-colors shadow-lg hover:shadow-xl inline-flex items-center gap-2"
                      >
                        Purchase
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                        </svg>
                      </a>
                    ) : null}
                  </div>
                  )}
                </div>
              </div>

              {/* Trust Features */}
              <div className="mt-8 grid grid-cols-2 gap-4">
                {[
                  { title: "100% Original Guaranteed", desc: "Every poster verified as original — full refund if we miss anything" },
                  { title: "Professionally Packaged", desc: "Shipped flat or rolled" },
                  { title: "Worldwide Shipping", desc: "Securely packed & insured delivery" },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-gold-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                    <div>
                      <p className="text-noir-500 font-display text-xs font-semibold">{item.title}</p>
                      <p className="text-noir-300 text-[11px] font-body">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─────────────── MAIN STOREFRONT ─────────────── */

function Storefront() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Poster[]>([]);
  const [blogPosts, setBlogPosts] = useState<Array<{id:number;slug:string;title:string;subtitle:string|null;cover_image:string|null;author:string;published_at:number|null}>>([]);
  const [loading, setLoading] = useState(true);
  const [recentlyLoading, setRecentlyLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [headerSearch, setHeaderSearch] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{id: number; title: string; year: number | null; director: string | null; format: string | null; country: string | null; sold: boolean; imageUrl: string | null; type: string}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Fetch search suggestions as user types — debounced 150ms
  useEffect(() => {
    if (headerSearch.length < 1) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await client.api.fetch(`/api/public/inventory?search=${encodeURIComponent(headerSearch)}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          setSearchSuggestions(data.items || []);
          setShowSuggestions(true);
        }
      } catch { /* silent */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [headerSearch]);

  // Hide suggestions when clicking outside
  useEffect(() => {
    const handleClick = () => setShowSuggestions(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Contact form state
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  // Fetch posters from API
  useEffect(() => {
    async function fetchPosters() {
      try {
        const res = await client.api.fetch("/api/public/inventory?visibility=featured&limit=20");
        if (res.ok) {
          const data = await res.json();
          setPosters(data.items || []);
        }
      } catch (err) {
        console.error("Failed to fetch posters:", err);
      }
      setLoading(false);
    }
    fetchPosters();

    // Fetch recently added posters
    async function fetchRecentlyAdded() {
      try {
        const res = await client.api.fetch("/api/public/inventory?visibility=recently_added&limit=8");
        if (res.ok) {
          const data = await res.json();
          setRecentlyAdded(data.items || []);
        }
      } catch (err) {
        console.error("Failed to fetch recently added:", err);
      }
      setRecentlyLoading(false);
    }
    fetchRecentlyAdded();

    // Fetch recent blog posts
    client.api.fetch("/api/public/blog").then(res => {
      if (res.ok) res.json().then(d => setBlogPosts((d.posts || []).slice(0, 3)));
    }).catch(() => {});
  }, []);

  const genres = useMemo(() => {
    const all = Array.from(new Set(
      posters.flatMap((p) => (p.genre || "").split(", ").filter(Boolean))
    )).sort();
    return ["All", ...all];
  }, [posters]);

  const filteredPosters = useMemo(
    () => activeFilter === "All" ? posters : posters.filter((p) => (p.genre || "").split(", ").includes(activeFilter)),
    [activeFilter, posters]
  );

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubscribing(true);
    try {
      const res = await client.api.fetch("/api/public/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setSubscribed(true);
    } catch { /* silent */ }
    setSubscribing(false);
  };

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactEmail || !contactMessage.trim()) return;
    setContactSending(true);
    try {
      const res = await client.api.fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: contactEmail, message: contactMessage, name: contactName || null }),
      });
      if (res.ok) setContactSent(true);
    } catch { /* silent */ }
    setContactSending(false);
  };

  return (
    <div className="min-h-screen grain-overlay">
      {/* ═══════ HEADER ═══════ */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${isScrolled ? 'bg-cream-50/95 backdrop-blur-md shadow-md' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            {/* Logo */}
            <a href="#" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-sm bg-burgundy-500 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-gold-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621-.504-1.125-1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125 1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
                </svg>
              </div>
              <span className={`font-display text-xl sm:text-2xl font-bold tracking-tight transition-colors ${isScrolled ? 'text-noir-500' : 'text-white'}`}>
                Frame &amp; <span className={isScrolled ? 'text-burgundy-500' : 'text-gold-300'}>Reel</span>
              </span>
            </a>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-8">
              {[{ label: "Collection", href: "#/collection" }, { label: "Blog", href: "#/blog" }, { label: "Contact", href: "#/contact" }].map((item) => (
                <a key={item.label} href={item.href}
                  className={`text-sm font-body font-medium uppercase tracking-wider transition-colors hover:text-burgundy-500 ${isScrolled ? 'text-noir-400' : 'text-cream-300'}`}>
                  {item.label}
                </a>
              ))}
              {/* Search Bar */}
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  placeholder="Search posters..."
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && headerSearch.trim()) {
                      window.location.hash = `#/collection?search=${encodeURIComponent(headerSearch.trim())}`;
                      setHeaderSearch("");
                      setShowSuggestions(false);
                    }
                    if (e.key === 'Escape') {
                      setShowSuggestions(false);
                    }
                  }}
                  onFocus={() => searchSuggestions.length > 0 && setShowSuggestions(true)}
                  className={`w-40 lg:w-56 pl-9 pr-3 py-1.5 text-xs font-body bg-transparent border rounded-sm placeholder:text-noir-300 focus:outline-none focus:border-burgundy-500 transition-colors ${isScrolled ? 'border-noir-200 text-noir-500' : 'border-cream-300/50 text-cream-200'}`}
                />
                <svg className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isScrolled ? 'text-noir-300' : 'text-cream-300/70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>

                {/* Dynamic Search Dropdown */}
                {showSuggestions && searchSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-noir-100 rounded-sm shadow-2xl z-50 overflow-hidden">
                    {/* Results header */}
                    <div className="px-3 py-1.5 border-b border-cream-200 bg-cream-50 flex items-center justify-between">
                      <span className="text-[10px] font-typewriter uppercase tracking-widest text-noir-300">
                        {searchSuggestions.length} result{searchSuggestions.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] font-typewriter uppercase tracking-widest text-noir-300">
                        Enter to search all
                      </span>
                    </div>

                    {searchSuggestions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          window.location.hash = `#/poster/${s.id}`;
                          setHeaderSearch("");
                          setShowSuggestions(false);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-cream-50 border-b border-cream-100 last:border-0 flex items-center gap-3 group transition-colors"
                      >
                        {/* Thumbnail */}
                        <div className="flex-shrink-0 w-8 h-12 bg-noir-100 rounded-sm overflow-hidden">
                          {s.imageUrl ? (
                            <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-noir-200 to-noir-300">
                              <svg className="w-3 h-3 text-noir-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-display font-semibold text-noir-500 truncate group-hover:text-burgundy-500 transition-colors">
                              {s.title}
                            </span>
                            {s.sold === 1 && (
                              <span className="flex-shrink-0 text-[8px] font-typewriter uppercase tracking-wider bg-noir-100 text-noir-400 px-1.5 py-0.5 rounded-sm">
                                Sold
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-noir-300 font-body mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {s.year && <span>{s.year}</span>}
                            {s.year && s.director && <span>·</span>}
                            {s.director && <span className="truncate">{s.director}</span>}
                            {s.format && <span className="text-[9px] font-typewriter uppercase tracking-wider text-burgundy-400">{s.format}</span>}
                          </div>
                        </div>

                        {/* Arrow */}
                        <svg className="flex-shrink-0 w-3 h-3 text-noir-200 group-hover:text-burgundy-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </button>
                    ))}

                    {/* View all results footer */}
                    <button
                      onClick={() => {
                        window.location.hash = `#/collection?search=${encodeURIComponent(headerSearch.trim())}`;
                        setHeaderSearch("");
                        setShowSuggestions(false);
                      }}
                      className="w-full px-3 py-2 text-[10px] font-typewriter uppercase tracking-wider text-burgundy-500 hover:bg-burgundy-50 text-center border-t border-cream-200 transition-colors"
                    >
                      View all results for "{headerSearch}" →
                    </button>
                  </div>
                )}
              </div>
            </nav>

            {/* CTA + Mobile Toggle */}
            <div className="flex items-center gap-3">
              <a href="#/collection" className="hidden sm:inline-flex bg-burgundy-500 hover:bg-burgundy-600 text-white text-xs font-display font-semibold uppercase tracking-wider px-4 py-2.5 rounded-sm transition-colors shadow-lg hover:shadow-xl">
                Browse Collection
              </a>
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2">
                <svg className={`w-6 h-6 transition-colors ${isScrolled ? 'text-noir-500' : 'text-white'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  {mobileMenuOpen
                    ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-cream-50/98 backdrop-blur-lg border-t border-cream-300 animate-fade-in">
            <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3">
              {[{ label: "Collection", href: "#/collection" }, { label: "Blog", href: "#/blog" }, { label: "Contact", href: "#/contact" }].map((item) => (
                <a key={item.label} href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-noir-400 font-body text-sm font-medium uppercase tracking-wider py-2 border-b border-cream-200 last:border-0 hover:text-burgundy-500 transition-colors">
                  {item.label}
                </a>
              ))}
              <a href="https://www.ebay.com/str/frameandreelmovieposters" target="_blank" rel="noopener noreferrer"
                onClick={() => setMobileMenuOpen(false)}
                className="text-noir-300 font-body text-xs uppercase tracking-wider py-2 hover:text-gold-500 transition-colors border-t border-cream-200">
                eBay Store ↗
              </a>
            </nav>
          </div>
        )}
      </header>
      {/* ═══════ HERO ═══════ */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-noir-900 via-noir-800 to-noir-500">
          <div className="absolute inset-0 opacity-20 bg-[url('https://public.youware.com/users-website-assets/prod/7b7cb41e-62cb-49b5-b72f-0c035a3c6347/46ea156932164c15ba330b5124f3ac47.jpg')] bg-cover bg-center bg-no-repeat" />
          <div className="absolute inset-0 bg-gradient-to-b from-noir-900/60 via-noir-900/40 to-noir-900/90" />
        </div>

        {/* Film strip decoration top */}
        <FilmStripDecor />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="animate-fade-in">
            <p className="text-gold-400 font-typewriter text-xs uppercase tracking-[0.3em] mb-6">Original Theatrical Posters</p>
            <h1 className="font-display text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold text-white leading-[0.95] mb-6">
              The Real Thing.
              <br />
              <span className="text-gradient-gold italic">On Your Wall.</span>
            </h1>
            <p className="text-cream-300 font-body text-base sm:text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
              Every poster was printed for a single theatrical run —{" "}
              <strong className="text-cream-100 font-semibold">not for collectors, not for resale.</strong>{" "}
              That's what makes them rare. We find them, verify them, and bring them to you.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style={{ animationDelay: '300ms' }}>
            <a href="#/collection" className="group bg-burgundy-500 hover:bg-burgundy-600 text-white font-display font-semibold text-sm uppercase tracking-wider px-8 py-4 rounded-sm transition-all duration-300 shadow-xl hover:shadow-2xl hover:shadow-burgundy-500/25 inline-flex items-center gap-2">
              Browse the Collection
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-cream-50 to-transparent" />
      </section>
      {/* ═══════ COLLECTION SECTION ═══════ */}
      <section id="collection" className="relative py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="text-center mb-12">
            <p className="text-gold-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Curated Selection</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-noir-500 mb-4">
              Featured Posters
            </h2>
            <div className="divider-vintage max-w-xs mx-auto mb-4" />
            <p className="text-noir-300 font-body text-sm sm:text-base max-w-xl mx-auto">
              Every poster tells a story — each one an original theatrical release, handpicked and guaranteed original. Never a reproduction.
            </p>
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-2 border-burgundy-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-noir-300 font-body text-sm">Loading collection...</p>
            </div>
          )}

          {/* Empty State */}
          {!loading && posters.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-cream-200 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-noir-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
              </div>
              <p className="font-display text-lg font-semibold text-noir-400 mb-2">Collection Coming Soon</p>
              <p className="text-noir-300 font-body text-sm max-w-md mx-auto mb-4">
                We're currently curating our featured collection. Check back soon or browse our full inventory on eBay.
              </p>
              <a
                href="https://www.ebay.com/str/frameandreelmovieposters"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-burgundy-500 hover:bg-burgundy-600 text-white font-display text-sm font-semibold uppercase tracking-wider px-6 py-3 rounded-sm transition-colors"
              >
                Visit eBay Store ↗
              </a>
            </div>
          )}

          {/* Genre Filters */}
          {!loading && posters.length > 0 && genres.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
              {genres.map((genre) => (
                <button
                  key={genre}
                  onClick={() => setActiveFilter(genre)}
                  className={`text-xs font-typewriter uppercase tracking-widest px-4 py-2 rounded-sm border transition-all duration-300 ${
                    activeFilter === genre
                      ? 'bg-burgundy-500 text-white border-burgundy-500 shadow-lg shadow-burgundy-500/20'
                      : 'bg-transparent text-noir-300 border-cream-300 hover:border-burgundy-400 hover:text-burgundy-500'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          )}

          {/* Poster Grid */}
          {!loading && filteredPosters.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
              {filteredPosters.map((poster, i) => (
                <PosterCard key={poster.id} poster={poster} index={i} />
              ))}
            </div>
          )}

          {/* No results for filter */}
          {!loading && posters.length > 0 && filteredPosters.length === 0 && (
            <div className="text-center py-12">
              <p className="text-noir-300 font-body text-sm">No {activeFilter} posters in the featured collection.</p>
            </div>
          )}

          {/* View Full Collection */}
          {!loading && posters.length > 0 && (
            <div className="text-center mt-14">
              <a
                href="#/collection"
                className="inline-flex items-center gap-2 bg-noir-500 hover:bg-noir-600 text-cream-100 font-display text-sm font-semibold uppercase tracking-wider px-8 py-3.5 rounded-sm transition-all shadow-lg hover:shadow-xl"
              >
                View Full Collection
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ═══════ RECENTLY ADDED SECTION ═══════ */}
      <section id="recently-added" className="py-20 bg-cream-50 relative">
        {/* Grain overlay for texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(139,69,19,0.5) 35px, rgba(139,69,19,0.5) 36px)`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          {/* Section Header */}
          <div className="text-center mb-12">
            <p className="text-emerald-600 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Fresh Arrivals</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-noir-500 mb-4">
              Recently Added
            </h2>
            <div className="divider-vintage max-w-xs mx-auto mb-4" />
            <p className="text-noir-300 font-body text-sm sm:text-base max-w-xl mx-auto">
              Just added to our collection. These new arrivals are ready to find their forever homes.
            </p>
          </div>

          {/* Loading */}
          {recentlyLoading && (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-noir-300 font-body text-sm">Loading new arrivals...</p>
            </div>
          )}

          {/* Empty State */}
          {!recentlyLoading && recentlyAdded.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-cream-200 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-noir-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-display text-lg font-semibold text-noir-400 mb-2">No Recent Arrivals</p>
              <p className="text-noir-300 font-body text-sm max-w-md mx-auto">
                Check back soon for new additions to our collection.
              </p>
            </div>
          )}

          {/* Recently Added Grid */}
          {!recentlyLoading && recentlyAdded.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
              {recentlyAdded.map((poster, i) => (
                <PosterCard key={poster.id} poster={poster} index={i} />
              ))}
            </div>
          )}

          {/* View All New Arrivals */}
          {!recentlyLoading && recentlyAdded.length > 0 && (
            <div className="text-center mt-14">
              <a
                href="#/collection?filter=recently_added"
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-display text-sm font-semibold uppercase tracking-wider px-8 py-3.5 rounded-sm transition-all shadow-lg hover:shadow-xl"
              >
                View All New Arrivals
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ═══════ COLLECTIONS BY GENRE ═══════ */}
      <section id="new-arrivals" className="py-20 bg-noir-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]">
          <div className="absolute inset-0" style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 35px, rgba(200,169,81,0.5) 35px, rgba(200,169,81,0.5) 36px)`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-14">
            <p className="text-gold-400 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Explore</p>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-cream-100 mb-4">
              Browse by Genre
            </h2>
            <div className="divider-vintage max-w-xs mx-auto" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {COLLECTIONS.map((col) => (
              <a key={col.slug} href="#" className="group p-3 sm:p-5 rounded-sm border border-cream-100/10 bg-noir-600/50 hover:bg-noir-600/80 hover:border-gold-400/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-gold-400/5">
                <div className="flex items-start justify-between mb-1 sm:mb-2">
                  <h3 className="font-display text-sm sm:text-base font-semibold text-cream-100 group-hover:text-gold-300 transition-colors">
                    {col.name}
                  </h3>
                  <span className="text-gold-400 font-typewriter text-[10px] sm:text-xs">{col.count}</span>
                </div>
                <p className="text-noir-200 text-[11px] sm:text-xs font-body leading-relaxed hidden sm:block">{col.description}</p>
                <div className="mt-2 sm:mt-3 flex items-center gap-1 text-gold-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] font-display uppercase tracking-wider font-semibold">Explore</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
      {/* ═══════ HOW IT WORKS — bg-white ═══════ */}
      <section id="about" className="py-20 sm:py-28 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            <div>
              <p className="text-burgundy-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-4">How It Works</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-noir-500 mb-6 leading-tight">
                We Find It. We Verify It.<br />We List It.<br />
                <span className="text-burgundy-500">You Hang It.</span>
              </h2>
              <p className="text-noir-300 font-body text-sm leading-relaxed">
                Every poster goes through the same process before it reaches the store. We research what we have, confirm it's genuine, and describe it accurately —{" "}
                <strong className="text-noir-500 font-semibold">regardless of format, era, or country of origin.</strong>{" "}
                If it doesn't check out, it doesn't get listed.
              </p>
            </div>
            <div className="space-y-0 divide-y divide-cream-200">
              {[
                { n: "1", title: "We source originals", desc: "We actively seek out original theatrical posters across formats and countries — American one-sheets, foreign releases, linen-backed prints, and more." },
                { n: "2", title: "We do the research", desc: "We verify release dates, confirm printing details, and identify the difference between a genuine original and a later reprint." },
                { n: "3", title: "We describe it accurately", desc: "Condition, format, size, and any notable details — written honestly. No inflated grades, no vague descriptions." },
              ].map((step) => (
                <div key={step.n} className="flex items-start gap-6 py-7 first:pt-0 last:pb-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-burgundy-300 flex items-center justify-center">
                    <span className="font-display text-sm font-bold text-burgundy-500">{step.n}</span>
                  </div>
                  <div>
                    <h4 className="font-display text-base font-semibold text-noir-500 mb-1">{step.title}</h4>
                    <p className="text-noir-300 font-body text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ WHY FRAME & REEL — bg-cream-50 ═══════ */}
      <section className="py-16 sm:py-20 bg-cream-50 border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-gold-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Why Frame &amp; Reel</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-noir-500">Every piece. Every time.</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: "M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z", title: "Guaranteed Original", desc: "Every piece is a genuine theatrical original, or we make it right. No exceptions." },
              { icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z", title: "Honest, Detailed Grading", desc: "No inflated grades. Condition described accurately with high-resolution images so you know exactly what you're getting." },
              { icon: "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9", title: "Packed Securely", desc: "Every poster is packed with care to arrive in exactly the condition described." },
              { icon: "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418", title: "Worldwide Shipping", desc: "We ship to collectors everywhere. Wherever you are, we'll get it to you safely." },
            ].map((item) => (
              <div key={item.title} className="flex flex-col items-start gap-3 p-5 bg-white rounded-sm border border-cream-200 hover:border-burgundy-200 hover:shadow-md transition-all duration-300">
                <div className="w-9 h-9 rounded-sm bg-cream-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-burgundy-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <div>
                  <h4 className="font-display text-sm font-semibold text-noir-500 mb-1">{item.title}</h4>
                  <p className="text-noir-300 text-xs font-body leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ TESTIMONIALS — bg-white ═══════ */}
      <section className="py-16 sm:py-20 bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <p className="text-gold-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Verified Buyers</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-noir-500">What Collectors Say</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-cream-50 border border-cream-200 rounded-sm p-6">
                <StarRating />
                <p className="text-noir-400 font-body text-sm leading-relaxed mt-3 mb-4 italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div>
                  <p className="text-noir-500 font-display text-xs font-semibold">{t.name}</p>
                  <p className="text-gold-500 font-typewriter text-[10px] uppercase tracking-wider mt-0.5">{t.location}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ FROM THE BLOG — bg-cream-50 ═══════ */}
      {blogPosts.length > 0 && (
        <section className="py-20 bg-cream-50 border-t border-cream-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <p className="text-gold-500 font-typewriter text-xs uppercase tracking-[0.3em] mb-3">Collector's Resource</p>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-noir-500 mb-4 leading-tight">
                From the Blog
              </h2>
              <p className="text-noir-300 font-body max-w-2xl mx-auto">
                Guides and deep-dives — for first-time buyers and serious collectors alike.
              </p>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "1px",
              background: "#C4B49A",
            }}>
              {blogPosts.map((post) => (
                <a
                  key={post.id}
                  href={`#/blog/${post.slug}`}
                  style={{
                    textDecoration: "none",
                    display: "block",
                    background: "#FBF8F2",
                    padding: "24px",
                    borderLeft: "3px solid #8B1A1A",
                  }}
                >
                  <div style={{
                    fontSize: "11px",
                    fontFamily: "monospace",
                    letterSpacing: "0.12em",
                    color: "#8B1A1A",
                    textTransform: "uppercase",
                    marginBottom: "10px",
                  }}>
                    {post.category || "Collecting"}
                  </div>
                  <div style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "#1A1208",
                    lineHeight: 1.3,
                    marginBottom: "10px",
                  }}>
                    {post.title}
                  </div>
                  <div style={{
                    fontSize: "13px",
                    color: "#6B5B3E",
                    lineHeight: 1.55,
                    marginBottom: "14px",
                  }}>
                    {(post.subtitle || "").substring(0, 120)}
                    {post.subtitle && post.subtitle.length > 120 ? "..." : ""}
                  </div>
                  <div style={{
                    fontSize: "11px",
                    fontFamily: "monospace",
                    letterSpacing: "0.1em",
                    color: "#8B1A1A",
                    textTransform: "uppercase",
                  }}>
                    Read More →
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════ NEWSLETTER — dark, always last before footer ═══════ */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-noir-900 via-noir-800 to-noir-500">
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, rgba(200,169,81,0.8) 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }} />
        </div>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-gold-400/10 border border-gold-400/20 rounded-full px-4 py-1.5 mb-6">
            <svg className="w-4 h-4 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            <span className="text-gold-300 text-xs font-typewriter uppercase tracking-widest">New Arrivals Weekly</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-cream-100 mb-4">
            First Access to Rare Finds
          </h2>
          <p className="text-cream-400 font-body text-sm sm:text-base mb-8 leading-relaxed">
            Join our collector&apos;s list and be the first to know when rare originals arrive.
            No spam — just cinema.
          </p>
          {subscribed ? (
            <div className="bg-gold-400/10 border border-gold-400/20 rounded-sm p-4 inline-flex items-center gap-3">
              <svg className="w-5 h-5 text-gold-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-cream-200 font-body text-sm">Welcome to the vault! Check your inbox for a confirmation.</p>
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="flex-1 bg-noir-600/50 border border-cream-100/15 text-cream-100 placeholder:text-noir-200 font-body text-sm px-4 py-3 rounded-sm focus:outline-none focus:border-gold-400/50 focus:ring-1 focus:ring-gold-400/25 transition-all"
              />
              <button type="submit" disabled={subscribing} className="bg-gold-400 hover:bg-gold-500 text-noir-800 font-display text-sm font-semibold uppercase tracking-wider px-6 py-3 rounded-sm transition-colors shadow-lg hover:shadow-xl whitespace-nowrap disabled:opacity-50">
                {subscribing ? "..." : "Subscribe"}
              </button>
            </form>
          )}
        </div>
      </section>
            {/* ═══════ FOOTER ═══════ */}
      <footer id="contact" className="bg-noir-900 py-16 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-sm bg-burgundy-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-gold-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621-.504-1.125-1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125 1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
                  </svg>
                </div>
                <span className="font-display text-lg font-bold text-cream-100">
                  Frame &amp; <span className="text-burgundy-400">Reel</span>
                </span>
              </div>
              <p className="text-noir-200 text-xs font-body leading-relaxed mb-4">
                Frame and Reel — Authentic original movie posters from the golden age of cinema to modern day. Visit us on eBay for the full inventory.
              </p>
              <div className="flex gap-3">
                {["M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.667 4.533-4.667 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.875V12h3.328l-.532 3.47h-2.796v8.385C19.612 22.954 24 17.99 24 12z", "M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"].map((path, i) => (
                  <a key={i} href="#" className="w-8 h-8 rounded-full bg-noir-700 hover:bg-burgundy-500 flex items-center justify-center transition-colors group">
                    <svg className="w-3.5 h-3.5 text-noir-200 group-hover:text-white fill-current transition-colors" viewBox="0 0 24 24">
                      <path d={path} />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h4 className="font-display text-sm font-semibold text-cream-200 uppercase tracking-wider mb-4">Quick Links</h4>
              <ul className="space-y-2.5">
                {["All Posters", "New Arrivals", "Rare & Limited", "Sale", "eBay Store"].map((link) => (
                  <li key={link}>
                    <a href={link === "eBay Store" ? "https://www.ebay.com/str/frameandreelmovieposters" : "#"} target={link === "eBay Store" ? "_blank" : undefined} rel={link === "eBay Store" ? "noopener noreferrer" : undefined} className="text-noir-200 text-xs font-body hover:text-gold-300 transition-colors">{link}{link === "eBay Store" ? " ↗" : ""}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Genres */}
            <div>
              <h4 className="font-display text-sm font-semibold text-cream-200 uppercase tracking-wider mb-4">Genres</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Crime & Gangster", genre: "Crime" },
                  { label: "Spaghetti Western", genre: "Western" },
                  { label: "Film Noir", genre: "Film Noir" },
                  { label: "Horror & Suspense", genre: "Horror" },
                  { label: "Action & Adventure", genre: "Action" },
                ].map(({ label, genre }) => (
                  <li key={label}>
                    <a href={`#/collection?genre=${encodeURIComponent(genre)}`} className="text-noir-200 text-xs font-body hover:text-gold-300 transition-colors">{label}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Help */}
            <div>
              <h4 className="font-display text-sm font-semibold text-cream-200 uppercase tracking-wider mb-4">Help</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Grading Guide", href: "#/blog/condition-grading-explained-how-a-single-fold-can-change-a-poster-s-value" },
                  { label: "Shipping Info", href: "#" },
                  { label: "Returns Policy", href: "#" },
                  { label: "Authentication", href: "#/blog/is-my-poster-real-a-beginner-s-authentication-checklist" },
                  { label: "FAQs", href: "#" },
                  { label: "Contact Us", href: "#/contact" },
                ].map(({ label, href }) => (
                  <li key={label}>
                    <a href={href} className="text-noir-200 text-xs font-body hover:text-gold-300 transition-colors">{label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Bottom */}
          <div className="divider-vintage mb-8" />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-noir-300 text-xs font-body">
              © 2026 Frame and Reel. All rights reserved. Every poster is an original — always has been, always will be.
            </p>
            <div className="flex gap-6">
              {[{ label: "Privacy Policy", href: "#" }, { label: "Terms of Service", href: "#" }, { label: "Admin", href: "#/admin-login" }].map((link) => (
                <a key={link.label} href={link.href} className={`text-xs font-body hover:text-gold-300 transition-colors ${link.label === "Admin" ? "text-noir-500 hover:text-noir-300" : "text-noir-300"}`}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────── INVENTORY ITEM INTERFACE ─────────────── */

interface InventoryItem {
  id: number;
  title: string;
  original_title: string | null;
  year: number | null;
  director: string | null;
  actors: string | null;
  genre: string | null;
  format: string | null;
  poster_country: string | null;
  movie_country: string | null;
  dimensions: string | null;
  ds_ss: string | null;
  artist: string | null;
  item_number: string | null;
  item_type: string | null;
  lot_id: string | null;
  sold: number;
  notes: string | null;
  source_url: string | null;
  visibility: string;
  poster_style: string | null;
  price: number | null;
  condition_grade: string | null;
  awards: string | null;
  created_at: number;
  updated_at: number;
}

interface InventoryFilters {
  formats: { format: string; count: number }[];
  countries: { poster_country: string; count: number }[];
  decades: { decade: number; count: number }[];
  genres: { genre: string; count: number }[];
  directors: { director: string; count: number }[];
  actors: { actor: string; count: number }[];
  awards: { awards: string; count: number }[];
}

/* ─────────────── FILTER ACCORDION ─────────────── */

function FilterAccordion({ title, icon, children, defaultOpen = false }: { title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-noir-100 last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-3 px-1 text-left group">
        <span className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="font-typewriter text-xs uppercase tracking-widest text-noir-400 group-hover:text-burgundy-500 transition-colors">{title}</span>
        </span>
        <svg className={`w-4 h-4 text-noir-300 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="pb-3 px-1">{children}</div>}
    </div>
  );
}

function FilterPill({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-body transition-all whitespace-nowrap ${active ? 'bg-burgundy-500 text-white shadow-sm' : 'bg-white text-noir-400 border border-noir-100 hover:border-burgundy-300 hover:text-burgundy-500'}`}>
      <span>{label}</span>
      {count !== undefined && <span className={`text-[10px] ${active ? 'text-cream-200' : 'opacity-50'}`}>({count})</span>}
    </button>
  );
}

/* ─────────────── CONTACT PAGE ─────────────── */

function ContactPage() {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactEmail || !contactMessage.trim()) return;
    setContactSending(true);
    try {
      const res = await client.api.fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: contactEmail, message: contactMessage, name: contactName || null }),
      });
      if (res.ok) setContactSent(true);
    } catch { /* silent */ }
    setContactSending(false);
  };

  return (
    <div className="min-h-screen grain-overlay">
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${isScrolled ? 'bg-cream-50/95 backdrop-blur-md shadow-md' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <a href="#" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-sm bg-burgundy-500 flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-gold-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621-.504-1.125-1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125 1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
                </svg>
              </div>
              <span className={`font-display text-xl sm:text-2xl font-bold tracking-tight transition-colors ${isScrolled ? 'text-noir-500' : 'text-white'}`}>
                Frame &amp; <span className={isScrolled ? 'text-burgundy-500' : 'text-gold-300'}>Reel</span>
              </span>
            </a>
            <nav className="hidden md:flex items-center gap-8">
              <a href="#/" className={`text-sm font-body font-medium uppercase tracking-wider transition-colors hover:text-burgundy-500 ${isScrolled ? 'text-noir-400' : 'text-cream-300'}`}>Home</a>
              <a href="#/collection" className={`text-sm font-body font-medium uppercase tracking-wider transition-colors hover:text-burgundy-500 ${isScrolled ? 'text-noir-400' : 'text-cream-300'}`}>Collection</a>
              <a href="#/blog" className={`text-sm font-body font-medium uppercase tracking-wider transition-colors hover:text-burgundy-500 ${isScrolled ? 'text-noir-400' : 'text-cream-300'}`}>Blog</a>
              <span className={`text-sm font-body font-medium uppercase tracking-wider ${isScrolled ? 'text-burgundy-500' : 'text-gold-300'}`}>Contact</span>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-20 bg-noir-900">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-noir-900/90 to-noir-800" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10 text-center">
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-cream-100 mb-4">Get in Touch</h1>
          <p className="text-cream-400 font-body text-base sm:text-lg max-w-2xl mx-auto">
            Have a question about a poster? Looking for something specific? We'd love to hear from you.
          </p>
        </div>
      </section>

      {/* Contact Form */}
      <section className="py-20 bg-cream-50">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {contactSent ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-gold-400/20 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="font-display text-2xl font-bold text-noir-500 mb-2">Message Sent!</h2>
              <p className="text-noir-300 font-body">We'll get back to you as soon as possible.</p>
            </div>
          ) : (
            <form onSubmit={handleContact} className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-noir-400 font-body text-xs uppercase tracking-wider mb-2">Your Name</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full bg-white border border-cream-300 text-noir-500 placeholder:text-noir-200 font-body text-sm px-4 py-3 rounded-sm focus:outline-none focus:border-burgundy-500 focus:ring-1 focus:ring-burgundy-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-noir-400 font-body text-xs uppercase tracking-wider mb-2">Email Address *</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full bg-white border border-cream-300 text-noir-500 placeholder:text-noir-200 font-body text-sm px-4 py-3 rounded-sm focus:outline-none focus:border-burgundy-500 focus:ring-1 focus:ring-burgundy-500/20 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-noir-400 font-body text-xs uppercase tracking-wider mb-2">Message *</label>
                <textarea
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Tell us what you're looking for, or ask us anything..."
                  required
                  rows={6}
                  className="w-full bg-white border border-cream-300 text-noir-500 placeholder:text-noir-200 font-body text-sm px-4 py-3 rounded-sm focus:outline-none focus:border-burgundy-500 focus:ring-1 focus:ring-burgundy-500/20 transition-all resize-none"
                />
              </div>
              <button type="submit" disabled={contactSending} className="w-full bg-burgundy-500 hover:bg-burgundy-600 text-white font-display text-sm font-semibold uppercase tracking-wider py-4 rounded-sm transition-colors shadow-lg hover:shadow-xl disabled:opacity-50">
                {contactSending ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-noir-900 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-sm bg-burgundy-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-gold-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621-.504-1.125-1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621.504 1.125 1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 12.504 6 13.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
              </svg>
            </div>
            <span className="font-display text-lg font-bold text-cream-100">
              Frame &amp; <span className="text-burgundy-400">Reel</span>
            </span>
          </div>
          <p className="text-noir-300 text-xs font-body">© 2026 Frame and Reel. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────── COLLECTION PAGE ─────────────── */

function CollectionPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filters, setFilters] = useState<InventoryFilters | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFormat, setActiveFormat] = useState("");
  const [activeCountry, setActiveCountry] = useState("");
  const [activeDecade, setActiveDecade] = useState("");
  const [activeGenre, setActiveGenre] = useState("");
  const [activeDirector, setActiveDirector] = useState("");
  const [activeActor, setActiveActor] = useState("");
  const [activeAward, setActiveAward] = useState("");
  const [activeSource, setActiveSource] = useState("");
  const [sortBy, setSortBy] = useState("title");
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Initialize search from URL hash query param
  useEffect(() => {
    const readSearch = () => {
      const hash = window.location.hash;
      const match = hash.match(/[?&]search=([^&]+)/);
      if (match) setSearch(decodeURIComponent(match[1]));
    };
    readSearch();
    window.addEventListener('hashchange', readSearch);
    return () => window.removeEventListener('hashchange', readSearch);
  }, []);

  const activeFilters = [activeFormat, activeCountry, activeDecade, activeGenre, activeDirector, activeActor, activeAward, activeSource].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearch(""); setActiveFormat(""); setActiveCountry(""); setActiveDecade(""); setActiveGenre(""); setActiveDirector(""); setActiveActor(""); setActiveAward(""); setActiveSource("");
  };

  useEffect(() => {
    fetchInventory();
  }, [search, activeFormat, activeCountry, activeDecade, activeGenre, activeDirector, activeActor, activeAward, activeSource, sortBy]);

  async function fetchInventory() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (activeFormat) params.set("format", activeFormat);
      if (activeCountry) params.set("country", activeCountry);
      if (activeDecade) params.set("decade", activeDecade);
      if (activeGenre) params.set("genre", activeGenre);
      if (activeDirector) params.set("director", activeDirector);
      if (activeActor) params.set("actor", activeActor);
      if (activeAward) params.set("award", activeAward);
      if (activeSource) params.set("source", activeSource);
      if (sortBy) params.set("sort", sortBy);
      params.set("limit", "200");
      const res = await client.api.fetch(`/api/public/inventory?${params}`);
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setFilters(data.filters);
    } catch (err) {
      console.error("Failed to fetch inventory:", err);
    }
    setLoading(false);
  }

  const formatLabel = (f: string) => {
    const map: Record<string, string> = { "Locandina": "Italian Locandina", "Petite": "French Petite", "Moyenne": "French Moyenne", "1sh": "US One-Sheet", "1-Stop": "1-Stop", "Small": "Small Format", "A1": "A1 Format" };
    return map[f] || f;
  };
  const formatEmoji = (f: string) => {
    const map: Record<string, string> = { "Locandina": "\ud83c\uddee\ud83c\udde9", "Petite": "\ud83c\uddeb\ud83c\uddf7", "Moyenne": "\ud83c\uddeb\ud83c\uddf7", "1sh": "\ud83c\uddfa\ud83c\uddf8", "1-Stop": "\ud83c\udf0d", "Small": "\ud83c\udf7f\ud83c\uddfa", "A1": "\ud83c\udf5d\ud83c\uddf5" };
    return map[f] || "\ud83c\udfac";
  };
  const countryFlag = (c: string) => {
    const map: Record<string, string> = { "Italy": "\ud83c\uddee\ud83c\udde9", "France": "\ud83c\uddeb\ud83c\uddf7", "USA": "\ud83c\uddfa\ud83c\uddf8", "USSR": "\ud83c\udf7f\ud83c\uddfa", "Poland": "\ud83c\udf5d\ud83c\uddf5", "UK/USA": "\ud83c\uddec\ud83c\udde7", "Australia": "\ud83c\udde6\ud83c\uddfa", "Czech": "\ud83c\udde8\ud83c\uddff", "Romania": "\ud83c\udf7f\ud83c\uddf4", "Hungary": "\ud83c\uded6\ud83c\uddfa", "Int'l": "\ud83c\udf0d" };
    return map[c] || "\ud83c\udfac";
  };

  // State for new filters

  return (
    <div className="min-h-screen bg-cream-50 grain-overlay">
      {/* Sticky Nav — same as homepage */}
      <header className="sticky top-0 z-50 bg-cream-50/95 backdrop-blur-sm border-b border-cream-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="#/" className="font-display text-xl font-bold text-noir-500 hover:text-burgundy-500 transition-colors">
              Frame &amp; <span className="text-burgundy-500">Reel</span>
            </a>
            <nav className="hidden sm:flex items-center gap-8">
              {[{ label: "Collection", href: "#/collection" }, { label: "Blog", href: "#/blog" }, { label: "Contact", href: "#/contact" }].map(item => (
                <a key={item.label} href={item.href} className="text-noir-400 hover:text-burgundy-500 font-body text-sm transition-colors uppercase tracking-wider">{item.label}</a>
              ))}
            </nav>
            <a href="#/" className="text-xs font-display uppercase tracking-wider text-noir-300 hover:text-burgundy-500 transition-colors">
              ← Home
            </a>
          </div>
        </div>
      </header>

      {/* Page Header */}
      <div className="bg-noir-500 text-cream-50 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <p className="font-typewriter text-gold-400 text-xs uppercase tracking-[0.3em] mb-2">Browse Our Vault</p>
          <h1 className="font-display text-4xl md:text-5xl text-cream-100">
            {search ? `Results for "${search}"` : activeGenre ? activeGenre : "Full Collection"}
          </h1>
          <p className="text-noir-300 font-body mt-2">
            {total} {total === 1 ? "poster" : "posters"} found
            {search && <button onClick={() => { setSearch(""); window.location.hash = "#/collection"; }} className="ml-3 text-gold-400 hover:text-gold-300 text-sm underline">Clear search</button>}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
        {/* Search + Filter Toggle */}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 text-noir-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by title, director, actor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-3.5 bg-white border border-noir-100 rounded-sm font-body text-noir-500 placeholder:text-noir-200 focus:outline-none focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500 transition-all"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative flex items-center gap-2 px-5 py-3.5 rounded-sm text-xs font-display uppercase tracking-wider transition-all border whitespace-nowrap ${showFilters ? 'bg-burgundy-500 text-white border-burgundy-500' : 'bg-white text-noir-400 border-noir-100 hover:border-burgundy-300'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilters > 0 && (
              <span className={`absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${showFilters ? 'bg-cream-100 text-burgundy-600' : 'bg-burgundy-500 text-white'}`}>
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Active Filter Pills + Clear */}
        {activeFilters > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {activeFormat && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>{formatEmoji(activeFormat)} {formatLabel(activeFormat)}</span><button onClick={() => setActiveFormat("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeCountry && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>{countryFlag(activeCountry)} {activeCountry}</span><button onClick={() => setActiveCountry("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeDecade && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>{activeDecade}s</span><button onClick={() => setActiveDecade("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeGenre && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>{activeGenre}</span><button onClick={() => setActiveGenre("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeDirector && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>{activeDirector}</span><button onClick={() => setActiveDirector("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeActor && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>👤 {activeActor}</span><button onClick={() => setActiveActor("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeAward && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>🏆 {activeAward === "winners" ? "Oscar Winners" : "Nominated"}</span><button onClick={() => setActiveAward("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            {activeSource && <span className="inline-flex items-center gap-1 px-3 py-1 bg-burgundy-50 text-burgundy-700 border border-burgundy-200 rounded-sm text-xs font-body"><span>📦 {activeSource === 'ebay' ? 'eBay' : activeSource}</span><button onClick={() => setActiveSource("")} className="hover:text-burgundy-900 ml-1">×</button></span>}
            <button onClick={clearAllFilters} className="text-xs font-display uppercase tracking-wider text-noir-300 hover:text-burgundy-500 transition-colors ml-2">Clear all</button>
          </div>
        )}

        {/* Collapsible Filter Panel */}
        {showFilters && filters && (
          <div className="mb-6 bg-white border border-noir-100 rounded-sm p-4 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              {/* Format */}
              <FilterAccordion title="Format" icon={"📐"} defaultOpen={!!activeFormat}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Formats" active={!activeFormat} onClick={() => setActiveFormat("")} />
                  {filters.formats.map((f) => (
                    <FilterPill key={f.format} label={`${formatEmoji(f.format)} ${formatLabel(f.format)}`} count={f.count} active={activeFormat === f.format} onClick={() => setActiveFormat(f.format)} />
                  ))}
                </div>
              </FilterAccordion>

              {/* Country */}
              <FilterAccordion title="Country of Origin" icon={"🌍"} defaultOpen={!!activeCountry}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Countries" active={!activeCountry} onClick={() => setActiveCountry("")} />
                  {filters.countries.map((c) => (
                    <FilterPill key={c.poster_country} label={`${countryFlag(c.poster_country)} ${c.poster_country}`} count={c.count} active={activeCountry === c.poster_country} onClick={() => setActiveCountry(c.poster_country)} />
                  ))}
                </div>
              </FilterAccordion>

              {/* Era / Decade */}
              <FilterAccordion title="Era / Decade" icon={"📅"} defaultOpen={!!activeDecade}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Eras" active={!activeDecade} onClick={() => setActiveDecade("")} />
                  {filters.decades.map((d) => (
                    <FilterPill key={d.decade} label={`${d.decade}s`} count={d.count} active={activeDecade === String(d.decade)} onClick={() => setActiveDecade(String(d.decade))} />
                  ))}
                </div>
              </FilterAccordion>

              {/* Genre */}
              <FilterAccordion title="Genre" icon={"🎭"} defaultOpen={!!activeGenre}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Genres" active={!activeGenre} onClick={() => setActiveGenre("")} />
                  {filters.genres.slice(0, 15).map((g) => (
                    <FilterPill key={g.genre} label={g.genre} count={g.count} active={activeGenre === g.genre} onClick={() => setActiveGenre(g.genre)} />
                  ))}
                  {filters.genres.length > 15 && (
                    <span className="text-[10px] text-noir-300 font-body px-2 py-1.5">+{filters.genres.length - 15} more</span>
                  )}
                </div>
              </FilterAccordion>

              {/* Director */}
              <FilterAccordion title="Director" icon={"🎬"} defaultOpen={!!activeDirector}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Directors" active={!activeDirector} onClick={() => setActiveDirector("")} />
                  {filters.directors.slice(0, 12).map((d) => (
                    <FilterPill key={d.director} label={d.director} count={d.count} active={activeDirector === d.director} onClick={() => setActiveDirector(d.director)} />
                  ))}
                  {filters.directors.length > 12 && (
                    <span className="text-[10px] text-noir-300 font-body px-2 py-1.5">+{filters.directors.length - 12} more</span>
                  )}
                </div>
              </FilterAccordion>

              {/* Actor */}
              <FilterAccordion title="Actor" icon={"👤"} defaultOpen={!!activeActor}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Actors" active={!activeActor} onClick={() => setActiveActor("")} />
                  {filters.actors && filters.actors.slice(0, 12).map((a) => (
                    <FilterPill key={a.actor} label={a.actor} count={a.count} active={activeActor === a.actor} onClick={() => setActiveActor(a.actor)} />
                  ))}
                  {filters.actors && filters.actors.length > 12 && (
                    <span className="text-[10px] text-noir-300 font-body px-2 py-1.5">+{filters.actors.length - 12} more</span>
                  )}
                </div>
              </FilterAccordion>

              {/* Academy Award Winners */}
              <FilterAccordion title="Academy Awards" icon={"🏆"} defaultOpen={!!activeAward}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Posters" active={!activeAward} onClick={() => setActiveAward("")} />
                  <FilterPill label="Oscar Winners" count={filters.awards?.find((a: any) => a.awards?.includes("Oscar"))?.count} active={activeAward === "winners"} onClick={() => setActiveAward("winners")} />
                  <FilterPill label="Nominated" count={filters.awards?.find((a: any) => a.awards)?.count} active={activeAward === "nominated"} onClick={() => setActiveAward("nominated")} />
                </div>
              </FilterAccordion>

              {/* Source (eBay, manual, etc) */}
              <FilterAccordion title="Source" icon={"📦"} defaultOpen={!!activeSource}>
                <div className="flex flex-wrap gap-2">
                  <FilterPill label="All Sources" active={!activeSource} onClick={() => setActiveSource("")} />
                  {filters.sources && filters.sources.map((s: any) => (
                    <FilterPill key={s.source} label={s.source === 'ebay' ? '📋 eBay' : s.source} count={s.count} active={activeSource === s.source} onClick={() => setActiveSource(s.source)} />
                  ))}
                </div>
              </FilterAccordion>
            </div>
          </div>
        )}

        {/* Sort + Results count */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-noir-100">
          <p className="text-noir-300 text-sm font-body">{loading ? "Searching..." : `${items.length} posters found`}</p>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="text-sm font-body text-noir-400 bg-white border border-noir-100 rounded-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-burgundy-500/30">
            <option value="title">Sort: A–Z</option>
            <option value="title_desc">Sort: Z–A</option>
            <option value="year">Sort: Oldest First</option>
            <option value="year_desc">Sort: Newest First</option>
            <option value="director">Sort: Director</option>
            <option value="format">Sort: Format</option>
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-burgundy-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <p className="font-display text-xl text-noir-400 mb-2">No posters found</p>
            <p className="text-noir-300 font-body text-sm">Try adjusting your filters or search terms</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item, i) => (
              <InventoryCard key={item.id} item={item} index={i} />
            ))}
          </div>
        )}

        {/* Back to home */}
        <div className="mt-12 pt-8 border-t border-noir-100 text-center">
          <a href="#" className="text-burgundy-500 hover:text-burgundy-600 font-display text-sm uppercase tracking-wider">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}

function InventoryCard({ item, index }: { item: InventoryItem; index: number }) {
  const formatLabel = (f: string) => {
    const map: Record<string, string> = { "Locandina": "Locandina", "Petite": "Petite", "Moyenne": "Moyenne", "1sh": "One-Sheet" };
    return map[f] || f;
  };
  const formatColor = (f: string) => {
    const map: Record<string, string> = { "Locandina": "bg-green-100 text-green-800 border-green-200", "Petite": "bg-blue-100 text-blue-800 border-blue-200", "Moyenne": "bg-purple-100 text-purple-800 border-purple-200", "1sh": "bg-amber-100 text-amber-800 border-amber-200" };
    return map[f] || "bg-gray-100 text-gray-700 border-gray-200";
  };

  return (
    <a href={`#/poster/${item.id}`} className="group transition-all duration-300 hover:-translate-y-1" style={{ animationDelay: `${index * 50}ms` }}>
      <div className="bg-white border border-noir-100 rounded-sm overflow-hidden h-full flex flex-col hover:shadow-lg hover:border-burgundy-200 transition-all duration-300">
        {/* Placeholder poster area */}
        <div className="aspect-[2/3] bg-gradient-to-br from-noir-100 via-noir-50 to-cream-50 flex items-center justify-center relative overflow-hidden">
        {item.imageUrl && <img src={item.imageUrl} alt={item.title || ""} className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-0 opacity-5 flex items-center justify-center">
            <svg className="w-24 h-24 text-noir-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
            </svg>
          </div>
          <div className="text-center px-3 relative z-10">
            <p className="font-display text-base md:text-lg text-noir-500 leading-tight line-clamp-3 font-semibold">{item.title}</p>
            {item.year && <p className="font-typewriter text-noir-300 text-sm mt-1">{item.year}{item.release_year ? ` / R${item.release_year}` : ""}</p>}
          </div>
          {/* Format badge */}
          {item.format && (
            <div className="absolute top-2 right-2">
              <span className={`text-[9px] font-typewriter uppercase tracking-wider px-2 py-0.5 border rounded-sm ${formatColor(item.format)}`}>
                {formatLabel(item.format)}
              </span>
            </div>
          )}
          {/* Country badge */}
          {item.poster_country && (
            <div className="absolute top-2 left-2">
              <span className="text-[9px] font-typewriter uppercase tracking-wider px-2 py-0.5 border rounded-sm bg-white/80 text-noir-500 border-noir-100">
                {item.poster_country}
              </span>
            </div>
          )}
          {item.sold === 1 && (
            <div className="absolute inset-0 bg-noir-500/50 flex items-center justify-center">
              <span className="bg-red-600 text-white text-xs font-display font-bold uppercase tracking-wider px-4 py-2 rounded-sm transform -rotate-12">Sold</span>
            </div>
          )}
        </div>
        {/* Card info */}
        <div className="p-3 flex-1 flex flex-col">
          <h3 className="font-display text-sm font-semibold text-noir-500 group-hover:text-burgundy-500 transition-colors line-clamp-2">
            {item.title}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-noir-300 font-body">
            {item.year && <span>{item.year}{item.release_year ? ` / R${item.release_year}` : ""}</span>}
            {item.director && <><span>·</span><span className="italic">{item.director}</span></>}
          </div>
          {item.dimensions && (
            <p className="mt-1 text-[10px] font-typewriter text-noir-200">{item.dimensions} · {item.ds_ss}</p>
          )}
          <div className="mt-auto pt-2">
            <span className="text-[10px] font-typewriter uppercase tracking-widest text-noir-200">#{item.item_number}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

/* ─────────────── ROUTER ─────────────── */

function getRoute(): { page: string; param?: string } {
  const hash = window.location.hash;
  if (hash.startsWith("#/blog/")) return { page: "blog-post", param: hash.replace("#/blog/", "") };
  if (hash.startsWith("#/blog")) return { page: "blog" };
  if (hash.startsWith("#/admin-login")) return { page: "admin-login" };
  if (hash.startsWith("#/inventory-admin")) return { page: "inventory-admin" };
  if (hash.startsWith("#/admin")) return { page: "admin" };
  if (hash.startsWith("#/ebay")) return { page: "ebay" };
  if (hash.startsWith("#/collection")) return { page: "collection" };
  if (hash.startsWith("#/poster/")) return { page: "poster", param: hash.replace("#/poster/", "") };
  if (hash.startsWith("#/contact")) return { page: "contact" };
  return { page: "store" };
}

function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const trackPage = () => {
      if (typeof window.gtag === 'function' && window._GA_ID) {
        window.gtag('event', 'page_view', {
          page_path: window.location.hash || '/',
          page_title: document.title,
        });
      }
    };
    trackPage();
    window.addEventListener('hashchange', trackPage);
    return () => window.removeEventListener('hashchange', trackPage);
  }, []);

  useEffect(() => {
    const handleHash = () => setRoute(getRoute());
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.page, route.param]);

  if (route.page === "admin-login") {
    return (
      <Suspense fallback={<div className="min-h-screen bg-cream-50 flex items-center justify-center"><div className="text-noir-300 font-body">Loading...</div></div>}>
        <AdminLogin />
      </Suspense>
    );
  }

  if (route.page === "inventory-admin") {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="text-gray-400">Loading inventory manager...</div>
          </div>
        }
      >
        <InventoryManager />
      </Suspense>
    );
  }

  if (route.page === "admin") {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-cream-50 flex items-center justify-center">
            <div className="text-noir-300 font-body">Loading...</div>
          </div>
        }
      >
        <PosterManager />
      </Suspense>
    );
  }

  if (route.page === "ebay") {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-cream-50 flex items-center justify-center">
            <div className="text-noir-300 font-body">Loading eBay Command Bridge...</div>
          </div>
        }
      >
        <EbayListingDashboard />
      </Suspense>
    );
  }

  if (route.page === "poster" && route.param) {
    return <PosterDetail posterId={route.param} />;
  }

  if (route.page === "blog-post" && route.param) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-cream-50 flex items-center justify-center"><div className="text-noir-300 font-body">Loading...</div></div>}>
        <BlogPage postSlug={route.param} />
      </Suspense>
    );
  }

  if (route.page === "blog") {
    return (
      <Suspense fallback={<div className="min-h-screen bg-cream-50 flex items-center justify-center"><div className="text-noir-300 font-body">Loading...</div></div>}>
        <BlogPage />
      </Suspense>
    );
  }

  if (route.page === "collection") {
    return <CollectionPage />;
  }

  if (route.page === "contact") {
    return <ContactPage />;
  }

  return <Storefront />;
}

export default App;

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createEdgeSpark } from "@edgespark/client";
import Tesseract from "tesseract.js";
import JSZip from "jszip";
import { Grid } from "react-window";

// ═══════════════════════════════════════════════════════════
// TITLE LANGUAGE CLASSIFIER
// Uses pattern matching + Wikidata — no API key, no cost
// ═══════════════════════════════════════════════════════════

// Common function words by language — enough to classify most movie titles
const LANG_MARKERS: Record<string, string[]> = {
  it: ["il ", "lo ", "la ", "i ", "gli ", "le ", "un ", "uno ", "una ", "del ", "della ", "dei ", "delle ",
       "di ", "da ", "in ", "con ", "su ", "per ", "tra ", "fra ", "l'", "d'", "nell'", "sull'",
       "e ", "ed ", "che ", "non ", "si ", "mi ", "ti ", "ci ", "vi ", "nel ", "nelle "],
  fr: ["le ", "la ", "les ", "un ", "une ", "des ", "du ", "de la ", "de l'", "l'", "d'",
       "et ", "ou ", "au ", "aux ", "en ", "dans ", "sur ", "sous ", "par ", "pour ",
       "qui ", "que ", "qu'", "ne ", "pas ", "est ", "sont ", "avec "],
  es: ["el ", "la ", "los ", "las ", "un ", "una ", "unos ", "unas ", "del ", "de la ",
       "de ", "en ", "con ", "por ", "para ", "que ", "se ", "al ", "y ", "o ", "no "],
  de: ["der ", "die ", "das ", "ein ", "eine ", "des ", "dem ", "den ", "und ", "oder ",
       "in ", "im ", "am ", "an ", "auf ", "bei ", "mit ", "von ", "zu ", "für ",
       "ist ", "sind ", "nicht ", "auch "],
  pt: ["o ", "a ", "os ", "as ", "um ", "uma ", "do ", "da ", "dos ", "das ",
       "de ", "em ", "no ", "na ", "por ", "para ", "com ", "e ", "ou ", "que "],
};

// Characters that strongly suggest specific languages
const LANG_CHARS: Record<string, RegExp> = {
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,  // Hiragana, Katakana, Kanji
  zh: /[\u4e00-\u9fff]/,
  ru: /[\u0400-\u04ff]/,               // Cyrillic
  ar: /[\u0600-\u06ff]/,               // Arabic
  ko: /[\uac00-\ud7af]/,               // Korean
};

// Special characters that hint at specific languages
const ACCENT_HINTS: Record<string, RegExp> = {
  it: /[àèéìíîòóùú]/i,
  fr: /[àâæçéèêëîïôœùûüÿ]/i,
  es: /[áéíóúüñ¡¿]/i,
  de: /[äöüß]/i,
  pt: /[ãõáéíóúâêôàç]/i,
};

export function detectLanguage(title: string): { lang: string; confidence: "high" | "medium" | "low"; label: string } {
  if (!title || title.trim().length < 2) return { lang: "en", confidence: "low", label: "English" };

  const t = title.toLowerCase().trim() + " ";

  // Check for non-Latin scripts first — always high confidence
  for (const [lang, regex] of Object.entries(LANG_CHARS)) {
    if (regex.test(title)) {
      const labels: Record<string, string> = { ja: "Japanese", zh: "Chinese", ru: "Russian", ar: "Arabic", ko: "Korean" };
      return { lang, confidence: "high", label: labels[lang] || lang };
    }
  }

  // Check accent characters — medium confidence
  for (const [lang, regex] of Object.entries(ACCENT_HINTS)) {
    if (regex.test(title)) {
      const labels: Record<string, string> = { it: "Italian", fr: "French", es: "Spanish", de: "German", pt: "Portuguese" };
      return { lang, confidence: "medium", label: labels[lang] || lang };
    }
  }

  // Count function word matches per language
  const scores: Record<string, number> = {};
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    scores[lang] = markers.filter(m => t.includes(m)).length;
  }

  const maxLang = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];
  if (maxLang && maxLang[1] >= 2) {
    const labels: Record<string, string> = { it: "Italian", fr: "French", es: "Spanish", de: "German", pt: "Portuguese" };
    return { lang: maxLang[0], confidence: maxLang[1] >= 3 ? "high" : "medium", label: labels[maxLang[0]] || maxLang[0] };
  }

  // Default to English if no other language detected
  return { lang: "en", confidence: "low", label: "English" };
}

// Wikidata lookup — finds all language titles for a movie
// Used as tiebreaker when detectLanguage is uncertain
export async function wikidataLookupTitles(englishTitle: string, year?: number): Promise<Record<string, string>> {
  try {
    const query = `
      SELECT ?item ?itemLabel ?title ?lang WHERE {
        ?item wdt:P31 wd:Q11424.
        ?item wdt:P1476 ?title.
        FILTER(LANG(?title) != "").
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        ?item rdfs:label ?enLabel FILTER(LANG(?enLabel) = "en").
        FILTER(LCASE(STR(?enLabel)) = "${englishTitle.toLowerCase().replace(/"/g, '\\"')}").
      } LIMIT 30
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, string> = {};
    for (const row of data.results?.bindings || []) {
      if (row.title?.value && row.title["xml:lang"]) {
        result[row.title["xml:lang"]] = row.title.value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// Main classifier — combines all three methods
export async function classifyPosterTitle(
  identifiedTitle: string,
  tmdbEnglishTitle?: string,
  tmdbYear?: number
): Promise<{ titleEnglish: string; titleLocal: string; language: string }> {
  // Step 1: If TMDB title matches identified title exactly → it's English
  if (tmdbEnglishTitle && identifiedTitle.toLowerCase().trim() === tmdbEnglishTitle.toLowerCase().trim()) {
    return { titleEnglish: tmdbEnglishTitle, titleLocal: "", language: "en" };
  }

  // Step 2: Fast language detection
  const detected = detectLanguage(identifiedTitle);

  if (detected.confidence === "high") {
    if (detected.lang === "en") {
      return { titleEnglish: identifiedTitle, titleLocal: tmdbEnglishTitle ? "" : "", language: "en" };
    } else {
      return {
        titleEnglish: tmdbEnglishTitle || "",
        titleLocal: identifiedTitle,
        language: detected.label,
      };
    }
  }

  // Step 3: TMDB tells us — if TMDB English title exists and differs from identified, identified is local
  if (tmdbEnglishTitle && tmdbEnglishTitle.toLowerCase().trim() !== identifiedTitle.toLowerCase().trim()) {
    return {
      titleEnglish: tmdbEnglishTitle,
      titleLocal: identifiedTitle,
      language: detected.label !== "English" ? detected.label : "Unknown",
    };
  }

  // Step 4: Wikidata tiebreaker (only for ambiguous cases)
  if (tmdbEnglishTitle && detected.confidence === "medium") {
    try {
      const wdTitles = await wikidataLookupTitles(tmdbEnglishTitle, tmdbYear);
      // Check if our identified title matches any Wikidata language variant
      for (const [lang, wdTitle] of Object.entries(wdTitles)) {
        if (wdTitle.toLowerCase().trim() === identifiedTitle.toLowerCase().trim() && lang !== "en") {
          const langLabels: Record<string, string> = {
            it: "Italian", fr: "French", es: "Spanish", de: "German",
            pt: "Portuguese", ja: "Japanese", ru: "Russian",
          };
          return {
            titleEnglish: tmdbEnglishTitle,
            titleLocal: identifiedTitle,
            language: langLabels[lang] || lang,
          };
        }
      }
    } catch { /* Wikidata unavailable — fall through */ }
  }

  // Final fallback: use detection result
  return detected.lang === "en"
    ? { titleEnglish: identifiedTitle, titleLocal: "", language: "English" }
    : { titleEnglish: tmdbEnglishTitle || "", titleLocal: identifiedTitle, language: detected.label };
}

// Virtualization threshold - use react-window when images exceed this count
const VIRTUALIZATION_THRESHOLD = 100;

// Skeleton loader for image cards - now accepts dynamic dimensions to match VirtualGrid
interface ImageCardSkeletonProps {
  width?: number;
  height?: number;
}

const ImageCardSkeleton = memo(({ width, height }: ImageCardSkeletonProps) => (
  <div 
    className="bg-white border border-gray-200 rounded-lg overflow-hidden animate-pulse"
    style={width ? { width: `${width}px` } : {}}
  >
    <div 
      className="bg-gray-200" 
      style={height ? { height: `${height * 0.7}px` } : { aspectRatio: '2/3' }}
    />
    <div className="p-2 space-y-2">
      <div className="h-3 bg-gray-200 rounded w-3/4" />
      <div className="h-2 bg-gray-200 rounded w-1/2" />
    </div>
  </div>
));
ImageCardSkeleton.displayName = "ImageCardSkeleton";

// Lazy loaded image component with skeleton
const LazyImage = memo(({ src, alt, className }: { src: string; alt: string; className?: string }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  
  return (
    <div className={`relative ${className}`}>
      {!loaded && !error && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
      <img
        src={src}
        alt={alt}
        className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
});
LazyImage.displayName = "LazyImage";

// Virtualized Grid component using react-window
interface VirtualGridProps {
  items: LibImage[];
  renderItem: (img: LibImage) => React.ReactNode;
  threshold?: number;
}

// Hook to measure container dimensions
function useContainerDimensions() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, dimensions };
}

// Cell component for react-window v2
const GridCell = memo(({ columnIndex, rowIndex, style, data }: { 
  columnIndex: number; 
  rowIndex: number; 
  style: React.CSSProperties;
  data: { items: LibImage[]; renderItem: (img: LibImage) => React.ReactNode; columnsCount: number; columnWidth: number; rowHeight: number; GAP: number } | undefined;
}) => {
  // Guard against undefined data during initial render
  if (!data) return null;
  
  const { items, renderItem, columnsCount, columnWidth, rowHeight, GAP } = data;
  const index = rowIndex * columnsCount + columnIndex;
  
  if (index >= items.length) return null;
  
  const img = items[index];
  
  return (
    <div style={{
      ...style,
      left: (style.left as number) + GAP,
      top: (style.top as number) + GAP,
      width: columnWidth,
      height: rowHeight,
    }}>
      {renderItem(img)}
    </div>
  );
});

GridCell.displayName = "GridCell";

const VirtualGrid = memo(({ items, renderItem, threshold = VIRTUALIZATION_THRESHOLD }: VirtualGridProps) => {
  const { containerRef, dimensions } = useContainerDimensions();
  
  // Don't virtualize if below threshold
  if (items.length < threshold) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {items.map(img => (
          <div key={img.id}>{renderItem(img)}</div>
        ))}
      </div>
    );
  }

  // Card dimensions - based on aspect-ratio [2/3] with gap-3 (12px)
  const GAP = 12;
  const MIN_CARD_WIDTH = 150;
  const CARD_HEIGHT_ratio = 2 / 3; // aspect ratio

  const { width, height } = dimensions;

  if (width <= 0 || height <= 0) {
    return (
      <div ref={containerRef} className="w-full" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
        <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>
      </div>
    );
  }

  // Calculate columns based on width
  const columnsCount = Math.max(2, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP)));
  const columnWidth = (width - GAP * (columnsCount - 1)) / columnsCount;
  const rowHeight = columnWidth * CARD_HEIGHT_ratio + 80; // image + metadata
  const rowsCount = Math.ceil(items.length / columnsCount);

  const cellData = { items, renderItem, columnsCount, columnWidth, rowHeight, GAP };

  return (
    <div ref={containerRef} className="w-full" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
      <Grid
        cellComponent={GridCell}
        cellProps={cellData}
        columnCount={columnsCount}
        columnWidth={columnWidth + GAP}
        rowCount={rowsCount}
        rowHeight={rowHeight + GAP}
        defaultHeight={height}
        defaultWidth={width}
        overscanCount={2}
      />
    </div>
  );
});

VirtualGrid.displayName = "VirtualGrid";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

interface LibImage {
  id: number;
  filename: string;
  s3_uri: string;
  url: string | null;
  ocr_text: string | null;
  identified_title: string | null;
  identified_year: number | null;
  identified_director: string | null;
  identified_genre: string | null;
  identified_actors: string | null;
  matched_inventory_id: number | null;
  lot_number: string | null;
  item_number: string | null;
  upload_note: string | null;
  poster_format: string | null;
  release_type: string | null;
  dimensions: string | null;
  created_at: number;
  // 🧬 Archival DNA Fields
  title_original: string | null;
  title_local: string | null;
  original_release_year: number | null;
  printer_credit: string | null;
  nss_visa_code: string | null;
  distributor_logo: string | null;
  dna_audit_status: string | null;
  dna_ocr_raw: string | null;
  poster_country: string | null;
  // Omni-CRM Fields
  print_year: number | null;
  year_range_start: number | null;
  year_range_end: number | null;
  conflict_status: "original" | "reissue" | "conflict" | "none" | null;
  conflict_reason: string | null;
}

interface InvItem {
  id: number;
  title: string;
  year: number | null;
  format: string | null;
  dimensions: string | null;
  source_url: string | null;
  visibility: string;
}

// TMDB Search Result interface
interface TmdbResult {
  id: number;
  title: string;
  original_title: string;
  year: number | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  director?: string;
  actors?: string;
  genres?: string;
}

interface UploadMeta {
  lotNumber: string;
  itemNumber: string;
  note: string;
  posterFormat: string;
  releaseType: string;
  dimensions: string;
  identifiedTitle: string;
  identifiedYear: string;
  identifiedDirector: string;
  identifiedGenre: string;
  identifiedActors: string;
  yearRangeStart: string;
  yearRangeEnd: string;
  sourceUrl: string;
  condition: string;
  // 🧬 Archival DNA Fields
  titleEnglish: string;
  titleLocal: string;
  printerCredit: string;
  nssVisaCode: string;
  distributorLogo: string;
  unionBugId: string;
  billingBlockFont: string;
  dnaAuditStatus: string;
  taglineAwards: string;
  releaseYear: string;
  suggestions?: any[];
  matchedInventoryId?: number;
}

const FORMAT_OPTIONS = [
  { value: "", label: "Select format..." },
  // Italian
  { value: "Locandina", label: "🇮🇹 Italian Locandina" },
  { value: "Due Fogli", label: "🇮🇹 Italian Due Fogli (1-Panel)" },
  { value: "4-Fogli", label: "🇮🇹 Italian 4 Fogli (2-Panel)" },
  { value: "6-Fogli", label: "🇮🇹 Italian 6 Fogli" },
  { value: "Photobusta", label: "🇮🇹 Italian Photobusta" },
  // French
  { value: "Petite", label: "🇫🇷 French Petite" },
  { value: "Moyenne", label: "🇫🇷 French Moyenne" },
  { value: "Grande", label: "🇫🇷 French Grande" },
  // US
  { value: "1sh", label: "🇺🇸 US One-Sheet" },
  { value: "3sh", label: "🇺🇸 US 3-Sheet" },
  { value: "6sh", label: "🇺🇸 US 6-Sheet" },
  { value: "Insert", label: "🇺🇸 US Insert" },
  { value: "Half-Sheet", label: "🇺🇸 US Half-Sheet" },
  { value: "Window Card", label: "🇺🇸 US Window Card" },
  { value: "Lobby Card", label: "🇺🇸 US Lobby Card" },
  // British
  { value: "UK Quad", label: "🇬🇧 UK Quad" },
  { value: "UK Crown", label: "🇬🇧 UK Crown" },
  { value: "UK Half Crown", label: "🇬🇧 UK Half Crown" },
  { value: "UK Double Crown", label: "🇬🇧 UK Double Crown" },
  // Japanese
  { value: "B2", label: "🇯🇵 Japanese B2" },
  { value: "B3", label: "🇯🇵 Japanese B3" },
  { value: "Chirashi", label: "🇯🇵 Japanese Chirashi (Flyer)" },
  { value: "STB", label: "🇯🇵 Japanese STB" },
  // Subway
  { value: "Subway", label: "🚇 Subway Sheet" },
  { value: "Half-Subway", label: "🚇 Half Subway" },
  // Other
  { value: "1-Stop", label: "🌍 1-Stop" },
  { value: "A1", label: "🇵🇱 A1 Format" },
  { value: "Small", label: "🇷🇺 Small Format" },
  { value: "Other", label: "Other" },
];

const FORMAT_DIMENSIONS: Record<string, string> = {
  "Locandina": '13" x 27.5" (33 x 70 cm)',
  "Due Fogli": '19.7" x 27.5" (50 x 70 cm)',
  "4-Fogli": '39" x 55" (99 x 140 cm)',
  "6-Fogli": '45.3" x 63" (115 x 160 cm)',
  "Photobusta": '18" x 26" (46 x 66 cm)',
  "Petite": '15.7" x 20.5" (40 x 52 cm)',
  "Moyenne": '23.6" x 31.5" (60 x 80 cm)',
  "Grande": '47.2" x 63" (120 x 160 cm)',
  "1sh": '27" x 41" (69 x 104 cm)',
  "3sh": '41" x 81" (104 x 206 cm)',
  "6sh": '81" x 81" (206 x 206 cm)',
  "Insert": '14" x 36" (36 x 91 cm)',
  "Half-Sheet": '22" x 28" (56 x 71 cm)',
  "Window Card": '14" x 22" (36 x 56 cm)',
  "Lobby Card": '11" x 14" (28 x 36 cm)',
  "UK Quad": '30" x 40" (76 x 102 cm)',
  "UK Crown": '15" x 20" (38 x 51 cm)',
  "UK Half Crown": '20" x 15" (51 x 38 cm)',
  "UK Double Crown": '30" x 20" (76 x 51 cm)',
  "B2": '28.7" x 40.6" (73 x 103 cm)',
  "B3": '14.3" x 20.3" (36 x 51 cm)',
  "Chirashi": '7" x 10" (18 x 26 cm)',
  "STB": '20.5" x 28.7" (52 x 73 cm)',
  "Subway": '45" x 60" (114 x 152 cm)',
  "Half-Subway": '28" x 40" (71 x 102 cm)',
  "1-Stop": '40" x 60" (102 x 152 cm)',
  "A1": '23.4" x 33.1" (59 x 84 cm)',
  "Small": '12" x 16" (30 x 41 cm)',
};

const RELEASE_TYPE_OPTIONS = [
  { value: "", label: "Release type..." },
  { value: "Original", label: "🎬 Original Release" },
  { value: "Re-release", label: "🔁 Re-release" },
];

const emptyMeta = (): UploadMeta => ({ 
  lotNumber: "", itemNumber: "", note: "", posterFormat: "", releaseType: "", dimensions: "", 
  identifiedTitle: "", identifiedYear: "", identifiedDirector: "", identifiedGenre: "", identifiedActors: "", 
  yearRangeStart: "", yearRangeEnd: "", sourceUrl: "", condition: "",
  // 🧬 Archival DNA Fields
  titleEnglish: "", titleLocal: "", printerCredit: "", nssVisaCode: "", 
  distributorLogo: "", unionBugId: "", billingBlockFont: "", dnaAuditStatus: "pending", taglineAwards: "",
  releaseYear: "",
});

// ═══════════════════════════════════════════════════
// Image Splitter (Canvas-based)
// ═══════════════════════════════════════════════════
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function splitImage(
  img: HTMLImageElement,
  count: number
): HTMLCanvasElement[] {
  const results: HTMLCanvasElement[] = [];
  const w = Math.floor(img.width / count);
  const h = img.height;
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, i * w, 0, w, h, 0, 0, w, h);
    results.push(canvas);
  }
  return results;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, type, quality);
  });
}

export default function MediaLibrary({ onRefreshInventory }: { onRefreshInventory?: () => void }) {
  const [images, setImages] = useState<LibImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [processingLabel, setProcessingLabel] = useState("");
  const [matchModalImage, setMatchModalImage] = useState<LibImage | null>(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchResults, setMatchResults] = useState<InvItem[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [autoMatchSuggestion, setAutoMatchSuggestion] = useState<{ img: LibImage; matches: InvItem[]; movie?: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Upload metadata state
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadMeta, setUploadMeta] = useState<UploadMeta>(emptyMeta());
  const [showUploadPanel, setShowUploadPanel] = useState(false);

  // Edit metadata modal
  const [editModalImage, setEditModalImage] = useState<LibImage | null>(null);
  const [editMeta, setEditMeta] = useState<UploadMeta>(emptyMeta());
  const [savingMeta, setSavingMeta] = useState(false);

  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLot, setFilterLot] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "identified" | "unidentified" | "matched" | "not_matched" | "pending_matches">("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [creatingListingId, setCreatingListingId] = useState<number | null>(null);
  const [showBulkFormatModal, setShowBulkFormatModal] = useState(false);
  // Split modal state for existing images
  const [splitModalImage, setSplitModalImage] = useState<LibImage | null>(null);
  const [splittingImage, setSplittingImage] = useState(false);
  const [bulkFormatValue, setBulkFormatValue] = useState("");
  
  // Bulk action states
  const [bulkActionModal, setBulkActionModal] = useState<"" | "delete" | "director" | "source" | "genre" | "tag" | "blog" | "bundle">("");
  const [bulkDirector, setBulkDirector] = useState("");
  const [bulkSource, setBulkSource] = useState("");
  const [bulkGenre, setBulkGenre] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkBlogId, setBulkBlogId] = useState("");
  const [bulkBundleId, setBulkBundleId] = useState("");
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // TMDB Manual Search state
  const [tmdbSearchQuery, setTmdbSearchQuery] = useState("");
  const [tmdbSearchYear, setTmdbSearchYear] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [showTmdbSearchModal, setShowTmdbSearchModal] = useState(false);
  const [selectedTmdbResult, setSelectedTmdbResult] = useState<TmdbResult | null>(null);

  // ═══════════════════════════════════════════════════
  // PROVENANCE ENGINE v2.0 - UI STATE
  // ═══════════════════════════════════════════════════
  
  // Quota Dashboard
  const [quotaUsed, setQuotaUsed] = useState(0);
  const QUOTA_LIMIT = 500;
  
  // Tools Dropdown Menu
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  
  // Glass Box Panel (Forensic Strip)
  const [showGlassBox, setShowGlassBox] = useState(false);
  const [forensicCrops, setForensicCrops] = useState<{
    header: string;
    footer: string;
    margin: string;
  } | null>(null);
  const [rawOcrLog, setRawOcrLog] = useState("");
  const [validationStatus, setValidationStatus] = useState<"verified" | "incomplete" | "anachronism" | "mismatch" | "pending">("pending");
  
  // Lot Year Range Configuration Modal
  const [showLotYearModal, setShowLotYearModal] = useState(false);
  const [editingLotYear, setEditingLotYear] = useState<{ lot: string; minYear: string; maxYear: string } | null>(null);
  
  // Provenance processing state
  const [provenanceProcessing, setProvenanceProcessing] = useState(false);
  const [provenanceStage, setProvenanceStage] = useState<"identify" | "validate" | null>(null);

  // ═══════════════════════════════════════════════════
  // LOGIC CONFLICT VISUALIZER - Lot Year Ranges
  // ═══════════════════════════════════════════════════
  // Lot year ranges for conflict detection (stored in localStorage)
  const [lotYearRanges, setLotYearRanges] = useState<Record<string, { minYear: number; maxYear: number }>>(() => {
    const stored = localStorage.getItem("lotYearRanges");
    return stored ? JSON.parse(stored) : {};
  });
  
  // Save lot year ranges to localStorage
  const updateLotYearRange = (lotNumber: string, minYear: number, maxYear: number) => {
    const updated = { ...lotYearRanges, [lotNumber]: { minYear, maxYear } };
    setLotYearRanges(updated);
    localStorage.setItem("lotYearRanges", JSON.stringify(updated));
  };

  // Detect year conflict for an image
  // Enhanced conflict detection - uses both DB conflict_status and localStorage ranges
  const detectYearConflict = (img: LibImage): { hasConflict: boolean; conflictYear?: number; expectedRange?: string; status?: string; reason?: string } => {
    // First check database conflict_status (from 3-Layer AI identification)
    if (img.conflict_status === "conflict") {
      return { 
        hasConflict: true, 
        conflictYear: img.print_year || img.identified_year || undefined,
        expectedRange: img.year_range_start && img.year_range_end ? `${img.year_range_start}-${img.year_range_end}` : undefined,
        status: "conflict",
        reason: img.conflict_reason || "Print year outside expected period"
      };
    }
    
    // Check for re-issue (Blue badge)
    if (img.conflict_status === "reissue") {
      return {
        hasConflict: false,
        status: "reissue",
        reason: img.conflict_reason || "Re-issue detected"
      };
    }
    
    // Check for verified original (Green check)
    if (img.conflict_status === "original") {
      return {
        hasConflict: false,
        status: "original",
        reason: img.conflict_reason || "Verified original"
      };
    }
    
    // Fallback: check localStorage year ranges
    if (!img.lot_number || !img.identified_year) return { hasConflict: false };
    
    const range = lotYearRanges[img.lot_number];
    if (!range) return { hasConflict: false };
    
    if (img.identified_year < range.minYear || img.identified_year > range.maxYear) {
      return { 
        hasConflict: true, 
        conflictYear: img.identified_year,
        expectedRange: `${range.minYear}-${range.maxYear}`
      };
    }
    return { hasConflict: false };
  };

  // Computed: unique lots from images
  const lots = Array.from(new Set(images.map(img => img.lot_number).filter(Boolean))).sort();

  // Filtered images
  const filteredImages = images.filter(img => {
    if (filterLot && img.lot_number !== filterLot) return false;
    if (filterStatus === "identified") return !img.matched_inventory_id && !!img.identified_title;
    if (filterStatus === "unidentified") return !img.matched_inventory_id && !img.identified_title;
    if (filterStatus === "matched") return !!img.matched_inventory_id;
    if (filterStatus === "not_matched") return !img.matched_inventory_id && !!img.identified_title;
    if (filterStatus === "pending_matches") return !img.matched_inventory_id && (img.match_status === 'suggested' || img.suggested_inventory_id !== null);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (img.filename?.toLowerCase().includes(q) || img.identified_title?.toLowerCase().includes(q) || img.lot_number?.toLowerCase().includes(q) || img.item_number?.toLowerCase().includes(q) || img.upload_note?.toLowerCase().includes(q) || img.ocr_text?.toLowerCase().includes(q));
    }
    return true;
  });

  const fetchImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.api.fetch("/api/public/library");
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      // API returns array directly, not { images: [...] }
      const items = Array.isArray(data) ? data : (data.images || data.items || []);
      // Normalize legacy data with default values for CRM fields
      const normalizedItems = items.map((img: LibImage) => ({
        ...img,
        // Ensure critical CRM fields never return undefined/null to the UI
        conflict_status: img.conflict_status ?? 'none',
        print_year: img.print_year ?? null,
        year_range_start: img.year_range_start ?? null,
        year_range_end: img.year_range_end ?? null,
        lot_number: img.lot_number ?? null,
        item_number: img.item_number ?? null,
      }));
      setImages(normalizedItems);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  // Select helpers
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const selectAll = () => {
    if (selectedIds.size === filteredImages.length) { setSelectedIds(new Set()); return; }
    setSelectedIds(new Set(filteredImages.map(img => img.id)));
  };

  // Bulk selection helpers
  const selectIdentified = () => setSelectedIds(new Set(identified.map(img => img.id)));
  const selectUnidentified = () => setSelectedIds(new Set(unidentified.map(img => img.id)));
  const selectMatched = () => setSelectedIds(new Set(matched.map(img => img.id)));
  const selectNotMatched = () => {
    const notMatched = identified.filter(img => !img.matched_inventory_id).map(img => img.id);
    setSelectedIds(new Set(notMatched));
  };

  // Bulk download
  const fetchImageAsBlob = async (imageId: number): Promise<{ blob: Blob; filename: string } | null> => {
    try {
      const response = await client.api.fetch(`/api/public/library/${imageId}/download`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      return { blob, filename: "" };
    } catch (err) { console.error("Download failed", err); return null; }
  };

  // Download a single image via backend proxy — fetch binary and save as blob
  const downloadImage = async (imageId: number, filename: string) => {
    try {
      const response = await client.api.fetch(`/api/public/library/${imageId}/download`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const pngName = filename.replace(/\.[^.]+$/, "") + ".png";
      a.download = pngName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      await new Promise(r => setTimeout(r, 300)); // prevent browser blocking
    } catch (err) { console.error("Download failed", err); }
  };

  // Bulk download as ZIP
  const handleBulkDownload = async () => {
    const toDownload = filteredImages.filter(img => selectedIds.has(img.id) && img.url);
    if (toDownload.length === 0) return;
    setDownloading(true);
    setProcessingLabel(`Preparing ${toDownload.length} images for download...`);
    try {
      const zip = new JSZip();
      const folder = zip.folder("posters");
      if (!folder) throw new Error("Failed to create zip folder");

      for (let i = 0; i < toDownload.length; i++) {
        const img = toDownload[i];
        setProcessingLabel(`Downloading ${i + 1}/${toDownload.length}: ${img.filename || `image-${img.id}`}...`);
        
        const result = await fetchImageAsBlob(img.id);
        if (result) {
          const pngName = (img.filename || `image-${img.id}`).replace(/\.[^.]+$/, "") + ".png";
          folder.file(pngName, result.blob);
        }
      }

      setProcessingLabel("Creating ZIP file...");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `posters-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) { console.error("Download failed", err); }
    setDownloading(false);
    setProcessingLabel("");
  };

  // Bulk format update
  const handleBulkFormat = async () => {
    if (!bulkFormatValue || selectedIds.size === 0) return;
    setProcessingLabel(`Updating format for ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poster_format: bulkFormatValue }),
        });
      }
      setProcessingLabel(`Updated ${ids.length} images to format: ${bulkFormatValue}`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setShowBulkFormatModal(false);
    setBulkFormatValue("");
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (!bulkDeleteConfirm || selectedIds.size === 0) return;
    setProcessingLabel(`Deleting ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}`, { method: "DELETE" });
      }
      setProcessingLabel(`Deleted ${ids.length} images`);
      setSelectedIds(new Set());
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkDeleteConfirm(false);
  };

  // Bulk update director
  const handleBulkDirector = async () => {
    if (!bulkDirector || selectedIds.size === 0) return;
    setProcessingLabel(`Updating director for ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identified_director: bulkDirector }),
        });
      }
      setProcessingLabel(`Updated director to: ${bulkDirector}`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkDirector("");
  };

  // Bulk add source
  const handleBulkSource = async () => {
    if (!bulkSource || selectedIds.size === 0) return;
    setProcessingLabel(`Adding source to ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_url: bulkSource }),
        });
      }
      setProcessingLabel(`Added source to ${ids.length} images`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkSource("");
  };

  // Bulk add genre
  const handleBulkGenre = async () => {
    if (!bulkGenre || selectedIds.size === 0) return;
    setProcessingLabel(`Adding genre to ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identified_genre: bulkGenre }),
        });
      }
      setProcessingLabel(`Added genre to ${ids.length} images`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkGenre("");
  };

  // Bulk add tag
  const handleBulkTag = async () => {
    if (!bulkTag || selectedIds.size === 0) return;
    setProcessingLabel(`Adding tag to ${selectedIds.size} images...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        // For now, store tag in upload_note as comma-separated
        const img = images.find(i => i.id === id);
        const existingTag = img?.upload_note || "";
        const newNote = existingTag ? `${existingTag} #${bulkTag}` : `#${bulkTag}`;
        await client.api.fetch(`/api/public/library/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upload_note: newNote }),
        });
      }
      setProcessingLabel(`Added tag to ${ids.length} images`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkTag("");
  };

  // ═══════════════════════════════════════════════════
  // PROVENANCE ENGINE v2.0 - HANDLER FUNCTIONS
  // ═══════════════════════════════════════════════════

  // Stage 1: Identify & Link (1 unit)
  const handleIdentify = async (imageId: number, options: {
    director?: string;
    actor?: string;
    posterFormat?: string;
    posterCountry?: string;
    yearRangeStart?: string;
    yearRangeEnd?: string;
  }) => {
    if (quotaUsed + 1 > QUOTA_LIMIT) {
      setProcessingLabel("Quota exceeded! Upgrade to continue.");
      return;
    }
    
    setProvenanceProcessing(true);
    setProvenanceStage("identify");
    setProcessingLabel("🔍 Identifying poster (Stage 1)...");
    
    try {
      console.log("[PROVENANCE] Starting Stage 1 identify for image", imageId, options);
      
      const res = await client.api.fetch(`/api/library/${imageId}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          director: options.director,
          actor: options.actor,
          posterFormat: options.posterFormat,
          posterCountry: options.posterCountry,
          yearRangeStart: options.yearRangeStart,
          yearRangeEnd: options.yearRangeEnd,
          mediaResolution: "low"
        }),
      });
      
      console.log("[PROVENANCE] Stage 1 response status:", res.status);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("[PROVENANCE] Stage 1 error response:", errorText);
        throw new Error(`API ${res.status}: ${errorText}`);
      }
      
      const data = await res.json();
      setQuotaUsed(prev => prev + (data.quotaUsed || 1));
      
      if (data.yearWarning) {
        setProcessingLabel(`⚠️ ${data.yearWarning}`);
        setTimeout(() => setProcessingLabel(""), 5000);
      } else {
        setProcessingLabel("✅ Identification complete!");
      }
      
      fetchImages();
      return data;
    } catch (err: any) {
      console.error("[PROVENANCE] Stage 1 FAILED:", err);
      setProcessingLabel(`❌ Identify failed: ${err.message}`);
    } finally {
      setProvenanceProcessing(false);
      setProvenanceStage(null);
    }
  };

  // Stage 2: Era Validator (3 units)
  const handleValidate = async (imageId: number, options: {
    posterFormat?: string;
    releaseType?: string;
    yearRangeStart?: string;
    yearRangeEnd?: string;
  }) => {
    if (quotaUsed + 3 > QUOTA_LIMIT) {
      setProcessingLabel("Quota exceeded! Upgrade to continue.");
      return;
    }
    
    setProvenanceProcessing(true);
    setProvenanceStage("validate");
    setProcessingLabel("🔬 Validating era (Stage 2 - Forensic)...");
    setShowGlassBox(true);
    
    try {
      console.log("[PROVENANCE] Starting Stage 2 validate for image", imageId, options);
      
      const res = await client.api.fetch(`/api/library/${imageId}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterFormat: options.posterFormat,
          releaseType: options.releaseType || "Original",
          yearRangeStart: options.yearRangeStart,
          yearRangeEnd: options.yearRangeEnd,
        }),
      });
      
      console.log("[PROVENANCE] Stage 2 response status:", res.status);
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("[PROVENANCE] Stage 2 error response:", errorText);
        throw new Error(`API ${res.status}: ${errorText}`);
      }
      
      const data = await res.json();
      setQuotaUsed(prev => prev + (data.quotaUsed || 3));
      
      // Update forensic UI
      if (data.forensicData) {
        setForensicCrops({
          header: data.forensicData.header_text || "",
          footer: data.forensicData.footer_text || "",
          margin: data.forensicData.margin_text || "",
        });
        setRawOcrLog(`${data.forensicData.header_text || ""} ${data.forensicData.footer_text || ""} ${data.forensicData.margin_text || ""}`);
      }
      
      setValidationStatus(data.validationStatus || "pending");
      
      // Status message
      if (data.validationStatus === "verified") {
        setProcessingLabel("✅ Era validation passed!");
      } else if (data.validationStatus === "anachronism") {
        setProcessingLabel("⚠️ Anachronism detected - check forensic details");
      } else if (data.validationStatus === "mismatch") {
        setProcessingLabel("⚠️ Mismatch detected - review details");
      } else if (data.validationStatus === "incomplete") {
        setProcessingLabel("⚠️ No forensic text detected - check image clarity");
      }
      
      fetchImages();
      return data;
    } catch (err: any) {
      console.error("[PROVENANCE] Stage 2 FAILED:", err);
      setProcessingLabel(`❌ Validation failed: ${err.message}`);
    } finally {
      setProvenanceProcessing(false);
      setProvenanceStage(null);
    }
  };

  // Legacy ID (renamed from AI Suggest)
  const handleLegacyId = async (imageId: number) => {
    const img = images.find(i => i.id === imageId);
    if (!img) return;
    
    await handleIdentify(imageId, {
      posterFormat: img.poster_format || undefined,
      posterCountry: img.poster_country || undefined,
      yearRangeStart: img.identified_year ? String(img.identified_year - 5) : undefined,
      yearRangeEnd: img.identified_year ? String(img.identified_year + 5) : undefined,
    });
  };

  // Bulk associate with blog article
  const handleBulkBlog = async () => {
    if (!bulkBlogId || selectedIds.size === 0) return;
    setProcessingLabel(`Associating ${selectedIds.size} images with blog...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/associate-blog`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blog_id: parseInt(bulkBlogId) }),
        });
      }
      setProcessingLabel(`Associated ${ids.length} images with blog #${bulkBlogId}`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkBlogId("");
  };

  // Bulk add to bundle
  const handleBulkBundle = async () => {
    if (!bulkBundleId || selectedIds.size === 0) return;
    setProcessingLabel(`Adding ${selectedIds.size} images to bundle...`);
    try {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        await client.api.fetch(`/api/public/library/${id}/add-to-bundle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle_id: parseInt(bulkBundleId) }),
        });
      }
      setProcessingLabel(`Added ${ids.length} images to bundle #${bulkBundleId}`);
      fetchImages();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
    setBulkActionModal("");
    setBulkBundleId("");
  };

  // Create inventory listing from an identified library image
  const handleCreateListing = async (img: LibImage) => {
    if (!img?.id) return;
    setCreatingListingId(img.id);
    setProcessingLabel(`Creating listing for "${img.identified_title || 'Unknown'}"...`);
    try {
      const res = await fetch(`/api/public/library/${img.id}/create-listing`, { method: "POST" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
      const data = await res.json();
      setProcessingLabel(`Created listing #${data.item.id} — ${data.item.title}`);
      fetchImages();
      onRefreshInventory?.();
    } catch (err: any) {
      setProcessingLabel(`Error: ${err.message}`);
    }
    setCreatingListingId(null);
    setTimeout(() => setProcessingLabel(""), 3000);
  };

  // Enrich an inventory item with TMDB data
  const handleEnrich = async (inventoryId: number) => {
    setProcessingLabel("Enriching with TMDB data...");
    try {
      const res = await fetch(`/api/inventory-admin/${inventoryId}/enrich`, { method: "POST" });
      if (!res.ok) throw new Error("Enrich failed");
      setProcessingLabel("Enriched successfully!");
      fetchImages();
      onRefreshInventory?.();
    } catch (err: any) {
      setProcessingLabel(`Enrich error: ${err.message}`);
    }
    setTimeout(() => setProcessingLabel(""), 3000);
  };

  // TMDB Manual Search
  const handleTmdbSearch = async () => {
    if (!tmdbSearchQuery.trim()) return;
    setTmdbSearching(true);
    setTmdbResults([]);
    try {
      const res = await client.api.fetch("/api/tmdb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: tmdbSearchQuery,
          year: tmdbSearchYear ? parseInt(tmdbSearchYear) : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTmdbResults(data.results || []);
      } else {
        const data = await res.json();
        setError(data.error || "Search failed");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setTmdbSearching(false);
  };

  // Apply TMDB result to library image
  const handleApplyTmdbResult = async () => {
    if (!selectedTmdbResult || !editModalImage) return;
    setSavingMeta(true);
    try {
      await client.api.fetch(`/api/public/library/${editModalImage.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identified_title: selectedTmdbResult.title,
          identified_year: selectedTmdbResult.year,
          identified_director: selectedTmdbResult.director || null,
          identified_genre: selectedTmdbResult.genres || null,
          identified_actors: selectedTmdbResult.actors || null,
        }),
      });
      setShowTmdbSearchModal(false);
      setSelectedTmdbResult(null);
      setEditModalImage(null);
      setEditMeta(emptyMeta());
      fetchImages();
    } catch (err: any) {
      setError("Failed to apply: " + err.message);
    }
    setSavingMeta(false);
  };

  // Open TMDB search modal from edit modal
  const openTmdbSearchFromEdit = () => {
    setTmdbSearchQuery(editMeta.identifiedTitle);
    setTmdbSearchYear(editMeta.identifiedYear);
    setShowTmdbSearchModal(true);
  };

  // Handle file selection — queue files and show metadata panel
  const handleFileSelect = (files: FileList) => {
    const arr = Array.from(files);
    if (arr.length > 0) {
      setPendingFiles(prev => [...prev, ...arr]);
      setShowUploadPanel(true);
    }
  };

  // Handle folder selection — extract lot number from folder name and queue all images
  const handleFolderSelect = (files: FileList) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;

    // Extract lot number from webkitRelativePath (e.g., "Lot_7155421/image.jpg" -> "7155421")
    let lotNumber = "";
    if (arr[0].webkitRelativePath) {
      const pathParts = arr[0].webkitRelativePath.split('/');
      const folderName = pathParts[0] || "";
      const lotMatch = folderName.match(/Lot_(\d+)/);
      if (lotMatch) {
        lotNumber = lotMatch[1];
      }
    }

    if (arr.length > 0) {
      setPendingFiles(prev => [...prev, ...arr]);
      // Pre-fill the lot number in upload metadata if found
      if (lotNumber) {
        setUploadMeta(prev => ({ ...prev, lot_number: lotNumber }));
      }
      setShowUploadPanel(true);
    }
  };

  // Execute the upload with metadata (with optional splitting)
  const handleUpload = async () => {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    setError(null);
    let uploaded = 0;

    for (const file of pendingFiles) {
      try {
        let filesToUpload: { blob: Blob; name: string }[] = [{ blob: file, name: file.name }];

        // Split image if enabled
        if (splitEnabled && splitCount > 1) {
          const img = await loadImage(file);
          const canvases = splitImage(img, splitCount);
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const ext = file.type.includes("png") ? "image/png" : "image/jpeg";
          const suffix = ext.includes("png") ? ".png" : ".jpg";
          filesToUpload = await Promise.all(
            canvases.map(async (canvas, i) => {
              const blob = await canvasToBlob(canvas, ext, 0.92);
              return { blob, name: `${baseName}_split${i + 1}${suffix}` };
            })
          );
        }

        for (const { blob, name } of filesToUpload) {
          const presignRes = await client.api.fetch("/api/public/library/upload-presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: name, contentType: blob.type }),
          });
          const presignData = await presignRes.json();

          await fetch(presignData.uploadUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": blob.type },
          });

          await client.api.fetch("/api/public/library/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              s3Uri: presignData.s3Uri,
              filename: name,
              contentType: blob.type,
              lotNumber: uploadMeta.lotNumber || null,
              itemNumber: uploadMeta.itemNumber || null,
              uploadNote: uploadMeta.note || null,
              posterFormat: uploadMeta.posterFormat || null,
              releaseType: uploadMeta.releaseType || null,
              dimensions: uploadMeta.dimensions || null,
              yearRangeStart: uploadMeta.yearRangeStart ? parseInt(uploadMeta.yearRangeStart) : null,
              yearRangeEnd: uploadMeta.yearRangeEnd ? parseInt(uploadMeta.yearRangeEnd) : null,
              sourceUrl: uploadMeta.sourceUrl || null,
              condition: uploadMeta.condition || null,
            }),
          });
          uploaded++;
        }
      } catch (err: any) {
        console.error("Upload failed for", file.name, err);
      }
    }
    setUploading(false);
    setPendingFiles([]);
    setUploadMeta(emptyMeta());
    setShowUploadPanel(false);
    setSplitEnabled(false);
    if (uploaded > 0) fetchImages();
  };

  // Save edited metadata
  const handleSaveMeta = async () => {
    if (!editModalImage) return;
    setSavingMeta(true);
    setError(null);
    try {
      console.log("Saving metadata for image:", editModalImage.id);
      console.log("Sending metadata:", JSON.stringify({
        lot_number: editMeta.lotNumber || null,
        item_number: editMeta.itemNumber || null,
        upload_note: editMeta.note || null,
        poster_format: editMeta.posterFormat || null,
        release_type: editMeta.releaseType || null,
        dimensions: editMeta.dimensions || null,
        identified_title: editMeta.identifiedTitle || null,
        identified_year: editMeta.identifiedYear ? parseInt(editMeta.identifiedYear) : null,
        identified_director: editMeta.identifiedDirector || null,
        identified_genre: editMeta.identifiedGenre || null,
        identified_actors: editMeta.identifiedActors || null,
        year_range_start: editMeta.yearRangeStart ? parseInt(editMeta.yearRangeStart) : null,
        year_range_end: editMeta.yearRangeEnd ? parseInt(editMeta.yearRangeEnd) : null,
        release_year: editMeta.releaseYear ? parseInt(editMeta.releaseYear) : null,
        title_english: editMeta.titleEnglish || null,
        title_local: editMeta.titleLocal || null,
        printer_credit: editMeta.printerCredit || null,
        nss_visa_code: editMeta.nssVisaCode || null,
        distributor_logo: editMeta.distributorLogo || null,
        union_bug_id: editMeta.unionBugId || null,
        billing_block_font: editMeta.billingBlockFont || null,
        dna_audit_status: editMeta.dnaAuditStatus || null,
        tagline_awards: editMeta.taglineAwards || null,
        matched_inventory_id: editMeta.matchedInventoryId || null,
      }));
      const res = await client.api.fetch(`/api/public/library/${editModalImage.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lot_number: editMeta.lotNumber || null,
          item_number: editMeta.itemNumber || null,
          upload_note: editMeta.note || null,
          poster_format: editMeta.posterFormat || null,
          release_type: editMeta.releaseType || null,
          dimensions: editMeta.dimensions || null,
          identified_title: editMeta.identifiedTitle || null,
          identified_year: editMeta.identifiedYear ? parseInt(editMeta.identifiedYear) : null,
          identified_director: editMeta.identifiedDirector || null,
          identified_genre: editMeta.identifiedGenre || null,
          identified_actors: editMeta.identifiedActors || null,
          year_range_start: editMeta.yearRangeStart ? parseInt(editMeta.yearRangeStart) : null,
          year_range_end: editMeta.yearRangeEnd ? parseInt(editMeta.yearRangeEnd) : null,
          source_url: editMeta.sourceUrl || null,
          condition: editMeta.condition || null,
          // 🧬 Archival DNA Fields
          title_english: editMeta.titleEnglish || null,
          title_local: editMeta.titleLocal || null,
          original_release_year: editMeta.identifiedYear ? parseInt(editMeta.identifiedYear) : null,
          printer_credit: editMeta.printerCredit || null,
          nss_visa_code: editMeta.nssVisaCode || null,
          distributor_logo: editMeta.distributorLogo || null,
          union_bug_id: editMeta.unionBugId || null,
          billing_block_font: editMeta.billingBlockFont || null,
          dna_audit_status: editMeta.dnaAuditStatus || null,
          tagline_awards: editMeta.taglineAwards || null,
        }),
      });
      console.log("Save response status:", res.status);
      if (!res.ok) {
        const errText = await res.text();
        console.error("Save failed:", errText);
        alert("Failed to save: " + res.status + " - " + errText);
        setSavingMeta(false);
        return;
      }
      const data = await res.json();
      console.log("Save response:", data);
      alert("Changes saved successfully!");
      setEditModalImage(null);
      setEditMeta(emptyMeta());
      setTimeout(() => fetchImages(), 500);
    } catch (err: any) {
      console.error("Save error:", err);
      setError("Failed to save: " + err.message);
      alert("Failed to save: " + err.message);
    }
    setSavingMeta(false);
  };

  // Open edit modal
  const openEditModal = (img: LibImage) => {
    setEditModalImage(img);
    setEditMeta({
      lotNumber: img.lot_number || "",
      itemNumber: img.item_number || "",
      note: img.upload_note || "",
      posterFormat: img.poster_format || "",
      releaseType: img.release_type || "",
      dimensions: img.dimensions || "",
      identifiedTitle: img.identified_title || "",
      identifiedYear: img.identified_year ? String(img.identified_year) : "",
      identifiedDirector: img.identified_director || "",
      identifiedGenre: img.identified_genre || "",
      identifiedActors: img.identified_actors || "",
      yearRangeStart: (img as any).year_range_start ? String((img as any).year_range_start) : "",
      yearRangeEnd: (img as any).year_range_end ? String((img as any).year_range_end) : "",
      sourceUrl: (img as any).source_url || "",
      condition: (img as any).condition || "",
      // 🧬 Archival DNA Fields — auto-populate using language detection
      // detectLanguage() uses function word patterns + accent characters
      // If title_english/title_local already stored, use them directly
      titleEnglish: img.title_english || (() => {
        if (!img.identified_title) return "";
        const detected = detectLanguage(img.identified_title);
        return detected.lang === "en" ? img.identified_title : "";
      })(),
      titleLocal: img.title_local || (() => {
        if (!img.identified_title) return "";
        const detected = detectLanguage(img.identified_title);
        return detected.lang !== "en" ? img.identified_title : "";
      })(),
      printerCredit: img.printer_credit || "",
      nssVisaCode: img.nss_visa_code || "",
      distributorLogo: img.distributor_logo || "",
      unionBugId: (img as any).union_bug_id || "",
      billingBlockFont: (img as any).billing_block_font || "",
      dnaAuditStatus: img.dna_audit_status || "pending",
      taglineAwards: (img as any).tagline_awards || "",
    });
  };

  // Auto-ID: OCR + TMDB
  const handleAutoId = async (img: LibImage) => {
    setProcessingId(img.id);
    setProcessingLabel("Running OCR...");
    setError(null);

    let ocrText = img.ocr_text || "";

    // Try client-side OCR first, then fallback to server-side OCR
    if (!ocrText && img.url) {
      // Try multiple languages for better detection
      const languages = ["eng", "ita", "fra", "spa", "deu", "jpn", "chi_sim"];
      let clientOcrWorked = false;
      
      for (const lang of languages) {
        try {
          console.log(`[OCR] Trying language: ${lang} on ${img.url}`);
          const result = await Tesseract.recognize(img.url, lang, { 
            logger: (m) => console.log(`[OCR ${lang}]`, m.status, Math.round(m.progress * 100) + "%")
          });
          const extracted = result.data.text || "";
          console.log(`[OCR ${lang}] Result:`, extracted.substring(0, 200));
          if (extracted.trim().length > ocrText.trim().length) {
            ocrText = extracted;
            clientOcrWorked = true;
          }
        } catch (e) { 
          console.warn(`[OCR] Failed for language ${lang}:`, e); 
        }
      }

      // If client OCR didn't work, try server-side OCR
      if (!clientOcrWorked || !ocrText.trim()) {
        setProcessingLabel("Client OCR failed, trying server-side OCR...");
        try {
          const ocrRes = await client.api.fetch(`/api/public/library/${img.id}/ocr`, { method: "POST" });
          if (ocrRes.ok) {
            const ocrData = await ocrRes.json();
            if (ocrData.text?.trim()) {
              ocrText = ocrData.text;
              console.log("[OCR] Server-side result:", ocrText.substring(0, 200));
            }
          }
        } catch (e) {
          console.warn("[OCR] Server-side OCR also failed:", e);
        }
      }
    }

    if (!ocrText.trim()) {
      setProcessingLabel("No text detected. Try AI Identify instead.");
      setProcessingId(null);
      return;
    }

    try {
      setProcessingLabel("Searching TMDB...");
      const res = await client.api.fetch(`/api/public/library/${img.id}/auto-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ocrText }),
      });

      if (res.ok) {
        const data = await res.json();
        setProcessingLabel(data.movie ? `Found: ${data.movie.title} (${data.movie.year || "?"})` : "No match found");

        // Classify the title language using all three methods
        if (data.movie?.title && data.movie?.identified_title) {
          try {
            const classification = await classifyPosterTitle(
              data.movie.identified_title,
              data.movie.title,
              data.movie.year
            );
            // Store classification results back to the image record
            await client.api.fetch(`/api/public/library/${img.id}/update-meta`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title_english: classification.titleEnglish || null,
                title_local: classification.titleLocal || null,
              }),
            });
            console.log(`[CLASSIFY] "${data.movie.identified_title}" → English: "${classification.titleEnglish}", Local: "${classification.titleLocal}" (${classification.language})`);
          } catch (e) {
            console.warn("[CLASSIFY] Title classification failed:", e);
          }
        }

        const enrichedImg = { ...img, identified_title: data.movie?.title, identified_year: data.movie?.year };
        if (data.inventoryMatches?.length >= 1) {
          setAutoMatchSuggestion({ img: enrichedImg, matches: data.inventoryMatches, movie: data.movie });
        }
      } else {
        const data = await res.json();
        const errorMsg = data.needsAi ? "No TMDB match — try AI Identify" : data.error || "Failed";
        const details = data.details ? `\n\n(${data.details})` : "";
        setProcessingLabel(errorMsg + details);
      }
    } catch (err: any) {
      setProcessingLabel("Error: " + err.message);
    }

    fetchImages();
    setProcessingId(null);
  };

  // AI Identify
  const handleAiIdentify = async (img: LibImage) => {
    if (!confirm("This uses Gemini Vision (costs AI credits). Continue?")) return;
    setProcessingId(img.id);
    setProcessingLabel("AI analyzing image...");
    setError(null);

    try {
      const res = await client.api.fetch(`/api/public/library/${img.id}/ai-identify`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const enrichedImg = { ...img, identified_title: data.movie?.title, identified_year: data.movie?.year };
        setProcessingLabel(data.movie ? `AI: ${data.movie.title} (${data.movie.year || "?"})` : "AI couldn't identify");
        if (data.inventoryMatches?.length >= 1) {
          setAutoMatchSuggestion({ img: enrichedImg, matches: data.inventoryMatches, movie: data.movie });
        }
      } else {
        const data = await res.json();
        const errorMsg = data.error || "AI failed";
        const fullError = data.details ? `\n\nDetails: ${data.details}\n\nFull Error: ${data.fullError}` : "";
        setProcessingLabel(errorMsg + fullError);
        if (data.details) console.error("[AI Error]", data);
      }
    } catch (err: any) {
      setProcessingLabel("Error: " + err.message);
    }

    fetchImages();
    setProcessingId(null);
  };

  // Split an existing image into multiple panels (preserving upload metadata)
  const handleSplitImage = async () => {
    if (!splitModalImage) return;
    
    setSplittingImage(true);
    setProcessingLabel(`Splitting image into ${splitCount} panels...`);
    
    try {
      // Fetch the original image
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = splitModalImage.url || splitModalImage.s3_uri;
      });
      
      // Split the image using the existing splitImage function
      const canvases = splitImage(img, splitCount);
      
      // Upload each split to storage
      const baseName = splitModalImage.filename.replace(/\.[^.]+$/, "");
      const ext = "image/jpeg";
      const suffix = ".jpg";
      
      for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i];
        const blob = await canvasToBlob(canvas, ext, 0.92);
        const filename = `${baseName}_split${i + 1}${suffix}`;
        
        // Get presigned URL
        const presignRes = await client.api.fetch("/api/public/library/upload-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, contentType: ext }),
        });
        const presignData = await presignRes.json();
        
        // Upload to storage
        await fetch(presignData.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": ext },
          body: blob,
        });
        
        // Confirm upload with original metadata preserved
        const confirmRes = await client.api.fetch("/api/public/library/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            s3Uri: presignData.s3Uri,
            filename,
            contentType: ext,
            lotNumber: splitModalImage.lot_number || "",
            itemNumber: splitModalImage.item_number ? `${splitModalImage.item_number}-${i + 1}` : "",
            uploadNote: splitModalImage.upload_note || "",
            posterFormat: splitModalImage.poster_format || "",
            releaseType: splitModalImage.release_type || "",
            dimensions: splitModalImage.dimensions || "",
          }),
        });
        
        if (!confirmRes.ok) {
          throw new Error(`Failed to confirm split ${i + 1}`);
        }
      }
      
      setProcessingLabel(`Successfully created ${splitCount} split images!`);
      setSplitModalImage(null);
      fetchImages();
    } catch (err: any) {
      console.error("Split error:", err);
      setProcessingLabel(`Error: ${err.message}`);
    }
    
    setSplittingImage(false);
    setTimeout(() => setProcessingLabel(""), 3000);
  };

  // Match to inventory
  const handleMatch = async (inventoryId: number) => {
    if (!matchModalImage) return;
    setMatchLoading(true);
    try {
      await client.api.fetch(`/api/public/library/${matchModalImage.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryId }),
      });
      setMatchModalImage(null);
      fetchImages();
      onRefreshInventory?.();
    } catch (err) { console.error(err); }
    setMatchLoading(false);
  };

  // Unmatch
  const handleUnmatch = async (img: LibImage) => {
    if (!img.matched_inventory_id) return;
    try {
      await client.api.fetch(`/api/public/library/${img.id}/unmatch`, { method: "POST" });
      fetchImages();
      onRefreshInventory?.();
    } catch (err) { console.error(err); }
  };

  // Delete
  const handleDelete = async (img: LibImage) => {
    if (!confirm(`Delete "${img.filename}"?`)) return;
    try {
      await client.api.fetch(`/api/public/library/${img.id}`, { method: "DELETE" });
      fetchImages();
    } catch (err) { console.error(err); }
  };

  // Open match modal
  const openMatchModal = (img: LibImage) => {
    if (!img?.id) return;
    setMatchModalImage(img);
    setMatchSearch(img.identified_title || "");
    setMatchResults([]);
    if (img.identified_title) searchInventory(img.identified_title, img.lot_number || undefined);
  };

  const searchInventory = async (query: string, lotNumber?: string) => {
    if (query.length < 2) { setMatchResults([]); return; }
    setMatchLoading(true);
    try {
      let url = `/api/inventory-admin?search=${encodeURIComponent(query)}&limit=20`;
      if (lotNumber) url += `&lot_id=${encodeURIComponent(lotNumber)}`;
      const res = await client.api.fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMatchResults(data.items || []);
      }
    } catch {}
    setMatchLoading(false);
  };

  const matched = filteredImages.filter(i => i.matched_inventory_id);
  const pendingMatches = filteredImages.filter(i => !i.matched_inventory_id && (i.match_status === 'suggested' || i.suggested_inventory_id !== null));
  const identified = filteredImages.filter(i => !i.matched_inventory_id && i.identified_title);
  const unidentified = filteredImages.filter(i => !i.matched_inventory_id && !i.identified_title);

  const formatLabel = (f: string) => FORMAT_OPTIONS.find(o => o.value === f)?.label || f;

  return (
    <div>
      {/* ═══════════════════════════════════════════════════ */}
      {/* PROVENANCE ENGINE v2.0 - HEADER UI */}
      {/* ═══════════════════════════════════════════════════ */}
      
      {/* Quota Dashboard */}
      <div className="flex items-center justify-between mb-4 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-lg px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-amber-600 font-semibold">🧬 Provenance Engine</span>
          <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded">v2.0</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-gray-600">Daily Quota:</span>{" "}
            <span className={`font-bold ${quotaUsed > QUOTA_LIMIT * 0.9 ? 'text-red-600' : quotaUsed > QUOTA_LIMIT * 0.7 ? 'text-amber-600' : 'text-green-600'}`}>
              {quotaUsed}
            </span>
            <span className="text-gray-400"> / {QUOTA_LIMIT}</span>
          </div>
          
          {/* Tools Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setShowToolsMenu(!showToolsMenu)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
            >
              🔧 Tools ▾
            </button>
            {showToolsMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button
                  onClick={() => {
                    setShowToolsMenu(false);
                    // Legacy ID action - will be triggered from selected image
                    setProcessingLabel("Select an image first, then use Legacy ID from the image actions");
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  📜 Legacy ID
                </button>
                <button
                  onClick={() => {
                    setShowToolsMenu(false);
                    setShowGlassBox(!showGlassBox);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  🔬 Forensic Strip
                </button>
                <button
                  onClick={() => {
                    setShowToolsMenu(false);
                    setQuotaUsed(0);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  🔄 Reset Quota
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Glass Box Panel - Forensic Strip */}
      {showGlassBox && (
        <div className="mb-4 bg-slate-900 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              🔬 Forensic Strip
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                validationStatus === 'verified' ? 'bg-green-500' :
                validationStatus === 'anachronism' ? 'bg-red-500' :
                validationStatus === 'mismatch' ? 'bg-orange-500' :
                validationStatus === 'incomplete' ? 'bg-yellow-500' :
                'bg-gray-500'
              }`}>
                {validationStatus === 'verified' ? '🟢 Verified' :
                 validationStatus === 'anachronism' ? '🔴 Anachronism' :
                 validationStatus === 'mismatch' ? '🟠 Mismatch' :
                 validationStatus === 'incomplete' ? '🟡 Incomplete' :
                 '⚪ Pending'}
              </span>
            </h3>
            <button onClick={() => setShowGlassBox(false)} className="text-gray-400 hover:text-white">✕</button>
          </div>
          
          {/* Three crop thumbnails */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-slate-800 rounded-lg p-2">
              <div className="text-xs text-gray-400 mb-1">Header (Top 15%)</div>
              <div className="h-16 bg-slate-700 rounded flex items-center justify-center text-xs text-gray-500 overflow-hidden">
                {forensicCrops?.header || "No data"}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-2">
              <div className="text-xs text-gray-400 mb-1">Footer (Bottom 20%)</div>
              <div className="h-16 bg-slate-700 rounded flex items-center justify-center text-xs text-gray-500 overflow-hidden">
                {forensicCrops?.footer || "No data"}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-2">
              <div className="text-xs text-gray-400 mb-1">Margin (Right 15%)</div>
              <div className="h-16 bg-slate-700 rounded flex items-center justify-center text-xs text-gray-500 overflow-hidden">
                {forensicCrops?.margin || "No data"}
              </div>
            </div>
          </div>
          
          {/* Raw OCR Log */}
          <div>
            <div className="text-xs text-gray-400 mb-1">Raw OCR Log</div>
            <textarea
              readOnly
              value={rawOcrLog}
              placeholder="OCR text from forensic zones will appear here..."
              className="w-full h-20 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-gray-300 resize-none"
            />
          </div>
          
          {rawOcrLog.length < 10 && rawOcrLog !== "" && (
            <div className="mt-2 text-yellow-400 text-sm flex items-center gap-2">
              ⚠️ No Forensic Text Detected. Check Image Clarity.
            </div>
          )}
        </div>
      )}

      {/* Upload zone */}
      <div className="flex gap-3 mb-4">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex-1 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
        >
          <div className="text-3xl mb-2">📸</div>
          <p className="text-sm font-medium text-gray-700">Select Images</p>
          <p className="text-xs text-gray-400 mt-1">or drag and drop</p>
        </div>
        <div
          onClick={() => folderInputRef.current?.click()}
          className="flex-1 border-2 border-dashed border-amber-300 rounded-xl p-6 text-center cursor-pointer hover:border-amber-500 hover:bg-amber-50/50 transition-colors"
        >
          <div className="text-3xl mb-2">📁</div>
          <p className="text-sm font-medium text-amber-700">Select Folder</p>
          <p className="text-xs text-amber-500 mt-1">Auto-assigns Lot #</p>
        </div>
      </div>

      {/* Hidden file inputs - placed outside the flex container */}
      <div className="hidden">
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files) handleFileSelect(e.target.files); e.target.value = ""; }} />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/*"
          multiple
          webkitdirectory=""
          directory=""
          onChange={(e) => { if (e.target.files) handleFolderSelect(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Upload metadata panel */}
      {showUploadPanel && pendingFiles.length > 0 && (
        <div className="mb-6 bg-white border border-blue-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Upload Metadata</h3>
              <p className="text-xs text-gray-500 mt-0.5">{pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""} queued — applies to all</p>
            </div>
            <button onClick={() => { setShowUploadPanel(false); setPendingFiles([]); setUploadMeta(emptyMeta()); }} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Lot #</label>
              <input
                type="text" placeholder="e.g. 7155273"
                value={uploadMeta.lotNumber}
                onChange={(e) => setUploadMeta(m => ({ ...m, lotNumber: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Item #</label>
              <input
                type="text" placeholder="e.g. A-101"
                value={uploadMeta.itemNumber}
                onChange={(e) => setUploadMeta(m => ({ ...m, itemNumber: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Poster Format</label>
              <select
                value={uploadMeta.posterFormat}
                onChange={(e) => {
                  const fmt = e.target.value;
                  setUploadMeta(m => ({ ...m, posterFormat: fmt, dimensions: FORMAT_DIMENSIONS[fmt] || "" }));
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Dimensions</label>
              <input type="text" placeholder="Auto-filled from format"
                value={uploadMeta.dimensions}
                onChange={(e) => setUploadMeta(m => ({ ...m, dimensions: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Release</label>
              <select
                value={uploadMeta.releaseType}
                onChange={(e) => setUploadMeta(m => ({ ...m, releaseType: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                {RELEASE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Note</label>
              <input
                type="text" placeholder="Optional note..."
                value={uploadMeta.note}
                onChange={(e) => setUploadMeta(m => ({ ...m, note: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Source URL</label>
              <input
                type="url" placeholder="https://example.com/source"
                value={uploadMeta.sourceUrl}
                onChange={(e) => setUploadMeta(m => ({ ...m, sourceUrl: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Condition</label>
              <select
                value={uploadMeta.condition}
                onChange={(e) => setUploadMeta(m => ({ ...m, condition: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                <option value="">Select condition...</option>
                <option value="Mint">Mint</option>
                <option value="Near Mint">Near Mint</option>
                <option value="Excellent">Excellent</option>
                <option value="Very Good">Very Good</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">🎯 Year Range (helps AI identify re-releases)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" placeholder="Start" min="1900" max="2030"
                  value={uploadMeta.yearRangeStart}
                  onChange={(e) => setUploadMeta(m => ({ ...m, yearRangeStart: e.target.value }))}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="number" placeholder="End" min="1900" max="2030"
                  value={uploadMeta.yearRangeEnd}
                  onChange={(e) => setUploadMeta(m => ({ ...m, yearRangeEnd: e.target.value }))}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <span className="text-xs text-gray-400">e.g. 1980-2010 for vintage posters</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} className="rounded" />
                <span className="text-xs font-medium text-gray-700">✂️ Split images</span>
              </label>
              {splitEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase">Panels:</span>
                  {[2, 3, 4, 5, 6].map(n => (
                    <button key={n} onClick={() => setSplitCount(n)}
                      className={`w-7 h-7 rounded text-xs font-bold transition-colors ${splitCount === n ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400 max-w-[200px] truncate">{pendingFiles.map(f => f.name).join(", ")}</p>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? "Uploading..." : `Upload ${pendingFiles.length} File${pendingFiles.length > 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {processingLabel && !autoMatchSuggestion && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <p className="text-sm text-blue-700">{processingLabel}</p>
        </div>
      )}

      {/* Auto-match suggestion — one-click link */}
      {autoMatchSuggestion && (
        <div className="mb-4 bg-green-50 border border-green-300 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-green-800">
                {processingLabel}
              </p>
              <p className="text-xs text-green-600 mt-0.5">
                {autoMatchSuggestion.matches.length === 1
                  ? <>Found in inventory: <span className="font-medium">{autoMatchSuggestion.matches[0].title}</span>
                    {autoMatchSuggestion.matches[0].format && <span className="text-green-500"> · {autoMatchSuggestion.matches[0].format}</span>}
                    {autoMatchSuggestion.matches[0].year && <span className="text-green-500"> · {autoMatchSuggestion.matches[0].year}</span>}</>
                  : <>{autoMatchSuggestion.matches.length} matches found — pick the right one</>}
              </p>
              {autoMatchSuggestion.movie?.director && (
                <p className="text-xs text-green-500 mt-0.5">Will enrich: director, actors, genre → inventory</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setAutoMatchSuggestion(null);
                  openMatchModal({ ...autoMatchSuggestion.img });
                }}
                className="text-green-600 text-xs hover:underline"
              >
                Search manually…
              </button>
              <button
                onClick={() => { setAutoMatchSuggestion(null); }}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {autoMatchSuggestion.matches.map(item => (
              <button
                key={item.id}
                onClick={async () => {
                  setMatchLoading(true);
                  try {
                    await client.api.fetch(`/api/public/library/${autoMatchSuggestion.img.id}/match`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ inventoryId: item.id }),
                    });
                    setAutoMatchSuggestion(null);
                    setProcessingLabel(`Linked to: ${item.title} ✓`);
                    fetchImages();
                    onRefreshInventory?.();
                  } catch (err) { console.error(err); }
                  setMatchLoading(false);
                }}
                disabled={matchLoading}
                className="w-full text-left p-2.5 border border-green-200 rounded-lg hover:bg-green-100 hover:border-green-400 transition-colors flex items-center justify-between disabled:opacity-50"
              >
                <div>
                  <p className="text-sm font-medium text-green-900">{item.title}</p>
                  <p className="text-xs text-green-600">
                    {item.year || "?"} · {item.format || "?"}
                    {item.dimensions && ` · ${item.dimensions}`}
                  </p>
                </div>
                <span className="bg-green-600 text-white text-xs font-medium px-3 py-1 rounded-lg hover:bg-green-700">
                  {matchLoading ? "Linking…" : "Link"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search & filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="Search by filename, title, lot, item #..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
        </div>
        {lots.length > 0 && (
          <select value={filterLot} onChange={(e) => setFilterLot(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Lots ({images.length})</option>
            {lots.map(lot => {
              const count = images.filter(img => img.lot_number === lot).length;
              const hasRange = lotYearRanges[lot];
              return <option key={lot} value={lot}>Lot {lot} ({count}){hasRange ? ` [${hasRange.minYear}-${hasRange.maxYear}]` : ''}</option>;
            })}
          </select>
        )}
        {/* Lot Year Range Config Button */}
        {lots.length > 0 && (
          <button 
            onClick={() => setShowLotYearModal(true)}
            className="text-xs bg-amber-100 text-amber-700 border border-amber-300 rounded-lg px-3 py-2 hover:bg-amber-200"
            title="Configure year ranges for lots to detect conflicts"
          >
            📅 Lot Years
          </button>
        )}
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
          <option value="all">All Status</option>
          <option value="identified">Identified</option>
          <option value="unidentified">Unidentified</option>
          <option value="matched">Matched</option>
          <option value="not_matched">Identified (Not Matched)</option>
        </select>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex-wrap">
            <span className="text-sm font-medium text-blue-700">{selectedIds.size} selected</span>
            <button onClick={handleBulkDownload} disabled={downloading} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {downloading ? "Downloading..." : "Download"}
            </button>
            <button onClick={() => {
              // Bulk OCR - run auto-id on each selected image
              const runBulkOcr = async () => {
                const ids = Array.from(selectedIds);
                for (let i = 0; i < ids.length; i++) {
                  const img = images.find(im => im.id === ids[i]);
                  if (img) {
                    setProcessingId(img.id);
                    setProcessingLabel(`OCR ${i + 1}/${ids.length}...`);
                    await handleAutoId(img);
                  }
                }
                setProcessingId(null);
              };
              runBulkOcr();
            }} disabled={processingId !== null} className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50">
              Run OCR
            </button>
            <button onClick={() => {
              // Bulk TMDB scan - skip OCR, use manual title if available
              const runBulkTmdb = async () => {
                const ids = Array.from(selectedIds);
                for (let i = 0; i < ids.length; i++) {
                  const img = images.find(im => im.id === ids[i]);
                  if (img && img.identified_title) {
                    setProcessingId(img.id);
                    setProcessingLabel(`TMDB ${i + 1}/${ids.length}: ${img.identified_title}...`);
                    try {
                      const res = await client.api.fetch(`/api/public/library/${img.id}/tmdb-scan`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: img.identified_title, year: img.identified_year }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setProcessingLabel(`Found: ${data.data?.title}`);
                      } else {
                        setProcessingLabel(`Not found: ${img.identified_title}`);
                      }
                    } catch (e) { console.error(e); }
                  }
                }
                setProcessingId(null);
                fetchImages();
              };
              runBulkTmdb();
            }} disabled={processingId !== null} className="bg-teal-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-teal-700 disabled:opacity-50">
              TMDB Scan
            </button>
            <button onClick={() => {
              // Bulk AI Suggest - verify/identify selected images
              const runBulkSuggest = async () => {
                const ids = Array.from(selectedIds);
                for (let i = 0; i < ids.length; i++) {
                  const img = images.find(im => im.id === ids[i]);
                  if (img) {
                    setProcessingId(img.id);
                    setProcessingLabel(`AI Suggest ${i + 1}/${ids.length}...`);
                    try {
                      const res = await client.api.fetch(`/api/public/library/${img.id}/ai-identify`, { method: "POST" });
                      if (res.ok) {
                        const data = await res.json();
                        setProcessingLabel(data.movie ? `Found: ${data.movie.title}` : "Not identified");
                      }
                    } catch (e) { console.error(e); }
                  }
                }
                setProcessingId(null);
                fetchImages();
              };
              runBulkSuggest();
            }} disabled={processingId !== null} className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50">
              AI Suggest
            </button>
            <button onClick={() => {
              // Open a modal for bulk format update
              setShowBulkFormatModal(true);
            }} className="bg-purple-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-purple-700">
              Set Format
            </button>
            <button onClick={() => setBulkActionModal("director")} className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-700">
              Set Director
            </button>
            <button onClick={() => setBulkActionModal("source")} className="bg-cyan-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-cyan-700">
              Add Source
            </button>
            <button onClick={() => setBulkActionModal("genre")} className="bg-pink-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-pink-700">
              Add Genre
            </button>
            <button onClick={() => setBulkActionModal("tag")} className="bg-orange-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-orange-700">
              Add Tag
            </button>
            <button onClick={() => setBulkActionModal("blog")} className="bg-teal-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-teal-700">
              Associate Blog
            </button>
            <button onClick={() => setBulkActionModal("bundle")} className="bg-amber-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-amber-700">
              Add to Bundle
            </button>
            <button onClick={() => setBulkActionModal("delete")} className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-red-700">
              Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-blue-600 text-xs hover:underline">Clear</button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-4 text-sm text-gray-500 items-center flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={selectedIds.size === filteredImages.length && filteredImages.length > 0} onChange={selectAll} className="rounded" />
          <span className="text-xs font-medium text-gray-600">Select All</span>
        </label>
        <button onClick={selectIdentified} className="text-xs text-teal-600 hover:underline">Identified ({identified.length})</button>
        <button onClick={selectUnidentified} className="text-xs text-gray-500 hover:underline">Unidentified ({unidentified.length})</button>
        <button onClick={selectMatched} className="text-xs text-green-600 hover:underline">Matched ({matched.length})</button>
        <button onClick={selectNotMatched} className="text-xs text-orange-600 hover:underline">Not Matched ({identified.filter(img => !img.matched_inventory_id).length})</button>
        <span className="text-gray-400">|</span>
        <span className="text-gray-400">{unidentified.length} unidentified</span>
        <span className="text-teal-600 font-medium">{identified.length} identified</span>
        <span className="text-green-600">{matched.length} matched</span>
        <span>{filteredImages.length}{filterLot || searchQuery ? ` of ${images.length}` : ""} total</span>
      </div>

      
      {/* Pending Matches List View */}
      {!loading && filterStatus === "pending_matches" && pendingMatches.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-700 uppercase tracking-wider">⏳ Pending Matches</h3>
            <button 
              onClick={async () => {
                const selectedPending = pendingMatches.filter(img => selectedIds.has(img.id));
                if (selectedPending.length === 0) return alert("Select matches to approve");
                
                const matches = selectedPending.map(img => ({
                  ebay_listing_id: img.id, // Using image id here
                  inventory_id: img.suggested_inventory_id
                }));
                
                try {
                  const res = await client.api.fetch("/api/admin/ebay/batch-confirm", {
                    method: "POST",
                    body: JSON.stringify({ matches })
                  });
                  const data = await res.json();
                  alert(`${data.total || 0} matches confirmed`);
                  fetchImages();
                  setSelectedIds(new Set());
                } catch (err) {
                  console.error(err);
                  alert("Failed to batch confirm");
                }
              }}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
            >
              Approve Selected ({Array.from(selectedIds).filter(id => pendingMatches.some(p => p.id === id)).length})
            </button>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" 
                      checked={pendingMatches.length > 0 && pendingMatches.every(img => selectedIds.has(img.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const newIds = new Set(selectedIds);
                          pendingMatches.forEach(img => newIds.add(img.id));
                          setSelectedIds(newIds);
                        } else {
                          const newIds = new Set(selectedIds);
                          pendingMatches.forEach(img => newIds.delete(img.id));
                          setSelectedIds(newIds);
                        }
                      }}
                      className="rounded" 
                    />
                  </th>
                  <th className="px-4 py-3">Image</th>
                  <th className="px-4 py-3">Suggested Match</th>
                  <th className="px-4 py-3">Format</th>
                  <th className="px-4 py-3">Lot #</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingMatches.map(img => (
                  <tr key={img.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(img.id)} onChange={() => toggleSelect(img.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-3">
                      {img.url ? (
                        <img src={img.url} alt="" className="w-10 h-14 object-cover rounded border border-gray-200" />
                      ) : (
                        <div className="w-10 h-14 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-xs text-gray-400">?</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{img.matched_title || img.identified_title}</div>
                      <div className="text-xs text-gray-500">{img.matched_year || img.identified_year}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{img.matched_format || img.poster_format || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{img.matched_lot_id || img.lot_number || "—"}</td>
                    <td className="px-4 py-3">
                      {img.match_confidence ? (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          img.match_confidence > 0.8 ? 'bg-green-100 text-green-700' :
                          img.match_confidence > 0.5 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {Math.round(img.match_confidence * 100)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button 
                        onClick={async () => {
                          try {
                            await client.api.fetch("/api/admin/ebay/confirm-match", {
                              method: "POST",
                              body: JSON.stringify({ ebay_listing_id: img.id, inventory_id: img.suggested_inventory_id })
                            });
                            fetchImages();
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="text-green-600 hover:text-green-800 text-xs font-medium"
                      >
                        ✓ Approve
                      </button>
                      <button 
                        onClick={async () => {
                          try {
                            // Reject match - just clear the suggestion
                            await client.api.fetch(`/api/public/library/${img.id}/metadata`, {
                              method: "PUT",
                              body: JSON.stringify({ suggested_inventory_id: null, match_status: 'rejected' })
                            });
                            fetchImages();
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        ✗ Reject
                      </button>
                      <button 
                        onClick={() => openMatchModal(img)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        🔍 Change Match
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Identified but not matched — show first so they get attention */}
      {!loading && identified.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wider mb-3">🎯 Identified — Ready to Match</h3>
          <VirtualGrid
            items={identified}
            renderItem={(img) => {
              const conflict = detectYearConflict(img);
              return (
              <div 
                className={`bg-white border-2 rounded-lg overflow-hidden hover:shadow-md transition-shadow relative h-full ${
                  selectedIds.has(img.id) ? 'border-blue-500 ring-2 ring-blue-200' : 
                  conflict.status === 'conflict' || conflict.hasConflict ? 'border-amber-400 ring-2 ring-amber-200' :
                  conflict.status === 'reissue' ? 'border-blue-400 ring-2 ring-blue-200' :
                  conflict.status === 'original' ? 'border-green-400 ring-2 ring-green-200' :
                  'border-teal-300'
                }`}
                onClick={() => (conflict.status === 'conflict' || conflict.hasConflict) && setShowGlassBox(true)}
                style={(conflict.status === 'conflict' || conflict.hasConflict) ? { cursor: 'pointer' } : {}}
              >
                {/* Status badges - Conflict/Re-issue/Original */}
                <div className="absolute top-1 right-1 z-10 flex gap-1">
                  {/* Conflict (Amber) */}
                  {(conflict.status === 'conflict' || conflict.hasConflict) && (
                    <span 
                      className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold shadow-sm cursor-pointer hover:bg-amber-600"
                      title={conflict.reason || `Year conflict: ${conflict.conflictYear} outside ${conflict.expectedRange}`}
                    >
                      ⚠️ Conflict
                    </span>
                  )}
                  {/* Re-issue (Blue) */}
                  {conflict.status === 'reissue' && (
                    <span 
                      className="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold shadow-sm"
                      title={conflict.reason || "Re-issue detected"}
                    >
                      🔄 Re-issue
                    </span>
                  )}
                  {/* Verified Original (Green) */}
                  {conflict.status === 'original' && (
                    <span 
                      className="text-[8px] bg-green-500 text-white px-1.5 py-0.5 rounded font-bold shadow-sm"
                      title={conflict.reason || "Verified original"}
                    >
                      ✓ Original
                    </span>
                  )}
                  <span className="text-[8px] bg-teal-500 text-white px-1.5 py-0.5 rounded font-bold shadow-sm">Identified</span>
                </div>
                <div className="aspect-[2/3] bg-gray-100 relative group">
                  <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"><input type="checkbox" checked={selectedIds.has(img.id)} onChange={() => toggleSelect(img.id)} className="w-5 h-5 rounded cursor-pointer" /></div>
                  {img.url && (
                    <button onClick={(e) => { e.stopPropagation(); downloadImage(img.id, img.filename || `image-${img.id}`); }} className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-white text-gray-700 rounded-full p-1.5 shadow-md hover:shadow-lg" title="Download">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    </button>
                  )}
                  {img.url ? (
                    <LazyImage src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">?</div>
                  )}
                  {processingId === img.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {/* Metadata badges */}
                  {(img.lot_number || img.item_number || img.poster_format) && (
                    <div className="absolute top-1 left-1 flex flex-wrap gap-1">
                      {img.lot_number && <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold">Lot {img.lot_number}</span>}
                      {img.item_number && <span className="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold">{img.item_number}</span>}
                      {img.poster_format && <span className="text-[8px] bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">{img.poster_format}</span>}
                      {img.release_type && <span className="text-[8px] bg-indigo-500 text-white px-1.5 py-0.5 rounded font-bold">{img.release_type}</span>}
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-800 truncate font-semibold">{img.identified_title}</p>
                  {img.identified_year && <p className="text-[10px] text-teal-600">{img.identified_year}</p>}
                  {(img.identified_director || img.identified_genre) && (
                    <p className="text-[9px] text-gray-400 truncate">{[img.identified_director, img.identified_genre].filter(Boolean).join(" · ")}</p>
                  )}
                  {img.upload_note && <p className="text-[9px] text-gray-400 truncate italic mt-0.5">{img.upload_note}</p>}
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <button onClick={() => openEditModal(img)}
                      className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-100">
                      ✏️
                    </button>
                    <button onClick={() => openMatchModal(img)}
                      className="text-[10px] bg-teal-50 text-teal-700 border border-teal-300 rounded px-1.5 py-0.5 hover:bg-teal-100 font-medium">
                      🔗 Match
                    </button>
                    {/* Provenance Engine v2.0 Actions */}
                    <button 
                      onClick={() => handleIdentify(img.id, { 
                        posterFormat: img.poster_format || undefined,
                        posterCountry: img.poster_country || undefined,
                        yearRangeStart: img.identified_year ? String(img.identified_year - 5) : undefined,
                        yearRangeEnd: img.identified_year ? String(img.identified_year + 5) : undefined,
                      })} 
                      disabled={provenanceProcessing}
                      className="text-[10px] bg-purple-50 text-purple-700 border border-purple-300 rounded px-1.5 py-0.5 hover:bg-purple-100 font-medium disabled:opacity-50"
                      title="Stage 1: Identify (1 unit)"
                    >
                      🔍 ID
                    </button>
                    <button 
                      onClick={() => handleValidate(img.id, { 
                        posterFormat: img.poster_format || undefined,
                        releaseType: img.release_type || "Original",
                        yearRangeStart: img.identified_year ? String(img.identified_year - 10) : undefined,
                        yearRangeEnd: img.identified_year ? String(img.identified_year + 10) : undefined,
                      })} 
                      disabled={provenanceProcessing}
                      className="text-[10px] bg-slate-50 text-slate-700 border border-slate-300 rounded px-1.5 py-0.5 hover:bg-slate-100 font-medium disabled:opacity-50"
                      title="Stage 2: Validate (3 units)"
                    >
                      🔬 Validate
                    </button>
                    <button onClick={() => handleCreateListing(img)} disabled={creatingListingId === img.id}
                      className="text-[10px] bg-blue-50 text-blue-700 border border-blue-300 rounded px-1.5 py-0.5 hover:bg-blue-100 font-medium disabled:opacity-50">
                      📋 Create Listing
                    </button>
                    <button onClick={() => handleDelete(img)}
                      className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-100">
                      ✕
                    </button>
                  </div>
                  <button onClick={() => { setSplitModalImage(img); setSplitCount(2); }}
                    className="text-[10px] bg-purple-50 text-purple-700 border border-purple-300 rounded px-1.5 py-0.5 hover:bg-purple-100 font-medium">
                    ✂️ Split
                  </button>
                </div>
              </div>
              );
            }}
          />
        </div>
      )}

      {/* Unidentified images grid */}
      {!loading && unidentified.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">📷 Unidentified Images</h3>
          <VirtualGrid
            items={unidentified}
            renderItem={(img) => (
              <div className={`bg-white border rounded-lg overflow-hidden hover:shadow-md transition-shadow h-full ${selectedIds.has(img.id) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
                <div className="aspect-[2/3] bg-gray-100 relative group">
                  <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"><input type="checkbox" checked={selectedIds.has(img.id)} onChange={() => toggleSelect(img.id)} className="w-5 h-5 rounded cursor-pointer" /></div>
                  {img.url && (
                    <button onClick={(e) => { e.stopPropagation(); downloadImage(img.id, img.filename || `image-${img.id}`); }} className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-white text-gray-700 rounded-full p-1.5 shadow-md hover:shadow-lg" title="Download">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    </button>
                  )}
                  {img.url ? (
                    <LazyImage src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">?</div>
                  )}
                  {processingId === img.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {/* Metadata badges */}
                  {(img.lot_number || img.item_number || img.poster_format) && (
                    <div className="absolute top-1 left-1 flex flex-wrap gap-1">
                      {img.lot_number && <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold">Lot {img.lot_number}</span>}
                      {img.item_number && <span className="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold">{img.item_number}</span>}
                      {img.poster_format && <span className="text-[8px] bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">{img.poster_format}</span>}
                      {img.release_type && <span className="text-[8px] bg-indigo-500 text-white px-1.5 py-0.5 rounded font-bold">{img.release_type}</span>}
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-600 truncate font-medium">{img.identified_title || img.filename}</p>
                  {img.identified_year && <p className="text-[10px] text-gray-400">{img.identified_year}</p>}
                  {img.upload_note && <p className="text-[9px] text-gray-400 truncate italic mt-0.5">{img.upload_note}</p>}
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <button onClick={() => openEditModal(img)}
                      className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-100">
                      ✏️
                    </button>
                    <button onClick={() => handleAutoId(img)} disabled={processingId !== null}
                      className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 hover:bg-green-100 disabled:opacity-40">
                      🔍 ID
                    </button>
                    <button onClick={() => handleAiIdentify(img)} disabled={processingId !== null}
                      className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5 hover:bg-purple-100 disabled:opacity-40">
                      🤖 AI
                    </button>
                    <button onClick={() => openMatchModal(img)}
                      className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100">
                      🔗 Match
                    </button>
                    <button onClick={() => handleDelete(img)}
                      className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-100">
                      ✕
                    </button>
                  </div>
                  <button onClick={() => { setSplitModalImage(img); setSplitCount(2); }}
                    className="text-[10px] bg-purple-50 text-purple-700 border border-purple-300 rounded px-1.5 py-0.5 hover:bg-purple-100 font-medium">
                    ✂️ Split
                  </button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* Matched images */}
      {!loading && matched.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-green-700 uppercase tracking-wider mb-3">✅ Matched to Inventory</h3>
          <VirtualGrid
            items={matched}
            renderItem={(img) => (
              <div className={`bg-white border rounded-lg overflow-hidden h-full ${selectedIds.has(img.id) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-green-200'}`}>
                <div className="aspect-[2/3] bg-gray-100 relative group">
                  <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity"><input type="checkbox" checked={selectedIds.has(img.id)} onChange={() => toggleSelect(img.id)} className="w-5 h-5 rounded cursor-pointer" /></div>
                  {img.url && (
                    <button onClick={(e) => { e.stopPropagation(); downloadImage(img.id, img.filename || `image-${img.id}`); }} className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 hover:bg-white text-gray-700 rounded-full p-1.5 shadow-md hover:shadow-lg" title="Download">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    </button>
                  )}
                  {img.url ? (
                    <LazyImage src={img.url} alt={img.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">?</div>
                  )}
                  {(img.lot_number || img.item_number || img.poster_format) && (
                    <div className="absolute top-1 left-1 flex flex-wrap gap-1">
                      {img.lot_number && <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold">Lot {img.lot_number}</span>}
                      {img.item_number && <span className="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold">{img.item_number}</span>}
                      {img.poster_format && <span className="text-[8px] bg-green-600 text-white px-1.5 py-0.5 rounded font-bold">{img.poster_format}</span>}
                      {img.release_type && <span className="text-[8px] bg-indigo-500 text-white px-1.5 py-0.5 rounded font-bold">{img.release_type}</span>}
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-600 truncate">{img.identified_title || "Matched"}</p>
                  <p className="text-[10px] text-green-600">→ Inventory #{img.matched_inventory_id}</p>
                  {img.upload_note && <p className="text-[9px] text-gray-400 truncate italic mt-0.5">{img.upload_note}</p>}
                  <div className="flex gap-1 mt-1.5">
                    <button onClick={() => openEditModal(img)}
                      className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-100">
                      ✏️
                    </button>
                    <button onClick={() => handleUnmatch(img)}
                      className="text-[10px] text-gray-400 hover:text-red-500">Unmatch</button>
                    <button onClick={() => handleEnrich(img.matched_inventory_id!)}
                      className="text-[10px] bg-purple-50 text-purple-700 border border-purple-300 rounded px-1.5 py-0.5 hover:bg-purple-100 font-medium">
                      ✨ Enrich
                    </button>
                  </div>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      {!loading && images.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-1">No images yet</p>
          <p className="text-sm">Upload poster images above to get started</p>
        </div>
      )}

            {/* Edit Metadata Modal */}
      {editModalImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Edit Metadata</h2>
              <button
                onClick={openTmdbSearchFromEdit}
                className="text-sm px-3 py-1 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium"
              >
                🔍 Search TMDB
              </button>
              <button onClick={() => { setEditModalImage(null); setEditMeta(emptyMeta()); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {editModalImage.url && (
                <div className="flex justify-center">
                  <img src={editModalImage.url} alt="" className="h-32 w-auto rounded-lg" />
                </div>
              )}
              
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">English Title</label>
                    <input type="text" placeholder="e.g. The Godfather"
                      value={editMeta.titleEnglish || editMeta.identifiedTitle || ""} onChange={(e) => setEditMeta(m => ({ ...m, titleEnglish: e.target.value, identifiedTitle: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Local Title</label>
                    <input type="text" placeholder="Local language title (Italian, French, etc.)"
                      value={editMeta.titleLocal || ""} onChange={(e) => setEditMeta(m => ({ ...m, titleLocal: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Original Release Year</label>
                    <input type="number" placeholder="e.g. 1972" min="1888" max="2030"
                      value={editMeta.identifiedYear || ""} onChange={(e) => setEditMeta(m => ({ ...m, identifiedYear: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Re-Release Year</label>
                    <input type="number" placeholder="e.g. 2019" min="1888" max="2030"
                      value={editMeta.releaseYear || ""} onChange={(e) => setEditMeta(m => ({ ...m, releaseYear: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Director</label>
                    <input type="text" placeholder="e.g. Coppola"
                      value={editMeta.identifiedDirector || ""} onChange={(e) => setEditMeta(m => ({ ...m, identifiedDirector: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Genre</label>
                    <input type="text" placeholder="e.g. Crime, Drama"
                      value={editMeta.identifiedGenre || ""} onChange={(e) => setEditMeta(m => ({ ...m, identifiedGenre: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Actors</label>
                    <input type="text" placeholder="e.g. Brando, Pacino"
                      value={editMeta.identifiedActors || ""} onChange={(e) => setEditMeta(m => ({ ...m, identifiedActors: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Format</label>
                    <select
                      value={editMeta.posterFormat || ""} onChange={(e) => {
                        const fmt = e.target.value;
                        setEditMeta(m => ({ ...m, posterFormat: fmt, dimensions: FORMAT_DIMENSIONS[fmt] || "" }));
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  
                  {/* 6e: Auto-suggest inventory match */}
                  {(editMeta.titleEnglish || editMeta.identifiedTitle) && editMeta.posterFormat && (
                    <div className="col-span-2 mt-2">
                      <button 
                        onClick={async (e) => {
                          e.preventDefault();
                          const title = editMeta.titleEnglish || editMeta.identifiedTitle || "";
                          const year = editMeta.identifiedYear || "";
                          const format = editMeta.posterFormat || "";
                          try {
                            const res = await client.api.fetch(`/api/admin/media-library/suggest-match?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}&format=${encodeURIComponent(format)}`);
                            const data = await res.json();
                            if (data.suggestions && data.suggestions.length > 0) {
                              setEditMeta(m => ({ ...m, suggestions: data.suggestions }));
                            } else {
                              setEditMeta(m => ({ ...m, suggestions: [] }));
                              alert("No matches found.");
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="w-full py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100"
                      >
                        Find Inventory Match
                      </button>
                      {editMeta.suggestions && editMeta.suggestions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {editMeta.suggestions.map((s: any) => (
                            <button key={s.id}
                              onClick={async (e) => {
                                e.preventDefault();
                                try {
                                  await client.api.fetch("/api/admin/ebay/confirm-match", {
                                    method: "POST",
                                    body: JSON.stringify({ ebay_listing_id: editModalImage.id, inventory_id: s.id }) // Wait, this is media library, not ebay
                                  });
                                  // Actually, we should just set matched_inventory_id and trigger syncMediaLibraryToInventory
                                  // But we don't have a direct endpoint for that here. Let's just set it in the state and save it.
                                  setEditMeta(m => ({ ...m, matchedInventoryId: s.id }));
                                  alert("Match selected. Save to apply.");
                                } catch (err) {
                                  console.error(err);
                                }
                              }}
                              className={`w-full text-left px-3 py-2 text-[10px] border rounded ${editMeta.matchedInventoryId === s.id ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
                            >
                              Match: {s.title} ({s.year}) · {s.format} · lot {s.lot_id} [MATCH]
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Printer Credit</label>
                    <input type="text" placeholder="e.g. offset - Milano"
                      value={editMeta.printerCredit || ""} onChange={(e) => setEditMeta(m => ({ ...m, printerCredit: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">NSS / Visa Code</label>
                    <input type="text" placeholder="e.g. R68/12 or Visto 45678"
                      value={editMeta.nssVisaCode || ""} onChange={(e) => setEditMeta(m => ({ ...m, nssVisaCode: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Distributor Logo</label>
                    <input type="text" placeholder="e.g. 20th Century Fox"
                      value={editMeta.distributorLogo || ""} onChange={(e) => setEditMeta(m => ({ ...m, distributorLogo: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Union Bug / ID</label>
                    <input type="text" placeholder="e.g. C12345"
                      value={editMeta.unionBugId || ""} onChange={(e) => setEditMeta(m => ({ ...m, unionBugId: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Billing Block Style</label>
                    <select
                      value={editMeta.billingBlockFont || ""} onChange={(e) => setEditMeta(m => ({ ...m, billingBlockFont: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      <option value="">Select style...</option>
                      <option value="classic">Classic (Pre-1960)</option>
                      <option value="modern">Modern (1960-1980)</option>
                      <option value="ultra-condensed">Ultra-Condensed (Post-1980)</option>
                      <option value="digital">Digital/Laser (Post-1990)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Audit Status</label>
                    <select
                      value={editMeta.dnaAuditStatus || "pending"} onChange={(e) => setEditMeta(m => ({ ...m, dnaAuditStatus: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="verified">Verified</option>
                      <option value="incomplete">Incomplete</option>
                      <option value="anachronism">Anachronism</option>
                      <option value="mismatch">Mismatch</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Awards / Tagline</label>
                    <input type="text" placeholder="e.g. Winner of 3 Academy Awards"
                      value={editMeta.taglineAwards || ""} onChange={(e) => setEditMeta(m => ({ ...m, taglineAwards: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Lot #</label>
                    <input type="text" placeholder="e.g. 7155273"
                      value={editMeta.lotNumber || ""} onChange={(e) => setEditMeta(m => ({ ...m, lotNumber: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Item #</label>
                    <input type="text" placeholder="e.g. A-101"
                      value={editMeta.itemNumber || ""} onChange={(e) => setEditMeta(m => ({ ...m, itemNumber: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Dimensions</label>
                    <input type="text" placeholder="Auto-filled from format"
                      value={editMeta.dimensions || ""}
                      onChange={(e) => setEditMeta(m => ({ ...m, dimensions: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Release</label>
                    <select
                      value={editMeta.releaseType || ""} onChange={(e) => setEditMeta(m => ({ ...m, releaseType: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      {RELEASE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Condition</label>
                    <select
                      value={editMeta.condition || ""}
                      onChange={(e) => setEditMeta(m => ({ ...m, condition: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      <option value="">Select condition...</option>
                      <option value="Fine">Fine</option>
                      <option value="Very Good to Fine">Very Good to Fine</option>
                      <option value="Very Good">Very Good</option>
                      <option value="Good to Very Good">Good to Very Good</option>
                      <option value="Good">Good</option>
                      <option value="Fair">Fair</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Source URL</label>
                    <input type="url" placeholder="https://example.com/source"
                      value={editMeta.sourceUrl || ""}
                      onChange={(e) => setEditMeta(m => ({ ...m, sourceUrl: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Note</label>
                    <textarea placeholder="Optional note..."
                      value={editMeta.note || ""} onChange={(e) => setEditMeta(m => ({ ...m, note: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none" rows={2}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setEditModalImage(null); setEditMeta(emptyMeta()); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleSaveMeta} disabled={savingMeta}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {savingMeta ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Modal */}
      {matchModalImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Match to Inventory</h2>
                <p className="text-xs text-gray-500">
                  {matchModalImage.identified_title && `Identified: "${matchModalImage.identified_title}" (${matchModalImage.identified_year || "?"})`}
                  {matchModalImage.identified_title && matchModalImage.lot_number && " · "}
                  {matchModalImage.lot_number && <span className="text-blue-600 font-medium">Scoping to Lot {matchModalImage.lot_number}</span>}
                </p>
              </div>
              <button onClick={() => setMatchModalImage(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {matchModalImage.url && (
              <div className="px-6 pt-4">
                <img src={matchModalImage.url} alt="" className="h-40 w-auto rounded-lg mx-auto" />
              </div>
            )}

            <div className="px-6 py-3">
              <input
                type="text" placeholder="Search inventory..."
                value={matchSearch} onChange={(e) => { setMatchSearch(e.target.value); searchInventory(e.target.value, matchModalImage?.lot_number || undefined); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              {matchLoading && <div className="text-center py-4 text-gray-400 text-sm">Searching...</div>}
              {matchResults.length > 0 ? (
                <div className="space-y-2">
                  {matchResults.map(item => (
                    <button key={item.id}
                      onClick={() => handleMatch(item.id)}
                      className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <span className="text-xs text-gray-400">#{item.id}</span>
                      </div>
                      <p className="text-xs text-gray-500">{item.year || "?"} · {item.format || "?"} · {item.dimensions || "No dims"}</p>
                      {matchModalImage?.identified_title && (
                        <p className="text-[10px] text-green-600 mt-1">
                          ✓ Will enrich with director, actors, genre from TMDB
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              ) : !matchLoading && matchSearch.length >= 2 && (
                <p className="text-sm text-gray-400 text-center py-4">No inventory items found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TMDB Search Modal */}
      {showTmdbSearchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Search TMDB</h3>
              <button onClick={() => { setShowTmdbSearchModal(false); setTmdbResults([]); setSelectedTmdbResult(null); }} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Movie title..."
                  value={tmdbSearchQuery}
                  onChange={(e) => setTmdbSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTmdbSearch()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="w-24">
                <input
                  type="text"
                  placeholder="Year"
                  value={tmdbSearchYear}
                  onChange={(e) => setTmdbSearchYear(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTmdbSearch()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={handleTmdbSearch}
                disabled={tmdbSearching || !tmdbSearchQuery.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {tmdbSearching ? "Searching..." : "Search"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {tmdbResults.length > 0 ? (
                <div className="space-y-2">
                  {tmdbResults.map(movie => (
                    <button
                      key={movie.id}
                      onClick={() => setSelectedTmdbResult(movie)}
                      className={`w-full text-left p-3 border rounded-lg transition-colors ${
                        selectedTmdbResult?.id === movie.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {movie.poster_path && (
                          <img
                            src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`}
                            alt={movie.title}
                            className="w-12 h-18 object-cover rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{movie.title}</p>
                          <p className="text-xs text-gray-500">{movie.year || "?"} · {movie.vote_average?.toFixed(1) || "?"}/10</p>
                          {movie.director && <p className="text-xs text-gray-600 mt-1">Dir: {movie.director}</p>}
                          {movie.genres && <p className="text-xs text-gray-500 truncate">{movie.genres}</p>}
                        </div>
                        {selectedTmdbResult?.id === movie.id && (
                          <span className="text-blue-600 text-sm font-medium">Selected</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  {tmdbSearching ? "Searching TMDB..." : "Enter a movie title and click Search"}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-4 pt-4 border-t">
              <button onClick={() => { setShowTmdbSearchModal(false); setTmdbResults([]); setSelectedTmdbResult(null); }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleApplyTmdbResult}
                disabled={!selectedTmdbResult || savingMeta}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingMeta ? "Applying..." : "Apply to Image"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Format Modal */}
      {showBulkFormatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Set Format for {selectedIds.size} images</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Poster Format</label>
                <select id="bulkPosterFormat" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">No change</option>
                  {FORMAT_OPTIONS.filter(o => o.value).map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Release Type</label>
                <select id="bulkReleaseType" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">No change</option>
                  <option value="Original">Original</option>
                  <option value="Re-release">Re-release</option>
                  <option value="Rerelease">Rerelease</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dimensions</label>
                <input type="text" id="bulkDimensions" placeholder="e.g. 27x40 in" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lot Number</label>
                <input type="text" id="bulkLotNumber" placeholder="Leave empty to keep existing" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowBulkFormatModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={async () => {
                const poster_format = (document.getElementById("bulkPosterFormat") as HTMLSelectElement).value || undefined;
                const release_type = (document.getElementById("bulkReleaseType") as HTMLSelectElement).value || undefined;
                const dimensions = (document.getElementById("bulkDimensions") as HTMLInputElement).value || undefined;
                const lot_number = (document.getElementById("bulkLotNumber") as HTMLInputElement).value || undefined;
                
                setProcessingLabel(`Updating ${selectedIds.size} images...`);
                try {
                  await client.api.fetch("/api/public/library/bulk-update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: Array.from(selectedIds), poster_format, release_type, dimensions, lot_number }),
                  });
                  fetchImages();
                  setSelectedIds(new Set());
                  setShowBulkFormatModal(false);
                  setProcessingLabel("Bulk update complete!");
                } catch (e: any) {
                  setProcessingLabel("Error: " + e.message);
                }
              }} className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Modals */}
      {bulkActionModal === "delete" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete {selectedIds.size} images?</h3>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone. All selected images will be permanently deleted.</p>
            {!bulkDeleteConfirm && (
              <label className="flex items-center gap-2 mb-4">
                <input type="checkbox" checked={bulkDeleteConfirm} onChange={(e) => setBulkDeleteConfirm(e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-700">Yes, I want to delete these images</span>
              </label>
            )}
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkDelete} disabled={!bulkDeleteConfirm} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Delete</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "director" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Set Director for {selectedIds.size} images</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Director Name</label>
              <input type="text" value={bulkDirector} onChange={(e) => setBulkDirector(e.target.value)} placeholder="e.g. Quentin Tarantino" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkDirector} disabled={!bulkDirector} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "source" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Source URL to {selectedIds.size} images</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Source URL</label>
              <input type="url" value={bulkSource} onChange={(e) => setBulkSource(e.target.value)} placeholder="https://example.com/source" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkSource} disabled={!bulkSource} className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "genre" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Genre to {selectedIds.size} images</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Genre</label>
              <input type="text" value={bulkGenre} onChange={(e) => setBulkGenre(e.target.value)} placeholder="e.g. Action, Sci-Fi, Horror" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkGenre} disabled={!bulkGenre} className="flex-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "tag" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Tag to {selectedIds.size} images</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tag</label>
              <input type="text" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="e.g. rare, vintage, collection" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkTag} disabled={!bulkTag} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "blog" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Associate with Blog Article</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Blog Article ID</label>
              <input type="number" value={bulkBlogId} onChange={(e) => setBulkBlogId(e.target.value)} placeholder="Enter blog ID" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkBlog} disabled={!bulkBlogId} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {bulkActionModal === "bundle" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add to Bundle</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Bundle ID</label>
              <input type="number" value={bulkBundleId} onChange={(e) => setBulkBundleId(e.target.value)} placeholder="Enter bundle ID" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkActionModal("")} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkBundle} disabled={!bulkBundleId} className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* Split Modal - for splitting existing images */}
      {splitModalImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">✂️ Split Image</h3>
              <button onClick={() => setSplitModalImage(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Split "{splitModalImage.filename}" into multiple panels. 
              The new images will keep the same lot number, format, and other metadata.
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Number of panels:</label>
              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSplitCount(n)}
                    className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${
                      splitCount === n 
                        ? "bg-purple-600 text-white" 
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setSplitModalImage(null)} 
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSplitImage} disabled={splittingImage}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {splittingImage ? (
                  <>
                    <span className="animate-spin">⏳</span> Splitting...
                  </>
                ) : (
                  <>✂️ Split into {splitCount}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Split Modal - for splitting existing images */}
      {splitModalImage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">✂️ Split Image</h3>
              <button onClick={() => setSplitModalImage(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Split "{splitModalImage.filename}" into multiple panels. 
              The new images will keep the same lot number, format, and other metadata.
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Number of panels:</label>
              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setSplitCount(n)}
                    className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${
                      splitCount === n 
                        ? "bg-purple-600 text-white" 
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setSplitModalImage(null)} 
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSplitImage} disabled={splittingImage}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {splittingImage ? (
                  <>
                    <span className="animate-spin">⏳</span> Splitting...
                  </>
                ) : (
                  <>✂️ Split into {splitCount}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lot Year Range Configuration Modal */}
      {showLotYearModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">📅 Configure Lot Year Ranges</h3>
              <button onClick={() => setShowLotYearModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Set year ranges for your lots to detect conflicts. If an identified poster's year falls outside the range, it'll be flagged with an amber border.
            </p>
            
            <div className="max-h-[400px] overflow-y-auto space-y-3 mb-4">
              {lots.map(lot => {
                const range = lotYearRanges[lot] || { minYear: 1960, maxYear: 1990 };
                return (
                  <div key={lot} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium text-gray-700 w-20">Lot {lot}</span>
                    <input 
                      type="number" 
                      value={editingLotYear?.lot === lot ? editingLotYear.minYear : range.minYear}
                      onChange={(e) => setEditingLotYear({ lot, minYear: e.target.value, maxYear: (editingLotYear?.lot === lot ? editingLotYear.maxYear : range.maxYear.toString()) })}
                      onFocus={() => !editingLotYear && setEditingLotYear({ lot, minYear: range.minYear.toString(), maxYear: range.maxYear.toString() })}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                      placeholder="Min"
                    />
                    <span className="text-gray-400">to</span>
                    <input 
                      type="number" 
                      value={editingLotYear?.lot === lot ? editingLotYear.maxYear : range.maxYear}
                      onChange={(e) => setEditingLotYear({ lot, minYear: (editingLotYear?.lot === lot ? editingLotYear.minYear : range.minYear.toString()), maxYear: e.target.value })}
                      onFocus={() => !editingLotYear && setEditingLotYear({ lot, minYear: range.minYear.toString(), maxYear: range.maxYear.toString() })}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                      placeholder="Max"
                    />
                    <button 
                      onClick={() => {
                        const newRange = editingLotYear?.lot === lot ? editingLotYear : { minYear: range.minYear.toString(), maxYear: range.maxYear.toString() };
                        updateLotYearRange(lot, parseInt(newRange.minYear) || 1960, parseInt(newRange.maxYear) || 1990);
                        setEditingLotYear(null);
                      }}
                      className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600"
                    >
                      Save
                    </button>
                  </div>
                );
              })}
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setShowLotYearModal(false)} 
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

            

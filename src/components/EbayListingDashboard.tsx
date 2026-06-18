import { createEdgeSpark } from "@edgespark/client";
import "@edgespark/client/styles.css";
import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Save,
  Send,
  RotateCcw,
  Trash2,
  Edit3,
  Sparkles,
  AlertCircle,
  Check,
  X,
  ExternalLink,
  RefreshCw,
  Package,
  DollarSign,
  Tag,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface EbayListing {
  id: number;
  poster_id: number | null;
  ebay_item_id: string | null;
  title: string | null;
  year: number | null;
  director: string | null;
  cast: string | null;
  format: string | null;
  origin: string | null;
  decade: string | null;
  price: number | null;
  condition: string | null;
  condition_details: string | null;
  other_notes: string | null;
  description_html: string | null;
  image_url: string | null;
  status: "draft" | "active" | "ended";
  item_web_url: string | null;
  gemini_synopsis: string | null;
  gemini_collector_note: string | null;
  category_id: string | null;
  created_at: number;
  last_synced_at: number | null;
}

interface Poster {
  id: number;
  title: string | null;
  year: number | null;
  director: string | null;
  actors: string | null;
  poster_style: string | null;
  condition_grade: string | null;
  format: string | null;
  poster_country: string | null;
  imageUrl: string | null;
  price: number | null;
}

// ═══════════════════════════════════════════════════════════
// Auth Guard
// ═══════════════════════════════════════════════════════════

function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const authChecked = useRef(false);

  useEffect(() => {
    if (authChecked.current) return;
    authChecked.current = true;
    client.auth.getSession().then((session) => {
      if (session.data?.user) {
        setUser(session.data.user);
      }
      setLoading(false);
    });
  }, []);

  return { user, loading };
}

// ═══════════════════════════════════════════════════════════
// Title Validator (80-char limit with Auto-Priority Toggle)
// ═══════════════════════════════════════════════════════════

function TitleValidator({
  title,
  onChange,
  director,
  cast,
}: {
  title: string;
  onChange: (title: string) => void;
  director: string | null;
  cast: string | null;
}) {
  const MAX_CHARS = 80;
  const charCount = title.length;
  const isOverLimit = charCount > MAX_CHARS;

  // Auto-priority: Strip "Locandina" and reformat to prioritize cast/director
  const handleAutoPriority = () => {
    let newTitle = title;

    // Remove "Locandina" or similar prefixes
    newTitle = newTitle.replace(/^Locandina\s*/i, "");
    newTitle = newTitle.replace(/^Italian\s*/i, "");
    newTitle = newTitle.replace(/^Original\s*/i, "");

    // If over limit, try to prioritize cast/director
    if (charCount > MAX_CHARS && (cast || director)) {
      const parts: string[] = [];
      if (cast) parts.push(cast.split(",")[0].trim());
      if (director) parts.push(`Dir. ${director}`);
      if (parts.length > 0) {
        newTitle = `${parts.join(" • ")}: ${newTitle}`;
      }
    }

    // Truncate if still over limit
    if (newTitle.length > MAX_CHARS) {
      newTitle = newTitle.substring(0, MAX_CHARS - 3) + "...";
    }

    onChange(newTitle);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-noir-700">
          eBay Title <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs ${
              isOverLimit ? "text-red-500 font-bold" : "text-noir-500"
            }`}
          >
            {charCount}/{MAX_CHARS}
          </span>
          {isOverLimit && (
            <button
              type="button"
              onClick={handleAutoPriority}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-gold-500 text-white rounded hover:bg-gold-600 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              Auto-Fix
            </button>
          )}
        </div>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter eBay listing title..."
        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-burgundy-500 focus:border-burgundy-500 ${
          isOverLimit ? "border-red-500 bg-red-50" : "border-noir-200"
        }`}
        maxLength={MAX_CHARS + 10} // Allow slight overflow for auto-fix
      />
      {isOverLimit && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Title exceeds 80 characters. Click "Auto-Fix" to reformat.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Decade Dropdown
// ═══════════════════════════════════════════════════════════

const DECADE_MAP: Record<number, string> = {
  1900: "1900s",
  1910: "1910s",
  1920: "1920s",
  1930: "1930s",
  1940: "1940s",
  1950: "1950s",
  1960: "1960s",
  1970: "1970s",
  1980: "1980s",
  1990: "1990s",
  2000: "2000s",
  2010: "2010s",
  2020: "2020s",
};

function getDecadeFromYear(year: number | null): string | null {
  if (!year) return null;
  const decade = Math.floor(year / 10) * 10;
  return DECADE_MAP[decade] || null;
}

// ═══════════════════════════════════════════════════════════
// Condition Options
// ═══════════════════════════════════════════════════════════

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like New" },
  { value: "very_good", label: "Very Good" },
  { value: "good", label: "Good" },
  { value: "acceptable", label: "Acceptable" },
];

// ═══════════════════════════════════════════════════════════
// Format Options
// ═══════════════════════════════════════════════════════════

const FORMAT_OPTIONS = [
  { value: "One Sheet (27x41)", label: "One Sheet (27x41)" },
  { value: "Locandina (13x28)", label: "Locandina (13x28)" },
  { value: "French (47x63)", label: "French (47x63)" },
  { value: "British (30x40)", label: "British (30x40)" },
  { value: "Italian (15x21)", label: "Italian (15x21)" },
  { value: "German (24x33)", label: "German (24x33)" },
  { value: "Japanese", label: "Japanese" },
  { value: "Insert (14x36)", label: "Insert (14x36)" },
  { value: "Window Card", label: "Window Card" },
  { value: "Lobby Card (11x14)", label: "Lobby Card (11x14)" },
  { value: "Three Sheet", label: "Three Sheet" },
  { value: "Six Sheet", label: "Six Sheet" },
];

// ═══════════════════════════════════════════════════════════
// Origin Options
// ═══════════════════════════════════════════════════════════

const ORIGIN_OPTIONS = [
  { value: "USA", label: "USA" },
  { value: "Italy", label: "Italy" },
  { value: "France", label: "France" },
  { value: "UK", label: "UK" },
  { value: "Germany", label: "Germany" },
  { value: "Japan", label: "Japan" },
  { value: "Spain", label: "Spain" },
  { value: "Belgium", label: "Belgium" },
  { value: "Netherlands", label: "Netherlands" },
  { value: "Argentina", label: "Argentina" },
  { value: "Mexico", label: "Mexico" },
  { value: "Australia", label: "Australia" },
];

// ═══════════════════════════════════════════════════════════
// TipTap Editor Component
// ═══════════════════════════════════════════════════════════

function DescriptionEditor({
  content,
  onChange,
  readOnly = false,
}: {
  content: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Write your listing description here...",
      }),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  if (!editor) {
    return null;
  }

  return (
    <div className="border border-noir-200 rounded-lg overflow-hidden">
      {!readOnly && (
        <div className="flex items-center gap-1 p-2 bg-noir-50 border-b border-noir-200">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded ${
              editor.isActive("bold")
                ? "bg-burgundy-500 text-white"
                : "hover:bg-noir-200"
            }`}
          >
            <span className="font-bold">B</span>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded ${
              editor.isActive("italic")
                ? "bg-burgundy-500 text-white"
                : "hover:bg-noir-200"
            }`}
          >
            <span className="italic">I</span>
          </button>
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            className={`p-1.5 rounded ${
              editor.isActive("heading", { level: 2 })
                ? "bg-burgundy-500 text-white"
                : "hover:bg-noir-200"
            }`}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            className={`p-1.5 rounded ${
              editor.isActive("heading", { level: 3 })
                ? "bg-burgundy-500 text-white"
                : "hover:bg-noir-200"
            }`}
          >
            H3
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded ${
              editor.isActive("bulletList")
                ? "bg-burgundy-500 text-white"
                : "hover:bg-noir-200"
            }`}
          >
            •
          </button>
          <div className="w-px h-5 bg-noir-300 mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="p-1.5 rounded hover:bg-noir-200 disabled:opacity-50"
          >
            ↩
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="p-1.5 rounded hover:bg-noir-200 disabled:opacity-50"
          >
            ↪
          </button>
        </div>
      )}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-4 min-h-[300px] focus:outline-none"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Dashboard Component
// ═══════════════════════════════════════════════════════════

export default function EbayListingDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [posters, setPosters] = useState<Poster[]>([]);
  const [activeTab, setActiveTab] = useState<"draft" | "active" | "ended" | "parse" | "history">(
    "draft"
  );
  const [selectedListing, setSelectedListing] = useState<EbayListing | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseRawText, setParseRawText] = useState("");
  const [parseItemId, setParseItemId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<any>(null);

  const handleParseDescription = async () => {
    if (!parseRawText) return;
    setParsing(true);
    try {
      const res = await client.api.fetch("/api/admin/ebay/parse-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ebay_item_id: parseItemId || null,
          raw_description: parseRawText,
        }),
      });
      setParseResult(await res.json());
    } catch (err) {
      console.error("Parse failed", err);
    }
    setParsing(false);
  };

  const handleConfirmParseMatch = async (inventoryId: number) => {
    if (!parseResult) return;
    try {
      const listingsRes = await client.api.fetch("/api/ebay/listings");
      const listingsData = await listingsRes.json();
      const listing = listingsData.listings?.find((l: any) => l.ebay_item_id === parseItemId);
      if (listing) {
        await client.api.fetch("/api/admin/ebay/confirm-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ebay_listing_id: listing.id, inventory_id: inventoryId }),
        });
      }
      setSuccess("Match confirmed and fields synced to inventory");
      setParseResult(null);
      setParseRawText("");
      setParseItemId("");
    } catch (err) {
      setError("Failed to confirm match");
    }
  };

  const [success, setSuccess] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<any>(null);
  const [historyListings, setHistoryListings] = useState<any[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    poster_id: null as number | null,
    title: "",
    year: null as number | null,
    director: "",
    cast: "",
    format: "",
    origin: "",
    decade: "",
    price: null as number | null,
    condition: "",
    condition_details: "",
    other_notes: "",
    description_html: "",
    image_url: "",
  });

  // Load listings and available posters
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [listingsRes, postersRes] = await Promise.all([
        client.api.fetch(`/api/ebay/listings?status=${activeTab}`),
        client.api.fetch("/api/ebay/available-posters"),
      ]);

      const listingsData = await listingsRes.json();
      const postersData = await postersRes.json();

      setListings(listingsData.listings || []);
      setPosters(postersData.posters || []);
    } catch (err: any) {
      console.error("Error loading data:", err);
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  // Auto-update decade when year changes
  useEffect(() => {
    if (formData.year) {
      const decade = getDecadeFromYear(formData.year);
      if (decade && decade !== formData.decade) {
        setFormData((prev) => ({ ...prev, decade }));
      }
    }
  }, [formData.year]);

  // Handle selecting a poster to list
  const handleSelectPoster = (poster: Poster) => {
    setFormData({
      poster_id: poster.id,
      title: poster.title || "",
      year: poster.year,
      director: poster.director || "",
      cast: poster.actors || "",
      format: poster.format || "",
      origin: poster.poster_country || "",
      decade: getDecadeFromYear(poster.year) || "",
      price: poster.price,
      condition: poster.condition_grade || "",
      condition_details: "",
      other_notes: "",
      description_html: "",
      image_url: poster.imageUrl || "",
    });
    setSelectedListing(null);
    setError(null);
    setSuccess(null);
  };

  // Handle selecting an existing listing for editing
  const handleSelectListing = (listing: EbayListing) => {
    setSelectedListing(listing);
    setFormData({
      poster_id: listing.poster_id,
      title: listing.title || "",
      year: listing.year,
      director: listing.director || "",
      cast: listing.cast || "",
      format: listing.format || "",
      origin: listing.origin || "",
      decade: listing.decade || "",
      price: listing.price,
      condition: listing.condition || "",
      condition_details: listing.condition_details || "",
      other_notes: listing.other_notes || "",
      description_html: listing.description_html || "",
      image_url: listing.image_url || "",
    });
    setError(null);
    setSuccess(null);
  };

  // Save listing (create or update)
  const handleSave = async () => {
    if (!formData.title) {
      setError("Title is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const endpoint = selectedListing
        ? `/api/ebay/listings/${selectedListing.id}`
        : "/api/ebay/listings";

      const method = selectedListing ? "PUT" : "POST";

      const res = await client.api.fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save listing");
      }

      setSuccess(
        selectedListing
          ? "Listing updated successfully"
          : "Listing created successfully"
      );

      if (!selectedListing && data.listing_id) {
        // Load the newly created listing
        const listingRes = await client.api.fetch(
          `/api/ebay/listings/${data.listing_id}`
        );
        const listingData = await listingRes.json();
        setSelectedListing(listingData.listing);
      }

      loadData();
    } catch (err: any) {
      console.error("Error saving listing:", err);
      setError(err.message || "Failed to save listing");
    } finally {
      setSaving(false);
    }
  };

  // Generate content with Gemini AI
  const handleGenerate = async () => {
    if (!selectedListing) {
      // Save first if new
      await handleSave();
      if (error) return;
    }

    const listingId = selectedListing?.id;
    if (!listingId) {
      setError("Please save the listing first");
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const res = await client.api.fetch(`/api/ebay/listings/${listingId}/generate`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate content");
      }

      setFormData((prev) => ({
        ...prev,
        description_html: data.generated.full_description || prev.description_html,
      }));

      setSuccess("Content generated successfully");
      loadData();
    } catch (err: any) {
      console.error("Error generating content:", err);
      setError(err.message || "Failed to generate content");
    } finally {
      setGenerating(false);
    }
  };

  // Publish listing to eBay
  const handlePublish = async () => {
    if (!selectedListing) {
      setError("Please save the listing first");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}/publish`,
        { method: "POST" }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to publish listing");
      }

      setSuccess(`Listing published! eBay Item ID: ${data.ebay_item_id}`);
      loadData();

      // Refresh selected listing
      const listingRes = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}`
      );
      const listingData = await listingRes.json();
      setSelectedListing(listingData.listing);
    } catch (err: any) {
      console.error("Error publishing listing:", err);
      setError(err.message || "Failed to publish listing");
    } finally {
      setSaving(false);
    }
  };

  // Withdraw/end listing
  const handleWithdraw = async () => {
    if (!selectedListing) return;

    if (!confirm("Are you sure you want to end this listing on eBay?")) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}/withdraw`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "NOT_AVAILABLE" }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to withdraw listing");
      }

      setSuccess("Listing withdrawn from eBay");
      loadData();

      // Refresh selected listing
      const listingRes = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}`
      );
      const listingData = await listingRes.json();
      setSelectedListing(listingData.listing);
    } catch (err: any) {
      console.error("Error withdrawing listing:", err);
      setError(err.message || "Failed to withdraw listing");
    } finally {
      setSaving(false);
    }
  };

  // Relist ended listing
  const handleRelist = async () => {
    if (!selectedListing) return;

    try {
      setSaving(true);
      setError(null);

      const res = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}/relist`,
        { method: "POST" }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to relist");
      }

      setSuccess("Listing relisted on eBay!");
      loadData();

      // Refresh selected listing
      const listingRes = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}`
      );
      const listingData = await listingRes.json();
      setSelectedListing(listingData.listing);
    } catch (err: any) {
      console.error("Error relisting:", err);
      setError(err.message || "Failed to relist");
    } finally {
      setSaving(false);
    }
  };

  // Delete listing
  const handleDelete = async () => {
    if (!selectedListing) return;

    if (!confirm("Are you sure you want to delete this listing?")) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const res = await client.api.fetch(
        `/api/ebay/listings/${selectedListing.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete listing");
      }

      setSelectedListing(null);
      setFormData({
        poster_id: null,
        title: "",
        year: null,
        director: "",
        cast: "",
        format: "",
        origin: "",
        decade: "",
        price: null,
        condition: "",
        condition_details: "",
        other_notes: "",
        description_html: "",
        image_url: "",
      });

      setSuccess("Listing deleted");
      loadData();
    } catch (err: any) {
      console.error("Error deleting listing:", err);
      setError(err.message || "Failed to delete listing");
    } finally {
      setSaving(false);
    }
  };

  // Clear form
  const handleNew = () => {
    setSelectedListing(null);
    setFormData({
      poster_id: null,
      title: "",
      year: null,
      director: "",
      cast: "",
      format: "",
      origin: "",
      decade: "",
      price: null,
      condition: "",
      condition_details: "",
      other_notes: "",
      description_html: "",
      image_url: "",
    });
    setError(null);
    setSuccess(null);
  };

  // Build Frame & Reel HTML template
  const buildTemplate = () => {
    const {
      title,
      year,
      origin,
      format,
      director,
      cast,
      condition,
      condition_details,
      gemini_synopsis,
      gemini_collector_note,
      other_notes,
    } = formData;

    const template = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
  <h2><b>${title || "[TITLE]"} (${year || "[YEAR]"}) ${origin || "[ORIGIN]"} ${format || "[FORMAT]"}</b></h2>
  <p><b>AUTHENTIC THEATRICAL ORIGINAL — NOT A REPLICA.</b></p>
  
  <p><b>FILM INFO:</b> ${director || "[Director]"} ${cast ? `• ${cast}` : ""}</p>
  <p><b>SYNOPSIS:</b> ${gemini_synopsis || "[Synopsis from Gemini]"}</p>
  
  <div style="background: #f9f9f9; padding: 15px; border-left: 5px solid #333;">
    <p><b>COLLECTOR'S NOTE:</b> ${gemini_collector_note || other_notes || "[Collector note]"}</p>
  </div>

  <p><b>CONDITION:</b> ${condition || "[Condition]"}. ${condition_details || "[Details]"}.</p>
  
  <hr>
  
  <p><b>SHIPPING:</b> Domestic $9.99 flat rate. Shipped rolled in heavy-duty PVC. International via eBay ISP.</p>
  <p><b>FRAME AND REEL:</b> I only sell authentic theatrical originals produced for cinema use.</p>
</div>`;

    setFormData((prev) => ({ ...prev, description_html: template }));
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-cream-50">
        <div className="animate-spin rounded-full h-12 w-12 border-burgundy-500 border-4"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-cream-50">
        <div className="text-center">
          <h2 className="text-2xl font-serif text-noir-800 mb-4">
            Admin Access Required
          </h2>
          <p className="text-noir-600">Please sign in to manage eBay listings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Header */}
      <header className="bg-noir-900 text-cream-50 py-4 px-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-gold-500" />
            <div>
              <h1 className="text-xl font-serif font-bold">Frame & Reel</h1>
              <p className="text-xs text-noir-400">eBay Command Bridge</p>
            </div>
          </div>
          <button
            onClick={handleNew}
            className="flex items-center gap-2 px-4 py-2 bg-burgundy-600 hover:bg-burgundy-700 rounded-lg transition-colors"
          >
            <Edit3 className="w-4 h-4" />
            New Listing
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-noir-200">
        <div className="flex px-6">
          {(["parse", "history", "draft", "active", "ended"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-medium capitalize transition-colors relative ${
                activeTab === tab
                  ? "text-burgundy-600"
                  : "text-noir-500 hover:text-noir-800"
              }`}
            >
              {tab}
              {tab === "draft" && listings.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-gold-500 text-white rounded-full">
                  {listings.length}
                </span>
              )}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-burgundy-600"></span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-140px)]">
        {/* Left Pane - Listings & Available Posters */}
        <div className="w-80 bg-white border-r border-noir-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-noir-200">
            <h3 className="font-semibold text-noir-800 flex items-center gap-2">
              {activeTab === "parse" && "Parse Listing"}
              {activeTab === "history" && "Listings History"}
              {activeTab === "draft" && "Available Posters"}
              {activeTab === "active" && "Active Listings"}
              {activeTab === "ended" && "Ended Listings"}
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-noir-500">Loading...</div>
            ) : activeTab === "draft" && !selectedListing ? (
              // Show available posters for draft tab when no listing selected
              <div className="p-2">
                {posters.length === 0 ? (
                  <p className="p-4 text-sm text-noir-500 text-center">
                    No available posters
                  </p>
                ) : (
                  posters.map((poster) => (
                    <button
                      key={poster.id}
                      onClick={() => handleSelectPoster(poster)}
                      className="w-full p-3 text-left hover:bg-cream-50 rounded-lg transition-colors"
                    >
                      <div className="flex gap-3">
                        {poster.imageUrl && (
                          <img
                            src={poster.imageUrl}
                            alt={poster.title || "Poster"}
                            className="w-12 h-16 object-cover rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-noir-800 truncate">
                            {poster.title || "Untitled"}
                          </p>
                          <p className="text-xs text-noir-500">
                            {poster.year} • {poster.poster_country}
                          </p>
                          {poster.price && (
                            <p className="text-sm font-semibold text-burgundy-600">
                              ${poster.price}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : listings.length === 0 ? (
              <p className="p-4 text-sm text-noir-500 text-center">
                No {activeTab} listings
              </p>
            ) : (
              <div className="p-2">
                {listings.map((listing) => (
                  <button
                    key={listing.id}
                    onClick={() => handleSelectListing(listing)}
                    className={`w-full p-3 text-left rounded-lg transition-colors mb-2 ${
                      selectedListing?.id === listing.id
                        ? "bg-burgundy-50 border border-burgundy-300"
                        : "hover:bg-cream-50 border border-transparent"
                    }`}
                  >
                    <div className="flex gap-3">
                      {listing.image_url && (
                        <img
                          src={listing.image_url}
                          alt={listing.title || "Listing"}
                          className="w-12 h-16 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-noir-800 truncate">
                          {listing.title || "Untitled"}
                        </p>
                        <p className="text-xs text-noir-500">
                          {listing.year} • {listing.format}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {listing.price && (
                            <span className="text-sm font-semibold text-burgundy-600">
                              ${listing.price}
                            </span>
                          )}
                          {listing.status === "active" && (
                            <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                              Active
                            </span>
                          )}
                          {listing.status === "ended" && (
                            <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">
                              Ended
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Pane - Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Status Messages */}
          {(error || success) && (
            <div
              className={`mx-4 mt-4 p-3 rounded-lg flex items-center gap-2 ${
                error
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-green-50 text-green-700 border border-green-200"
              }`}
            >
              {error ? (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              ) : (
                <Check className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm">{error || success}</span>
              <button
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                }}
                className="ml-auto p-1 hover:bg-noir-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Dual Pane Editor */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Inputs */}
            <div className="w-1/2 p-6 overflow-y-auto border-r border-noir-200">
              <div className="space-y-4">
                {/* Title Validator */}
                <TitleValidator
                  title={formData.title}
                  onChange={(title) =>
                    setFormData((prev) => ({ ...prev, title }))
                  }
                  director={formData.director}
                  cast={formData.cast}
                />

                {/* Year & Decade */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Year
                    </label>
                    <input
                      type="number"
                      value={formData.year || ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          year: e.target.value
                            ? parseInt(e.target.value)
                            : null,
                        }))
                      }
                      placeholder="1985"
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Decade
                    </label>
                    <select
                      value={formData.decade}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, decade: e.target.value }))
                      }
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    >
                      <option value="">Select decade</option>
                      {Object.values(DECADE_MAP).map((decade) => (
                        <option key={decade} value={decade}>
                          {decade}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Director & Cast */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Director
                    </label>
                    <input
                      type="text"
                      value={formData.director}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, director: e.target.value }))
                      }
                      placeholder="Sergio Leone"
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Cast
                    </label>
                    <input
                      type="text"
                      value={formData.cast}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, cast: e.target.value }))
                      }
                      placeholder="Clint Eastwood, Eli Wallach"
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    />
                  </div>
                </div>

                {/* Format & Origin */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Format
                    </label>
                    <select
                      value={formData.format}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, format: e.target.value }))
                      }
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    >
                      <option value="">Select format</option>
                      {FORMAT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Origin
                    </label>
                    <select
                      value={formData.origin}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, origin: e.target.value }))
                      }
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    >
                      <option value="">Select origin</option>
                      {ORIGIN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Price & Condition */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Price (USD)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-noir-400" />
                      <input
                        type="number"
                        step="0.01"
                        value={formData.price || ""}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            price: e.target.value
                              ? parseFloat(e.target.value)
                              : null,
                          }))
                        }
                        placeholder="99.99"
                        className="w-full pl-9 pr-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-noir-700 mb-1">
                      Condition
                    </label>
                    <select
                      value={formData.condition}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          condition: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                    >
                      <option value="">Select condition</option>
                      {CONDITION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Condition Details */}
                <div>
                  <label className="block text-sm font-medium text-noir-700 mb-1">
                    Condition Details
                  </label>
                  <textarea
                    value={formData.condition_details}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        condition_details: e.target.value,
                      }))
                    }
                    placeholder="Minor edge wear, small fold lines, etc."
                    rows={2}
                    className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                  />
                </div>

                {/* Other Notes (High Priority) */}
                <div>
                  <label className="block text-sm font-medium text-noir-700 mb-1">
                    <span className="text-burgundy-600">★</span> Other Notes{" "}
                    <span className="text-noir-400 font-normal">(Injected into Gemini prompt)</span>
                  </label>
                  <textarea
                    value={formData.other_notes}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        other_notes: e.target.value,
                      }))
                    }
                    placeholder="Linen backed by Studio City, Rare 1979 re-release artist Dante Manno, etc."
                    rows={3}
                    className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500 bg-gold-50"
                  />
                </div>

                {/* Image URL */}
                <div>
                  <label className="block text-sm font-medium text-noir-700 mb-1">
                    <ImageIcon className="w-4 h-4 inline mr-1" />
                    Image URL
                  </label>
                  <input
                    type="url"
                    value={formData.image_url}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, image_url: e.target.value }))
                    }
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-noir-200 rounded-lg focus:ring-2 focus:ring-burgundy-500"
                  />
                  {formData.image_url && (
                    <img
                      src={formData.image_url}
                      alt="Preview"
                      className="mt-2 h-32 object-contain rounded border border-noir-200"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Right: WYSIWYG Editor */}
            <div className="w-1/2 p-6 overflow-y-auto bg-cream-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-noir-800 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Listing Description
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={buildTemplate}
                    className="px-3 py-1.5 text-sm bg-noir-100 hover:bg-noir-200 rounded-lg transition-colors"
                  >
                    Insert Template
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gold-500 hover:bg-gold-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {generating ? "Generating..." : "Generate with AI"}
                  </button>
                </div>
              </div>

              <DescriptionEditor
                content={formData.description_html}
                onChange={(html) =>
                  setFormData((prev) => ({ ...prev, description_html: html }))
                }
                readOnly={selectedListing?.status === "active"}
              />
            </div>
          </div>

          {/* Action Bar */}
          <div className="bg-white border-t border-noir-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-burgundy-600 hover:bg-burgundy-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving..." : "Save Draft"}
                </button>

                {selectedListing?.status === "draft" && (
                  <button
                    onClick={handlePublish}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    {saving ? "Publishing..." : "Publish to eBay"}
                  </button>
                )}

                {selectedListing?.status === "active" && (
                  <button
                    onClick={handleWithdraw}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    End Listing
                  </button>
                )}

                {selectedListing?.status === "ended" && (
                  <button
                    onClick={handleRelist}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Relist
                  </button>
                )}

                {selectedListing?.item_web_url && (
                  <a
                    href={selectedListing.item_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-noir-100 hover:bg-noir-200 text-noir-700 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View on eBay
                  </a>
                )}
              </div>

              <div className="flex gap-2">
                {selectedListing && (
                  <>
                    {selectedListing.status === "draft" && (
                      <button
                        onClick={handleDelete}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Status Badge */}
            {selectedListing && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-noir-500">Status:</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    selectedListing.status === "draft"
                      ? "bg-yellow-100 text-yellow-700"
                      : selectedListing.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {selectedListing.status.toUpperCase()}
                </span>
                {selectedListing.ebay_item_id && (
                  <span className="text-noir-400">
                    eBay ID: {selectedListing.ebay_item_id}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

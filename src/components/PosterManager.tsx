import { createEdgeSpark } from "@edgespark/client";
import "@edgespark/client/styles.css";
import { useState, useEffect, useRef, useCallback } from "react";
import Tesseract from "tesseract.js";
import { MetadataModal, type BatchMetadata } from "./MetadataModal";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface Poster {
  id: number;
  imageId: number;
  title: string | null;
  year: number | null;
  director: string | null;
  actors: string | null;
  genre: string | null;
  plot: string | null;
  posterStyle: string | null;
  awards: string | null;
  status: string;
  price: number | null;
  condition: string | null;
  notes: string | null;
  imageUrl: string | null;
  createdAt: number;
  // Batch CRM fields
  lotNumber?: string | null;
  expectedPeriodStart?: number | null;
  expectedPeriodEnd?: number | null;
  posterCountry?: string | null;
  posterFormat?: string | null;
  conflictStatus?: string | null;
  conflictDetails?: string | null;
}

interface UploadItem {
  file: File;
  id: string;
  preview: string;
  status: "pending" | "uploading" | "splitting" | "scanning" | "done" | "error";
  shouldSplit: boolean;
  splitCount: number;
  images: { canvas: HTMLCanvasElement; index: number }[];
  posterIds: number[];
  error?: string;
  // Batch metadata for CRM
  metadata?: BatchMetadata;
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

  const signIn = async () => {
    const res = await client.auth.getSession();
    if (res.data?.user) {
      setUser(res.data.user);
      return;
    }
  };

  const signOut = async () => {
    await client.auth.signOut();
    setUser(null);
  };

  return { user, loading, signIn, signOut };
}

// ═══════════════════════════════════════════════════════════
// Image Splitter (Canvas-based)
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Upload Manager Component
// ═══════════════════════════════════════════════════════════

function UploadManager({ onRefresh }: { onRefresh: () => void }) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadSource, setUploadSource] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ═══════════════════════════════════════════════════════════
  // METADATA MODAL STATE
  // ═══════════════════════════════════════════════════════════
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ files: File[]; folderName: string | null }>({
    files: [],
    folderName: null,
  });
  const [batchMetadata, setBatchMetadata] = useState<BatchMetadata | null>(null);
  // Session memory for last used values
  const [lastUsedMetadata, setLastUsedMetadata] = useState({
    lotNumber: "",
    posterCountry: "",
    posterFormat: "",
  });

  const addFiles = (files: FileList | File[], folderName: string | null = null) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (imageFiles.length === 0) return;
    
    // Instead of directly adding, show the metadata modal
    setPendingFiles({ files: imageFiles, folderName });
    setShowMetadataModal(true);
  };

  const handleMetadataConfirm = (metadata: BatchMetadata) => {
    // Create upload items with the metadata
    const newUploads: UploadItem[] = pendingFiles.files.map((file) => ({
      file,
      id: crypto.randomUUID(),
      preview: URL.createObjectURL(file),
      status: "pending" as const,
      shouldSplit: false,
      splitCount: 2,
      images: [],
      posterIds: [],
      // Store metadata with each upload item
      metadata,
    }));
    
    setUploads((prev) => [...prev, ...newUploads]);
    setBatchMetadata(metadata);
    
    // Update session memory
    setLastUsedMetadata({
      lotNumber: metadata.lotNumber,
      posterCountry: metadata.posterCountry,
      posterFormat: metadata.posterFormat,
    });
    
    setShowMetadataModal(false);
    setPendingFiles({ files: [], folderName: null });
  };

  const toggleSplit = (id: string, enabled: boolean) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, shouldSplit: enabled } : u))
    );
  };

  const setSplitCount = (id: string, count: number) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, splitCount: count } : u))
    );
  };

  const processAll = async () => {
    const pending = uploads.filter((u) => u.status === "pending");
    for (const item of pending) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, status: "uploading" } : u
        )
      );
      await processUpload(item);
    }
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const processUpload = async (item: UploadItem) => {
    try {
      // Step 1: Upload original to R2
      const presignRes = await client.api.fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type,
        }),
      });
      const { uploadUrl, uploadId } = await presignRes.json();

      await fetch(uploadUrl, { method: "PUT", body: item.file });
      
      // Pass batch metadata to backend for CRM integration
      await client.api.fetch(`/api/uploads/${uploadId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          source_url: uploadSource || null,
          // Batch Ingest Metadata
          lot_number: item.metadata?.lotNumber || null,
          expected_era_start: item.metadata?.expectedEraStart || null,
          expected_era_end: item.metadata?.expectedEraEnd || null,
          poster_country: item.metadata?.posterCountry || null,
          poster_format: item.metadata?.posterFormat || null,
          batch_notes: item.metadata?.batchNotes || null,
        }),
      });

      // Step 2: Split if needed, or use image as-is
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id
            ? { ...u, status: item.shouldSplit ? "splitting" : "scanning" }
            : u
        )
      );

      let splitCanvases: HTMLCanvasElement[] = [];
      if (item.shouldSplit) {
        const img = await loadImage(item.file);
        splitCanvases = splitImage(img, item.splitCount);
      } else {
        // No split — create a canvas from the original image
        const img = await loadImage(item.file);
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        splitCanvases = [canvas];
      }

      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, images: splitCanvases } : u
        )
      );

      // Step 3: Upload each split to R2
      const splits: { path: string; index: number }[] = [];
      for (let i = 0; i < splitCanvases.length; i++) {
        const canvas = splitCanvases[i];
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9)
        );
        const ext = item.file.name.split(".").pop() || "jpg";
        const splitFilename = `${item.file.name.replace(
          `.${ext}`,
          ""
        )}_part${i + 1}.jpg`;

        const presignRes2 = await client.api.fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: splitFilename,
            contentType: "image/jpeg",
          }),
        });
        const { uploadUrl: splitUploadUrl, path: splitPath } =
          await presignRes2.json();

        await fetch(splitUploadUrl, {
          method: "PUT",
          body: blob,
        });

        splits.push({ path: splitPath, index: i });
      }

      // Step 4: Register splits with backend
      const splitsRes = await client.api.fetch(`/api/uploads/${uploadId}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splits }),
      });
      const { imageCount } = await splitsRes.json();

      // Step 5: OCR + TMDB scan (free), Gemini fallback
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, status: "scanning" } : u
        )
      );

      // Get poster IDs for this upload
      const postersRes = await client.api.fetch("/api/posters");
      const { posters: allPosters } = await postersRes.json();

      // The newly created posters are the most recent ones matching image count
      const newPosters = allPosters.slice(0, imageCount);
      const posterIds = newPosters.map((p: Poster) => p.id);

      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, posterIds } : u))
      );

      // Scan each: OCR first, Gemini fallback
      for (let i = 0; i < posterIds.length; i++) {
        const pid = posterIds[i];
        const canvas = item.images[i]?.canvas;

        try {
          // Step A: Run OCR on the split canvas (free, client-side)
          let ocrText = "";
          if (canvas) {
            const ocrResult = await Tesseract.recognize(
              canvas.toDataURL("image/png"),
              "eng",
              { logger: () => {} }
            );
            ocrText = ocrResult.data.text.trim();
          }

          // Step B: Try TMDB lookup with OCR text (free)
          if (ocrText.length > 2) {
            const ocrRes = await client.api.fetch(`/api/posters/${pid}/ocr-scan`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: ocrText }),
            });

            if (ocrRes.ok) {
              console.log(`✓ Poster ${pid} identified via OCR + TMDB: ${ocrText.substring(0, 40)}`);
              continue; // Success — skip Gemini
            }

            const ocrData = await ocrRes.json();
            if (!ocrData.needsFallback) {
              console.error(`OCR scan error for poster ${pid}:`, ocrData.error);
              continue;
            }
          }

          // Step C: Gemini fallback (only when OCR fails)
          console.log(`⚠ OCR failed for poster ${pid}, using Gemini fallback...`);
          await client.api.fetch(`/api/posters/${pid}/scan`, {
            method: "POST",
          });
        } catch (err) {
          console.error("Scan failed for poster", pid, err);
        }
      }

      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "done" } : u))
      );
      onRefresh();
    } catch (error: any) {
      console.error("Upload processing error:", error);
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id
            ? { ...u, status: "error", error: error.message }
            : u
        )
      );
    }
  };

  return (
    <div className="bg-white/90 rounded-2xl shadow-vintage-lg p-6 mb-8 border border-cream-300">
      <h3 className="font-display text-2xl text-noir-400 mb-4">
        Upload Posters
      </h3>

      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-burgundy-500 bg-burgundy-50"
            : "border-cream-400 hover:border-burgundy-300 hover:bg-cream-50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) {
            // Extract folder name from dropped items if available
            const items = e.dataTransfer.items;
            let folderName: string | null = null;
            if (items && items[0]) {
              const item = items[0];
              if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry?.isDirectory) {
                  folderName = entry.name;
                }
              }
            }
            addFiles(e.dataTransfer.files, folderName);
          }
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <svg
          className="mx-auto mb-3 w-12 h-12 text-cream-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-noir-300 font-body text-sm">
          <span className="text-burgundy-500 font-semibold">
            Click to upload
          </span>{" "}
          or drag and drop poster images
        </p>
      {/* Upload buttons */}
      <div className="flex gap-3 mt-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-burgundy-500 text-white rounded-lg font-body text-sm font-medium hover:bg-burgundy-600 transition-colors"
        >
          📁 Select Files
        </button>
        <button
          onClick={() => folderInputRef.current?.click()}
          className="px-4 py-2 bg-noir-50 text-noir-400 border border-cream-300 rounded-lg font-body text-sm font-medium hover:bg-noir-100 transition-colors"
        >
          📂 Select Folder
        </button>
      </div>
      <p className="text-noir-200 font-body text-xs mt-2">
        JPG, PNG, WEBP — drag & drop or select. Toggle split for side-by-side images.
      </p>
      
      {/* Source URL Field */}
      <div className="mt-3">
        <label className="block text-xs font-medium text-noir-200 mb-1">Source URL (optional)</label>
        <input
          type="url"
          value={uploadSource}
          onChange={(e) => setUploadSource(e.target.value)}
          placeholder="https://example.com/source or leave empty"
          className="w-full border border-cream-300 rounded-lg px-3 py-2 text-sm font-body focus:ring-2 focus:ring-burgundy-500/30 focus:border-burgundy-500"
        />
        <p className="text-[10px] text-noir-200 mt-1">Add a source link that will be associated with all uploaded images</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*"
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*"
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />
      </div>

      {/* Upload Queue & Progress */}
      {uploads.length > 0 && (
        <div className="mt-6">
          {/* Action bar */}
          <div className="flex items-center justify-between mb-4">
            <p className="font-body text-sm text-noir-400">
              {uploads.length} image{uploads.length !== 1 ? "s" : ""}
              {uploads.filter((u) => u.shouldSplit).length > 0 && (
                <span className="text-burgundy-500 ml-1">
                  ({uploads.filter((u) => u.shouldSplit).length} to split)
                </span>
              )}
            </p>
            {uploads.some((u) => u.status === "pending") && (
              <div className="flex items-center gap-2">
                <button
                  onClick={processAll}
                  className="px-4 py-2 bg-burgundy-500 text-white rounded-lg font-body text-sm font-medium hover:bg-burgundy-600 transition-colors"
                >
                  ⬆ Process All
                </button>
                <button
                  onClick={() => {
                    const pending = uploads.filter((u) => u.status === "pending");
                    const allSplit = pending.every((u) => u.shouldSplit);
                    pending.forEach((u) => toggleSplit(u.id, !allSplit));
                  }}
                  className="px-3 py-2 bg-white text-noir-300 border border-cream-300 rounded-lg font-body text-xs font-medium hover:border-burgundy-300 transition-colors"
                  title="Toggle split on all pending images"
                >
                  {uploads.filter((u) => u.status === "pending").every((u) => u.shouldSplit)
                    ? "✂ Unsplit All"
                    : "✂ Split All"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {uploads.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 bg-cream-50 rounded-xl p-4 border border-cream-200"
              >
                <img
                  src={item.preview}
                  alt=""
                  className="w-16 h-24 object-cover rounded-lg border border-cream-300"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-body text-sm text-noir-400 truncate">
                      {item.file.name}
                    </p>
                    {item.status === "pending" && (
                      <button
                        onClick={() => removeUpload(item.id)}
                        className="text-noir-200 hover:text-red-500 transition-colors text-lg leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Split toggle (only when pending) */}
                  {item.status === "pending" && (
                    <div className="flex items-center gap-3 mt-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.shouldSplit}
                          onChange={(e) =>
                            toggleSplit(item.id, e.target.checked)
                          }
                          className="w-4 h-4 rounded border-cream-400 text-burgundy-500 focus:ring-burgundy-500"
                        />
                        <span className="text-xs font-body text-noir-300">
                          Split image
                        </span>
                      </label>
                      {item.shouldSplit && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-body text-noir-200">
                            into
                          </span>
                          {[2, 3, 4].map((n) => (
                            <button
                              key={n}
                              onClick={() => setSplitCount(item.id, n)}
                              className={`w-6 h-6 rounded text-xs font-body font-medium transition-colors ${
                                item.splitCount === n
                                  ? "bg-burgundy-500 text-white"
                                  : "bg-white text-noir-300 border border-cream-300 hover:border-burgundy-300"
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                          <span className="text-xs font-body text-noir-200">
                            parts
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status badge */}
                  {item.status !== "pending" && (
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-body ${
                          item.status === "done"
                            ? "bg-green-100 text-green-700"
                            : item.status === "error"
                            ? "bg-red-100 text-red-700"
                            : "bg-gold-100 text-gold-700"
                        }`}
                      >
                        {item.status === "uploading" && "⬆ Uploading..."}
                        {item.status === "splitting" && "✂ Splitting..."}
                        {item.status === "scanning" && "🔍 Scanning..."}
                        {item.status === "done" && "✓ Complete"}
                        {item.status === "error" && "✗ Error"}
                      </span>
                      {item.images.length > 0 && (
                        <span className="text-xs text-noir-200 font-body">
                          {item.images.length} poster
                          {item.images.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Split preview */}
                  {item.images.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {item.images.map((img, i) => (
                        <img
                          key={i}
                          src={img.canvas.toDataURL()}
                          alt={`Part ${i + 1}`}
                          className="w-12 h-16 object-cover rounded border border-cream-300"
                        />
                      ))}
                    </div>
                  )}
                  {item.error && (
                    <p className="text-xs text-red-600 font-body mt-1">
                      {item.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* METADATA MODAL - The "Guard" at the door */}
      <MetadataModal
        isOpen={showMetadataModal}
        onClose={() => {
          setShowMetadataModal(false);
          setPendingFiles({ files: [], folderName: null });
        }}
        onConfirm={handleMetadataConfirm}
        pendingFiles={pendingFiles}
        lastUsed={lastUsedMetadata}
      />
    </div>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
// Poster Table
// ═══════════════════════════════════════════════════════════

function PosterTable({
  posters,
  onRefresh,
}: {
  posters: Poster[];
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Poster>>({});

  const startEdit = (poster: Poster) => {
    setEditingId(poster.id);
    setEditData({
      title: poster.title,
      year: poster.year,
      director: poster.director,
      actors: poster.actors,
      genre: poster.genre,
      condition: poster.condition,
      price: poster.price,
      notes: poster.notes,
      visibility: poster.visibility || "hidden",
    });
  };

  const saveEdit = async (id: number) => {
    await client.api.fetch(`/api/posters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditingId(null);
    onRefresh();
  };

  const deletePoster = async (id: number) => {
    if (!confirm("Delete this poster?")) return;
    await client.api.fetch(`/api/posters/${id}`, { method: "DELETE" });
    onRefresh();
  };

  const scanPoster = async (poster: Poster) => {
    // Try OCR + TMDB first (free)
    try {
      if (poster.imageUrl) {
        const imgRes = await fetch(poster.imageUrl);
        const blob = await imgRes.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);

        const ocrResult = await Tesseract.recognize(canvas, "eng", { logger: () => {} });
        const ocrText = ocrResult.data.text.trim();

        if (ocrText.length > 2) {
          const ocrRes = await client.api.fetch(`/api/posters/${poster.id}/ocr-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: ocrText }),
          });
          if (ocrRes.ok) {
            onRefresh();
            return; // Success
          }
        }
      }
    } catch (e) {
      console.warn("OCR scan failed, falling back to Gemini", e);
    }

    // Gemini fallback
    await client.api.fetch(`/api/posters/${poster.id}/scan`, { method: "POST" });
    onRefresh();
  };

  const statusColors: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    scanned: "bg-blue-100 text-blue-700",
    active: "bg-green-100 text-green-700",
  };

  const visibilityColors: Record<string, string> = {
    featured: "bg-gold-100 text-gold-700 border-gold-200",
    listed: "bg-blue-100 text-blue-700 border-blue-200",
    hidden: "bg-gray-100 text-gray-500 border-gray-200",
  };

  const quickToggleVisibility = async (poster: Poster) => {
    const next = poster.visibility === "featured" ? "listed" : poster.visibility === "listed" ? "hidden" : "featured";
    await client.api.fetch(`/api/posters/${poster.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    onRefresh();
  };



  if (posters.length === 0) {
    return (
      <div className="bg-white/90 rounded-2xl shadow-vintage-lg p-8 text-center border border-cream-300">
        <p className="font-body text-noir-300">
          No posters yet. Upload some images to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/90 rounded-2xl shadow-vintage-lg border border-cream-300 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="bg-noir-50 text-noir-400">
              <th className="text-left px-4 py-3 font-semibold">Image</th>
              <th className="text-left px-4 py-3 font-semibold">Title</th>
              <th className="text-left px-4 py-3 font-semibold">Year</th>
              <th className="text-left px-4 py-3 font-semibold">Director</th>
              <th className="text-left px-4 py-3 font-semibold">Genre</th>
              <th className="text-left px-4 py-3 font-semibold">Price</th>
              <th className="text-left px-4 py-3 font-semibold">Visibility</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-left px-4 py-3 font-semibold">CRM</th>
              <th className="text-right px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posters.map((poster) => (
              <tr
                key={poster.id}
                className={`border-t border-cream-200 hover:bg-cream-50/50 ${
                  poster.conflictStatus && poster.conflictStatus !== "none"
                    ? "bg-amber-50/30 border-l-4 border-l-amber-400"
                    : ""
                }`}
              >
                <td className="px-4 py-3">
                  {poster.imageUrl ? (
                    <img
                      src={poster.imageUrl}
                      alt=""
                      className="w-12 h-16 object-cover rounded border border-cream-300"
                    />
                  ) : (
                    <div className="w-12 h-16 bg-cream-100 rounded border border-cream-300" />
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === poster.id ? (
                    <input
                      type="text"
                      value={editData.title || ""}
                      onChange={(e) =>
                        setEditData({ ...editData, title: e.target.value })
                      }
                      className="border border-cream-300 rounded px-2 py-1 text-sm w-full"
                    />
                  ) : (
                    <span className="text-noir-400 font-medium">
                      {poster.title || "Unknown"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-noir-300">
                  {editingId === poster.id ? (
                    <input
                      type="number"
                      value={editData.year || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          year: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="border border-cream-300 rounded px-2 py-1 text-sm w-20"
                    />
                  ) : (
                    poster.year || "—"
                  )}
                </td>
                <td className="px-4 py-3 text-noir-300">{poster.director || "—"}</td>
                <td className="px-4 py-3 text-noir-300">{poster.genre || "—"}</td>
                <td className="px-4 py-3 text-noir-300">
                  {editingId === poster.id ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editData.price || ""}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          price: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="border border-cream-300 rounded px-2 py-1 text-sm w-20"
                    />
                  ) : poster.price ? (
                    `$${poster.price.toFixed(2)}`
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId === poster.id ? (
                    <select
                      value={editData.visibility || "hidden"}
                      onChange={(e) =>
                        setEditData({ ...editData, visibility: e.target.value })
                      }
                      className="border border-cream-300 rounded px-2 py-1 text-xs"
                    >
                      <option value="featured">⭐ Featured</option>
                      <option value="listed">📋 Listed</option>
                      <option value="hidden">🔒 Hidden</option>
                    </select>
                  ) : (
                    <button
                      onClick={() => quickToggleVisibility(poster)}
                      className={`px-2 py-0.5 rounded-full text-xs border cursor-pointer hover:opacity-80 transition-opacity ${visibilityColors[poster.visibility || "hidden"]}`}
                      title="Click to cycle: Featured → Listed → Hidden"
                    >
                      {poster.visibility === "featured" ? "⭐ Featured" : poster.visibility === "listed" ? "📋 Listed" : "🔒 Hidden"}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs ${statusColors[poster.status] || statusColors.pending}`}
                  >
                    {poster.status}
                  </span>
                </td>
                {/* Conflict Badge Column */}
                <td className="px-4 py-3">
                  {poster.conflictStatus && poster.conflictStatus !== "none" ? (
                    <div className="flex flex-col gap-1">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 border border-amber-200 animate-pulse">
                        ⚠️ {poster.conflictStatus === "era_mismatch" ? "Era Mismatch" : poster.conflictStatus === "country_mismatch" ? "Country Mismatch" : "Conflict"}
                      </span>
                      {poster.lotNumber && (
                        <span className="text-xs text-noir-200">Lot #{poster.lotNumber}</span>
                      )}
                    </div>
                  ) : poster.lotNumber ? (
                    <span className="text-xs text-noir-200">Lot #{poster.lotNumber}</span>
                  ) : (
                    <span className="text-noir-200">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {poster.status === "pending" && (
                      <button
                        onClick={() => scanPoster(poster)}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                        title="Scan (OCR + TMDB, Gemini fallback)"
                      >
                        🔍
                      </button>
                    )}
                    {editingId === poster.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(poster.id)}
                          className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(poster)}
                          className="px-2 py-1 text-xs bg-gold-50 text-gold-700 rounded hover:bg-gold-100"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deletePoster(poster.id)}
                          className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main App
// ═══════════════════════════════════════════════════════════

export default function PosterManagerApp() {
  const { user, loading, signIn, signOut } = useAuth();
  const [posters, setPosters] = useState<Poster[]>([]);
  const [activeTab, setActiveTab] = useState<"upload" | "manage">("upload");
  const [loadingPosters, setLoadingPosters] = useState(false);

  const fetchPosters = useCallback(async () => {
    setLoadingPosters(true);
    try {
      const res = await client.api.fetch("/api/posters");
      const data = await res.json();
      setPosters(data.posters);
    } catch (err) {
      console.error("Failed to fetch posters:", err);
    }
    setLoadingPosters(false);
  }, []);

  useEffect(() => {
    if (user) fetchPosters();
  }, [user, fetchPosters]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="text-noir-300 font-body">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-vintage-lg p-8 max-w-md w-full border border-cream-300">
          <div className="text-center mb-6">
            <h2 className="font-display text-3xl text-noir-400 mb-2">
              Frame & Reel
            </h2>
            <p className="font-body text-noir-300 text-sm">
              Sign in to manage your poster inventory
            </p>
          </div>
          <div
            ref={(el) => {
              if (el) {
                client.auth
                  .renderAuthUI(el, {
                    redirectTo: window.location.href,
                  })
                  .catch(console.error);
              }
            }}
            style={{ width: "100%", maxWidth: 420, minHeight: 320 }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-50">
      {/* Header */}
      <header className="bg-noir-50/80 backdrop-blur-sm border-b border-cream-300 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-display text-2xl text-noir-400">
              Frame & Reel
            </h1>
            <span className="text-xs font-typewriter text-noir-200 uppercase tracking-widest border border-cream-300 px-2 py-0.5 rounded">
              Inventory Manager
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-body text-noir-300">
              {user.email}
            </span>
            <button
              onClick={signOut}
              className="text-sm font-body text-burgundy-500 hover:text-burgundy-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-white rounded-xl p-1 shadow-vintage border border-cream-300 w-fit">
          <button
            onClick={() => setActiveTab("upload")}
            className={`px-6 py-2 rounded-lg font-body text-sm font-medium transition-colors ${
              activeTab === "upload"
                ? "bg-burgundy-500 text-white shadow-sm"
                : "text-noir-300 hover:text-noir-400"
            }`}
          >
            ⬆ Upload & Scan
          </button>
          <button
            onClick={() => {
              setActiveTab("manage");
              fetchPosters();
            }}
            className={`px-6 py-2 rounded-lg font-body text-sm font-medium transition-colors ${
              activeTab === "manage"
                ? "bg-burgundy-500 text-white shadow-sm"
                : "text-noir-300 hover:text-noir-400"
            }`}
          >
            📋 Manage Posters
            {posters.length > 0 && (
              <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded-full text-xs">
                {posters.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === "upload" && (
          <UploadManager onRefresh={fetchPosters} />
        )}

        {activeTab === "manage" && (
          <>
            {loadingPosters ? (
              <div className="text-center py-12 font-body text-noir-300">
                Loading posters...
              </div>
            ) : (
              <PosterTable posters={posters} onRefresh={fetchPosters} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

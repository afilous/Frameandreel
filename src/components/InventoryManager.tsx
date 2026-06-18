import { useState, useEffect, useCallback } from "react";
import { createEdgeSpark } from "@edgespark/client";
import MediaLibrary from "./MediaLibrary";
import BlogEditor from "./BlogEditor";

const client = createEdgeSpark({
  baseUrl: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud",
});

interface InventoryItem {
  release_year?: number | null;
  id: number;
  title: string;
  year: number | null;
  director: string | null;
  format: string | null;
  poster_country: string | null;
  genre: string | null;
  actors: string | null;
  artist: string | null;
  dimensions: string | null;
  ds_ss: string | null;
  item_number: string | null;
  sold: number;
  visibility: string;
  source_url: string | null;
  notes: string | null;
  price: number | null;
  condition_grade: string | null;
  created_at: number;
  updated_at: number;
  ebay_item_id: string | null;
  ebay_price: number | null;
  ebay_status: string | null;
  pricing_markup: number | null;
  [key: string]: any;
}


function AnalyticsTab() {
  const lookerUrl = typeof __LOOKER_STUDIO_URL__ !== 'undefined'
    ? __LOOKER_STUDIO_URL__
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Analytics</h2>
        <a
          href="https://datastudio.google.com/reporting/5e8910bf-5ca0-40ab-a3a9-444927c08205"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "13px", color: "#8B1A1A", textDecoration: "none" }}
        >
          Open in Data Studio →
        </a>
      </div>
      {lookerUrl ? (
        <iframe
          src={lookerUrl}
          style={{ flex: 1, width: "100%", border: "none", minHeight: "800px" }}
          allowFullScreen
        />
      ) : (
        <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
          <p>Analytics URL not configured. Add LOOKER_STUDIO_URL to YouWare secrets.</p>
        </div>
      )}
    </div>
  );
}

export default function InventoryManager() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterFormat, setFilterFormat] = useState("");
  const [filterLotId, setFilterLotId] = useState("");
  const [filterVisibility, setFilterVisibility] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterDirector, setFilterDirector] = useState("");
  const [filterYearFrom, setFilterYearFrom] = useState("");
  const [filterYearTo, setFilterYearTo] = useState("");
  const [filterDecade, setFilterDecade] = useState("");
  const [filterTags, setFilterTags] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [batchCountry, setBatchCountry] = useState("");
  const [batchPrice, setBatchPrice] = useState("");
  const [inlinePriceEdit, setInlinePriceEdit] = useState<{ id: number; value: string } | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchVis, setBatchVis] = useState("featured");
  const [batchFormat, setBatchFormat] = useState("");
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, any>>({ title: "", year: "", director: "", actors: "", format: "", item_number: "", price: "", condition_grade: "", notes: "" });
  const [creating, setCreating] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [activeTab, setActiveTab] = useState<"inventory" | "media" | "blog" | "ebay" | "orders" | "sheets" | "import">("inventory");

  // Bulk Import state
  const [importMode, setImportMode] = useState<"append" | "patch" | "replace">("append");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importData, setImportData] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number; skipped: number; errors: string[] } | null>(null);
  const [importStats, setImportStats] = useState<{ total: number; available: number; sold: number } | null>(null);

  // Google Sheets state - Service Account Handshake
  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState("");
  const [sheetsValidation, setSheetsValidation] = useState<{
    canAccess: boolean;
    serviceAccountEmail: string;
    spreadsheetTitle?: string;
    availableSheets?: string[];
    instruction?: string;
    error?: string;
  } | null>(null);
  const [sheetsValidating, setSheetsValidating] = useState(false);
  const [sheetsConnectionStatus, setSheetsConnectionStatus] = useState<{
    status: "disconnected" | "connecting" | "active" | "error";
    hasEditorAccess: boolean;
    canSync: boolean;
    serviceAccountEmail: string;
    lastValidated?: number;
    error?: string;
  }>({ status: "disconnected", hasEditorAccess: false, canSync: false, serviceAccountEmail: "" });
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState<number | null>(null);

  // Merge state
  const [mergeModal, setMergeModal] = useState<{ show: boolean; keep: any; merge: any }>({ show: false, keep: null, merge: null });
  const [duplicates, setDuplicates] = useState<{ key: string; items: any[] }[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [showDupPanel, setShowDupPanel] = useState(false);
  const [ebayDuplicates, setEbayDuplicates] = useState<any[]>([]);
  const [enhancedMode, setEnhancedMode] = useState(false);

  // eBay state
  const [ebaySeller, setEbaySeller] = useState("poster_child-1");
  const [ebayQuery, setEbayQuery] = useState("");
  const [ebayListings, setEbayListings] = useState<any[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayPulling, setEbayPulling] = useState(false);
  const [ebayTotal, setEbayTotal] = useState(0);
  const [ebayAlreadyLinked, setEbayAlreadyLinked] = useState(0);
  const [ebayLinking, setEbayLinking] = useState<number | null>(null);
  const [ebayCreating, setEbayCreating] = useState<string | null>(null);
  const [ebayBulkCreating, setEbayBulkCreating] = useState(false);
  const [ebayAutoMatching, setEbayAutoMatching] = useState(false);
  const [autoMatchResults, setAutoMatchResults] = useState<any>(null);
  const [selectedMatches, setSelectedMatches] = useState<Map<string, number>>(new Map());
  const [batchLoading, setBatchLoading] = useState(false);

  const toggleMatch = (ebayId: string, inventoryId: number) => {
    setSelectedMatches(prev => {
      const next = new Map(prev);
      next.has(ebayId) ? next.delete(ebayId) : next.set(ebayId, inventoryId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedMatches.size === pendingMatches.length) {
      setSelectedMatches(new Map());
    } else {
      const all = new Map(pendingMatches.map((m: any) => [m.ebay?.ebayItemId, m.inventory?.id]));
      setSelectedMatches(all);
    }
  };

  const handleBatchConfirm = async () => {
    setBatchLoading(true);
    const matches = Array.from(selectedMatches.entries()).map(([ebayId, inventoryId]) => ({
      ebay_item_id: ebayId,
      inventory_id: inventoryId,
    }));
    try {
      const res = await client.api.fetch("/api/ebay/batch-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      const data = await res.json();
      // Update local state
      fetchItems();
      setEbayListings(prev => prev.map(l => {
        const match = matches.find(m => m.ebay_item_id === l.ebayItemId);
        if (match) {
          return { ...l, linked: true, linkedInventoryId: match.inventory_id };
        }
        return l;
      }));
      setSelectedMatches(new Map());
      setAutoMatchResults(null);
      setPendingMatches([]);
    } catch (err) {
      console.error(err);
    }
    setBatchLoading(false);
  };

  const [pendingMatches, setPendingMatches] = useState<any[]>([]);
  const [unmatchedEbay, setUnmatchedEbay] = useState<any[]>([]);
  const [ebayPriceMarkup, setEbayPriceMarkup] = useState(0.9);
  const [ebaySyncingPrices, setEbaySyncingPrices] = useState(false);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayUsername, setEbayUsername] = useState<string | null>(null);
  const [ebayPublishing, setEbayPublishing] = useState<number | null>(null);
  const [ebayError, setEbayError] = useState<string | null>(null);
  const [matchPanelEbayId, setMatchPanelEbayId] = useState<string | null>(null);
  const [suggestedMatches, setSuggestedMatches] = useState<any[]>([]);
  const [manualMatchSearch, setManualMatchSearch] = useState("");
  const [manualMatchResults, setManualMatchResults] = useState<any[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);

  // Orders state
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersSyncing, setOrdersSyncing] = useState(false);
  const [ordersFilter, setOrdersFilter] = useState("");
  const [ordersStats, setOrdersStats] = useState<any>({});

  // Bundle state
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleForm, setBundleForm] = useState({ title: "", notes: "", ebayBundleUrl: "", price: "", itemNumber: "" });
  const [creatingBundle, setCreatingBundle] = useState(false);
  const [bundleDetailId, setBundleDetailId] = useState<number | null>(null);
  const [bundleDetail, setBundleDetail] = useState<any>(null);
  const [bundleDetailLoading, setBundleDetailLoading] = useState(false);
  const [itemBundles, setItemBundles] = useState<Record<number, any[]>>({});
  const [bundlesLoading, setBundlesLoading] = useState(false);

  // eBay: Check auth status on load
  const checkEbayAuth = useCallback(async () => {
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-auth-status");
      if (res.ok) {
        const data = await res.json();
        setEbayConnected(data.connected);
        setEbayUsername(data.seller_username);
      }
    } catch { /* ignore */ }
  }, []);

  // eBay: Connect account
  const connectEbay = async () => {
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-auth-url");
      if (res.ok) {
        const data = await res.json();
        window.open(data.authUrl, "_blank", "width=600,height=700");
        // Show debug info in console for troubleshooting
        if (data._debug) {
          console.log("[eBay OAuth Debug]", data._debug);
        }
        setTimeout(checkEbayAuth, 5000);
        setTimeout(checkEbayAuth, 10000);
        setTimeout(checkEbayAuth, 15000);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to get eBay auth URL");
      }
    } catch (err) { console.error(err); }
  };

  // eBay: Disconnect
  const disconnectEbay = async () => {
    if (!confirm("Disconnect your eBay seller account?")) return;
    await client.api.fetch("/api/inventory-admin/ebay-disconnect", { method: "POST" });
    setEbayConnected(false);
    setEbayUsername(null);
  };

  // eBay: Publish inventory item to eBay
  const publishToEbay = async (id: number) => {
    if (!ebayConnected) {
      alert("Connect your eBay account first (click the Connect button in the eBay tab).");
      return;
    }
    if (!confirm("Publish this item to eBay as a new listing?")) return;
    setEbayPublishing(id);
    try {
      const res = await client.api.fetch(`/api/inventory-admin/${id}/publish-ebay`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Published! eBay listing ID: ${data.listingId}\n${data.ebayUrl || ""}`);
        fetchItems();
      } else {
        const err = await res.json();
        alert(`Publish failed: ${err.error}\n${err.details ? "\nDetails: " + err.details : ""}`);
      }
    } catch (err) { console.error(err); alert("Publish failed."); }
    setEbayPublishing(null);
  };

  // Orders: Fetch stats
  const fetchOrderStats = useCallback(async () => {
    try {
      const res = await client.api.fetch("/api/inventory-admin/orders-stats");
      if (res.ok) setOrdersStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  // Bulk Import: Parse CSV file
  const parseCSV = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());
      if (lines.length < 2) {
        alert("CSV file must have a header row and at least one data row");
        return;
      }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      const data = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((header, i) => {
          row[header] = values[i] || "";
        });
        return row;
      });
      setImportData(data);
    };
    reader.readAsText(file);
  }, []);

  // Bulk Import: Handle import
  const handleBulkImport = useCallback(async () => {
    if (importData.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await client.api.fetch("/api/inventory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: importData, mode: importMode }),
      });
      if (res.ok) {
        const result = await res.json();
        setImportResult(result);
        fetchImportStats();
        fetchItems();
      } else {
        const err = await res.json();
        alert(err.error || "Import failed");
      }
    } catch (err) { console.error(err); alert("Import failed"); }
    setImporting(false);
  }, [importData, importMode]);

  // Bulk Import: Fetch stats
  const fetchImportStats = useCallback(async () => {
    try {
      const res = await client.api.fetch("/api/inventory/stats");
      if (res.ok) {
        const data = await res.json();
        setImportStats({ total: data.total || 0, available: data.available || 0, sold: data.sold || 0 });
      }
    } catch { /* ignore */ }
  }, []);

  // Load import stats when switching to import tab
  useEffect(() => {
    if (activeTab === "import") {
      fetchImportStats();
    }
  }, [activeTab, fetchImportStats]);

  // Orders: Fetch orders
  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (ordersFilter) params.set("status", ordersFilter);
      const res = await client.api.fetch(`/api/inventory-admin/orders?${params}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        setOrdersTotal(data.total || 0);
      }
    } catch { /* ignore */ }
    setOrdersLoading(false);
  }, [ordersFilter]);

  // Orders: Sync from eBay
  const syncEbayOrders = async () => {
    if (!ebayConnected) {
      alert("Connect your eBay account first.");
      return;
    }
    setOrdersSyncing(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-orders-sync", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Synced ${data.synced} orders from eBay.`);
        fetchOrders();
        fetchOrderStats();
      } else {
        const err = await res.json();
        alert(`Sync failed: ${err.error}`);
      }
    } catch { alert("Order sync failed."); }
    setOrdersSyncing(false);
  };

  // Orders: Update status
  const updateOrderStatus = async (id: number, status: string) => {
    try {
      await client.api.fetch(`/api/inventory-admin/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      fetchOrders();
      fetchOrderStats();
    } catch { console.error("Failed to update order"); }
  };

  // Bundle: Create bundle from selected items
  const createBundle = async () => {
    if (selectedIds.size < 2) { alert("Select at least 2 items to create a bundle."); return; }
    if (!bundleForm.title.trim()) { alert("Bundle title is required."); return; }
    setCreatingBundle(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin/bundles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: bundleForm.title.trim(),
          childIds: Array.from(selectedIds),
          notes: bundleForm.notes.trim() || undefined,
          ebayBundleUrl: bundleForm.ebayBundleUrl.trim() || undefined,
          price: bundleForm.price ? parseFloat(bundleForm.price) : undefined,
          itemNumber: bundleForm.itemNumber.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowBundleModal(false);
        setBundleForm({ title: "", notes: "", ebayBundleUrl: "", price: "", itemNumber: "" });
        setSelectedIds(new Set());
        fetchItems();
        alert(`Bundle "${data.bundle.title}" created with ${data.children.length} items (ID: ${data.bundle.id})`);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create bundle");
      }
    } catch (err: any) { alert(err.message || "Failed to create bundle"); }
    setCreatingBundle(false);
  };

  // Bundle: Fetch bundle detail
  const fetchBundleDetail = async (bundleId: number) => {
    setBundleDetailLoading(true);
    setBundleDetailId(bundleId);
    try {
      const res = await client.api.fetch(`/api/inventory-admin/bundles/${bundleId}`);
      if (res.ok) {
        setBundleDetail(await res.json());
      }
    } catch (e) { console.error(e); }
    setBundleDetailLoading(false);
  };

  // Bundle: Delete bundle
  const deleteBundle = async (bundleId: number) => {
    if (!confirm("Delete this bundle? The child items will remain in your inventory.")) return;
    await client.api.fetch(`/api/inventory-admin/bundles/${bundleId}`, { method: "DELETE" });
    setBundleDetailId(null);
    setBundleDetail(null);
    fetchItems();
  };

  // Bundle: Remove child from bundle
  const removeChildFromBundle = async (bundleId: number, childId: number) => {
    await client.api.fetch(`/api/inventory-admin/bundles/${bundleId}/items/${childId}`, { method: "DELETE" });
    fetchBundleDetail(bundleId);
    fetchItems();
  };

  // Bundle: Check which bundles contain items on current page
  const fetchItemBundles = useCallback(async (itemIds: number[]) => {
    if (itemIds.length === 0) return;
    try {
      const results: Record<number, any[]> = {};
      await Promise.all(itemIds.map(async (id) => {
        const res = await client.api.fetch(`/api/inventory-admin/items/${id}/bundles`);
        if (res.ok) {
          const data = await res.json();
          if (data.bundles?.length > 0) results[id] = data.bundles;
        }
      }));
      setItemBundles(results);
    } catch { /* ignore */ }
  }, []);

  // Load item bundles when items change
  useEffect(() => {
    if (items.length > 0 && activeTab === "inventory") {
      fetchItemBundles(items.map(i => i.id));
    }
  }, [items, activeTab, fetchItemBundles]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterFormat) params.set("format", filterFormat);
      if (filterLotId) params.set("lot_id", filterLotId);
      if (filterVisibility) params.set("visibility", filterVisibility);
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      if (filterFormat) params.set("format", filterFormat);
      if (filterLotId) params.set("lot_id", filterLotId);
      if (filterVisibility) params.set("visibility", filterVisibility);
      if (filterSource) params.set("source", filterSource);
      if (filterDirector) params.set("director", filterDirector);
      if (filterYearFrom) params.set("year_from", filterYearFrom);
      if (filterYearTo) params.set("year_to", filterYearTo);
      if (filterDecade) params.set("decade", filterDecade);
      if (filterTags) params.set("tags", filterTags);
      if (sortBy) params.set("sort", sortBy);

      const res = await client.api.fetch(`/api/inventory-admin?${params}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text || res.statusText}`);
      }
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error("Failed to fetch inventory:", err);
      setError(err.message || String(err));
    }
    setLoading(false);
  }, [search, filterFormat, filterLotId, filterVisibility, page, filterSource, filterDirector, filterYearFrom, filterYearTo, filterDecade, filterTags, sortBy]);

  // Load data on mount
  useEffect(() => { fetchItems(); checkEbayAuth(); }, [fetchItems, checkEbayAuth]);

  // Toggle select
  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  const selectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(i => i.id)));
  };

  // Batch visibility update
  const handleBatchVisibility = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await client.api.fetch("/api/inventory-admin/batch-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), visibility: batchVis }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        fetchItems();
      }
    } catch (err) { console.error(err); }
  };

  // Batch format + country update
  const handleBatchFormat = async () => {
    if (selectedIds.size === 0 || !batchFormat) return;
    try {
      const updates: Record<string, string> = {};
      if (batchFormat === "French Petite" || batchFormat === "French Moyenne" || batchFormat === "French Grande") {
        updates.format = batchFormat;
        updates.poster_country = "France";
      } else if (batchFormat === "Locandina" || batchFormat === "Due Fogli" || batchFormat === "4-Fogli" || batchFormat === "6-Fogli") {
        updates.format = batchFormat;
        updates.poster_country = "Italy";
      } else {
        updates.format = batchFormat;
      }
      const res = await client.api.fetch("/api/inventory-admin/batch-update-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: Array.from(selectedIds), updates }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedIds(new Set());
        setBatchFormat("");
        fetchItems();
      }
    } catch (err) { console.error(err); }
  };

  // Batch delete selected items - offers both soft delete and permanent delete options
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    
    const choice = confirm(`Click OK to SOFT DELETE (archive) ${selectedIds.size} items.\n\nClick Cancel to PERMANENTLY DELETE (irreversible).`);
    
    if (choice) {
      // Soft delete (archive)
      try {
        const res = await client.api.fetch("/api/inventory-admin/batch-soft-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        });
        if (res.ok) {
          setSelectedIds(new Set());
          fetchItems();
          alert(`Soft deleted ${selectedIds.size} items`);
        }
      } catch (err) { console.error(err); }
    } else {
      // Check if they really want permanent delete
      if (!confirm(`Are you sure you want to PERMANENTLY DELETE ${selectedIds.size} items? This cannot be undone!`)) return;
      try {
        const res = await client.api.fetch("/api/inventory-admin/batch/permanent", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: Array.from(selectedIds) }),
        });
        if (res.ok) {
          setSelectedIds(new Set());
          fetchItems();
          alert(`Permanently deleted ${selectedIds.size} items`);
        }
      } catch (err) { console.error(err); }
    }
  };

  // Batch price update
  const handleBatchPrice = async () => {
    if (selectedIds.size === 0 || !batchPrice) return;
    const price = parseFloat(batchPrice);
    if (isNaN(price) || price < 0) { alert("Please enter a valid price"); return; }
    try {
      const res = await client.api.fetch("/api/inventory-admin/batch-update-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: Array.from(selectedIds), updates: { price } }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setBatchPrice("");
        fetchItems();
      }
    } catch (err) { console.error(err); }
  };

  // Inline price save
  const saveInlinePrice = async (id: number, value: string) => {
    const price = value === "" ? null : parseFloat(value);
    if (price !== null && isNaN(price)) { setInlinePriceEdit(null); return; }
    try {
      await client.api.fetch(`/api/inventory-admin/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      fetchItems();
    } catch (err) { console.error(err); }
    setInlinePriceEdit(null);
  };

  // Batch update country of origin
  const handleBatchCountry = async () => {
    if (selectedIds.size === 0 || !batchCountry) return;
    try {
      const res = await client.api.fetch("/api/inventory-admin/batch-country", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), poster_country: batchCountry }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setBatchCountry("");
        fetchItems();
        alert(`Updated country for ${selectedIds.size} items`);
      }
    } catch (err) { console.error(err); }
  };

  const toggleVisibility = async (item: InventoryItem) => {
    // Cycle: featured -> listed -> unlisted
    const next = item.visibility === "featured" ? "listed" : item.visibility === "listed" ? "unlisted" : "featured";
    try {
      await client.api.fetch(`/api/inventory-admin/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      fetchItems();
    } catch (err) { console.error(err); }
  };

  // Toggle sold (auto-ends eBay listing if marking as sold)
  const toggleSold = async (item: InventoryItem) => {
    const markingSold = item.sold !== 1;
    try {
      const res = await client.api.fetch(`/api/inventory-admin/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sold: markingSold ? 1 : 0 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (markingSold && data.ebay_end) {
          if (data.ebay_end.success) {
            alert(`Marked as sold. ${data.ebay_end.message}`);
          } else {
            alert(`Marked as sold, but could not end eBay listing:\n${data.ebay_end.message}`);
          }
        }
      }
      fetchItems();
    } catch (err) { console.error(err); }
  };

  // Edit item
  // Create new inventory item
  const createItem = async () => {
    if (!addForm.title?.trim() || !addForm.item_number?.trim()) { alert("Title and Item Number are required."); return; }
    setCreating(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        setShowAddForm(false);
        setAddForm({ title: "", year: "", director: "", actors: "", format: "", item_number: "", price: "", condition_grade: "", notes: "" });
        fetchItems();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create item");
      }
    } catch (err: any) { alert(err.message); }
    setCreating(false);
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setEditForm({
      title: item.title,
      year: item.year,
      director: item.director,
      format: item.format,
      poster_country: item.poster_country,
      genre: item.genre,
      price: item.price,
      condition_grade: item.condition_grade,
      dimensions: item.dimensions,
      notes: item.notes,
      artist: item.artist,
      actors: item.actors,
      ebay_item_id: item.ebay_item_id,
      ebay_price: item.ebay_price,
      pricing_markup: item.pricing_markup || 0.9,
    });
  };
  const saveEdit = async () => {
    if (!editingItem) return;
    try {
      const res = await client.api.fetch(`/api/inventory-admin/${editingItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      console.log("Save response:", res.status, res.statusText);
      if (!res.ok) {
        const errText = await res.text();
        console.error("Save error:", errText);
        alert("Failed to save: " + res.status);
        return;
      }
      const data = await res.json();
      console.log("Saved data:", data);
      alert("Changes saved successfully!");
      setEditingItem(null);
      setTimeout(() => fetchItems(), 500);
    } catch (err) { console.error(err); alert("Failed to save changes"); }
  };

  // Upload image
  const uploadImage = async (itemId: number, file: File) => {
    setUploadingId(itemId);
    setUploadProgress("Requesting upload...");
    try {
      const presignRes = await client.api.fetch(`/api/inventory-admin/${itemId}/upload-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const presignData = await presignRes.json();

      setUploadProgress("Uploading image...");
      await fetch(presignData.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      setUploadProgress("Confirming...");
      const confirmRes = await client.api.fetch(`/api/inventory-admin/${itemId}/confirm-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Uri: presignData.s3Uri }),
      });
      if (confirmRes.ok) {
        fetchItems();
        setUploadProgress("");
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadProgress("Upload failed");
    }
    setUploadingId(null);
  };

  // Delete item - offers both soft delete (archive) and permanent delete options
  const deleteItem = async (id: number) => {
    const choice = confirm("Click OK to SOFT DELETE (archive) this item.\n\nClick Cancel to PERMANENTLY DELETE (irreversible).");
    
    if (choice) {
      // Soft delete (archive)
      try {
        await client.api.fetch(`/api/inventory-admin/${id}/soft-delete`, { method: "POST" });
        fetchItems();
      } catch (err) { console.error(err); }
    } else {
      // Check if they really want permanent delete
      if (!confirm("Are you sure you want to PERMANENTLY DELETE this item? This cannot be undone!")) return;
      try {
        await client.api.fetch(`/api/inventory-admin/${id}/permanent`, { method: "DELETE" });
        fetchItems();
      } catch (err) { console.error(err); }
    }
  };

  // Enrich single item
  const enrichItem = async (id: number) => {
    setEnriching(id);
    try {
      const res = await client.api.fetch(`/api/inventory-admin/${id}/enrich`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        fetchItems();
        console.log("Enriched:", data.changes);
      }
    } catch (err) { console.error(err); }
    setEnriching(null);
  };

  // Bulk enrich all
  const enrichAll = async () => {
    if (!confirm("Enrich all items with TMDB metadata and format dimensions? This may take a moment.")) return;
    setEnriching(-1);
    try {
      const res = await client.api.fetch("/api/inventory-admin/enrich-bulk", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        fetchItems();
        alert(`Enriched ${data.enriched} of ${data.total} items`);
      }
    } catch (err) { console.error(err); }
    setEnriching(null);
  };

  // Find duplicate inventory items (supports enhanced mode with eBay detection)
  const findDuplicates = async (enhanced: boolean = false) => {
    setDupLoading(true);
    setShowDupPanel(true);
    setEnhancedMode(enhanced);
    try {
      const endpoint = enhanced 
        ? "/api/inventory-admin/duplicates/enhanced?include_ebay=true"
        : "/api/inventory-admin/duplicates";
      const res = await client.api.fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data.duplicates || []);
        setEbayDuplicates(data.ebayDuplicates || []);
      }
    } catch (err) { console.error(err); }
    setDupLoading(false);
  };

  // Quick delete duplicate
  const deleteDuplicate = async (id: number) => {
    if (!confirm(`Delete inventory item #${id}?`)) return;
    try {
      const res = await client.api.fetch("/api/inventory-admin/duplicates/delete", {
        method: "POST",
        body: JSON.stringify({ ids: [id] }),
      });
      if (res.ok) {
        // Refresh
        findDuplicates(enhancedMode);
        fetchItems();
      }
    } catch (err) { console.error(err); }
  };

  // Merge via new API
  const handleMergeEnhanced = async (targetId: number, sourceIds: number[], deleteSources: boolean = true) => {
    setMerging(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin/duplicates/merge", {
        method: "PUT",
        body: JSON.stringify({ targetId, sourceIds, deleteSources }),
      });
      if (res.ok) {
        setMergeModal({ show: false, keep: null, merge: null });
        fetchItems();
        findDuplicates(enhancedMode);
      }
    } catch (err) { console.error(err); }
    setMerging(false);
  };

  // eBay: Search seller listings
  const searchEbay = async () => {
    if (!ebaySeller.trim()) return;
    setEbayLoading(true);
    try {
      const params = new URLSearchParams({ seller: ebaySeller, query: ebayQuery });
      const res = await client.api.fetch(`/api/inventory-admin/ebay-search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEbayListings(data.items || []);
        setEbayTotal(data.total || 0);
      } else {
        const err = await res.json();
        setError(err.error || "eBay search failed");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setEbayLoading(false);
  };

  // eBay: Open match panel and fetch suggested matches
  const openMatchPanel = async (ebayItem: any) => {
    setMatchPanelEbayId(ebayItem.ebayItemId);
    setManualMatchSearch("");
    setManualMatchResults([]);
    setMatchLoading(true);
    try {
      const res = await client.api.fetch(`/api/inventory-admin/ebay-suggest-matches?title=${encodeURIComponent(ebayItem.title)}`);
      const data = await res.json();
      setSuggestedMatches(data.matches || []);
    } catch (err) { console.error(err); setSuggestedMatches([]); }
    setMatchLoading(false);
  };

  // eBay: Search inventory manually for matching
  const searchManualMatch = async (query: string) => {
    setManualMatchSearch(query);
    if (query.length < 2) { setManualMatchResults([]); return; }
    try {
      const res = await client.api.fetch(`/api/inventory-admin?search=${encodeURIComponent(query)}&limit=20`);
      const data = await res.json();
      // Filter out items already linked to eBay
      const available = (data.items || []).filter((item: any) => !item.ebay_item_id);
      setManualMatchResults(available);
    } catch (err) { setManualMatchResults([]); }
  };

  // eBay: Link an eBay listing to a specific inventory item
  const linkToItem = async (ebayItem: any, inventoryId: number) => {
    const invItem = items.find(i => i.id === inventoryId);
    if (!confirm(`Link "${ebayItem.title}" ($${ebayItem.price}) to "${invItem?.title}" (ID: ${inventoryId})?`)) return;
    setEbayLinking(inventoryId);
    try {
      await client.api.fetch(`/api/inventory-admin/${inventoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ebay_item_id: ebayItem.ebayItemId,
          ebay_price: ebayItem.price,
          ebay_status: "active",
          price: ebayItem.price ? Math.round(ebayItem.price * ebayPriceMarkup * 100) / 100 : invItem?.price,
        }),
      });
      fetchItems();
      // Update local listing state
      setEbayListings(prev => prev.map(l => l.ebayItemId === ebayItem.ebayItemId ? { ...l, linked: true, linkedInventoryId: inventoryId } : l));
      setMatchPanelEbayId(null);
    } catch (err) { console.error(err); }
    setEbayLinking(null);
  };

  // eBay: Sync pricing from eBay
  const syncPricingFromEbay = async () => {
    if (!confirm(`Set all linked prices to ${Math.round(ebayPriceMarkup * 100)}% of their eBay price?`)) return;
    setEbaySyncingPrices(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-sync-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markup: ebayPriceMarkup }),
      });
      if (res.ok) {
        const data = await res.json();
        fetchItems();
        alert(`Updated ${data.updated} prices`);
      }
    } catch (err) { console.error(err); }
    setEbaySyncingPrices(false);
  };

  // eBay: Auto-match pulled listings to existing inventory
  const autoMatchEbayListings = async () => {
    if (ebayListings.length === 0) return;
    setEbayAutoMatching(true);
    setAutoMatchResults(null);
    try {
      // Use dryRun: true - only report matches, don't auto-link
      const res = await client.api.fetch("/api/inventory-admin/ebay-auto-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listings: ebayListings.filter(l => !l.linked), dryRun: true }),
      });
      const data = await res.json();
      setAutoMatchResults(data);
      console.log("[eBay] Auto-match results (match-only):", data);
      // Store matches in state for user to review and manually link
      setPendingMatches(data.matched || []);
      setUnmatchedEbay(data.unmatched || []);
    } catch (err: any) {
      console.error("[eBay] Auto-match error:", err);
    } finally {
      setEbayAutoMatching(false);
    }
  };

  // Manually link an eBay listing to an inventory item
  const linkEbayToInventory = async (ebayItemId: string, inventoryId: number, price?: number) => {
    setEbayLinking(inventoryId);
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryId, ebayItemId, ebayPrice: price }),
      });
      if (res.ok) {
        // Update local state
        setEbayListings(prev => prev.map(l => 
          l.ebayItemId === ebayItemId 
            ? { ...l, linked: true, linkedInventoryId: inventoryId }
            : l
        ));
        fetchItems();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to link");
      }
    } catch (err: any) {
      console.error("[eBay] Link error:", err);
    } finally {
      setEbayLinking(null);
    }
  };

  // eBay: Pull ALL listings from seller (paginated)
  const pullAllEbayListings = async () => {
    if (!ebaySeller.trim()) return;
    setEbayPulling(true);
    setEbayListings([]);
    setEbayError(null);
    setError(null);
    try {
      const params = new URLSearchParams({ seller: ebaySeller });
      if (ebayQuery.trim()) params.set("query", ebayQuery.trim());
      console.log("[eBay] Pulling all listings for seller:", ebaySeller);
      const res = await client.api.fetch(`/api/inventory-admin/ebay-pull-all?${params}`);
      const data = await res.json();
      console.log("[eBay] Pull response:", res.status, data);
      if (res.ok) {
        setEbayListings(data.items || []);
        setEbayTotal(data.total || 0);
        setEbayAlreadyLinked(data.alreadyLinked || 0);
        if (!data.pulled && data.error) {
          setEbayError(`eBay: ${data.error}${data.details ? ' — ' + data.details : ''}`);
        } else if (data.pulled === 0) {
          setEbayError(`No listings found for seller "${ebaySeller}". Check the seller username.`);
        }
      } else {
        setEbayError(data.error || `eBay pull failed (${res.status})`);
      }
    } catch (err: any) {
      console.error("[eBay] Pull exception:", err);
      setEbayError(err.message || "Network error — check connection");
    }
    setEbayPulling(false);
  };

  // eBay: Create new inventory item from a single listing
  const createFromEbay = async (listing: any) => {
    setEbayCreating(listing.ebayItemId);
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listing),
      });
      if (res.ok) {
        const data = await res.json();
        fetchItems();
        setEbayListings(prev => prev.map(l => l.ebayItemId === listing.ebayItemId ? { ...l, linked: true, linkedInventoryId: data.item?.id } : l));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create inventory item");
      }
    } catch (err: any) { alert(err.message); }
    setEbayCreating(null);
  };

  // eBay: Bulk create inventory for all unmatched listings
  const bulkCreateFromEbay = async () => {
    const unmatched = ebayListings.filter(l => !l.linked);
    if (unmatched.length === 0) { alert("No unmatched listings to import"); return; }
    if (!confirm(`Import ${unmatched.length} unmatched eBay listings as new inventory items?`)) return;
    setEbayBulkCreating(true);
    try {
      const res = await client.api.fetch("/api/inventory-admin/ebay-bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listings: unmatched }),
      });
      if (res.ok) {
        const data = await res.json();
        fetchItems();
        alert(`Imported ${data.created} items. Skipped ${data.skipped} (already linked or errors).`);
        setEbayListings(prev => prev.map(l => ({ ...l, linked: true })));
        setEbayAlreadyLinked(prev => prev + data.created);
      } else {
        const err = await res.json();
        alert(err.error || "Bulk import failed");
      }
    } catch (err: any) { alert(err.message); }
    setEbayBulkCreating(false);
  };

  const visBadge = (v: string) => {
    const cls = v === "featured" ? "bg-gold-400 text-noir-800" : v === "listed" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500";
    return <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${cls}`}>{v}</span>;
  };

  const formatBadge = (f: string) => {
    const map: Record<string, string> = {
      Locandina: "bg-green-50 text-green-700 border-green-200",
      "French Petite": "bg-blue-50 text-blue-700 border-blue-200",
      "French Moyenne": "bg-purple-50 text-purple-700 border-purple-200",
      "French Grande": "bg-pink-50 text-pink-700 border-pink-200",
      "Due Fogli": "bg-teal-50 text-teal-700 border-teal-200",
      "4-Fogli": "bg-indigo-50 text-indigo-700 border-indigo-200",
      "6sh": "bg-orange-50 text-orange-700 border-orange-200",
      "1sh": "bg-amber-50 text-amber-700 border-amber-200",
      "1-Stop": "bg-red-50 text-red-700 border-red-200",
      Insert: "bg-cyan-50 text-cyan-700 border-cyan-200",
      "Half-Sheet": "bg-lime-50 text-lime-700 border-lime-200",
      "Lobby Card": "bg-yellow-50 text-yellow-700 border-yellow-200",
      "UK Quad": "bg-slate-50 text-slate-700 border-slate-200",
      A1: "bg-violet-50 text-violet-700 border-violet-200",
      "Australian Daybill": "bg-emerald-50 text-emerald-700 border-emerald-200",
      Small: "bg-gray-50 text-gray-700 border-gray-200",
      Other: "bg-gray-50 text-gray-600 border-gray-200",
    };
    return <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${map[f] || "bg-gray-50 text-gray-600 border-gray-200"}`}>{f}</span>;
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Inventory Manager</h1>
            <p className="text-sm text-gray-500">{total} items total</p>
          </div>
          <a href="#" className="text-sm text-gray-500 hover:text-gray-700">← Back to Store</a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 items-center">
          <button onClick={() => { setActiveTab("inventory"); setFilterVisibility(""); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "inventory" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            All Inventory
          </button>
          <button onClick={() => { setActiveTab("inventory"); setFilterVisibility("featured"); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "inventory" && filterVisibility === "featured" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            ⭐ Featured
          </button>
          <button onClick={() => { setActiveTab("inventory"); setFilterVisibility("listed"); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "inventory" && filterVisibility === "listed" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            ✅ Listed
          </button>
          <button onClick={() => { setActiveTab("inventory"); setFilterVisibility("unlisted"); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "inventory" && filterVisibility === "unlisted" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            ❌ Unlisted
          </button>
          <button onClick={() => { setActiveTab("inventory"); setFilterVisibility("sold_out"); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "inventory" && filterVisibility === "sold_out" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            🔥 Sold Out
          </button>
          <button onClick={() => setActiveTab("media")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "media" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📸 Media Library
          </button>
          <button onClick={() => setActiveTab("blog")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "blog" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📝 Blog
          </button>
          <button onClick={() => setActiveTab("ebay")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "ebay" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            🛒 eBay
          </button>
          <button onClick={() => setActiveTab("analytics")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "analytics" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📊 Analytics
          </button>
          <button onClick={() => { setActiveTab("orders"); fetchOrders(); fetchOrderStats(); }} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "orders" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📦 Orders {ordersStats.awaiting_shipment ? <span className="ml-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{ordersStats.awaiting_shipment}</span> : null}
          </button>
          <button onClick={() => setActiveTab("sheets")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "sheets" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📊 Google Sheets
          </button>
          <button onClick={() => setActiveTab("import")} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "import" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            📥 Bulk Import
          </button>
          {activeTab === "inventory" && (
            <button onClick={enrichAll} disabled={enriching === -1}
              className="ml-auto text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50">
              {enriching === -1 ? "Enriching..." : "✨ Enrich All (TMDB + Dims)"}
            </button>
          )}
        </div>

        {/* Tab content */}
        {activeTab === "media" ? (
          <MediaLibrary onRefreshInventory={fetchItems} />
        ) : activeTab === "blog" ? (
          <BlogEditor />
        ) : activeTab === "sheets" ? (
          /* Google Sheets Tab - Service Account Handshake */
          <div className="space-y-6">
            {/* ConnectionPanel - Service Account Status */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">🔐 Service Account Handshake</h3>
                {/* Status Light */}
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${
                    sheetsConnectionStatus.status === "active" ? "bg-green-500 animate-pulse" :
                    sheetsConnectionStatus.status === "connecting" ? "bg-yellow-500 animate-pulse" :
                    sheetsConnectionStatus.status === "error" ? "bg-red-500" :
                    "bg-gray-300"
                  }`} />
                  <span className="text-xs font-medium text-gray-600">
                    {sheetsConnectionStatus.status === "active" ? "Connected" :
                     sheetsConnectionStatus.status === "connecting" ? "Connecting..." :
                     sheetsConnectionStatus.status === "error" ? "Error" :
                     "Disconnected"}
                  </span>
                </div>
              </div>
              
              <p className="text-sm text-gray-600 mb-4">
                Your permanent server-to-server connection. The status light shows if the bridge-operator service account has Editor access.
              </p>

              {/* Bridge Email Display */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Bridge Operator Email</p>
                    <code className="text-sm font-mono text-gray-800">
                      {sheetsConnectionStatus.serviceAccountEmail || "youware@youware-backend.iam.gserviceaccount.com"}
                    </code>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(sheetsConnectionStatus.serviceAccountEmail || "youware@youware-backend.iam.gserviceaccount.com")}
                    className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Invite this email as <strong>Editor</strong> to your Google Sheet to enable sync
                </p>
              </div>

              {/* Check Permissions Button */}
              <div className="flex gap-3">
                <input
                  type="text"
                  value={sheetsSpreadsheetId}
                  onChange={(e) => setSheetsSpreadsheetId(e.target.value)}
                  placeholder="Enter Google Spreadsheet ID (e.g., 1abc2def...)"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm"
                />
                <button
                  onClick={async () => {
                    if (!sheetsSpreadsheetId.trim()) return;
                    setSheetsValidating(true);
                    setSheetsConnectionStatus(prev => ({ ...prev, status: "connecting" }));
                    try {
                      // Use check-permissions endpoint for Editor access validation
                      const res = await fetch("https://staging--b4puosnkz6175drjl5qg.youbase.cloud/api/sheets/check-permissions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ spreadsheetId: sheetsSpreadsheetId.trim() })
                      });
                      const data = await res.json();
                      
                      // Update connection status
                      setSheetsConnectionStatus({
                        status: data.canSync ? "active" : "error",
                        hasEditorAccess: data.hasEditorAccess || false,
                        canSync: data.canSync || false,
                        serviceAccountEmail: data.serviceAccountEmail || "",
                        lastValidated: data.lastValidated,
                        error: data.error
                      });
                      
                      setSheetsValidation(data);
                    } catch (err) {
                      setSheetsConnectionStatus(prev => ({ 
                        ...prev, 
                        status: "error", 
                        error: "Failed to check permissions" 
                      }));
                    }
                    setSheetsValidating(false);
                  }}
                  disabled={sheetsValidating || !sheetsSpreadsheetId.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {sheetsValidating ? "Checking..." : "Check Permissions"}
                </button>
              </div>

              {/* Connection Status Details */}
              {sheetsConnectionStatus.status !== "disconnected" && (
                <div className={`mt-4 border rounded-lg p-4 ${
                  sheetsConnectionStatus.canSync 
                    ? "bg-green-50 border-green-200" 
                    : "bg-red-50 border-red-200"
                }`}>
                  {sheetsConnectionStatus.canSync ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-green-700 font-medium">Editor Access Confirmed</span>
                      </div>
                      <p className="text-xs text-green-600">
                        ✓ Service account has Editor access. Bulk sync is enabled.
                        {sheetsConnectionStatus.lastValidated && (
                          <span className="ml-2">Last validated: {new Date(sheetsConnectionStatus.lastValidated).toLocaleString()}</span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-red-700 font-medium">Access Denied</span>
                      </div>
                      <p className="text-xs text-red-600">
                        {sheetsConnectionStatus.error || "Service account does not have Editor access. Please invite the Bridge Operator email as Editor."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Legacy Validation (for backward compatibility) */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">📊 Google Sheets Sync</h3>
              <p className="text-sm text-gray-600 mb-4">
                Connect your Google Sheet to sync inventory data. The system will validate access and show you exactly what permissions are needed.
              </p>
              
              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  value={sheetsSpreadsheetId}
                  onChange={(e) => setSheetsSpreadsheetId(e.target.value)}
                  placeholder="Enter Google Spreadsheet ID (e.g., 1abc2def...)"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm"
                />
                <button
                  onClick={async () => {
                    if (!sheetsSpreadsheetId.trim()) return;
                    setSheetsValidating(true);
                    try {
                      const res = await fetch("https://staging--b4puosnkz6175drjl5qg.youbase.cloud/api/sheets/validate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ spreadsheetId: sheetsSpreadsheetId.trim() })
                      });
                      const data = await res.json();
                      setSheetsValidation(data);
                    } catch (err) {
                      setSheetsValidation({ canAccess: false, serviceAccountEmail: "", error: "Failed to validate" });
                    }
                    setSheetsValidating(false);
                  }}
                  disabled={sheetsValidating || !sheetsSpreadsheetId.trim()}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {sheetsValidating ? "Validating..." : "Validate"}
                </button>
              </div>

              {sheetsValidation && (
                <div className={`border rounded-lg p-4 ${sheetsValidation.canAccess ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                  {sheetsValidation.canAccess ? (
                    <div>
                      <p className="text-green-700 font-medium">✅ Connected to "{sheetsValidation.spreadsheetTitle}"</p>
                      <p className="text-xs text-green-600 mt-1">Available sheets: {sheetsValidation.availableSheets?.join(", ")}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-red-700 font-medium">❌ {sheetsValidation.error || "Access Denied"}</p>
                      {sheetsValidation.instruction && (
                        <div className="mt-3 p-3 bg-white border border-red-200 rounded-lg">
                          <p className="text-xs text-gray-600 mb-2">{sheetsValidation.instruction}</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-xs font-mono">
                              {sheetsValidation.serviceAccountEmail}
                            </code>
                            <button
                              onClick={() => navigator.clipboard.writeText(sheetsValidation.serviceAccountEmail)}
                              className="text-xs bg-gray-200 px-3 py-2 rounded hover:bg-gray-300"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "import" ? (
          /* Bulk Import Tab */
          <div className="space-y-6">
            {/* Stats Overview */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-700">{importStats?.total ?? "..."}</div>
                <div className="text-xs text-blue-600">Total Items</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-700">{importStats?.available ?? "..."}</div>
                <div className="text-xs text-green-600">Available</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-2xl font-bold text-gray-700">{importStats?.sold ?? "..."}</div>
                <div className="text-xs text-gray-600">Sold</div>
              </div>
            </div>

            {/* Import Mode Selection */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">📥 Bulk Import</h3>
                <button
                  onClick={async () => {
                    try {
                      const res = await client.api.fetch("/api/inventory/template");
                      console.log("[Template Download] Response status:", res.status, res.ok);
                      if (!res.ok) {
                        const errorText = await res.text();
                        console.error("[Template Download] Error:", errorText);
                        alert(`Failed to download template: ${res.status} ${res.statusText}`);
                        return;
                      }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "inventory_template.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) { console.error(err); alert("Failed to download template"); }
                  }}
                  className="text-xs bg-gray-100 text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-200"
                >
                  📥 Download Template
                </button>
              </div>
              
              <p className="text-sm text-gray-600 mb-4">
                Upload a CSV file to import inventory. The file must include a <code className="bg-gray-100 px-1 rounded">lot_id</code> column as the unique identifier.
              </p>

              {/* Mode Selection */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { key: "append", label: "Append", desc: "Add new lot numbers only", color: "blue" },
                  { key: "patch", label: "Patch", desc: "Update existing + add new", color: "amber" },
                  { key: "replace", label: "Replace", desc: "Clear all and re-import", color: "red" }
                ].map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => setImportMode(mode.key as "append" | "patch" | "replace")}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      importMode === mode.key
                        ? mode.key === "append" ? "border-blue-500 bg-blue-50"
                        : mode.key === "patch" ? "border-amber-500 bg-amber-50"
                        : "border-red-500 bg-red-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className={`font-medium text-sm ${
                      mode.key === "append" ? "text-blue-700" 
                      : mode.key === "patch" ? "text-amber-700" 
                      : "text-red-700"
                    }`}>
                      {mode.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{mode.desc}</div>
                  </button>
                ))}
              </div>

              {/* File Upload */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  importFile ? "border-green-400 bg-green-50" : "border-gray-300 hover:border-gray-400"
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && file.name.endsWith(".csv")) {
                    setImportFile(file);
                    parseCSV(file);
                  } else {
                    alert("Please upload a CSV file");
                  }
                }}
              >
                {importFile ? (
                  <div>
                    <div className="text-green-600 font-medium">📄 {importFile.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{importData.length} rows detected</div>
                    <button
                      onClick={() => { setImportFile(null); setImportData([]); setImportResult(null); }}
                      className="text-xs text-gray-500 underline mt-2"
                    >
                      Remove file
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="text-gray-400 text-3xl mb-2">📁</div>
                    <div className="text-sm text-gray-600">
                      Drag & drop CSV here, or{" "}
                      <label className="text-blue-600 cursor-pointer hover:underline">
                        browse
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setImportFile(file);
                              parseCSV(file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Field Mapping Preview */}
              {importData.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Field Mapping Preview</h4>
                  <div className="bg-gray-50 rounded-lg p-3 overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr className="text-gray-500">
                          {Object.keys(importData[0] || {}).map((col) => (
                            <th key={col} className="px-2 py-1 text-left">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importData.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t border-gray-200">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="px-2 py-1 max-w-[150px] truncate">{val || "-"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importData.length > 3 && (
                      <div className="text-xs text-gray-500 mt-1">...and {importData.length - 3} more rows</div>
                    )}
                  </div>
                </div>
              )}

              {/* Import Button */}
              {importData.length > 0 && (
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleBulkImport}
                    disabled={importing}
                    className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importing ? "Importing..." : `🚀 Import ${importData.length} Rows (${importMode})`}
                  </button>
                </div>
              )}

              {/* Import Result */}
              {importResult && (
                <div className={`mt-4 rounded-lg p-4 ${
                  importResult.inserted > 0 || importResult.updated > 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"
                }`}>
                  <h4 className="font-medium text-gray-800 mb-2">Import Complete</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-green-600 font-bold">{importResult.inserted}</span>
                      <span className="text-gray-600"> inserted</span>
                    </div>
                    <div>
                      <span className="text-amber-600 font-bold">{importResult.updated}</span>
                      <span className="text-gray-600"> updated</span>
                    </div>
                    <div>
                      <span className="text-gray-600 font-bold">{importResult.skipped}</span>
                      <span className="text-gray-600"> skipped</span>
                    </div>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="text-xs text-red-600 font-medium">Errors:</div>
                      {importResult.errors.map((err, i) => (
                        <div key={i} className="text-xs text-red-500">{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "ebay" ? (
          /* eBay Integration Tab */
          <div className="space-y-6">
            {/* eBay OAuth Connection */}
            <div className={`border rounded-lg p-5 ${ebayConnected ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-800">🔑 eBay Seller Account</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {ebayConnected
                      ? `Connected${ebayUsername ? ` as @${ebayUsername}` : ""} — you can publish listings from inventory.`
                      : "Connect your eBay seller account to create listings directly from inventory."}
                  </p>
                </div>
                <div>
                  {ebayConnected ? (
                    <button onClick={disconnectEbay} className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors">
                      Disconnect
                    </button>
                  ) : (
                    <button onClick={connectEbay} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                      🔗 Connect eBay
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* eBay Pull & Search */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">📦 Pull Your eBay Listings</h3>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">eBay Seller Username</label>
                  <input type="text" placeholder="e.g. poster_child-1" value={ebaySeller} onChange={(e) => setEbaySeller(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Filter Query <span className="text-gray-400">(optional)</span></label>
                  <input type="text" placeholder="leave empty for all listings" value={ebayQuery} onChange={(e) => setEbayQuery(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={pullAllEbayListings} disabled={ebayPulling || !ebaySeller}
                    className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
                    {ebayPulling ? `Pulling... (${ebayListings.length})` : "⬇ Pull All Listings"}
                  </button>
                  <button onClick={searchEbay} disabled={ebayLoading || !ebaySeller}
                    className="px-5 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors whitespace-nowrap">
                    {ebayLoading ? "Searching..." : "🔍 Quick Search"}
                  </button>
                  <button onClick={async () => { if (confirm("Delete ALL eBay-sourced inventory items? This cannot be undone.")) { const res = await client.api.fetch("/api/inventory-admin/ebay-purge", { method: "DELETE" }); if (res.ok) { const d = await res.json(); alert("Deleted " + d.deleted + " eBay items"); fetchItems(); } } }}
                    className="px-5 py-2 bg-red-50 text-red-700 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap">
                    🗑 Purge eBay Imports
                  </button>
                </div>
              </div>
              {ebayTotal > 0 && (
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-600 font-medium">{ebayTotal} listings found, {ebayListings.length} loaded</span>
                  <span className="text-green-600">{ebayAlreadyLinked} already linked</span>
                  <span className="text-amber-600">{ebayListings.filter(l => !l.linked).length} unmatched</span>
                  <button onClick={autoMatchEbayListings} disabled={ebayAutoMatching || ebayListings.filter(l => !l.linked).length === 0}
                    className="ml-auto px-4 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
                    {ebayAutoMatching ? "⚡ Matching..." : "⚡ Auto-Match"}
                  </button>
                </div>
              )}
              {ebayError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mt-3">
                  <p className="text-sm text-red-700 font-medium">eBay Error</p>
                  <p className="text-xs text-red-500 mt-1">{ebayError}</p>
                  <button onClick={() => setEbayError(null)} className="text-xs text-red-600 underline mt-1">Dismiss</button>
                </div>
              )}
            </div>
            {ebayListings.some(l => !l.linked) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-amber-800">📥 Import Unmatched Listings</h3>
                    <p className="text-xs text-amber-600 mt-1">
                      {ebayListings.filter(l => !l.linked).length} listings are not linked to inventory. Import them to create new items automatically.
                    </p>
                  </div>
                  <button onClick={bulkCreateFromEbay} disabled={ebayBulkCreating}
                    className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors">
                    {ebayBulkCreating ? "Importing..." : `Import All ${ebayListings.filter(l => !l.linked).length} Items`}
                  </button>
                </div>
              </div>
            )}

            {autoMatchResults && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-purple-800">⚡ Match Results - Review & Confirm</h3>
                  <button onClick={() => { setAutoMatchResults(null); setPendingMatches([]); setUnmatchedEbay([]); }} className="text-xs text-purple-600 hover:underline">Dismiss</button>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center mb-4">
                  <div className="bg-green-100 rounded-lg p-2">
                    <div className="text-lg font-bold text-green-700">{pendingMatches.length}</div>
                    <div className="text-[10px] text-green-600">Potential Matches</div>
                  </div>
                  <div className="bg-amber-100 rounded-lg p-2">
                    <div className="text-lg font-bold text-amber-700">{unmatchedEbay.length}</div>
                    <div className="text-[10px] text-amber-600">Unmatched (Need Approval)</div>
                  </div>
                  <div className="bg-gray-100 rounded-lg p-2">
                    <div className="text-lg font-bold text-gray-700">{autoMatchResults.alreadyLinked?.length || 0}</div>
                    <div className="text-[10px] text-gray-600">Already Linked</div>
                  </div>
                </div>

                {/* Pending Matches - Manual Approval */}
                {pendingMatches.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-bold text-gray-700 mb-2">📋 Suggested Matches (click to confirm):</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "12px", background: "#f0fdf4", borderRadius: "8px", marginBottom: "12px", border: "1px solid #86efac" }}>
                        <input
                          type="checkbox"
                          checked={selectedMatches.size === pendingMatches.length && pendingMatches.length > 0}
                          onChange={toggleSelectAll}
                        />
                        <span style={{ fontSize: "13px" }}>
                          {selectedMatches.size} of {pendingMatches.length} selected
                        </span>
                        <button
                          onClick={handleBatchConfirm}
                          disabled={selectedMatches.size === 0 || batchLoading}
                          style={{ marginLeft: "auto", background: "#22c55e", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer" }}
                        >
                          {batchLoading ? "Confirming..." : `✓ Confirm Selected (${selectedMatches.size})`}
                        </button>
                      </div>
                      {pendingMatches.map((match: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-white border border-green-200 rounded-lg p-2">
                          <input
                            type="checkbox"
                            checked={selectedMatches.has(match.ebay?.ebayItemId)}
                            onChange={() => toggleMatch(match.ebay?.ebayItemId, match.inventory?.id)}
                            className="mr-3"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-800 truncate">{match.ebay?.title?.substring(0, 40)}...</div>
                            <div className="text-[10px] text-gray-500">Score: {match.score} → Inventory #{match.inventory?.id} ({match.inventory?.title})</div>
                          </div>
                          <button onClick={() => linkEbayToInventory(match.ebay?.ebayItemId, match.inventory?.id, match.ebay?.price)}
                            disabled={ebayLinking === match.inventory?.id}
                            className="ml-2 px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50">
                            {ebayLinking === match.inventory?.id ? "..." : "✓ Confirm"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unmatched - Create New Inventory */}
                {unmatchedEbay.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-gray-700 mb-2">🆕 Unmatched - Click to Create Inventory:</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {unmatchedEbay.slice(0, 10).map((item: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg p-2">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            {item.image && <img src={item.image} alt="" className="w-8 h-10 object-cover rounded" />}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-800 truncate">{item.title?.substring(0, 35)}...</div>
                              <div className="text-[10px] text-gray-500">${item.price} · {item.condition}</div>
                            </div>
                          </div>
                          <button onClick={() => createFromEbay(item)}
                            disabled={ebayCreating !== null}
                            className="ml-2 px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 disabled:opacity-50">
                            {ebayCreating === item.ebayItemId ? "..." : "+ Create"}
                          </button>
                        </div>
                      ))}
                      {unmatchedEbay.length > 10 && (
                        <div className="text-xs text-gray-500 text-center py-2">...and {unmatchedEbay.length - 10} more</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pricing Sync */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">💰 Pricing Sync</h3>
              <div className="flex items-center gap-4 mb-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Website Price = eBay Price x</label>
                  <div className="flex items-center gap-2">
                    <input type="number" step="0.05" min="0" max="2" value={ebayPriceMarkup}
                      onChange={(e) => setEbayPriceMarkup(parseFloat(e.target.value) || 1)}
                      className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                    <span className="text-sm text-gray-500">({Math.round(ebayPriceMarkup * 100)}% of eBay price)</span>
                  </div>
                </div>
                <button onClick={syncPricingFromEbay} disabled={ebaySyncingPrices}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {ebaySyncingPrices ? "Syncing..." : "Sync All Linked Prices"}
                </button>
              </div>
              <p className="text-xs text-gray-400">This updates the price on all inventory items that have an eBay price linked.</p>
            </div>

            {/* eBay Listings Grid */}
            {ebayListings.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-800">eBay Listings ({ebayListings.length})</h3>
                  <div className="flex gap-2">
                    <button onClick={() => setEbayListings(prev => prev.filter(l => !l.linked))} className="text-xs text-blue-600 hover:underline">Show unmatched only</button>
                    {ebayListings.length < (ebayTotal || 0) && (
                      <span className="text-xs text-amber-600">Showing first {ebayListings.length} of {ebayTotal}</span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Image</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">eBay Price</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Site Price</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ebayListings.map((listing: any) => (
                        <tr key={listing.ebayItemId} className={`hover:bg-gray-50 ${listing.linked ? "bg-green-50/30" : ""}`}>
                          <td className="px-3 py-2">
                            {listing.image ? (
                              <img src={listing.image} alt="" className="w-10 h-14 object-cover rounded border border-gray-200" />
                            ) : (
                              <div className="w-10 h-14 bg-gray-100 rounded border border-dashed border-gray-300" />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <a href={listing.itemWebUrl} target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium max-w-[250px] block truncate">
                              {listing.title}
                            </a>
                            <div className="text-[10px] text-gray-400">{listing.condition || ""} · ID: {listing.ebayItemId}</div>
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900">${listing.price || "—"}</td>
                          <td className="px-3 py-2 text-green-700 font-medium">
                            ${listing.price ? (Math.round(listing.price * ebayPriceMarkup * 100) / 100).toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {listing.linked ? (
                              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-green-100 text-green-700">linked</span>
                            ) : (
                              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">unmatched</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {listing.linked ? (
                                <span className="text-[10px] text-gray-400 px-1">FR-{String(listing.linkedInventoryId || "").padStart(5, "0")}</span>
                              ) : (
                                <>
                                  <button onClick={() => createFromEbay(listing)} disabled={ebayCreating !== null}
                                    className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2.5 py-1 hover:bg-blue-100 disabled:opacity-50">
                                    {ebayCreating === listing.ebayItemId ? "..." : "+ Import"}
                                  </button>
                                  <button onClick={() => openMatchPanel(listing)}
                                    className={`text-xs border rounded px-2.5 py-1 disabled:opacity-50 ${matchPanelEbayId === listing.ebayItemId ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"}`}>
                                    🔗 Match
                                  </button>
                                </>
                              )}
                            </div>
                            {/* Match Panel */}
                            {matchPanelEbayId === listing.ebayItemId && (
                              <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 min-w-[320px] max-w-[400px]">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-gray-700">Suggested Matches</span>
                                  <button onClick={() => setMatchPanelEbayId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                                </div>
                                {matchLoading ? (
                                  <p className="text-xs text-gray-400">Searching...</p>
                                ) : suggestedMatches.length > 0 ? (
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {suggestedMatches.map((m: any) => (
                                      <button key={m.id} onClick={() => linkToItem(listing, m.id)} disabled={ebayLinking === m.id}
                                        className="w-full text-left flex items-center gap-2 p-2 bg-white rounded border border-gray-200 hover:border-purple-300 hover:bg-purple-50 disabled:opacity-50 transition-colors">
                                        {m.image_url ? <img src={m.image_url} className="w-6 h-8 object-cover rounded" alt="" /> : <div className="w-6 h-8 bg-gray-200 rounded" />}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-medium text-gray-800 truncate">{m.title}</p>
                                          <p className="text-[10px] text-gray-400">ID: {m.id} {m.year ? `· ${m.year}` : ""} {m.format ? `· ${m.format}` : ""} · ${m.price || "—"}</p>
                                        </div>
                                        <span className="text-[9px] font-mono bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{m._matchScore} match</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-400">No matches found. Search below.</p>
                                )}
                                {/* Manual Search */}
                                <div className="mt-2 pt-2 border-t border-gray-200">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Manual Search</span>
                                  <input type="text" placeholder="Type to search inventory..." value={manualMatchSearch}
                                    onChange={(e) => searchManualMatch(e.target.value)}
                                    className="w-full mt-1 border border-gray-300 rounded px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500" />
                                  {manualMatchResults.length > 0 && (
                                    <div className="space-y-1 mt-1.5 max-h-36 overflow-y-auto">
                                      {manualMatchResults.map((m: any) => (
                                        <button key={m.id} onClick={() => linkToItem(listing, m.id)} disabled={ebayLinking === m.id}
                                          className="w-full text-left flex items-center gap-2 p-2 bg-white rounded border border-gray-200 hover:border-purple-300 hover:bg-purple-50 disabled:opacity-50 transition-colors">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-gray-800 truncate">{m.title}</p>
                                            <p className="text-[10px] text-gray-400">ID: {m.id} {m.year ? `· ${m.year}` : ""} · ${m.price || "—"}</p>
                                          </div>
                                          <span className="text-[9px] font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Link</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* eBay Linkage Stats */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">📊 Linkage Overview</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-700">{items.filter(i => i.ebay_item_id).length}</p>
                  <p className="text-xs text-gray-500 mt-1">eBay Linked</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg">
                  <p className="text-2xl font-bold text-amber-700">{items.filter(i => !i.ebay_item_id).length}</p>
                  <p className="text-xs text-gray-500 mt-1">Unlinked</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-900">{ebayPriceMarkup * 100}%</p>
                  <p className="text-xs text-gray-500 mt-1">Price Factor</p>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "orders" ? (
          /* Orders Tab */
          <div className="space-y-6">
            {/* Order Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{ordersStats.total_orders || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Total Orders</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-amber-700">{ordersStats.awaiting_shipment || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Awaiting Shipment</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{ordersStats.in_progress || 0}</p>
                <p className="text-xs text-gray-500 mt-1">In Progress</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{ordersStats.fulfilled || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Fulfilled</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">${((ordersStats.total_revenue || 0)).toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-1">Total Revenue</p>
              </div>
            </div>

            {/* Sync + Filter Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={syncEbayOrders} disabled={ordersSyncing}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {ordersSyncing ? "Syncing..." : "🔄 Sync from eBay"}
              </button>
              <select value={ordersFilter} onChange={(e) => setOrdersFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
                <option value="">All Statuses</option>
                <option value="AWAITING_SHIPMENT">Awaiting Shipment</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="FULFILLED">Fulfilled</option>
              </select>
              <p className="text-xs text-gray-400 ml-auto">{ordersTotal} orders</p>
            </div>

            {/* Orders Table */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {ordersLoading ? (
                <div className="p-10 text-center text-gray-400">Loading orders...</div>
              ) : orders.length === 0 ? (
                <div className="p-10 text-center text-gray-400">
                  <p className="text-lg mb-2">📦 No orders yet</p>
                  <p className="text-sm">Click "Sync from eBay" to pull your orders.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Buyer</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {orders.map((order: any) => {
                        const lineItems = typeof order.line_items === "string" ? JSON.parse(order.line_items) : (order.line_items || []);
                        const statusColor = order.status === "AWAITING_SHIPMENT" ? "bg-amber-100 text-amber-800" : order.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-800" : order.status === "FULFILLED" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800";
                        return (
                          <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5">
                              <div className="font-mono text-xs text-blue-600">{order.legacy_order_id || order.ebay_order_id}</div>
                              {order.shipping_address && <div className="text-[10px] text-gray-400 mt-1 max-w-[180px] truncate">{order.shipping_address.split("\n")[0]}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600">
                              {order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-sm">{order.buyer_username || "—"}</td>
                            <td className="px-3 py-2.5">
                              {lineItems.map((li: any, i: number) => (
                                <div key={i} className="text-xs text-gray-600 truncate max-w-[200px]" title={li.title}>
                                  {li.title || li.sku || "Item"}
                                  {li.quantity > 1 ? ` ×${li.quantity}` : ""}
                                </div>
                              ))}
                            </td>
                            <td className="px-3 py-2.5 font-medium">
                              ${order.total_amount ? order.total_amount.toFixed(2) : "0.00"}
                              <span className="text-[10px] text-gray-400 ml-1">{order.total_currency}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                                {order.status?.replace(/_/g, " ") || "UNKNOWN"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              {order.status !== "FULFILLED" && (
                                <button onClick={() => updateOrderStatus(order.id, "SHIPPED")}
                                  className="text-xs bg-green-50 text-green-700 border border-green-200 rounded px-2.5 py-1 hover:bg-green-100">
                                  ✅ Mark Shipped
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Add Item button */}
          <button onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Item
          </button>

          <button onClick={() => findDuplicates(false)} disabled={dupLoading}
            className="px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 text-sm font-medium rounded-lg hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5">
            {dupLoading ? "Scanning..." : "🔀 Find Duplicates"}
          </button>
          <button onClick={() => findDuplicates(true)} disabled={dupLoading}
            className="px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium rounded-lg hover:bg-orange-100 disabled:opacity-50 flex items-center gap-1.5"
            title="Also detect eBay duplicates">
            🛒+🔀 Enhanced
          </button>
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search title or director..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </div>

          {/* Format filter */}
          <select value={filterFormat} onChange={(e) => { setFilterFormat(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Formats</option>
            <option value="French Petite">French Petite</option>
            <option value="French Moyenne">French Moyenne</option>
            <option value="French Grande">French Grande</option>
            <option value="Locandina">Locandina</option>
            <option value="Due Fogli">Due Fogli</option>
            <option value="4-Fogli">4 Fogli</option>
            <option value="6sh">6 Sheet</option>
            <option value="1sh">One-Sheet</option>
            <option value="1-Stop">1-Stop</option>
            <option value="Insert">Insert</option>
            <option value="Half-Sheet">Half-Sheet</option>
            <option value="Lobby Card">Lobby Card</option>
            <option value="UK Quad">UK Quad</option>
            <option value="A1">A1</option>
            <option value="Australian Daybill">Australian Daybill</option>
            <option value="Other">Other</option>
          </select>
          <input type="text" placeholder="Filter by Lot #..." value={filterLotId} onChange={(e) => { setFilterLotId(e.target.value); setPage(0); }}
            className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30" />

          {/* Source filter */}
          <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Sources</option>
            <option value="ebay">🛒 eBay</option>
            <option value="manual">📋 Manual</option>
          </select>

          {/* Director filter */}
          <input type="text" placeholder="Director..." value={filterDirector} onChange={(e) => { setFilterDirector(e.target.value); setPage(0); }}
            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30" />

          {/* Year range */}
          <div className="flex items-center gap-1">
            <input type="number" placeholder="From" value={filterYearFrom} onChange={(e) => { setFilterYearFrom(e.target.value); setPage(0); }}
              className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500/30" />
            <span className="text-gray-400">-</span>
            <input type="number" placeholder="To" value={filterYearTo} onChange={(e) => { setFilterYearTo(e.target.value); setPage(0); }}
              className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500/30" />
          </div>

          {/* Decade filter */}
          <select value={filterDecade} onChange={(e) => { setFilterDecade(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
            <option value="">All Decades</option>
            <option value="1900">1900s</option>
            <option value="1910">1910s</option>
            <option value="1920">1920s</option>
            <option value="1930">1930s</option>
            <option value="1940">1940s</option>
            <option value="1950">1950s</option>
            <option value="1960">1960s</option>
            <option value="1970">1970s</option>
            <option value="1980">1980s</option>
            <option value="1990">1990s</option>
            <option value="2000">2000s</option>
            <option value="2010">2010s</option>
            <option value="2020">2020s</option>
          </select>

          {/* Sort */}
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(0); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30">
            <option value="created_at">Newest First</option>
            <option value="title">Title (A-Z)</option>
            <option value="year">Year (Oldest)</option>
            <option value="year_desc">Year (Newest)</option>
            <option value="format">Format</option>
            <option value="country">Country</option>
            <option value="director">Director</option>
          </select>

          {/* Batch actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-blue-700">{selectedIds.size} selected</span>
              <select value={batchVis} onChange={(e) => setBatchVis(e.target.value)} className="border border-blue-300 rounded px-2 py-1 text-sm">
                <option value="featured">⭐ Featured</option>
                <option value="listed">✅ Listed</option>
                <option value="unlisted">❌ Unlisted</option>
                <option value="sold_out">🔥 Sold Out</option>
              </select>
              <button onClick={handleBatchVisibility} className="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-700">
                Apply
              </button>
              <span className="text-gray-400">|</span>
              <select value={batchFormat} onChange={(e) => setBatchFormat(e.target.value)} className="border border-blue-300 rounded px-2 py-1 text-sm">
                <option value="">Set Format...</option>
                <option value="French Petite">🇫🇷 French Petite</option>
                <option value="French Moyenne">🇫🇷 French Moyenne</option>
                <option value="French Grande">🇫🇷 French Grande</option>
                <option value="Locandina">🇮🇹 Locandina</option>
                <option value="Due Fogli">🇮🇹 Due Fogli</option>
                <option value="4-Fogli">🇮🇹 4 Fogli</option>
                <option value="1sh">🇺🇸 One-Sheet</option>
              </select>
              {batchFormat && (
                <button onClick={handleBatchFormat} className="bg-green-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-green-700">
                  Apply Format
                </button>
              )}
              <button onClick={() => setSelectedIds(new Set())} className="text-blue-600 text-sm hover:underline">Cancel</button>
              <span className="text-gray-400">|</span>
              <button onClick={() => {
                setBundleForm({
                  title: items.filter(i => selectedIds.has(i.id)).map(i => i.title).filter(Boolean).slice(0, 2).join(" + ") || "Bundle",
                  notes: "", ebayBundleUrl: "", price: "", itemNumber: "",
                });
                setShowBundleModal(true);
              }}
                className="bg-purple-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-purple-700">
                📦 Bundle ({selectedIds.size})
              </button>
              <span className="text-gray-400">|</span>
              {/* Country of origin batch */}
              <select value={batchCountry} onChange={(e) => setBatchCountry(e.target.value)} className="border border-blue-300 rounded px-2 py-1 text-sm">
                <option value="">Set Country...</option>
                <option value="USA">🇺🇸 USA</option>
                <option value="UK">🇬🇧 UK</option>
                <option value="France">🇫🇷 France</option>
                <option value="Italy">🇮🇹 Italy</option>
                <option value="Germany">🇩🇪 Germany</option>
                <option value="Japan">🇯🇵 Japan</option>
                <option value="Spain">🇪🇸 Spain</option>
                <option value="Australia">🇦🇺 Australia</option>
              </select>
              {batchCountry && (
                <button onClick={handleBatchCountry} className="bg-teal-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-teal-700">
                  Apply Country
                </button>
              )}
              <span className="text-gray-400">|</span>
              {/* Batch price */}
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Set Price..."
                  value={batchPrice}
                  onChange={(e) => setBatchPrice(e.target.value)}
                  className="border border-blue-300 rounded px-2 py-1 text-sm w-28"
                />
              </div>
              {batchPrice && (
                <button onClick={handleBatchPrice} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-emerald-700">
                  Apply Price
                </button>
              )}
              <span className="text-gray-400">|</span>
              <button onClick={handleBatchDelete} className="bg-red-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-red-700">
                🗑 Delete ({selectedIds.size})
              </button>
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700 font-medium">Failed to load inventory</p>
            <p className="text-xs text-red-500 mt-1">{error}</p>
            <button onClick={fetchItems} className="text-xs text-red-600 underline mt-2">Retry</button>
          </div>
        )}

        {/* Items table */}
        {loading ? (
          <div className="text-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No items found</div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2.5 text-left w-8">
                      <input type="checkbox" checked={selectedIds.size === items.length && items.length > 0} onChange={selectAll} className="rounded" />
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Image</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Director</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Format</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">eBay</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.id} className={`hover:bg-gray-50 ${selectedIds.has(item.id) ? "bg-blue-50" : ""}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative group">
                          {item.source_url ? (
                            <img src={item.source_url} alt={item.title} className="w-12 h-16 object-cover rounded border border-gray-200" />
                          ) : (
                            <div className="w-12 h-16 bg-gray-100 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                          {item.image_source && (
                            <span className={`absolute -top-1 -right-1 text-[8px] font-bold px-1 py-0.5 rounded leading-none ${item.image_source === 'library' ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                              {item.image_source === 'library' ? 'HQ' : 'eBay'}
                            </span>
                          )}
                          <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) uploadImage(item.id, file);
                            }} disabled={uploadingId === item.id} />
                          </label>
                          {uploadingId === item.id && (
                            <div className="absolute inset-0 bg-white/80 rounded flex items-center justify-center">
                              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={`font-medium text-gray-900 max-w-[200px] truncate ${item.item_type === 'bundle' ? 'text-purple-700 cursor-pointer hover:underline' : ''}`}
                          onClick={() => item.item_type === 'bundle' && fetchBundleDetail(item.id)}>
                          {item.item_type === 'bundle' && '📦 '}{item.title}
                        </div>
                        <div className="text-xs text-gray-400">{item.item_number}</div>
                        {item.item_type === 'bundle' && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 mt-0.5">📦 Bundle</span>
                        )}
                        {itemBundles[item.id]?.length > 0 && item.item_type !== 'bundle' && (
                          <button onClick={(e) => { e.stopPropagation(); fetchBundleDetail(itemBundles[item.id][0].id); }}
                            className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 mt-0.5 hover:bg-purple-100 cursor-pointer">
                            📦 In bundle
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.source === "ebay" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-orange-100 text-orange-700" title="Imported from eBay">
                            🛒 eBay
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                            📋 Manual
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{item.year ? `${item.year}${item.release_year ? ` / R${item.release_year}` : ""}` : "—"}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[150px] truncate">{item.director || "—"}</td>
                      <td className="px-3 py-2">{item.format ? formatBadge(item.format) : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          {visBadge(item.visibility)}
                          {item.sold === 1 && <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700">Sold</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {item.ebay_item_id ? (
                          <a href={item.source_url || `https://www.ebay.com/itm/${item.ebay_item_id}`} target="_blank" rel="noopener"
                            className="text-[10px] font-mono text-blue-600 hover:underline block">
                            🛒 {item.ebay_item_id}
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                        {item.ebay_bundle_url && (
                          <a href={item.ebay_bundle_url} target="_blank" rel="noopener"
                            className="text-[10px] font-mono text-purple-600 hover:underline block mt-0.5"
                            title={item.ebay_bundle_url}>
                            📦 Bundle
                          </a>
                        )}
                        {item.ebay_status && <span className="text-[9px] text-gray-400 block">{item.ebay_status}</span>}
                        {item.ebay_price && <span className="text-[9px] text-green-600 block">${item.ebay_price}</span>}
                      </td>
                      <td className="px-3 py-2" onClick={() => { if (!inlinePriceEdit || inlinePriceEdit.id !== item.id) setInlinePriceEdit({ id: item.id, value: item.price != null ? String(item.price) : "" }); }}>
                        {inlinePriceEdit && inlinePriceEdit.id === item.id ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span className="text-gray-500 text-sm">$</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              autoFocus
                              value={inlinePriceEdit.value}
                              onChange={(e) => setInlinePriceEdit({ id: item.id, value: e.target.value })}
                              onBlur={() => saveInlinePrice(item.id, inlinePriceEdit.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlinePrice(item.id, inlinePriceEdit.value);
                                if (e.key === "Escape") setInlinePriceEdit(null);
                              }}
                              className="w-20 border border-blue-400 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        ) : (
                          <div className="cursor-pointer group">
                            <div className="text-sm text-gray-900 group-hover:text-blue-600">
                              {item.price != null ? `$${Number(item.price).toLocaleString()}` : <span className="text-gray-400 italic text-xs">click to set</span>}
                            </div>
                            {item.ebay_price && <div className="text-[9px] text-gray-400">eBay: ${item.ebay_price}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleVisibility(item)} title="Toggle visibility" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            {item.visibility === "featured" ? "⭐" : item.visibility === "listed" ? "✅" : item.visibility === "unlisted" ? "❌" : "🔥"}
                          </button>
                          <button onClick={() => toggleSold(item)} title="Toggle sold" className={`p-1.5 rounded hover:bg-gray-100 ${item.sold ? "text-red-500" : "text-gray-400 hover:text-gray-600"}`}>
                            💰
                          </button>
                          <button onClick={() => openEdit(item)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600">
                            ✏️
                          </button>
                          <button onClick={() => deleteItem(item.id)} title="Delete" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600">
                            🗑️
                          </button>
                          <button onClick={() => enrichItem(item.id)} disabled={enriching === item.id} title="Enrich (TMDB + dims)" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600 disabled:opacity-40">
                            {enriching === item.id ? "⏳" : "✨"}
                          </button>
                          <button onClick={() => publishToEbay(item.id)} disabled={ebayPublishing === item.id} title="Publish to eBay" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-purple-600 disabled:opacity-40">
                            {ebayPublishing === item.id ? "⏳" : "🛒"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </p>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                  ← Prev
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-3 py-1.5 text-sm border rounded-lg ${p === page ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 hover:bg-gray-50"}`}>
                      {p + 1}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* Upload progress toast */}
      {uploadProgress && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm">
          {uploadProgress}
        </div>
      )}

      {/* Add Item Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Add Inventory Item</h2>
              <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Title *</label>
                <input type="text" value={addForm.title || ""} onChange={(e) => setAddForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. Chinatown" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Item Number *</label>
                  <input type="text" value={addForm.item_number || ""} onChange={(e) => setAddForm(f => ({ ...f, item_number: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. 7111974" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Year</label>
                  <input type="text" value={addForm.year || ""} onChange={(e) => setAddForm(f => ({ ...f, year: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. 1974" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Director</label>
                  <input type="text" value={addForm.director || ""} onChange={(e) => setAddForm(f => ({ ...f, director: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. Roman Polanski" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Actors</label>
                  <input type="text" value={addForm.actors || ""} onChange={(e) => setAddForm(f => ({ ...f, actors: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. Jack Nicholson, Faye Dunaway" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Format</label>
                  <input type="text" value={addForm.format || ""} onChange={(e) => setAddForm(f => ({ ...f, format: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. Australian Daybill" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Price</label>
                  <input type="text" value={addForm.price || ""} onChange={(e) => setAddForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. 495" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Condition</label>
                <input type="text" value={addForm.condition_grade || ""} onChange={(e) => setAddForm(f => ({ ...f, condition_grade: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" placeholder="e.g. Very Fine" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Notes</label>
                <textarea value={addForm.notes || ""} onChange={(e) => setAddForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" rows={2} placeholder="Original theatrical release, etc." />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={createItem} disabled={creating}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {creating ? "Creating..." : "Create Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Edit: {editingItem.title}</h2>
              <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {/* 5e: Show Lot # and Item # */}
              <p className="text-xs text-gray-400">Lot # {editingItem.lot_id} · Item # {editingItem.item_number}</p>
              
              {/* 5a: Split single Title field into two */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">ENGLISH TITLE</label>
                <input type="text" placeholder="e.g. Pale Rider" value={editForm.title ?? ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">LOCAL TITLE</label>
                <input type="text" placeholder="e.g. Il cavaliere pallido" value={editForm.original_title ?? ""} onChange={(e) => setEditForm({ ...editForm, original_title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">Foreign language title as it appears on the poster</p>
              </div>

              {/* 5b: Year fields */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">ORIGINAL RELEASE YEAR</label>
                <input type="number" value={editForm.year ?? ""} onChange={(e) => setEditForm({ ...editForm, year: e.target.value ? Number(e.target.value) : null })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">RE-RELEASE YEAR</label>
                <input type="number" placeholder="e.g. 2019" value={editForm.release_year ?? ""} onChange={(e) => setEditForm({ ...editForm, release_year: e.target.value ? Number(e.target.value) : null })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">Leave blank if original release. Shows as R2019 on site.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">RELEASE TYPE</label>
                <select value={editForm.release_type || "original"} onChange={(e) => setEditForm({ ...editForm, release_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
                  <option value="original">Original Release</option>
                  <option value="rerelease">Re-release</option>
                </select>
              </div>

              {/* 5c: Poster Style / Variant */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">POSTER STYLE / VARIANT</label>
                <input type="text" placeholder="e.g. Teaser, Advance, Style A, Anniversary Edition" value={editForm.poster_style ?? ""} onChange={(e) => setEditForm({ ...editForm, poster_style: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">Leave blank if standard release</p>
              </div>

              {/* Other standard fields */}
              {[
                { key: "director", label: "Director", type: "text" },
                { key: "genre", label: "Genre", type: "text" },
                { key: "format", label: "Format", type: "text" },
                { key: "poster_country", label: "Country", type: "text" },
                { key: "price", label: "Price", type: "number" },
                { key: "condition_grade", label: "Condition", type: "text" },
                { key: "dimensions", label: "Dimensions", type: "text" },
                { key: "artist", label: "Artist", type: "text" },
                { key: "actors", label: "Actors", type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</label>
                  <input type={type} value={editForm[key] ?? ""} onChange={(e) => setEditForm({ ...editForm, [key]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                </div>
              ))}
              
              {/* 5f: Source URL */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">SOURCE URL</label>
                <input type="text" placeholder="https://..." value={editForm.source_url ?? ""} onChange={(e) => setEditForm({ ...editForm, source_url: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>

              {/* 5d: Authentication fields */}
              <div className="border-t border-gray-100 pt-3 mt-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">🔍 Authentication</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Printer Credit</label>
                <input type="text" value={editForm.printer_credit ?? ""} onChange={(e) => setEditForm({ ...editForm, printer_credit: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">NSS / Visa Code</label>
                <input type="text" value={editForm.nss_code ?? ""} onChange={(e) => setEditForm({ ...editForm, nss_code: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Distributor Logo</label>
                <input type="text" value={editForm.distributor_logo ?? ""} onChange={(e) => setEditForm({ ...editForm, distributor_logo: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Billing Block Style</label>
                <select value={editForm.billing_block_style || ""} onChange={(e) => setEditForm({ ...editForm, billing_block_style: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
                  <option value="">Select...</option>
                  <option value="classic">Classic (Pre-1960)</option>
                  <option value="modern">Modern (1960-1980)</option>
                  <option value="ultra-condensed">Ultra-Condensed (Post-1980)</option>
                  <option value="digital">Digital/Laser (Post-1990)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Audit Status</label>
                <select value={editForm.audit_status || "pending"} onChange={(e) => setEditForm({ ...editForm, audit_status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="incomplete">Incomplete</option>
                  <option value="anachronism">Anachronism</option>
                  <option value="mismatch">Mismatch</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Notes</label>
                <textarea value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              {/* eBay Fields */}
              <div className="border-t border-gray-100 pt-3 mt-3">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">🛒 eBay Integration</p>
              </div>
              {[
                { key: "ebay_item_id", label: "eBay Item ID", type: "text", placeholder: "e.g. 123456789012" },
                { key: "ebay_price", label: "eBay Price ($)", type: "number", placeholder: "0.00" },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</label>
                  <input type={type} placeholder={placeholder} value={editForm[key] ?? ""} onChange={(e) => setEditForm({ ...editForm, [key]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">eBay Bundle URL</label>
                <input type="text" placeholder="https://www.ebay.com/itm/..." value={editForm.ebay_bundle_url || ""}
                  onChange={(e) => setEditForm({ ...editForm, ebay_bundle_url: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">Link if this item is also part of a bundle listing</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Pricing Markup (%)</label>
                <input type="number" step="0.05" min="0" max="2" value={editForm.pricing_markup ?? 0.9}
                  onChange={(e) => setEditForm({ ...editForm, pricing_markup: parseFloat(e.target.value) || 1 })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">Website price = eBay price × {Math.round((editForm.pricing_markup || 0.9) * 100)}%</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setEditingItem(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={saveEdit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save Changes</button>
            </div>
          </div>
        </div>
      )}
      {/* Create Bundle Modal */}
      {showBundleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">📦 Create Bundle</h2>
              <button onClick={() => setShowBundleModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-700">
                <span className="font-semibold">{selectedIds.size} items selected</span> for this bundle
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Bundle Title *</label>
                <input type="text" value={bundleForm.title} onChange={(e) => setBundleForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
                  placeholder="e.g. The Shape of Water (2 French Petite)" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Bundle Price ($)</label>
                  <input type="number" value={bundleForm.price} onChange={(e) => setBundleForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500" placeholder="e.g. 85" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Item Number</label>
                  <input type="text" value={bundleForm.itemNumber} onChange={(e) => setBundleForm(f => ({ ...f, itemNumber: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500" placeholder="Auto-generated if blank" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">eBay Bundle URL</label>
                <input type="text" value={bundleForm.ebayBundleUrl} onChange={(e) => setBundleForm(f => ({ ...f, ebayBundleUrl: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
                  placeholder="https://www.ebay.com/itm/..." />
                <p className="text-[10px] text-gray-400 mt-0.5">Link the eBay bundle listing URL</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Notes</label>
                <textarea value={bundleForm.notes} onChange={(e) => setBundleForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500" rows={2}
                  placeholder="e.g. Bundle of 2 posters matching eBay listing" />
              </div>
              {/* Show selected items preview */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Items in Bundle</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {items.filter(i => selectedIds.has(i.id)).map(item => (
                    <div key={item.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1.5">
                      {item.source_url && <img src={item.source_url} alt="" className="w-6 h-8 object-cover rounded" />}
                      <span className="truncate text-gray-700">{item.title}</span>
                      <span className="text-gray-400 text-xs ml-auto shrink-0">{item.format}</span>
                      <span className="text-gray-400 text-xs shrink-0">{item.dimensions}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowBundleModal(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={createBundle} disabled={creatingBundle}
                className="px-5 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {creatingBundle ? "Creating..." : "📦 Create Bundle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle Detail Panel */}
      {bundleDetailId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                📦 Bundle: {bundleDetail?.bundle?.title || "..."}
              </h2>
              <button onClick={() => { setBundleDetailId(null); setBundleDetail(null); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            {bundleDetailLoading ? (
              <div className="p-12 text-center"><div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" /></div>
            ) : bundleDetail ? (
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-500">Item #:</span> <span className="font-medium">{bundleDetail.bundle.item_number}</span></div>
                  <div><span className="text-gray-500">Price:</span> <span className="font-medium">${bundleDetail.bundle.price || "—"}</span></div>
                  <div><span className="text-gray-500">Status:</span> <span>{bundleDetail.bundle.visibility}</span></div>
                  {bundleDetail.bundle.ebay_bundle_url && (
                    <div className="col-span-2">
                      <span className="text-gray-500">eBay URL:</span>{" "}
                      <a href={bundleDetail.bundle.ebay_bundle_url} target="_blank" rel="noopener" className="text-purple-600 hover:underline text-xs break-all">
                        {bundleDetail.bundle.ebay_bundle_url}
                      </a>
                    </div>
                  )}
                </div>
                {bundleDetail.bundle.notes && (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">{bundleDetail.bundle.notes}</div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Items in Bundle ({bundleDetail.children?.length || 0})
                    </p>
                    <button onClick={() => { setBundleDetailId(null); setBundleDetail(null); }}
                      className="text-xs text-purple-600 hover:underline">Close</button>
                  </div>
                  <div className="space-y-2">
                    {bundleDetail.children?.map((child: any) => (
                      <div key={child.id} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-lg p-2.5">
                        {child.source_url ? (
                          <img src={child.source_url} alt="" className="w-10 h-14 object-cover rounded border" />
                        ) : (
                          <div className="w-10 h-14 bg-gray-200 rounded border border-dashed flex items-center justify-center text-gray-400 text-xs">No img</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900 truncate">{child.title}</div>
                          <div className="text-xs text-gray-400">{child.item_number} · {child.format} · {child.dimensions || "—"}</div>
                        </div>
                        <button onClick={() => removeChildFromBundle(bundleDetail.bundle.id, child.id)}
                          className="text-red-400 hover:text-red-600 text-xs p-1 hover:bg-red-50 rounded" title="Remove from bundle">
                          ✕
                        </button>
                      </div>
                    ))}
                    {(!bundleDetail.children || bundleDetail.children.length === 0) && (
                      <p className="text-sm text-gray-400 text-center py-4">No items in this bundle</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-gray-400">Bundle not found</div>
            )}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
              <button onClick={() => { if (bundleDetailId) deleteBundle(bundleDetailId); }}
                className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">
                🗑️ Delete Bundle
              </button>
              <button onClick={() => { setBundleDetailId(null); setBundleDetail(null); }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicates Panel */}
      {showDupPanel && (
        <div className="mt-4 bg-white border border-purple-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-purple-50 border-b border-purple-200">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔀</span>
              <span className="font-bold text-purple-900">Potential Duplicates</span>
              <span className="text-xs font-mono bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">{duplicates.length} groups</span>
              {enhancedMode && ebayDuplicates.length > 0 && (
                <span className="text-xs font-mono bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">🛒 {ebayDuplicates.length} eBay groups</span>
              )}
            </div>
            <button onClick={() => setShowDupPanel(false)} className="text-purple-400 hover:text-purple-700 text-xl">&times;</button>
          </div>
          <div className="p-4 max-h-96 overflow-y-auto space-y-3">
            {dupLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mr-3" />
                <span className="text-sm text-purple-600">Scanning for duplicates...</span>
              </div>
            ) : duplicates.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <span className="text-2xl block mb-2">✅</span>
                <span className="text-sm">No potential duplicates found</span>
              </div>
            ) : (
              duplicates.map((group) => (
                <div key={group.key} className="border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-400 font-mono mb-2 truncate">Match: "{group.key}"</div>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((item: any) => (
                      <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                        {item.source_url ? (
                          <img src={item.source_url} alt="" className="w-6 h-8 object-cover rounded" />
                        ) : (
                          <div className="w-6 h-8 bg-gray-200 rounded" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-gray-900">{item.title}</div>
                          <div className="text-[10px] text-gray-400">
                            #{item.id} · {item.item_number} · {item.year || "?"} · {item.format || "?"}
                            {item.source === "ebay" && <span className="text-orange-500 ml-1">🛒</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 ml-2">
                          {group.items.filter((i: any) => i.id !== item.id).map((other: any) => (
                            <button key={other.id}
                              onClick={() => setMergeModal({ show: true, keep: item, merge: other })}
                              className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded hover:bg-purple-200"
                              title={`Merge ${other.title} into ${item.title}`}>
                              ← #{other.id}
                            </button>
                          ))}
                          <button onClick={() => deleteDuplicate(item.id)} 
                            className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded hover:bg-red-200 ml-1"
                            title={`Delete ${item.title}`}>
                            🗑
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}

            {enhancedMode && ebayDuplicates.length > 0 && (
              <div className="mt-4 pt-4 border-t-2 border-orange-200">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">🛒</span>
                  <span className="font-bold text-orange-900">eBay Linked Duplicates</span>
                  <span className="text-xs font-mono bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{ebayDuplicates.length} groups</span>
                </div>
                {ebayDuplicates.map((group) => (
                  <div key={group.ebayId} className="border border-orange-200 rounded-lg p-3 mb-3 bg-orange-50">
                    <div className="text-xs text-orange-600 font-mono mb-2">
                      eBay ID: {group.ebayId} — {group.items.length} items linked
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.items.map((item: any) => (
                        <div key={item.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-orange-200">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{item.title}</div>
                            <div className="text-[10px] text-gray-400">
                              #{item.id} · {item.itemNumber} · {item.year || "?"}
                            </div>
                          </div>
                          <button onClick={() => deleteDuplicate(item.id)} 
                            className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded hover:bg-red-200"
                            title={`Delete ${item.title}`}>
                            🗑
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Merge Modal */}
      {mergeModal.show && mergeModal.keep && mergeModal.merge && (
        <MergeModal
          keep={mergeModal.keep}
          merge={mergeModal.merge}
          merging={merging}
          onMerge={(fields) => handleMergeEnhanced(mergeModal.keep.id, [mergeModal.merge.id], true)}
          onClose={() => setMergeModal({ show: false, keep: null, merge: null })}
        />
      )}
    </div>
  );
}

// Merge Modal Component
function MergeModal({ keep, merge, merging, onMerge, onClose }: {
  keep: any; merge: any; merging: boolean;
  onMerge: (fields: Record<string, any>) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Record<string, any>>({});

  const comparableFields = [
    { key: "title", label: "Title" },
    { key: "year", label: "Year" },
    { key: "director", label: "Director" },
    { key: "actors", label: "Actors" },
    { key: "genre", label: "Genre" },
    { key: "format", label: "Format" },
    { key: "dimensions", label: "Dimensions" },
    { key: "poster_country", label: "Country" },
    { key: "price", label: "Price" },
    { key: "condition_grade", label: "Condition" },
    { key: "source_url", label: "Image URL" },
    { key: "ebay_item_id", label: "eBay ID" },
    { key: "source", label: "Source" },
  ];

  // Auto-select the better value for each field
  const autoMerge = () => {
    const merged: Record<string, any> = {};
    for (const { key } of comparableFields) {
      const keepVal = keep[key];
      const mergeVal = merge[key];
      // Prefer non-null, non-empty values; prefer keep if both exist
      if (mergeVal && !keepVal) {
        merged[key] = mergeVal;
      } else if (keepVal) {
        merged[key] = keepVal;
      }
    }
    // Merge notes
    const notes = [keep.notes, merge.notes ? `[From #${merge.id}] ${merge.notes}` : null].filter(Boolean).join("\n");
    merged.notes = notes;
    setFields(merged);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">🔀 Merge Duplicates</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Keep <span className="font-medium text-blue-600">#{keep.id} {keep.title}</span> and merge data from{" "}
              <span className="font-medium text-red-600">#{merge.id} {merge.title}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4">
          <div className="flex gap-3 mb-4">
            <button onClick={autoMerge} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 font-medium">
              ✨ Auto-Merge (best of both)
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 uppercase">Field</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-blue-500 uppercase">Keep #{keep.id}</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-red-500 uppercase">Merge #{merge.id}</th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-purple-500 uppercase">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comparableFields.map(({ key, label }) => {
                  const kVal = keep[key];
                  const mVal = merge[key];
                  const rVal = fields[key] !== undefined ? fields[key] : kVal;
                  const isDiff = String(kVal || "") !== String(mVal || "");
                  return (
                    <tr key={key} className={isDiff ? "bg-amber-50/50" : ""}>
                      <td className="px-2 py-1.5 text-xs font-medium text-gray-600">{label}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-700 max-w-[180px] truncate">
                        <button onClick={() => setFields(f => ({ ...f, [key]: kVal }))}
                          className={`text-left w-full rounded px-1 py-0.5 hover:bg-blue-100 ${rVal === kVal ? "bg-blue-100 font-medium" : ""}`}>
                          {kVal || <span className="text-gray-300">—</span>}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-gray-700 max-w-[180px] truncate">
                        <button onClick={() => setFields(f => ({ ...f, [key]: mVal }))}
                          className={`text-left w-full rounded px-1 py-0.5 hover:bg-red-100 ${rVal === mVal && isDiff ? "bg-red-100 font-medium" : ""}`}>
                          {mVal || <span className="text-gray-300">—</span>}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-xs font-medium text-purple-700 max-w-[180px] truncate">{rVal || <span className="text-gray-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <p className="text-[10px] text-red-500">⚠️ Item #{merge.id} will be permanently deleted after merge</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={() => onMerge(fields)} disabled={merging}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium disabled:opacity-50">
              {merging ? "Merging..." : "🔀 Merge"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

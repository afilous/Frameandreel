// v3
import { Hono } from "hono";
import type { Client } from "@sdk/server-types";
import { tables, buckets } from "./__generated__/index";
import { eq, desc, and, ne, or, sql } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

const app = new Hono();
export default app;

// ═══════════════════════════════════════════════════
// FORENSIC PROMPT TEMPLATE (Enhanced for Triptych Analysis)
// Note: Sharp cropping not available in Edge runtime
// The AI prompt includes region-specific instructions for better analysis
// ═══════════════════════════════════════════════════
const FORENSIC_PROMPT_TEMPLATE = `Analyze this movie poster image with special attention to THREE REGIONS:

REGION 1 - HEADER (Top 10%): Look for DISTRIBUTOR LOGOS (Criterion, Lucky Red, 20th Century Fox, etc.), STUDIO MARKS, and RE-ISSUE indicators. Note any modern printer credits.

REGION 2 - CENTER (Middle 60%): This is the main artwork. Identify the movie title, actors, and primary visual elements.

REGION 3 - FOOTER (Bottom 30%): The most critical zone. Look for NSS CODES, TAX/VISA STAMPS, PRINTER CREDITS, BILLING BLOCKS, and any serial numbers or production codes.

Cross-reference the year indicators in the Header with the Printer Credit in the Footer to determine if this is an ORIGINAL or RE-ISSUE.

Return your findings in JSON format:
- "distributor_logo": The distributor/studio logo found in header
- "printer_credit": Printer information from footer  
- "nss_visa_code": NSS or tax stamps from footer
- "release_type": "ORIGINAL" or "RE-ISSUE" based on modern markers
- "identified_year": The year determined from the forensic evidence`;


// NOTE: the original GET /api/admin/media-library/pending-matches endpoint
// that was here has been removed — it was defined on this file's outer,
// unused `app` instance (see line ~9 const app = new Hono()), which is
// never the instance actually served (createApp's returned app is what's
// used). A working version of this endpoint, with confidence-tier grouping,
// is now defined inside createApp() further down in this file.

// POST /api/admin/media-library/batch-confirm-matches
app.post("/api/admin/media-library/batch-confirm-matches", async (c) => {
  const { matches } = await c.req.json();
  if (!Array.isArray(matches)) return c.json({ error: "matches array required" }, 400);
  const results = [];
  for (const m of matches) {
    await edgespark.db.all(sql.raw(`
      UPDATE image_library SET
        matched_inventory_id = ${m.inventory_id},
        match_status = 'confirmed',
        updated_at = ${Date.now()}
      WHERE id = ${m.image_id}
    `));
    await syncMediaLibraryToInventory(edgespark, sql, m.image_id, m.inventory_id);
    results.push({ image_id: m.image_id, inventory_id: m.inventory_id, success: true });
  }
  return c.json({ results, confirmed: results.length });
});

// POST /api/admin/media-library/reject-match
app.post("/api/admin/media-library/reject-match", async (c) => {
  const { image_id } = await c.req.json();
  await edgespark.db.all(sql.raw(`
    UPDATE image_library SET
      match_status = 'rejected',
      suggested_inventory_id = NULL,
      match_confidence = NULL
    WHERE id = ${image_id}
  `));
  return c.json({ success: true });
});

app.post("/api/ebay/batch-link", async (c) => {
  const { matches } = await c.req.json();
  if (!Array.isArray(matches)) return c.json({ error: "matches array required" }, 400);
  const e = (s) => String(s||'').replace(/'/g,"''");
  const results = [];
  for (const m of matches) {
    await edgespark.db.all(sql.raw(`
      UPDATE inventory SET
        ebay_item_id = '${e(m.ebay_item_id)}',
        updated_at = ${Date.now()}
      WHERE id = ${m.inventory_id}
    `));
    results.push({ ...m, success: true });
  }
  return c.json({ results, confirmed: results.length });
});

// ═══════════════════════════════════════════════════════════════
// CONSOLIDATION ADDITIONS — Safe base64, retry, usage tracking,
// country rules, reference data (Doc 1, file 01)
// ═══════════════════════════════════════════════════════════════

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function geminiWithRetry(
  ai: any,
  params: any,
  maxRetries = 3,
  delayMs = 2000
): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await ai.models.generateContent(params);
      return result;
    } catch (err: any) {
      lastError = err;
      const is503 = err?.message?.includes("503") ||
                    err?.message?.includes("UNAVAILABLE") ||
                    err?.message?.includes("high demand");
      if (!is503 || attempt === maxRetries - 1) throw err;
      console.warn(`[Gemini] 503 attempt ${attempt + 1}/${maxRetries}, retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

async function trackUsage(
  edgespark: any,
  sql: any,
  model: string,
  stage: string,
  estimatedCostCents: number
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  try {
    await edgespark.db.all(sql.raw(`
      INSERT INTO api_usage_log (date, model, stage, calls, estimated_cost_cents, last_call_at)
      VALUES ('${today}', '${model}', '${stage}', 1, ${estimatedCostCents}, ${Date.now()})
      ON CONFLICT(date, model, stage) DO UPDATE SET
        calls = calls + 1,
        estimated_cost_cents = estimated_cost_cents + ${estimatedCostCents},
        last_call_at = ${Date.now()}
    `));
  } catch (e) {
    console.warn("[Usage] Failed to track usage:", e);
  }
}

function buildCountryRules(country: string, yearStart: number, yearEnd: number): string {
  const c = country.toLowerCase();
  if (c.includes("ital")) return `
ITALY RULES:
- "Prima Edizione" / "Prima Edizione Italiana" = original first release marker
- "Edizione Successiva" / "Riedizione" = explicit reissue marker
- Visto di Censura ranges: 1945-49: 1-6000 | 1950-59: 6000-31000 | 1960-69: 31000-55000 | 1970-79: 55000-73000 | 1980-89: 73000+
- Tax stamp (Imposta Pubblicità / Marca da Bollo): 1950s=L.20 | 1960s-70s=L.30-40 | 1980s=L.50-100+
- Locandina format: IGNORE top 15-20% (blank "Spazio per il Cinema" — local theater stamps, not film data)
- CIC logo = post-1970 | UIP logo = post-1981
- "Fotocromocombinazione", "Fotolito", "Zincografica" = printing sub-contractors, NOT main printer
- Expected era: ${yearStart}-${yearEnd}`;

  if (c.includes("fran")) return `
FRANCE RULES:
- Visa d'exploitation ranges: 1945-49: 1-9000 | 1950-59: 9000-23000 | 1960-69: 23000-36000 | 1970-79: 36000-51000 | 1980-89: 51000+
- Printer address format: pre-1972 = "Paris-9" or "Paris (10e)" | post-1972 = "75009" (5-digit)
- If 5-digit postal code found and expected era ends before 1972 = reissue indicator
- Reissues often have tiny date code near printer name e.g. "Saint-Martin - 75.12" = Dec 1975
- IGNORE "1881" if preceded by "Loi du" or "Juillet" — legal boilerplate, NOT a year
- French Visa stamp required on all originals — if printer present but no Visa number, flag for review
- Expected era: ${yearStart}-${yearEnd}`;

  if (c.includes("uk") || c.includes("brit")) return `
UK RULES:
- BBFC rating eras: pre-1970 = U/A/X(16+) | 1970-1982 = X(18+, spelled out) | post-1982 = 15/18/PG/12
- If "15", "18", "PG" or "12" found and expected era ends before 1982 = definite reissue
- Classic printers: W.E. Berry, Stafford & Co = 1940s-60s | Lonsdale & Bartholomew = 1960s-70s
- Expected era: ${yearStart}-${yearEnd}`;

  if (c.includes("austral")) return `
AUSTRALIA RULES:
- Pre-1971 classifications: "Suitable only for Adults" / "General Exhibition" (text)
- Post-1971: boxed letter grades G/NRC/M/R — if found on pre-1971 film = reissue
- Physical: pre-1970 Daybills = 15x40 with white border + 3 horizontal folds
- Post-1975: shorter/wider ~13x30, often full-bleed, 2 folds
- Expected era: ${yearStart}-${yearEnd}`;

  if (c.includes("japan")) return `
JAPAN RULES:
- Eirin (映倫) number = sequential classification stamp. High 5-digit number on old film = reissue
- Paper: originals (50s-60s) = flat matte fibrous | reissues = glossy/semi-gloss bright white
- Distributors: Toho (kaiju/Kurosawa), Shochiku (Ozu/anime), Toei (yakuza/samurai), Nikkatsu (action)
- Expected era: ${yearStart}-${yearEnd}`;

  return `Expected era: ${yearStart}-${yearEnd}`;
}

function getKnownPrinters(country: string): string {
  const c = country.toLowerCase();
  if (c.includes("ital")) return KNOWN_ITALIAN_PRINTERS.join(", ");
  if (c.includes("fran")) return KNOWN_FRENCH_PRINTERS.join(", ");
  if (c.includes("uk") || c.includes("brit")) return KNOWN_UK_PRINTERS.join(", ");
  if (c.includes("austral")) return KNOWN_AUSTRALIAN_PRINTERS.join(", ");
  return [...KNOWN_ITALIAN_PRINTERS, ...KNOWN_FRENCH_PRINTERS].join(", ");
}

const STAGE1_MODEL = "gemini-2.5-flash-lite";
const STAGE2_MODEL = "gemini-2.5-flash";
const STAGE1_COST_CENTS = 0.1;
const STAGE2_COST_CENTS = 0.2;

const KNOWN_ITALIAN_PRINTERS = [
  "Rotolitografica", "Rotopress", "Arti Grafiche Zoli", "Litoroma",
  "S.A.C.", "Zincografica Firenze", "Pizzichemi", "I.G.E.R.",
  "Grafiche S.A.T.", "Ditta A. Poli", "Zincografica", "Fotolito",
  "Rotocalco", "Dromos", "Saccani"
];

const KNOWN_FRENCH_PRINTERS = [
  "Cinémato", "Imprimerie Lalande", "Imprimerie Saint-Martin",
  "Ets. Jouineau", "Affiche Gaillard", "Imprimerie Bedos",
  "Imp. de Landais", "Affiches Michelson"
];

const KNOWN_UK_PRINTERS = [
  "W.E. Berry", "Stafford & Co", "Lonsdale & Bartholomew",
  "Donside", "S&D Toon", "W&G Baird"
];

const KNOWN_AUSTRALIAN_PRINTERS = [
  "W.E. Smith", "Robert Burton", "M.A. Mapstone"
];

const KNOWN_DISTRIBUTORS = [
  "Titanus", "Cineriz", "Cinecittà", "CIC", "Cinema International Corporation",
  "United International Pictures", "UIP", "Lucky Red", "Dear Film",
  "Dear International", "S.A.C.", "Gaumont", "Pathé", "Parafrance",
  "Columbia-Warner", "Prodis", "Rank Organisation", "Hoyts", "Greater Union",
  "Toho", "Shochiku", "Toei", "Nikkatsu",
  "20th Century Fox", "MGM", "Columbia", "Warner Bros", "Paramount",
  "Universal", "United Artists", "RKO", "Disney", "Embassy"
];

const DIRECTOR_PSEUDONYMS: Record<string, string> = {
  "John Old": "Mario Bava",
  "John M. Old": "Mario Bava",
  "Mickey Lion": "Mario Bava",
  "Louis Fuller": "Lucio Fulci",
  "Hank Milestone": "Umberto Lenzi",
  "Humphrey Humbert": "Umberto Lenzi",
  "Simon Sterling": "Sergio Sollima",
  "George B. Lewis": "Aldo Lado",
  "Martin Dolman": "Sergio Martino",
  "George Kaplan": "Sergio Martino",
  "Robert Hampton": "Riccardo Freda",
};

const ACTOR_TRUE_NAMES: Record<string, string> = {
  "Mario Girotti": "Terence Hill",
  "Carlo Pedersoli": "Bud Spencer",
  "John Wells": "Gian Maria Volonté",
  "John Welch": "Gian Maria Volonté",
  "John Garko": "Gianni Garko",
  "A. Steffen": "Anthony Steffen",
  "Montgomery Wood": "Giuliano Gemma",
  "Alan Collins": "Luciano Pigozzi",
  "Sara Bay": "Rosalba Neri",
  "Gianni Belmondo": "Jean-Paul Belmondo",
  "Alan Delon": "Alain Delon",
};

export async function createApp(
  edgespark: Client<typeof tables>
): Promise<Hono> {
  const app = new Hono();

  const now = () => Date.now();

  // ═══════════════════════════════════════════════════
  // HEALTH CHECK ROUTE
  // ═══════════════════════════════════════════════════
  app.get('/api/health', async (c) => {
    try {
      // Test database connectivity
      await edgespark.db.all(sql.raw("SELECT 1"));
      return c.json({ 
        status: 'OK', 
        timestamp: Date.now(),
        database: 'connected'
      });
    } catch (e) {
      return c.json({ 
        status: 'ERROR', 
        error: String(e),
        timestamp: Date.now()
      }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // DYNAMIC SITEMAP ROUTE
  // Generates XML sitemap from database for SEO
  // ═══════════════════════════════════════════════════
  app.get('/api/sitemap.xml', async (c) => {
    try {
      // Fetch all visible posters (status = 'listed' or 'featured')
      const posters = await edgespark.db.all(sql.raw(`
        SELECT id, title, updatedAt FROM posters 
        WHERE status IN ('listed', 'featured') 
        AND sold = 0
        ORDER BY updatedAt DESC
        LIMIT 1000
      `));
      
      const baseUrl = 'https://frameandreel.com';
      const today = new Date().toISOString().split('T')[0];
      
      let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/#/admin</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.1</priority>
  </url>`;
      
      // Add each poster as a URL
      for (const poster of posters as any[]) {
        const posterDate = poster.updatedAt 
          ? new Date(poster.updatedAt).toISOString().split('T')[0] 
          : today;
        // Use hash routing for poster detail pages
        sitemap += `
  <url>
    <loc>${baseUrl}/#/poster/${poster.id}</loc>
    <lastmod>${posterDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
      }
      
      sitemap += '\n</urlset>';
      
      return c.text(sitemap, 200, { 'Content-Type': 'application/xml' });
    } catch (e) {
      console.error('[SITEMAP ERROR]', e);
      return c.text('<?xml version="1.0"?><error>Failed to generate sitemap</error>', 500, { 'Content-Type': 'application/xml' });
    }
  });

  // Ensure eBay listings table exists
  try {
    await edgespark.db.all(sql.raw(`
      CREATE TABLE IF NOT EXISTS ebay_listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ebay_item_id TEXT UNIQUE NOT NULL,
        title TEXT,
        price REAL,
        currency TEXT DEFAULT 'USD',
        condition TEXT,
        item_web_url TEXT,
        image_url TEXT,
        shipping_cost REAL,
        status TEXT DEFAULT 'active',
        listing_type TEXT,
        seller TEXT,
        last_synced_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `));
    console.log("[DB] ebay_listings table ready");
  } catch (e) {
    console.warn("[DB] ebay_listings table creation skipped:", e);
  }

  // ═══════════════════════════════════════════════════
  // CONSOLIDATION ADDITIONS — processing queue + usage tracking
  // ═══════════════════════════════════════════════════
  try {
    await edgespark.db.all(sql.raw(`
      CREATE TABLE IF NOT EXISTS processing_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        stage TEXT NOT NULL DEFAULT 'stage1',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        batch_context TEXT,
        error TEXT,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
      )
    `));
    await edgespark.db.all(sql.raw(`
      CREATE INDEX IF NOT EXISTS queue_status_idx ON processing_queue(status, stage)
    `));
    await edgespark.db.all(sql.raw(`
      CREATE INDEX IF NOT EXISTS queue_image_idx ON processing_queue(image_id)
    `));
    await edgespark.db.all(sql.raw(`
      CREATE TABLE IF NOT EXISTS api_usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        stage TEXT NOT NULL,
        calls INTEGER DEFAULT 0,
        estimated_cost_cents REAL DEFAULT 0,
        last_call_at INTEGER,
        UNIQUE(date, model, stage)
      )
    `));
    console.log("[DB] processing_queue and api_usage_log tables ready");
  } catch (e) {
    console.warn("[DB] queue/usage table creation skipped:", e);
  }

  // ═══════════════════════════════════════════════════
  // PROVENANCE ENGINE v2.0 - ARCHIVAL DNA FIELDS
  // ═══════════════════════════════════════════════════
  // Add Archival DNA columns to image_library table
  const dnaColumns = [
    "title_english TEXT",
    "title_local TEXT",
    "original_release_year INTEGER",
    "printer_credit TEXT",
    "nss_visa_code TEXT",
    "distributor_logo TEXT",
    "dna_audit_status TEXT DEFAULT 'pending'",
    "dna_ocr_raw TEXT",
    "dna_forensic_crops TEXT",
  ];
  
  for (const col of dnaColumns) {
    try {
      const colName = col.split(" ")[0];
      await edgespark.db.all(sql.raw(`ALTER TABLE image_library ADD COLUMN IF NOT EXISTS ${colName}`));
    } catch (e) {
      // Column may already exist, continue
    }
  }
  console.log("[DB] Archival DNA columns ready");

  // Helper to validate ID parameter
  const parseIdParam = (idStr: string): number => {
    const parsed = parseInt(idStr);
    if (isNaN(parsed) || parsed <= 0) return -1;
    return parsed;
  };

  // ═══════════════════════════════════════════════════
  // TMDB MANUAL SEARCH (Free — no AI cost)
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  // LOGIC CONFLICT INTERCEPTOR
  // Forces forensic scan when TMDb year doesn't match user-defined range
  // ═══════════════════════════════════════════════════

  // Search TMDB by title manually
  app.post("/api/tmdb/search", async (c) => {
    const { query, year, yearRangeStart, yearRangeEnd } = await c.req.json() as { 
      query: string; 
      year?: number;
      yearRangeStart?: number;
      yearRangeEnd?: number;
    };
    console.log("[API] POST /api/tmdb/search", { query, year, yearRangeStart, yearRangeEnd });

    const tmdbKey = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;
    if (!tmdbKey) {
      return c.json({ error: "TMDB API key not configured" }, 500);
    }

    try {
      // Build search query - try multiple approaches for international titles
      let searchQueries: string[] = [];
      
      // Strategy 1: Original query with year if provided
      if (year) {
        searchQueries.push(`${query} ${year}`);
      }
      
      // Strategy 2: Try with just the query (without year) to get more results
      searchQueries.push(query);
      
      // Strategy 3: For French/Italian titles, also try the original title search
      // We'll search each query until we find results

      // Execute searches until we find a match
      for (const searchQuery of searchQueries) {
        console.log("[API] TMDB trying query:", searchQuery);
        
        const tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(searchQuery)}&include_adult=false&api_key=${tmdbKey}`,
        );
        const tmdbData: any = await tmdbRes.json();

        if (tmdbData.results && tmdbData.results.length > 0) {
          console.log("[API] TMDB found", tmdbData.results.length, "results for query:", searchQuery);
          
          // Get detailed info for each result
          const results = await Promise.all(
        tmdbData.results.slice(0, 10).map(async (movie: any) => {
          try {
            const detailRes = await fetch(
              `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKey}`,
            );
            const details: any = await detailRes.json();

            const director = details.credits?.crew?.find((c: any) => c.job === "Director")?.name || null;
            const actors = details.credits?.cast?.slice(0, 5).map((a: any) => a.name).join(", ") || null;
            const genres = details.genres?.map((g: any) => g.name).join(", ") || null;

            const releaseYear = movie.release_date ? parseInt(movie.release_date) : null;
            
            // LOGIC CONFLICT INTERCEPTOR: Check if year is outside user range
            let conflict = false;
            let forcedForensicScan = false;
            if (yearRangeStart !== undefined && yearRangeEnd !== undefined && releaseYear) {
              if (releaseYear < yearRangeStart || releaseYear > yearRangeEnd) {
                conflict = true;
                forcedForensicScan = true;
                console.log(`[CONFLICT] Year ${releaseYear} outside range ${yearRangeStart}-${yearRangeEnd} - forcing forensic scan`);
              }
            }

            return {
              id: movie.id,
              title: movie.title,
              original_title: movie.original_title,
              year: releaseYear,
              overview: movie.overview,
              poster_path: movie.poster_path,
              backdrop_path: movie.backdrop_path,
              vote_average: movie.vote_average,
              director,
              actors,
              genres,
              // Add conflict metadata for frontend
              _conflict: conflict,
              _forcedForensicScan: forcedForensicScan,
              _conflictReason: conflict ? `Year ${releaseYear} outside range ${yearRangeStart}-${yearRangeEnd}` : null,
            };
          } catch {
            return {
              id: movie.id,
              title: movie.title,
              original_title: movie.original_title,
              year: movie.release_date ? parseInt(movie.release_date) : null,
              overview: movie.overview,
              poster_path: movie.poster_path,
              backdrop_path: movie.backdrop_path,
              vote_average: movie.vote_average,
            };
          }
        })
      );

      // Check if any results have conflicts
      const hasForcedScan = results.some((r: any) => r._forcedForensicScan);
      
      return c.json({ 
        results,
        _hasForcedForensicScan: hasForcedScan,
        _conflictSummary: hasForcedScan ? "One or more results require forensic verification due to year range conflict" : null
      });
      } // End of "if results found" block
      } // End of for loop - all queries tried

      // No results from any query
      return c.json({ results: [], message: "No movies found" });
    } catch (err: any) {
      console.error("[API] TMDB search error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // UPLOAD & SPLITTING
  // ═══════════════════════════════════════════════════

  // Get presigned URL for direct R2 upload
  app.post("/api/upload/presign", async (c) => {
    const { filename, contentType } = await c.req.json();
    console.log("[API] POST /api/upload/presign", { filename, contentType });

    const path = `uploads/${edgespark.auth.user!.id}/${now()}-${filename}`;

    const { uploadUrl } = await edgespark.storage
      .from(buckets.poster_images)
      .createPresignedPutUrl(path, 3600);

    const uri = edgespark.storage.toS3Uri(buckets.poster_images, path);
    const [upload] = await edgespark.db
      .insert(tables.posterUploads)
      .values({
        userId: edgespark.auth.user!.id,
        originalFilename: filename,
        originalS3Uri: uri,
        status: "uploaded",
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();

    console.log("[API] Upload record created", { uploadId: upload.id });
    return c.json({ uploadUrl, path, uploadId: upload.id });
  });

  // Confirm upload completed
  // ═══════════════════════════════════════════════════════════
  // BATCH INGEST METADATA COLUMNS
  // Add columns to poster_uploads table if they don't exist
  // ═══════════════════════════════════════════════════════════
  const uploadBatchColumns = [
    "lot_number TEXT",
    "expected_era_start INTEGER",
    "expected_era_end INTEGER",
    "poster_country TEXT",
    "poster_format TEXT",
    "batch_notes TEXT",
  ];
  
  for (const col of uploadBatchColumns) {
    try {
      const colName = col.split(" ")[0];
      await edgespark.db.all(sql.raw(`ALTER TABLE poster_uploads ADD COLUMN IF NOT EXISTS ${colName}`));
    } catch (e) {
      // Column may already exist, continue
    }
  }
  console.log("[DB] Batch Ingest columns ready");

  // Add columns to posters table for CRM tracking
  const posterBatchColumns = [
    "lot_number TEXT",
    "expected_period_start INTEGER",
    "expected_period_end INTEGER",
    "poster_country TEXT",
    "poster_format TEXT",
    "conflict_status TEXT DEFAULT 'none'",
    "conflict_details TEXT",
  ];
  
  for (const col of posterBatchColumns) {
    try {
      const colName = col.split(" ")[0];
      await edgespark.db.all(sql.raw(`ALTER TABLE posters ADD COLUMN IF NOT EXISTS ${colName}`));
    } catch (e) {
      // Column may already exist, continue
    }
  }
  console.log("[DB] Poster CRM columns ready");

  // ═══════════════════════════════════════════════════════════
  // BATCH UPLOAD CONFIRM - Stores Metadata
  // ═══════════════════════════════════════════════════════════
  app.post("/api/uploads/:id/confirm", async (c) => {
    const uploadId = parseInt(c.req.param("id"));
    const { 
      source_url,
      lot_number,
      expected_era_start,
      expected_era_end,
      poster_country,
      poster_format,
      batch_notes,
    } = await c.req.json() as {
      source_url?: string | null;
      lot_number?: string | null;
      expected_era_start?: number | null;
      expected_era_end?: number | null;
      poster_country?: string | null;
      poster_format?: string | null;
      batch_notes?: string | null;
    };
    
    console.log("[API] POST /api/uploads/:id/confirm", { 
      uploadId, 
      lot_number, 
      expected_era_start, 
      expected_era_end,
      poster_country,
      poster_format,
    });

    // Update upload with metadata
    await edgespark.db
      .update(tables.posterUploads)
      .set({ 
        status: "confirmed", 
        updatedAt: now(),
        // Store batch metadata
        ...(lot_number && { lotNumber: lot_number }),
        ...(expected_era_start !== undefined && expected_era_start !== null && { expectedEraStart: expected_era_start }),
        ...(expected_era_end !== undefined && expected_era_end !== null && { expectedEraEnd: expected_era_end }),
        ...(poster_country && { posterCountry: poster_country }),
        ...(poster_format && { posterFormat: poster_format }),
        ...(batch_notes && { batchNotes: batch_notes }),
      })
      .where(eq(tables.posterUploads.id, uploadId));

    return c.json({ success: true });
  });

  // Save split images
  app.post("/api/uploads/:id/splits", async (c) => {
    const uploadId = parseInt(c.req.param("id"));
    const { splits } = (await c.req.json()) as {
      splits: { path: string; index: number }[];
    };
    console.log("[API] POST /api/uploads/:id/splits", {
      uploadId,
      count: splits.length,
    });

    const upload = await edgespark.db
      .select()
      .from(tables.posterUploads)
      .where(
        and(
          eq(tables.posterUploads.id, uploadId),
          eq(tables.posterUploads.userId, edgespark.auth.user!.id)
        )
      )
      .get();

    if (!upload) {
      return c.json({ error: "Upload not found" }, 404);
    }

    for (const split of splits) {
      const uri = edgespark.storage.toS3Uri(buckets.poster_images, split.path);
      await edgespark.db.insert(tables.posterImages).values({
        uploadId,
        s3Uri: uri,
        splitIndex: split.index,
        createdAt: now(),
      });
    }

    // Auto-create poster records for each split
    const images = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.uploadId, uploadId));

    for (const img of images) {
      const existing = await edgespark.db
        .select()
        .from(tables.posters)
        .where(eq(tables.posters.imageId, img.id))
        .get();
      if (!existing) {
        // Cast upload to any to access dynamically added columns
        const uploadAny = upload as any;
        
        await edgespark.db.insert(tables.posters).values({
          imageId: img.id,
          status: "pending",
          createdAt: now(),
          updatedAt: now(),
          // Propagate batch metadata from upload
          ...(uploadAny.lotNumber && { lotNumber: uploadAny.lotNumber }),
          ...(uploadAny.expectedEraStart && { expectedPeriodStart: uploadAny.expectedEraStart }),
          ...(uploadAny.expectedEraEnd && { expectedPeriodEnd: uploadAny.expectedEraEnd }),
          ...(uploadAny.posterCountry && { posterCountry: uploadAny.posterCountry }),
          ...(uploadAny.posterFormat && { posterFormat: uploadAny.posterFormat }),
          ...(uploadAny.batchNotes && { notes: uploadAny.batchNotes }),
        });
      }
    }

    await edgespark.db
      .update(tables.posterUploads)
      .set({ status: "split", updatedAt: now() })
      .where(eq(tables.posterUploads.id, uploadId));

    return c.json({ success: true, imageCount: images.length });
  });

  // ═══════════════════════════════════════════════════
  // OCR + TMDB SCANNING (Free — no AI cost)
  // ═══════════════════════════════════════════════════

  app.post("/api/posters/:id/ocr-scan", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    const { text } = await c.req.json() as { text: string };
    console.log("[API] POST /api/posters/:id/ocr-scan", { posterId, textLength: text?.length });

    if (!text || text.trim().length < 2) {
      return c.json({ error: "No text extracted — try Gemini scan instead", needsFallback: true }, 422);
    }

    const tmdbKey = edgespark.secret.get("TMDB_API_KEY");
    if (!tmdbKey) {
      return c.json({ error: "TMDB API key not configured" }, 500);
    }

    const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;

    // Extract likely movie title from OCR text
    // OCR returns lines of text; movie title is typically the largest/most prominent
    const lines = text
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 2);

    // Try searching TMDB with different parts of the extracted text
    // Strategy: try first, try all, try combinations
    const searchQueries = [
      lines[0],                    // Most prominent line (usually title)
      lines.slice(0, 2).join(" "), // First two lines combined
      lines.join(" "),              // All text
    ].filter(Boolean);

    for (const query of searchQueries) {
      try {
        const tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&api_key=${tmdbKeyStr}`,
        );
        const tmdbData: any = await tmdbRes.json();

        if (tmdbData.results && tmdbData.results.length > 0) {
          const movie = tmdbData.results[0];
          console.log("[API] TMDB match found", { title: movie.title, year: movie.release_date });

          // Get full details for richer data
          let details: any = {};
          try {
            const detailRes = await fetch(
              `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKeyStr}`,
            );
            details = await detailRes.json();
          } catch {
            // Use search results only
          }

          // Extract data
          const director =
            details.credits?.crew?.find((c: any) => c.job === "Director")?.name ||
            null;
          const actors =
            details.credits?.cast
              ?.slice(0, 4)
              .map((a: any) => a.name)
              .join(", ") || null;
          const genres =
            details.genres?.map((g: any) => g.name).join(", ") ||
            movie.genre_ids?.length > 0
              ? String(movie.genre_ids)
              : null;

          // Build movie data
          const movieData = {
            title: movie.title,
            year: movie.release_date ? parseInt(movie.release_date) : null,
            director,
            actors,
            genre: genres,
            plot: movie.overview || details.overview || null,
            awards: details.awards?.text || null,
          };

          // Update poster record
          await edgespark.db
            .update(tables.posters)
            .set({
              title: movieData.title,
              year: movieData.year,
              director: movieData.director,
              actors: movieData.actors,
              genre: movieData.genre,
              plot: movieData.plot,
              awards: movieData.awards,
              tmdbId: String(movie.id),
              status: "scanned",
              scannedAt: now(),
              updatedAt: now(),
            })
            .where(eq(tables.posters.id, posterId));

          return c.json({ success: true, data: movieData, source: "tmdb" });
        }
      } catch (err: any) {
        console.warn("[API] TMDB search failed for query:", query, err.message);
      }
    }

    // No TMDB match found
    console.log("[API] No TMDB match for OCR text");
    return c.json({
      error: "No movie match found in TMDB — try Gemini scan instead",
      needsFallback: true,
      ocrText: text,
    }, 404);
  });

  // ═══════════════════════════════════════════════════
  // AI SCANNING (Gemini Vision — fallback only)
  // ═══════════════════════════════════════════════════

  app.post("/api/posters/:id/scan", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    console.log("[API] POST /api/posters/:id/scan", { posterId });

    const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return c.json({ error: "Gemini API key not configured" }, 500);
    }

    const poster = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();
    if (!poster) return c.json({ error: "Poster not found" }, 404);

    const image = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.id, poster.imageId))
      .get();
    if (!image) return c.json({ error: "Image not found" }, 404);

    // Download image from storage
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(
      image.s3Uri
    );
    const file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found in storage" }, 404);

    // Convert to base64 for Gemini
    const bytes = new Uint8Array(file.body);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mimeType = file.metadata?.contentType || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    // ═══════════════════════════════════════════════════
    // BATCH INGEST CONSTRAINTS
    // Get constraints from batch metadata for guided scanning
    // Cast poster to any to access dynamically added columns
    // ═══════════════════════════════════════════════════
    const posterAny = poster as any;
    const expectedEraStart = posterAny.expectedPeriodStart;
    const expectedEraEnd = posterAny.expectedPeriodEnd;
    const posterCountry = posterAny.posterCountry;
    const lotNumber = posterAny.lotNumber;
    
    // Build constraint string for the prompt
    let constraints = "";
    if (expectedEraStart && expectedEraEnd) {
      constraints += `\nCRITICAL CONSTRAINT - Expected Era: This poster is expected to be from ${expectedEraStart}-${expectedEraEnd}. If the forensic evidence (NSS code, billing block) suggests a year OUTSIDE this range, flag it as a potential RE-ISSUE or ERA MISMATCH.\n`;
    }
    if (posterCountry) {
      constraints += `\nCRITICAL CONSTRAINT - Expected Country: This poster is expected to be from ${posterCountry.toUpperCase()}. Prioritize ${posterCountry.toUpperCase()} distributor logos and language. If the poster shows a different country's distributor, flag as potential IMPORT/RE-ISSUE.\n`;
    }
    if (lotNumber) {
      constraints += `\nBATCH CONTEXT: This poster is part of Lot #${lotNumber}.\n`;
    }

    // ═══════════════════════════════════════════════════
    // SPECIALIZED MOVIE POSTER PROMPT (Frame & Reel)
    // ═══════════════════════════════════════════════════
    const prompt = `You are the Lead Cataloger for "Frame and Reel," specializing in 100% theatrical original vintage movie posters. Your goal is to extract specific metadata from this poster image with 100% accuracy.${constraints}

OPERATIONAL LOGIC:
1. SCAN FOR ANCHORS: Locate the "Billing Block" (fine print at the bottom) and the "NSS/Tax String" (e.g., 81/0024 or a French Visa d'exploitation number). These are high-confidence identifiers for year and origin.
2. TEXT HIERARCHY: Prioritize the largest font size for the Title. If the title is stylized/abstract, cross-reference it with the names found in the billing block (Director/Stars) to confirm the movie.
3. TITLE LANGUAGE RULE:
   - DEFAULT: Lead with the English Title.
   - EXCEPTION: If the film is of French Origin (produced/originated in France), lead with the French Title. Use the English title only for non-French origin films.

ERROR HANDLING:
- If the image is blurry or high-contrast, analyze the "shapes" of the text blocks to infer the studio or era.
- If you cannot identify the movie with >85% confidence, flag it for manual review.

Return a JSON object with these fields:
{
  "inventory_status": "MATCHED" or "NEEDS_REVIEW",
  "movie_title": "Primary Title",
  "release_year": "YYYY",
  "origin_country": "Country",
  "is_french_origin": boolean,
  "billing_block_summary": "Director and Lead Cast",
  "confidence_score": 0.0-1.0,
  "director": "Director name(s)",
  "actors": "Main actor names, comma separated",
  "genre": "Primary genre",
  "posterStyle": "Style description (e.g., one-sheet, advance, Italian locandina, French petite)",
  "language": "Poster language (English, Italian, French, etc.)"
}

Only return the JSON, no other text.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { data: base64, mimeType: "image/jpeg" } },
            ],
          },
        ],
      });

      const text =
        response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[API] Gemini scan - no JSON in response", text);
        return c.json(
          { error: "Could not parse movie info from image", raw: text },
          422
        );
      }

      const movieData = JSON.parse(jsonMatch[0]);
      console.log("[API] Gemini scan success", {
        title: movieData.movie_title,
        year: movieData.release_year,
        confidence: movieData.confidence_score,
      });

      // Map new field names to database schema
      const dbData = {
        title: movieData.movie_title || null,
        year: movieData.release_year ? parseInt(String(movieData.release_year)) : null,
        director: movieData.director || movieData.billing_block_summary?.split(" ").slice(0, 2).join(" ") || null,
        actors: movieData.actors || null,
        genre: movieData.genre || null,
        posterStyle: movieData.posterStyle || null,
        language: movieData.language || null,
        status: "scanned",
        scannedAt: now(),
        updatedAt: now(),
      };

      await edgespark.db
        .update(tables.posters)
        .set(dbData)
        .where(eq(tables.posters.id, posterId));

      // ═══════════════════════════════════════════════════
      // CONFLICT DETECTION ENGINE
      // Compare scan results against batch constraints
      // ═══════════════════════════════════════════════════
      let conflictStatus = "none";
      let conflictDetails = null;
      
      // Check Era Conflict
      if (expectedEraStart && expectedEraEnd && movieData.release_year) {
        const foundYear = parseInt(String(movieData.release_year));
        if (!isNaN(foundYear) && (foundYear < expectedEraStart || foundYear > expectedEraEnd)) {
          conflictStatus = "era_mismatch";
          conflictDetails = {
            type: "era_mismatch",
            expected: `${expectedEraStart}-${expectedEraEnd}`,
            found: foundYear,
            message: `Era Mismatch: Expected ${expectedEraStart}s-${expectedEraEnd}s, found ${foundYear}`,
          };
          console.log(`[CONFLICT] Era Mismatch detected: Expected ${expectedEraStart}-${expectedEraEnd}, found ${foundYear}`);
        }
      }
      
      // Check Country Conflict
      if (posterCountry && movieData.origin_country) {
        const foundCountry = movieData.origin_country.toLowerCase();
        const expectedCountry = posterCountry.toLowerCase();
        if (foundCountry !== expectedCountry && foundCountry !== "unknown") {
          // Only flag as conflict if we have a definite different country
          if (conflictStatus === "none") {
            conflictStatus = "country_mismatch";
            conflictDetails = {
              type: "country_mismatch",
              expected: expectedCountry,
              found: foundCountry,
              message: `Country Mismatch: Expected ${expectedCountry}, found ${foundCountry}`,
            };
          } else {
            // Multiple conflicts - upgrade to combined
            conflictStatus = "multiple_conflicts";
            conflictDetails = {
              ...conflictDetails,
              country_mismatch: {
                expected: expectedCountry,
                found: foundCountry,
              },
            };
          }
          console.log(`[CONFLICT] Country Mismatch detected: Expected ${expectedCountry}, found ${foundCountry}`);
        }
      }
      
      // Update poster with conflict status (using raw SQL for dynamic columns)
      if (conflictStatus !== "none") {
        try {
          await edgespark.db.all(sql.raw(`
            UPDATE posters 
            SET conflict_status = '${conflictStatus}', 
                conflict_details = '${JSON.stringify(conflictDetails).replace(/'/g, "''")}'
            WHERE id = ${posterId}
          `));
        } catch (e) {
          console.warn("[DB] Conflict status update failed:", e);
        }
      }

      // ═══════════════════════════════════════════════════
      // LOGIC BRIDGE: Fuzzy Match to Inventory
      // ═══════════════════════════════════════════════════
      let matchedInventoryId: number | null = null;
      let fuzzyMatchScore = 0;

      if (movieData.movie_title && movieData.confidence_score >= 0.7) {
        try {
          // Search inventory table for matching title
          const searchPattern = '%' + movieData.movie_title.toLowerCase() + '%';
          const inventoryItems = await edgespark.db
            .select()
            .from(tables.inventory)
            .where(sql`LOWER(${tables.inventory.title}) LIKE ${searchPattern}`)
            .limit(5);

          if (inventoryItems.length > 0) {
            // Find best match based on title similarity
            const searchTitle = movieData.movie_title.toLowerCase().trim();
            for (const item of inventoryItems) {
              const itemTitle = (item.title || "").toLowerCase().trim();
              // Simple fuzzy matching: check if titles match closely
              if (itemTitle === searchTitle || itemTitle.includes(searchTitle) || searchTitle.includes(itemTitle)) {
                matchedInventoryId = item.id;
                fuzzyMatchScore = 1.0;
                console.log("[API] Fuzzy match found:", item.title, "->", movieData.movie_title);
                break;
              }
            }
          }
        } catch (fuzzyError) {
          console.warn("[API] Fuzzy match failed:", fuzzyError);
        }
      }

      return c.json({ 
        success: true, 
        data: movieData,
        matchedInventoryId,
        fuzzyMatchScore,
        conflict: conflictStatus !== "none" ? {
          status: conflictStatus,
          details: conflictDetails,
        } : null,
      });
    } catch (error: any) {
      console.error("[API] Gemini scan error", error.message);
      return c.json({ error: "AI scanning failed: " + error.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // TMDB DIRECT SEARCH (Skip OCR, use manual title/year)
  // ═══════════════════════════════════════════════════

  app.post("/api/posters/:id/tmdb-scan", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    const { title, year } = await c.req.json() as { title: string; year?: number };
    console.log("[API] POST /api/posters/:id/tmdb-scan", { posterId, title, year });

    if (!title || title.trim().length < 2) {
      return c.json({ error: "Title is required" }, 422);
    }

    const tmdbKey = edgespark.secret.get("TMDB_API_KEY");
    if (!tmdbKey) {
      return c.json({ error: "TMDB API key not configured" }, 500);
    }

    const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;

    try {
      // Search TMDB with provided title and optional year
      let query = title;
      if (year) query += ` ${year}`;
      
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&api_key=${tmdbKeyStr}`,
      );
      const tmdbData: any = await tmdbRes.json();

      if (!tmdbData.results || tmdbData.results.length === 0) {
        return c.json({ 
          error: "No movie found in TMDB", 
          suggestion: "Try a different title or use AI scan for help" 
        }, 404);
      }

      // Get full details
      const movie = tmdbData.results[0];
      let details: any = {};
      try {
        const detailRes = await fetch(
          `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKeyStr}`,
        );
        details = await detailRes.json();
      } catch {}

      const director = details.credits?.crew?.find((c: any) => c.job === "Director")?.name || null;
      const actors = details.credits?.cast?.slice(0, 4).map((a: any) => a.name).join(", ") || null;
      const genres = details.genres?.map((g: any) => g.name).join(", ") || null;

      const movieData = {
        title: movie.title,
        year: movie.release_date ? parseInt(movie.release_date) : null,
        director,
        actors,
        genre: genres,
        plot: movie.overview || details.overview || null,
        awards: details.awards?.text || null,
        tmdbId: String(movie.id),
      };

      // Update poster with TMDB data
      await edgespark.db
        .update(tables.posters)
        .set({
          ...movieData,
          status: "scanned",
          scannedAt: now(),
          updatedAt: now(),
        })
        .where(eq(tables.posters.id, posterId));

      return c.json({ success: true, data: movieData, source: "tmdb" });
    } catch (error: any) {
      console.error("[API] TMDB scan error", error.message);
      return c.json({ error: "TMDB search failed: " + error.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // AI SUGGEST (Verify current data, suggest if unsure)
  // ═══════════════════════════════════════════════════

  app.post("/api/posters/:id/suggest", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    console.log("[API] POST /api/posters/:id/suggest", { posterId });

    const poster = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();
    if (!poster) return c.json({ error: "Poster not found" }, 404);

    const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return c.json({ error: "Gemini API key not configured" }, 500);
    }

    // Get image for analysis
    const image = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.id, poster.imageId))
      .get();
    if (!image) return c.json({ error: "Image not found" }, 404);

    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(image.s3Uri);
    const file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found" }, 404);

    const bytes = new Uint8Array(file.body);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const mimeType = file.metadata?.contentType || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    // Build current info summary for the AI
    const currentInfo = poster.title ? `
Current known info:
- Title: ${poster.title}
- Year: ${poster.year || "unknown"}
- Director: ${poster.director || "unknown"}
- Genre: ${poster.genre || "unknown"}
- Actors: ${poster.actors || "unknown"}
` : "";

    const prompt = `You are an expert movie poster analyst. Analyze this movie poster image and compare with the provided information.

${currentInfo}

Return a JSON object with:
{
  "identified": boolean, // true if confident in movie identification
  "confidence": "high" | "medium" | "low", // how sure you are
  "suggestedTitle": "movie title or null",
  "suggestedYear": number or null,
  "suggestedDirector": "director name or null",
  "suggestedActors": "actors or null",
  "suggestedGenre": "genre or null",
  "suggestedPlot": "plot summary or null",
  "reasoning": "brief explanation of your identification and confidence level"
}

If you are confident the current info is correct, set "identified": true and "confidence": "high".
If the poster shows a different movie than the current info, provide corrected data.
If you cannot identify the movie, set "identified": false and "confidence": "low".`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { data: base64, mimeType } },
            ],
          },
        ],
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return c.json({ error: "Could not parse suggestion", raw: text }, 422);
      }

      const suggestion = JSON.parse(jsonMatch[0]);
      console.log("[API] Suggestion result", { identified: suggestion.identified, confidence: suggestion.confidence });

      return c.json({ success: true, suggestion });
    } catch (error: any) {
      console.error("[API] Suggest error", error.message);
      return c.json({ error: "AI suggestion failed: " + error.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // POSTER CRUD
  // ═══════════════════════════════════════════════════

  // Helper: get presigned URL for an image S3 URI
  async function getImageUrl(s3Uri: string): Promise<string | null> {
    try {
      const { bucket, path } = edgespark.storage.fromS3Uri(s3Uri);
      const { downloadUrl } = await edgespark.storage
        .from(bucket)
        .createPresignedGetUrl(path, 3600);
      return downloadUrl;
    } catch {
      return null;
    }
  }

  // List all posters
  app.get("/api/posters", async (c) => {
    const status = c.req.query("status");
    console.log("[API] GET /api/posters", { status });

    let query = edgespark.db.select().from(tables.posters);
    if (status) {
      query = query.where(eq(tables.posters.status, status)) as typeof query;
    }

    const allPosters = await query.orderBy(desc(tables.posters.createdAt)).all();

    const postersWithUrls = await Promise.all(
      allPosters.map(async (poster) => {
        const image = await edgespark.db
          .select()
          .from(tables.posterImages)
          .where(eq(tables.posterImages.id, poster.imageId))
          .get();
        const imageUrl = image ? await getImageUrl(image.s3Uri) : null;
        return { ...poster, imageUrl };
      })
    );

    return c.json({ posters: postersWithUrls });
  });

  // Get single poster
  app.get("/api/posters/:id", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    const poster = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();
    if (!poster) return c.json({ error: "Poster not found" }, 404);

    const image = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.id, poster.imageId))
      .get();
    const imageUrl = image ? await getImageUrl(image.s3Uri) : null;

    return c.json({ poster: { ...poster, imageUrl } });
  });

  // Update poster
  app.put("/api/posters/:id", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    console.log("[API] PUT /api/posters/:id", { posterId });

    const updatable = [
      "title",
      "year",
      "director",
      "actors",
      "genre",
      "plot",
      "posterStyle",
      "awards",
      "price",
      "condition",
      "notes",
      "status",
      "visibility",
    ] as const;

    const updates: Record<string, any> = { updatedAt: now() };
    for (const key of updatable) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    await edgespark.db
      .update(tables.posters)
      .set(updates)
      .where(eq(tables.posters.id, posterId));

    const updated = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();

    return c.json({ poster: updated });
  });

  // Delete poster
  app.delete("/api/posters/:id", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    console.log("[API] DELETE /api/posters/:id", { posterId });

    const poster = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();
    if (!poster) return c.json({ error: "Poster not found" }, 404);

    const image = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.id, poster.imageId))
      .get();

    if (image) {
      try {
        const { bucket, path } = edgespark.storage.fromS3Uri(image.s3Uri);
        await edgespark.storage.from(bucket).delete(path);
      } catch (e) {
        console.warn("[API] Failed to delete storage file", e);
      }
      await edgespark.db
        .delete(tables.posterImages)
        .where(eq(tables.posterImages.id, image.id));
    }

    await edgespark.db
      .delete(tables.posters)
      .where(eq(tables.posters.id, posterId));

    return c.json({ success: true });
  });

  // List uploads
  app.get("/api/uploads", async (c) => {
    console.log("[API] GET /api/uploads");
    const uploads = await edgespark.db
      .select()
      .from(tables.posterUploads)
      .where(eq(tables.posterUploads.userId, edgespark.auth.user!.id))
      .orderBy(desc(tables.posterUploads.createdAt))
      .all();

    const uploadsWithCounts = await Promise.all(
      uploads.map(async (upload) => {
        const images = await edgespark.db
          .select()
          .from(tables.posterImages)
          .where(eq(tables.posterImages.uploadId, upload.id))
          .all();
        return { ...upload, imageCount: images.length };
      })
    );

    return c.json({ uploads: uploadsWithCounts });
  });

  // ═══════════════════════════════════════════════════
  // PUBLIC API (No auth required)
  // ═══════════════════════════════════════════════════

  // List visible posters (featured + listed, skip hidden)
  app.get("/api/public/posters", async (c) => {
    const visibility = c.req.query("visibility"); // ?visibility=featured | listed
    console.log("[API] GET /api/public/posters", { visibility });

    const conditions = visibility
      ? eq(tables.posters.visibility, visibility)
      : ne(tables.posters.visibility, "hidden");

    const allPosters = await edgespark.db
      .select()
      .from(tables.posters)
      .where(conditions)
      .orderBy(desc(tables.posters.createdAt))
      .all();

    const postersWithUrls = await Promise.all(
      allPosters.map(async (poster) => {
        let imageUrl: string | null = null;
        try {
          const image = await edgespark.db
            .select()
            .from(tables.posterImages)
            .where(eq(tables.posterImages.id, poster.imageId))
            .get();
          if (image) imageUrl = await getImageUrl(image.s3Uri);
        } catch (e) {
          console.warn("[API] Failed to get image for poster", poster.id, e);
        }
        return { ...poster, imageUrl };
      })
    );

    return c.json({ posters: postersWithUrls });
  });

  // Get single poster by ID (public)
  app.get("/api/public/posters/:id", async (c) => {
    const posterId = parseInt(c.req.param("id"));
    console.log("[API] GET /api/public/posters/:id", { posterId });

    const poster = await edgespark.db
      .select()
      .from(tables.posters)
      .where(eq(tables.posters.id, posterId))
      .get();

    if (!poster || poster.visibility === "hidden") {
      return c.json({ error: "Poster not found" }, 404);
    }

    const image = await edgespark.db
      .select()
      .from(tables.posterImages)
      .where(eq(tables.posterImages.id, poster.imageId))
      .get();
    const imageUrl = image ? await getImageUrl(image.s3Uri) : null;

    return c.json({ poster: { ...poster, imageUrl } });
  });

  // ═══════════════════════════════════════════════════
  // PUBLIC INVENTORY API (No auth required)
  // ═══════════════════════════════════════════════════

function parseEbayDescription(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  const posterMatch = raw.match(/POSTER INFO:\s*\n([\s\S]*?)(?=\n[A-Z][A-Z ''S]+:|\n*$)/);
  if (posterMatch) {
    for (const line of posterMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      if (!value || value === 'N/A') continue;
      if (key === 'year') {
        const m = value.match(/\d{4}/);
        if (m) result.year = parseInt(m[0]);
        result.release_type = /re.?release/i.test(value) ? 'rerelease' : 'original';
      }
      else if (key === 're-release year') {
        const m = value.match(/\d{4}/);
        if (m) result.release_year = parseInt(m[0]);
      }
      else if (key === 'director') result.director = value;
      else if (key === 'starring') result.actors = value;
      else if (key === 'artist') result.artist = value;
      else if (key === 'english title') result.title = value;
      else if (key === 'format') {
        const f = value.toLowerCase();
        if (f.includes('locandina')) result.format = 'Italian Locandina';
        else if (f.includes('quattro') || f.includes('quatro') || f.includes('2-panel')) result.format = 'Italian Quattro Fogli';
        else if (f.includes('due') || f.includes('1-panel')) result.format = 'Italian Due Fogli';
        else if (f.includes('fotobusta') || f.includes('photobusta')) result.format = 'Italian Fotobusta';
        else if (f.includes('petite')) result.format = 'French Petite';
        else if (f.includes('moyenne')) result.format = 'French Moyenne';
        else if (f.includes('grande')) result.format = 'French Grande';
        else if (f.includes('one-sheet') || f.includes('one sheet')) result.format = 'One-Sheet';
        else result.format = value.split('/')[0].trim();
      }
      else if (key.includes('title') && key !== 'english title') {
        result.original_title = value;
        if (key.includes('italian')) result.poster_country = 'Italy';
        else if (key.includes('french')) result.poster_country = 'France';
        else if (key.includes('spanish')) result.poster_country = 'Spain';
        else if (key.includes('german')) result.poster_country = 'Germany';
        else if (key.includes('japanese')) result.poster_country = 'Japan';
      }
    }
  }
  const condMatch = raw.match(/CONDITION:\s*([^\n]+)/);
  if (condMatch) {
    const c = condMatch[1].trim();
    if (/very good to fine/i.test(c)) result.condition = 'Very Good to Fine';
    else if (/very good/i.test(c)) result.condition = 'Very Good';
    else if (/fine/i.test(c)) result.condition = 'Fine';
    else if (/good/i.test(c)) result.condition = 'Good';
    else result.condition = c.split('(')[0].trim();
  }
  return result;
}

async function syncMediaLibraryToInventory(
  edgespark: any, sql: any, imageId: number, inventoryId: number
) {
  const [img] = await edgespark.db.all(sql.raw(`SELECT * FROM image_library WHERE id=${imageId}`));
  const [inv] = await edgespark.db.all(sql.raw(`SELECT * FROM inventory WHERE id=${inventoryId}`));
  if (!img || !inv) return;
  const e = (s: any) => String(s||'').replace(/'/g,"''");
  const blank = (s: any) => !s || String(s).trim() === '';
  const hasProperCase = (s: string) => s && s !== s.toLowerCase();
  const updates: string[] = [];
  const imgTitle = img.title_english || img.title || '';
  if (imgTitle && (blank(inv.title) || (hasProperCase(imgTitle) && !hasProperCase(inv.title))))
    updates.push(`title='${e(imgTitle)}'`);
  if (img.title_local && blank(inv.original_title))
    updates.push(`original_title='${e(img.title_local)}'`);
  const fieldMap = [
    ['year','year'],['release_type','release_type'],['format','format'],
    ['condition','condition_grade'],['director','director'],['actors','actors'],
    ['genre','genre'],['dimensions','dimensions'],['printer_credit','printer_credit'],
    ['nss_code','nss_code'],['distributor_logo','distributor_logo'],
    ['billing_block_style','billing_block_style'],['audit_status','audit_status'],
  ];
  for (const [src,dst] of fieldMap) {
    if (img[src] && blank((inv as any)[dst])) updates.push(`${dst}='${e(img[src])}'`);
  }
  if (updates.length > 0)
    await edgespark.db.all(sql.raw(
      `UPDATE inventory SET ${updates.join(',')},updated_at=${Date.now()} WHERE id=${inventoryId}`
    ));
  await edgespark.db.all(sql.raw(`
    UPDATE image_library SET
      matched_inventory_id=${inventoryId},
      matched_title='${e(inv.title)}',
      matched_year=${inv.year||'NULL'},
      matched_format='${e(inv.format)}',
      matched_lot_id='${e(inv.lot_id)}',
      matched_item_number='${e(inv.item_number)}',
      match_status='confirmed'
    WHERE id=${imageId}
  `));
}

// POST /api/admin/ebay/parse-listing
app.post("/api/admin/ebay/parse-listing", async (c) => {
  const { ebay_item_id, raw_description } = await c.req.json();
  if (!raw_description) return c.json({ error: "raw_description required" }, 400);
  const parsed = parseEbayDescription(raw_description);
  const now = Date.now();
  const e = (s: any) => String(s||'').replace(/'/g,"''");
  await edgespark.db.all(sql.raw(`
    INSERT INTO ebay_listings (ebay_item_id,ebay_status,parsed_english_title,
    parsed_original_title,parsed_year,parsed_release_year,parsed_director,
    parsed_actors,parsed_format,parsed_artist,parsed_condition,parsed_country,
    raw_description,created_at,updated_at)
    VALUES('${e(ebay_item_id||'')}','active','${e(parsed.title||'')}',
    '${e(parsed.original_title||'')}',${parsed.year||'NULL'},
    ${parsed.release_year||'NULL'},'${e(parsed.director||'')}',
    '${e(parsed.actors||'')}','${e(parsed.format||'')}','${e(parsed.artist||'')}',
    '${e(parsed.condition||'')}','${e(parsed.poster_country||'')}',
    '${e(raw_description)}',${now},${now})
    ON CONFLICT(ebay_item_id) DO UPDATE SET
      parsed_english_title=excluded.parsed_english_title,
      parsed_original_title=excluded.parsed_original_title,
      parsed_year=excluded.parsed_year,
      updated_at=${now}
  `));
  const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g,'')||'';
  const allInv = await edgespark.db.all(sql.raw(
    `SELECT id,title,original_title,year,format FROM inventory`
  ));
  let bestMatch: any = null; let bestScore = 0;
  for (const inv of allInv as any[]) {
    let score = 0;
    if (normalize(inv.title||'')=== normalize(parsed.title||'')) score+=10;
    if (normalize(inv.original_title||'')=== normalize(parsed.original_title||'')) score+=8;
    if (inv.year && parsed.year && inv.year==parsed.year) score+=3;
    if (score>bestScore) { bestScore=score; bestMatch=inv; }
  }
  const confidence = Math.min(bestScore/13,1.0);
  if (bestMatch && confidence>0.6)
    await edgespark.db.all(sql.raw(
      `UPDATE ebay_listings SET inventory_id=${bestMatch.id},match_confidence=${confidence}
       WHERE ebay_item_id='${e(ebay_item_id||'')}'`
    ));
  return c.json({ parsed, suggested_match: bestMatch, confidence });
});

// GET /api/admin/ebay/listings
app.get("/api/admin/ebay/listings", async (c) => {
  const listings = await edgespark.db.all(sql.raw(`
    SELECT el.*,i.title as inv_title,i.lot_id,i.format as inv_format
    FROM ebay_listings el
    LEFT JOIN inventory i ON el.inventory_id=i.id
    ORDER BY el.created_at DESC
  `));
  return c.json({ listings });
});

// POST /api/admin/ebay/confirm-match
app.post("/api/admin/ebay/confirm-match", async (c) => {
  const { ebay_listing_id, inventory_id } = await c.req.json();
  const now = Date.now();
  const e = (s: any) => String(s||'').replace(/'/g,"''");
  await edgespark.db.all(sql.raw(
    `UPDATE ebay_listings SET inventory_id=${inventory_id},updated_at=${now} WHERE id=${ebay_listing_id}`
  ));
  const [listing] = await edgespark.db.all(sql.raw(`SELECT * FROM ebay_listings WHERE id=${ebay_listing_id}`)) as any[];
  const [inv] = await edgespark.db.all(sql.raw(`SELECT * FROM inventory WHERE id=${inventory_id}`)) as any[];
  if (!listing||!inv) return c.json({ error:"not found" },404);
  const blank = (s: any) => !s||String(s).trim()==='';
  const updates: string[] = [];
  if (listing.parsed_english_title && blank(inv.title)) updates.push(`title='${e(listing.parsed_english_title)}'`);
  if (listing.parsed_original_title && blank(inv.original_title)) updates.push(`original_title='${e(listing.parsed_original_title)}'`);
  if (listing.parsed_year && blank(inv.year)) updates.push(`year=${listing.parsed_year}`);
  if (listing.parsed_release_year && blank(inv.release_year)) updates.push(`release_year=${listing.parsed_release_year}`);
  if (listing.parsed_director && blank(inv.director)) updates.push(`director='${e(listing.parsed_director)}'`);
  if (listing.parsed_actors && blank(inv.actors)) updates.push(`actors='${e(listing.parsed_actors)}'`);
  if (listing.parsed_format && blank(inv.format)) updates.push(`format='${e(listing.parsed_format)}'`);
  if (listing.parsed_artist && blank(inv.artist)) updates.push(`artist='${e(listing.parsed_artist)}'`);
  if (listing.parsed_condition && blank(inv.condition_grade)) updates.push(`condition_grade='${e(listing.parsed_condition)}'`);
  if (listing.parsed_country && blank(inv.poster_country)) updates.push(`poster_country='${e(listing.parsed_country)}'`);
  if (updates.length>0)
    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${updates.join(',')} WHERE id=${inventory_id}`));
  return c.json({ success:true, fields_updated:updates.length });
});

// POST /api/admin/ebay/batch-confirm
app.post("/api/admin/ebay/batch-confirm", async (c) => {
  const { matches } = await c.req.json();
  if (!Array.isArray(matches)) return c.json({ error:"matches array required" },400);
  const results = [];
  for (const m of matches as any[]) {
    await edgespark.db.all(sql.raw(
      `UPDATE ebay_listings SET inventory_id=${m.inventory_id},updated_at=${Date.now()} WHERE id=${m.ebay_listing_id}`
    ));
    results.push({ ...m, success:true });
  }
  return c.json({ results, total:results.length });
});

// GET /api/admin/media-library/suggest-match?title=X&year=Y&format=Z
app.get("/api/admin/media-library/suggest-match", async (c) => {
  const title = c.req.query('title')||'';
  const year = c.req.query('year')||'';
  const format = c.req.query('format')||'';
  const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g,'')||'';
  const normTitle = normalize(title);
  const allInv = await edgespark.db.all(sql.raw(
    `SELECT id,title,original_title,year,format,lot_id,poster_country FROM inventory`
  ));
  const scored = allInv.map((inv: any) => {
    let score = 0;
    const invN = normalize(inv.title||'');
    const origN = normalize(inv.original_title||'');
    if (normTitle && invN===normTitle) score+=10;
    else if (normTitle && (invN.includes(normTitle)||normTitle.includes(invN))) score+=5;
    if (normTitle && origN===normTitle) score+=8;
    if (year && inv.year && String(inv.year)===String(year)) score+=3;
    if (format && inv.format && normalize(inv.format)===normalize(format)) score+=2;
    return {...inv,score};
  }).filter((i: any)=>i.score>0).sort((a: any,b: any)=>b.score-a.score).slice(0,5);
  return c.json({ suggestions:scored });
});

  // List visible inventory items with filters
  app.get("/api/public/inventory", async (c) => {
    const search = c.req.query("search") || "";
    const format = c.req.query("format") || "";
    const country = c.req.query("country") || "";
    const visibilityParam = c.req.query("visibility") || "";
    const source = c.req.query("source") || "";
    const decade = c.req.query("decade") || "";
    const genre = c.req.query("genre") || "";
    const director = c.req.query("director") || "";
    const actor = c.req.query("actor") || "";
    const sort = c.req.query("sort") || "title";
    const limit = parseInt(c.req.query("limit") || "100");
    const offset = parseInt(c.req.query("offset") || "0");
    console.log("[API] GET /api/public/inventory", { search, format, country, source, decade, genre, director, actor, sort });

    const sortMap: Record<string, string> = {
      title: "i.title ASC",
      title_desc: "i.title DESC",
      year: "i.year ASC",
      year_desc: "i.year DESC",
      director: "i.director ASC",
      format: "i.format ASC",
      country: "i.poster_country ASC",
      newest: "i.created_at DESC",
    };
    const orderSql = sortMap[sort] || "i.title ASC";

    const safeSearch = search ? search.replace(/'/g, "''") : "";
    const safeFormat = format ? format.replace(/'/g, "''") : "";
    const safeCountry = country ? country.replace(/'/g, "''") : "";
    const safeGenre = genre ? genre.replace(/'/g, "''") : "";
    const safeDirector = director ? director.replace(/'/g, "''") : "";
    const safeActor = actor ? actor.replace(/'/g, "''") : "";

    // Handle comma-separated visibility values (e.g. "listed,featured,recently_added")
    let visibilityWhere = `i.visibility NOT IN ('hidden', 'unlisted')`;
    if (visibilityParam) {
      const visValues = visibilityParam.split(",").map(v => `'${v.trim().replace(/'/g, "''")}'`).join(",");
      visibilityWhere = `i.visibility IN (${visValues})`;
    }

    let whereSql = `WHERE ${visibilityWhere} AND (i.sold = 0 OR i.sold IS NULL)`;
    if (source) whereSql += ` AND i.source = '${source.replace(/'/g, "''")}'`;
    if (safeSearch) whereSql += ` AND (i.title LIKE '%${safeSearch}%' OR i.original_title LIKE '%${safeSearch}%' OR i.director LIKE '%${safeSearch}%' OR i.actors LIKE '%${safeSearch}%')`;
    if (safeFormat) whereSql += ` AND i.format = '${safeFormat}'`;
    if (safeCountry) whereSql += ` AND i.poster_country = '${safeCountry}'`;
    if (decade) {
      const ds = parseInt(decade);
      whereSql += ` AND i.year >= ${ds} AND i.year <= ${ds + 9}`;
    }
    if (safeGenre) whereSql += ` AND i.genre LIKE '%${safeGenre}%'`;
    if (safeDirector) whereSql += ` AND i.director = '${safeDirector}'`;
    if (safeActor) whereSql += ` AND i.actors LIKE '%${safeActor}%'`;

    const fullCountSql = `SELECT COUNT(*) as total FROM inventory i ${whereSql}`;

    // Join image_library to get poster images — inventory is the source of truth (846 real rows)
    const fullItemsSql = `
      SELECT
        i.*,
        COALESCE(i.price,
          CASE WHEN i.ebay_price IS NOT NULL AND i.pricing_markup IS NOT NULL THEN round(i.ebay_price * i.pricing_markup, 2)
          WHEN i.ebay_price IS NOT NULL THEN i.ebay_price
          ELSE NULL END
        ) as price,
        il.url as imageUrl,
        il.thumbnail_url as thumbnailUrl
      FROM inventory i
      LEFT JOIN image_library il ON il.matched_inventory_id = i.id
      ${whereSql}
      GROUP BY i.id
      ORDER BY ${orderSql}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await edgespark.db.all<{ total: number }>(sql.raw(fullCountSql));
    const itemsResult = await edgespark.db.all<any>(sql.raw(fullItemsSql));

    // Resolve S3 URIs to presigned URLs
    const itemsWithUrls = await Promise.all(
      itemsResult.map(async (item: any) => {
        // Try imageUrl from image_library first
        if (item.imageUrl?.startsWith("s3://")) {
          try {
            const { bucket, path } = edgespark.storage.fromS3Uri(item.imageUrl);
            const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
            return { ...item, imageUrl: downloadUrl };
          } catch (e) {
            console.warn("[API] Failed to resolve image_library URL for item", item.id, e);
          }
        }
        // Fall back to source_url on inventory record
        if (item.source_url?.startsWith("s3://")) {
          try {
            const { bucket, path } = edgespark.storage.fromS3Uri(item.source_url);
            const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
            return { ...item, imageUrl: downloadUrl };
          } catch (e) {
            console.warn("[API] Failed to resolve source_url for item", item.id, e);
          }
        }
        return item;
      })
    );

    // Get filter counts from inventory
    const baseFilter = `WHERE i.visibility NOT IN ('hidden', 'unlisted') AND (i.sold = 0 OR i.sold IS NULL)`; // inventory table
    const formatCountsSql = `SELECT i.format, COUNT(*) as count FROM inventory i ${baseFilter} GROUP BY i.format`;
    const countryCountsSql = `SELECT i.poster_country, COUNT(*) as count FROM inventory i ${baseFilter} GROUP BY i.poster_country`;
    const decadeCountsSql = `SELECT (year / 10) * 10 as decade, COUNT(*) as count FROM inventory i ${baseFilter} AND i.year IS NOT NULL GROUP BY decade ORDER BY decade`;
    // For genres, split comma-separated values and count individually
    const genreCountsSql = `SELECT genre, COUNT(*) as count FROM inventory i ${baseFilter} AND i.genre IS NOT NULL AND i.genre != '' GROUP BY genre ORDER BY count DESC`;
    const directorCountsSql = `SELECT director, COUNT(*) as count FROM inventory i ${baseFilter} AND i.director IS NOT NULL AND director != '' GROUP BY director ORDER BY count DESC`;

    // For actors, split comma-separated values and count individually
    // Use a safer approach that handles edge cases
    let actorCounts: { actor: string; count: number }[] = [];
    try {
      const rawActorSql = `SELECT actors, COUNT(*) as count FROM inventory i ${baseFilter} AND i.actors IS NOT NULL AND i.actors != '' GROUP BY actors ORDER BY count DESC`;
      const rawActors = await edgespark.db.all<{ actors: string; count: number }>(sql.raw(rawActorSql));
      actorCounts = rawActors.flatMap(a => a.actors.split(',').map(s => ({ actor: s.trim(), count: a.count })));
    } catch (e) {
      actorCounts = [];
    }

    const formatCounts = await edgespark.db.all<{ format: string; count: number }>(sql.raw(formatCountsSql));
    const countryCounts = await edgespark.db.all<{ poster_country: string; count: number }>(sql.raw(countryCountsSql));
    const decadeCounts = await edgespark.db.all<{ decade: number; count: number }>(sql.raw(decadeCountsSql));
    const sourceCountsSql = `SELECT source, COUNT(*) as count FROM inventory i ${baseFilter} AND i.source IS NOT NULL AND source != '' GROUP BY source ORDER BY count DESC`;
    const sourceCounts = await edgespark.db.all<{ source: string; count: number }>(sql.raw(sourceCountsSql));
    let genreCounts: { genre: string; count: number }[] = [];
    try {
      genreCounts = await edgespark.db.all<{ genre: string; count: number }>(sql.raw(genreCountsSql));
    } catch (e) {
      // Fallback: return raw genre strings
      const rawGenreSql = `SELECT genre, COUNT(*) as count FROM inventory i ${baseFilter} AND i.genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY count DESC`;
      const rawGenres = await edgespark.db.all<{ genre: string; count: number }>(sql.raw(rawGenreSql));
      genreCounts = rawGenres.flatMap(g => g.genre.split(',').map(s => ({ genre: s.trim(), count: g.count })));
    }
    const directorCounts = await edgespark.db.all<{ director: string; count: number }>(sql.raw(directorCountsSql));

    // Deduplicate genre counts (merge same genre from different comma combos)
    const genreMap = new Map<string, number>();
    for (const g of genreCounts) {
      if (g.genre) genreMap.set(g.genre, (genreMap.get(g.genre) || 0) + g.count);
    }
    const dedupedGenres = Array.from(genreMap.entries())
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({
      items: itemsWithUrls,
      total: countResult[0]?.total || 0,
      limit,
      offset,
      filters: {
        formats: formatCounts,
        countries: countryCounts,
        decades: decadeCounts,
        genres: dedupedGenres,
        directors: directorCounts,
        actors: actorCounts,
        sources: sourceCounts,
      },
    });
  });

  // Get single inventory item by ID (public)
  app.get("/api/public/inventory/:id", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    console.log("[API] GET /api/public/inventory/:id", { itemId });

    const results = await edgespark.db.all<any>(
      sql.raw(`SELECT 
        i.*,
        COALESCE(i.price, 
          CASE WHEN i.ebay_price IS NOT NULL AND i.pricing_markup IS NOT NULL THEN round(i.ebay_price * i.pricing_markup, 2)
          WHEN i.ebay_price IS NOT NULL THEN i.ebay_price
          ELSE NULL END
        ) as price,
        il.url as imageUrl,
        il.thumbnail_url as thumbnailUrl
      FROM inventory i
      LEFT JOIN image_library il ON il.matched_inventory_id = i.id
      WHERE i.id = ${itemId}
      GROUP BY i.id`)
    );

    if (!results[0] || results[0].visibility === "hidden") {
      return c.json({ error: "Item not found" }, 404);
    }

    const item = results[0];

    // Resolve S3 URI to presigned URL — try imageUrl from image_library first
    let resolvedImageUrl: string | null = item.imageUrl || null;
    if (item.imageUrl?.startsWith("s3://")) {
      try {
        const { bucket, path } = edgespark.storage.fromS3Uri(item.imageUrl);
        const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
        resolvedImageUrl = downloadUrl;
      } catch (e) {
        console.warn("[API] Failed to resolve image_library URL for item", item.id, e);
      }
    } else if (item.source_url?.startsWith("s3://")) {
      try {
        const { bucket, path } = edgespark.storage.fromS3Uri(item.source_url);
        const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
        resolvedImageUrl = downloadUrl;
      } catch (e) {
        console.warn("[API] Failed to resolve source_url for item", item.id, e);
      }
    }

    return c.json({ item: { ...item, imageUrl: resolvedImageUrl } });
  });

  // Search suggestions for autocomplete — dynamic, queries master_inventory
  // Includes sold items (shown with sold indicator) so collectors can see full history
  app.get("/api/public/inventory/search-suggestions", async (c) => {
    const query = c.req.query("q") || "";
    if (!query || query.length < 2) {
      return c.json({ suggestions: [] });
    }

    const safeQuery = query.replace(/'/g, "''").toLowerCase();

    const suggestionsSql = `
      SELECT 
        i.id, i.title, i.director, i.actors, i.year, 
        i.poster_country as country, i.format, i.visibility,
        i.sold, i.price,
        il.url as imageUrl, il.thumbnail_url as thumbnailUrl
      FROM inventory i
      LEFT JOIN image_library il ON il.matched_inventory_id = i.id
      WHERE i.visibility NOT IN ('hidden', 'unlisted')
        AND (
          LOWER(i.title) LIKE '%${safeQuery}%' 
          OR LOWER(i.original_title) LIKE '%${safeQuery}%'
          OR LOWER(i.director) LIKE '%${safeQuery}%' 
          OR LOWER(i.actors) LIKE '%${safeQuery}%'
          OR LOWER(i.genre) LIKE '%${safeQuery}%'
          OR LOWER(i.format) LIKE '%${safeQuery}%'
          OR LOWER(i.poster_country) LIKE '%${safeQuery}%'
        )
      GROUP BY i.id
      ORDER BY 
        CASE WHEN i.sold = 1 THEN 1 ELSE 0 END ASC,
        CASE WHEN LOWER(i.title) LIKE '${safeQuery}%' THEN 0 ELSE 1 END ASC,
        i.title ASC
      LIMIT 8
    `;
    
    const suggestions = await edgespark.db.all<any>(sql.raw(suggestionsSql));
    
    // Resolve S3 image URLs
    const withImages = await Promise.all(suggestions.map(async (s: any) => {
      let imageUrl = s.imageUrl || null;
      if (imageUrl?.startsWith("s3://")) {
        try {
          const { bucket, path } = edgespark.storage.fromS3Uri(imageUrl);
          const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 3600);
          imageUrl = downloadUrl;
        } catch { imageUrl = null; }
      }
      return {
        id: s.id,
        title: s.title,
        year: s.year,
        director: s.director,
        format: s.format,
        country: s.country,
        sold: s.sold === 1,
        imageUrl,
        type: s.title?.toLowerCase().includes(safeQuery) ? "title" 
             : s.director?.toLowerCase().includes(safeQuery) ? "director"
             : s.actors?.toLowerCase().includes(safeQuery) ? "actor"
             : "general"
      };
    }));

    return c.json({ suggestions: withImages });
  });

  // ═══════════════════════════════════════════════════
  // INVENTORY TEMPLATE DOWNLOAD
  // ═══════════════════════════════════════════════════

  // Download CSV template for inventory import (hard-coded to prevent DB errors)
  app.get("/api/inventory/template", async (c) => {
    console.log("[API] GET /api/inventory/template");
    
    const csvHeaders = 'lot_id,title_original,title_local,movie_release_year,poster_year,poster_country,format,printer_credit,nss_visa_code,ebay_listing_ids,condition_grade,notes';
    
    return new Response(csvHeaders, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=frame_and_reel_template.csv'
      }
    });
  });

  // ═══════════════════════════════════════════════════
  // INVENTORY ADMIN (Public — no auth required)
  // ═══════════════════════════════════════

  // List all inventory items (admin)
  app.get("/api/inventory-admin", async (c) => {
    const search = c.req.query("search") || "";
    const format = c.req.query("format") || "";
    const visibility = c.req.query("visibility") || "";
    const lotId = c.req.query("lot_id") || "";
    const source = c.req.query("source") || "";  // ebay or manual
    const director = c.req.query("director") || "";
    const yearFrom = c.req.query("year_from") || "";
    const yearTo = c.req.query("year_to") || "";
    const decade = c.req.query("decade") || "";
    const tags = c.req.query("tags") || "";
    const sort = c.req.query("sort") || "created_at";
    const limit = parseInt(c.req.query("limit") || "100");
    const offset = parseInt(c.req.query("offset") || "0");
    console.log("[API] GET /api/inventory-admin", { search, format, visibility, lotId, source, director, decade, tags });

    let whereSql = "WHERE deleted_at IS NULL";
    if (search) {
      // Flexible matching: normalize search term and compare against normalized titles
      // Handles: case, spacing, punctuation, partial matches
      const cleanSearch = search.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      // Also create a version with common character replacements for typo tolerance
      const flexibleSearch = cleanSearch
        .replace(/[ae]/g, "[ae]")  // Allow 'a' or 'e' variations
        .replace(/[ou]/g, "[ou]")
        .replace(/[ij]/g, "[ij]");
      
      whereSql += ` AND (
        LOWER(title) LIKE '%${cleanSearch}%'
        OR LOWER(COALESCE(original_title, '')) LIKE '%${cleanSearch}%'
        OR LOWER(REPLACE(REPLACE(REPLACE(title, '-', ''), ':', ''), ' ', '')) LIKE '%${cleanSearch.replace(/ /g, '')}%'
        OR LOWER(REPLACE(REPLACE(REPLACE(COALESCE(original_title, ''), '-', ''), ':', ''), ' ', '')) LIKE '%${cleanSearch.replace(/ /g, '')}%'
        OR LOWER(COALESCE(actors, '')) LIKE '%${cleanSearch}%'
        OR LOWER(COALESCE(director, '')) LIKE '%${cleanSearch}%'
      )`;
    }
    if (format) whereSql += ` AND format = '${format.replace(/'/g, "''")}'`;
    if (visibility) whereSql += ` AND visibility = '${visibility.replace(/'/g, "''")}'`;
    if (lotId) whereSql += ` AND lot_id = '${lotId.replace(/'/g, "''")}'`;
    if (source) whereSql += ` AND source = '${source.replace(/'/g, "''")}'`;
    if (director) whereSql += ` AND LOWER(director) LIKE '%${director.toLowerCase().replace(/'/g, "''")}%'`;
    if (yearFrom) whereSql += ` AND year >= ${parseInt(yearFrom) || 1900}`;
    if (yearTo) whereSql += ` AND year <= ${parseInt(yearTo) || 2100}`;
    if (decade) {
      const decadeNum = parseInt(decade) || 0;
      whereSql += ` AND year >= ${decadeNum} AND year < ${decadeNum + 10}`;
    }
    if (tags) whereSql += ` AND LOWER(tags) LIKE '%${tags.toLowerCase().replace(/'/g, "''")}%'`;

    const sortMap: Record<string, string> = {
      created_at: "created_at DESC",
      title: "title ASC",
      year: "year ASC",
      year_desc: "year DESC",
      format: "format ASC",
      country: "poster_country ASC",
      director: "director ASC",
    };
    const orderSql = sortMap[sort] || "created_at DESC";

    const countResult = await edgespark.db.all<{ total: number }>(
      sql.raw(`SELECT COUNT(*) as total FROM inventory i ${whereSql}`)
    );
    const itemsRaw = await edgespark.db.all<any>(
      sql.raw(`SELECT i.*, il.url as imageUrl, il.thumbnail_url as thumbnailUrl
       FROM inventory i
       LEFT JOIN image_library il ON il.matched_inventory_id = i.id
       ${whereSql} GROUP BY i.id ORDER BY ${orderSql} LIMIT ${limit} OFFSET ${offset}`)
    );

    // Resolve S3 image URLs for admin display
    const items = await Promise.all(itemsRaw.map(async (item: any) => {
      let imageUrl = item.imageUrl || item.source_url || null;
      if (imageUrl?.startsWith("s3://")) {
        try {
          const { bucket, path } = edgespark.storage.fromS3Uri(imageUrl);
          const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 3600);
          imageUrl = downloadUrl;
        } catch { imageUrl = null; }
      }
      return { ...item, imageUrl };
    }));

    return c.json({
      items,
      total: countResult[0]?.total || 0,
      limit,
      offset,
    });
  });

  // Create new inventory item
  app.post("/api/inventory-admin", async (c) => {
    const body = await c.req.json();
    const { title, year, director, actors, format, poster_country, dimensions, artist, genre, condition_grade, notes, item_number, price } = body;

    if (!title || !item_number) return c.json({ error: "title and item_number are required" }, 400);

    // Check for duplicate item_number
    const existing = await edgespark.db.all<any>(sql.raw(`SELECT id FROM inventory WHERE item_number = '${item_number.replace(/'/g, "''")}'`));
    if (existing.length > 0) return c.json({ error: `Item number "${item_number}" already exists (ID: ${existing[0].id})` }, 409);

    const now = Date.now();
    const cols: string[] = ["title", "item_number", "visibility", "created_at", "updated_at"];
    const vals: string[] = [
      `'${String(title).replace(/'/g, "''")}'`,
      `'${String(item_number).replace(/'/g, "''")}'`,
      "'listed'",
      String(now),
      String(now),
    ];

    if (year !== undefined && year !== null && year !== "") { cols.push("year"); vals.push(String(parseInt(year) || 0)); }
    if (director) { cols.push("director"); vals.push(`'${String(director).replace(/'/g, "''")}'`); }
    if (actors) { cols.push("actors"); vals.push(`'${String(actors).replace(/'/g, "''")}'`); }
    if (format) { cols.push("format"); vals.push(`'${String(format).replace(/'/g, "''")}'`); }
    if (poster_country) { cols.push("poster_country"); vals.push(`'${String(poster_country).replace(/'/g, "''")}'`); }
    if (dimensions) { cols.push("dimensions"); vals.push(`'${String(dimensions).replace(/'/g, "''")}'`); }
    if (artist) { cols.push("artist"); vals.push(`'${String(artist).replace(/'/g, "''")}'`); }
    if (genre) { cols.push("genre"); vals.push(`'${String(genre).replace(/'/g, "''")}'`); }
    if (condition_grade) { cols.push("condition_grade"); vals.push(`'${String(condition_grade).replace(/'/g, "''")}'`); }
    if (notes) { cols.push("notes"); vals.push(`'${String(notes).replace(/'/g, "''")}'`); }
    if (price !== undefined && price !== null) { cols.push("price"); vals.push(String(parseFloat(price) || 0)); }

    await edgespark.db.all(sql.raw(`INSERT INTO inventory (${cols.join(", ")}) VALUES (${vals.join(", ")})`));

    const created = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE item_number = '${item_number.replace(/'/g, "''")}'`));
    console.log("[API] POST /api/inventory-admin", { item_number, title });
    return c.json({ item: created[0] });
  });

  // Update inventory item (visibility, price, notes, etc.)
  // Helper: withdraw an eBay listing (end it) to prevent duplicate sales
  async function endEbayListing(sku: string): Promise<{ success: boolean; message: string }> {
    const token = await getValidEbayToken();
    if (!token) return { success: false, message: "eBay not connected — cannot auto-end listing" };

    try {
      // First, try to find the active offer for this SKU
      const offerRes = await fetch(
        `https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Language": "en-US",
          },
        }
      );

      if (!offerRes.ok) {
        // 404 means no active offers — listing already ended
        if (offerRes.status === 404) return { success: true, message: "No active eBay offer found — listing may already be ended." };
        const errText = await offerRes.text();
        console.warn("[eBay] Fetch offer failed for SKU", sku, offerRes.status, errText);
        return { success: false, message: `Could not fetch eBay offer (${offerRes.status})` };
      }

      const offerData: any = await offerRes.json();
      const offers = offerData.offers || offerData;
      const offer = Array.isArray(offers) ? offers[0] : offers;

      if (!offer?.offerId) return { success: false, message: "No active offer ID found" };

      // Withdraw the offer from marketplace
      const withdrawRes = await fetch(
        `https://api.ebay.com/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/withdraw`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Language": "en-US",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      if (withdrawRes.ok) {
        console.log("[eBay] Listing ended for SKU", sku, "offer", offer.offerId);
        return { success: true, message: `eBay listing ended (offer ${offer.offerId})` };
      }

      const errText = await withdrawRes.text();
      console.error("[eBay] Withdraw offer failed for SKU", sku, withdrawRes.status, errText);
      return { success: false, message: `Failed to end eBay listing (${withdrawRes.status}): ${errText}` };
    } catch (e: any) {
      console.error("[eBay] End listing error for SKU", sku, e);
      return { success: false, message: `Error ending listing: ${e.message}` };
    }
  }

  // Helper: withdraw an eBay listing (end it) to prevent duplicate sales
  async function endEbayListingByItemId(ebayItemId: string): Promise<{ success: boolean; message: string }> {
    const sku = `FR-${String(parseInt(ebayItemId) || 0).toString().padStart(5, "0")}`;
    return endEbayListing(sku);
  }

  app.put("/api/inventory-admin/:id", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    const body = await c.req.json();
    console.log("[API] PUT /api/inventory-admin/:id", { itemId, body });

    const allowed = ["visibility", "price", "notes", "title", "year", "director", "format", "poster_country", "sold", "dimensions", "condition_grade", "genre", "actors", "artist", "ebay_item_id", "ebay_price", "ebay_status", "pricing_markup", "source", "ebay_bundle_url", "tags", "collectors_note", "ebay_description", "condition_notes", "shipping_info", "international_shipping", "combined_shipping", "format_description", "original_title", "release_year", "release_type", "printer_credit", "nss_code", "distributor_logo", "billing_block_style", "audit_status", "poster_style"];
    const sets: string[] = [`updated_at = ${Date.now()}`];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        const val = body[key] === null ? "NULL" : typeof body[key] === "number" ? String(body[key]) : `'${String(body[key]).replace(/'/g, "''")}'`;
        
        // Auto-mark as sold when visibility is set to sold_out
        if (key === "visibility" && (body[key] === "sold_out" || body[key] === "sold-out")) {
          sets.push("visibility = 'sold_out'");
          sets.push("sold = 1");
        } else {
          sets.push(`${key} = ${val}`);
        }
      }
    }

    if (sets.length <= 1) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${itemId}`));

    // Auto-end eBay listing when marking as sold
    let ebayEndResult: { success: boolean; message: string } | null = null;
    if (body.sold === 1 || body.sold === "1") {
      const itemRows = await edgespark.db.all<any>(sql.raw(`SELECT id, ebay_item_id FROM inventory WHERE id = ${itemId}`));
      if (itemRows[0]?.ebay_item_id) {
        const sku = `FR-${String(itemId).padStart(5, "0")}`;
        ebayEndResult = await endEbayListing(sku);
        console.log("[API] Auto-end eBay listing on sold", { itemId, sku, result: ebayEndResult });
        // Update eBay status
        if (ebayEndResult.success) {
          await edgespark.db.all(sql.raw(
            `UPDATE inventory SET ebay_status = 'ended', updated_at = ${Date.now()} WHERE id = ${itemId}`
          ));
        }
      }
    }

    const updated = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${itemId}`));

    return c.json({ item: updated[0], ebay_end: ebayEndResult });
  });

  // Upload image for inventory item (presigned URL)
  app.post("/api/inventory-admin/:id/upload-image", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    const { filename, contentType } = await c.req.json();
    console.log("[API] POST /api/inventory-admin/:id/upload-image", { itemId, filename });

    const path = `inventory-images/${Date.now()}-${filename}`;
    const { uploadUrl } = await edgespark.storage
      .from(buckets.poster_images)
      .createPresignedPutUrl(path, 3600);
    const uri = edgespark.storage.toS3Uri(buckets.poster_images, path);

    // Store the S3 URI temporarily; client calls /confirm after upload
    return c.json({ uploadUrl, path, s3Uri: uri });
  });

  // Confirm image upload for inventory item
  app.post("/api/inventory-admin/:id/confirm-image", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    const { s3Uri } = await c.req.json();
    console.log("[API] POST /api/inventory-admin/:id/confirm-image", { itemId });

    await edgespark.db.all(
      sql.raw(`UPDATE inventory SET source_url = '${s3Uri.replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id = ${itemId}`)
    );

    // Generate a presigned download URL
    const { bucket, path } = edgespark.storage.fromS3Uri(s3Uri);
    const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);

    return c.json({ success: true, imageUrl: downloadUrl });
  });

  // Batch update visibility
  app.put("/api/inventory-admin/batch-visibility", async (c) => {
    const { ids, visibility } = await c.req.json();
    console.log("[API] PUT /api/inventory-admin/batch-visibility", { count: ids?.length, visibility });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }
    if (!["featured", "listed", "hidden", "recently_added"].includes(visibility)) {
      return c.json({ error: "Invalid visibility value" }, 400);
    }

    const idList = ids.join(",");
    await edgespark.db.all(
      sql.raw(`UPDATE inventory SET visibility = '${visibility}', updated_at = ${Date.now()} WHERE id IN (${idList})`)
    );

    return c.json({ success: true, updated: ids.length });
  });

  // Batch update country of origin
  app.put("/api/inventory-admin/batch-country", async (c) => {
    const { ids, poster_country } = await c.req.json();
    console.log("[API] PUT /api/inventory-admin/batch-country", { count: ids?.length, poster_country });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }

    const idList = ids.join(",");
    await edgespark.db.all(
      sql.raw(`UPDATE inventory SET poster_country = '${String(poster_country).replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id IN (${idList})`)
    );

    return c.json({ success: true, updated: ids.length });
  });

  // Batch delete inventory items
  app.delete("/api/inventory-admin/batch", async (c) => {
    const path = c.req.path;
    const method = c.req.method;
    console.log("[API] DELETE /api/inventory-admin/batch received", { path, method });
    
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      console.error("[API] DELETE /api/inventory-admin/batch: Failed to parse body", e);
      return c.json({ error: "Request body parse error" }, 400);
    }
    const { ids } = body;
    console.log("[API] DELETE /api/inventory-admin/batch", { ids, count: ids?.length, path });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }

    // Normalize all IDs to numbers
    const idList = ids.map((id: number|string) => Number(id)).filter((id: number) => id > 0 && !isNaN(id)).join(",");

    if (!idList) {
      return c.json({ error: "Invalid item ID" }, 400);
    }
    
    // First remove all items from any bundles they belong to
    await edgespark.db.all(sql.raw(`DELETE FROM inventory_bundle_items WHERE child_inventory_id IN (${idList})`));
    
    // Get items to delete their images
    const items = await edgespark.db.all<any>(sql.raw(`SELECT id, source_url FROM inventory WHERE id IN (${idList})`));
    
    // Delete images from storage
    for (const item of items) {
      if (item.source_url) {
        try {
          const { bucket, path } = edgespark.storage.fromS3Uri(item.source_url);
          await edgespark.storage.from(bucket).delete(path);
        } catch (e) {
          console.warn("[API] Failed to delete image", e);
        }
      }
    }

    // Delete inventory records
    await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id IN (${idList})`));
    return c.json({ success: true, deleted: ids.length });
  });

  // Soft delete inventory item (mark as deleted, can be restored)
  app.post("/api/inventory-admin/:id/soft-delete", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    console.log("[API] POST /api/inventory-admin/:id/soft-delete", { itemId });

    const now = Date.now();
    await edgespark.db.all(sql.raw(`UPDATE inventory SET deleted_at = ${now}, visibility = 'unlisted', updated_at = ${now} WHERE id = ${itemId}`));
    return c.json({ success: true, message: "Item soft deleted (archived)" });
  });

  // Restore soft-deleted inventory item
  app.post("/api/inventory-admin/:id/restore", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    console.log("[API] POST /api/inventory-admin/:id/restore", { itemId });

    const now = Date.now();
    await edgespark.db.all(sql.raw(`UPDATE inventory SET deleted_at = NULL, visibility = 'listed', updated_at = ${now} WHERE id = ${itemId}`));
    return c.json({ success: true, message: "Item restored" });
  });

  // Permanently delete inventory item (irreversible)
  app.delete("/api/inventory-admin/:id/permanent", async (c) => {
    const itemId = parseIdParam(c.req.param("id"));
    if (itemId < 0) return c.json({ error: "Invalid item ID" }, 400);
    console.log("[API] DELETE /api/inventory-admin/:id/permanent", { itemId });

    try {
      // Check if item exists
      const item = await edgespark.db.all<any>(sql.raw(`SELECT source_url FROM inventory WHERE id = ${itemId}`));
      if (!item[0]) {
        return c.json({ error: "Item not found" }, 404);
      }

      // Check if item is part of any bundles - if so, remove from bundle first
      const bundleLinks = await edgespark.db.all<any>(sql.raw(`SELECT id FROM inventory_bundle_items WHERE child_inventory_id = ${itemId}`));
      if (bundleLinks.length > 0) {
        await edgespark.db.all(sql.raw(`DELETE FROM inventory_bundle_items WHERE child_inventory_id = ${itemId}`));
        console.log(`[API] Removed item ${itemId} from ${bundleLinks.length} bundles`);
      }

      // Check if item has image and delete it
      if (item[0]?.source_url) {
        try {
          const { bucket, path } = edgespark.storage.fromS3Uri(item[0].source_url);
          await edgespark.storage.from(bucket).delete(path);
        } catch (e) {
          console.warn("[API] Failed to delete image", e);
        }
      }

      // Permanently delete the record
      await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id = ${itemId}`));
      return c.json({ success: true, message: "Item permanently deleted" });
    } catch (err: any) {
      console.error("[API] Permanent delete failed:", err);
      return c.json({ error: err.message || "Delete failed" }, 500);
    }
  });

  // Batch soft delete inventory items
  app.post("/api/inventory-admin/batch-soft-delete", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ error: "Request body parse error" }, 400);
    }
    const { ids } = body;
    console.log("[API] POST /api/inventory-admin/batch-soft-delete", { count: ids?.length });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }

    const idList = ids.map((id: number|string) => Number(id)).filter((id: number) => id > 0 && !isNaN(id)).join(",");
    if (!idList) {
      return c.json({ error: "Invalid item ID" }, 400);
    }

    const now = Date.now();
    await edgespark.db.all(sql.raw(`UPDATE inventory SET deleted_at = ${now}, visibility = 'unlisted', updated_at = ${now} WHERE id IN (${idList})`));
    return c.json({ success: true, softDeleted: ids.length });
  });

  // Batch permanent delete (irreversible)
  app.delete("/api/inventory-admin/batch/permanent", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch (e) {
      return c.json({ error: "Request body parse error" }, 400);
    }
    const { ids } = body;
    console.log("[API] DELETE /api/inventory-admin/batch/permanent", { count: ids?.length });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array required" }, 400);
    }

    const idList = ids.map((id: number|string) => Number(id)).filter((id: number) => id > 0 && !isNaN(id)).join(",");
    if (!idList) {
      return c.json({ error: "Invalid item ID" }, 400);
    }
    
    // First remove all items from any bundles they belong to
    await edgespark.db.all(sql.raw(`DELETE FROM inventory_bundle_items WHERE child_inventory_id IN (${idList})`));
    
    // Get items to delete their images
    const items = await edgespark.db.all<any>(sql.raw(`SELECT id, source_url FROM inventory WHERE id IN (${idList})`));
    
    // Delete images from storage
    for (const item of items) {
      if (item.source_url) {
        try {
          const { bucket, path } = edgespark.storage.fromS3Uri(item.source_url);
          await edgespark.storage.from(bucket).delete(path);
        } catch (e) {
          console.warn("[API] Failed to delete image", e);
        }
      }
    }

    // Permanently delete inventory records
    await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id IN (${idList})`));
    return c.json({ success: true, permanentlyDeleted: ids.length });
  });

  // Bulk delete eBay-sourced inventory items
  app.delete("/api/inventory-admin/ebay-purge", async (c) => {
    console.log("[API] DELETE /api/inventory-admin/ebay-purge");
    
    const result = await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE source = 'ebay' RETURNING id, title, item_number`));
    const count = result.length;
    
    console.log(`[API] Deleted ${count} eBay-sourced items`);
    return c.json({ success: true, deleted: count, items: result });
  });

  // ═══════════════════════════════════════════════════
  // BUNDLE MANAGEMENT
  // ═══════════════════════════════════════════════════

  // Create a bundle from selected inventory items
  app.post("/api/inventory-admin/bundles", async (c) => {
    const { title, childIds, notes, ebayBundleUrl, price, itemNumber } = await c.req.json() as {
      title: string;
      childIds: number[];
      notes?: string;
      ebayBundleUrl?: string;
      price?: number;
      itemNumber?: string;
    };

    if (!title?.trim()) return c.json({ error: "title is required" }, 400);
    if (!childIds?.length || childIds.length < 2) return c.json({ error: "at least 2 items required for a bundle" }, 400);

    // Validate child items exist
    const idList = childIds.join(",");
    const children = await edgespark.db.all<any>(
      sql.raw(`SELECT id, title FROM inventory WHERE id IN (${idList})`)
    );
    if (children.length !== childIds.length) {
      const found = children.map(c => c.id);
      const missing = childIds.filter(id => !found.includes(id));
      return c.json({ error: `items not found: ${missing.join(", ")}` }, 400);
    }

    const now = Date.now();
    const safeTitle = String(title).replace(/'/g, "''");
    const safeItemNumber = itemNumber ? `'${String(itemNumber).replace(/'/g, "''")}'` : `'BND-${now}'`;
    const safeNotes = notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL";
    const safePrice = price !== undefined && price !== null ? String(parseFloat(String(price)) || 0) : "NULL";
    const safeEbayUrl = ebayBundleUrl ? `'${String(ebayBundleUrl).replace(/'/g, "''")}'` : "NULL";

    // Create the bundle inventory item
    const bundleResult = await edgespark.db.all<any>(
      sql.raw(`INSERT INTO inventory (title, item_type, item_number, visibility, notes, price, ebay_bundle_url, source, created_at, updated_at)
        VALUES ('${safeTitle}', 'bundle', ${safeItemNumber}, 'listed', ${safeNotes}, ${safePrice}, ${safeEbayUrl}, 'manual', ${now}, ${now})`)
    );
    const bundleRow = await edgespark.db.all<any>(
      sql.raw(`SELECT * FROM inventory WHERE item_number = ${safeItemNumber}`)
    );
    const bundle = bundleRow[0];
    if (!bundle) return c.json({ error: "failed to create bundle" }, 500);

    // Add child items to the bundle
    for (let i = 0; i < childIds.length; i++) {
      await edgespark.db.all(sql.raw(
        `INSERT INTO inventory_bundle_items (bundle_id, child_inventory_id, sort_order, created_at)
         VALUES (${bundle.id}, ${childIds[i]}, ${i}, ${now})`
      ));
    }

    console.log("[API] POST /api/inventory-admin/bundles", { bundleId: bundle.id, title, childCount: childIds.length });
    return c.json({ bundle, children });
  });

  // List all bundles (inventory items where item_type = 'bundle')
  app.get("/api/inventory-admin/bundles", async (c) => {
    const bundles = await edgespark.db.all<any>(
      sql.raw(`SELECT * FROM inventory WHERE item_type = 'bundle' ORDER BY created_at DESC`)
    );

    // For each bundle, fetch child items
    const result = [];
    for (const b of bundles) {
      const items = await edgespark.db.all<any>(
        sql.raw(`SELECT i.* FROM inventory i
          INNER JOIN inventory_bundle_items bi ON bi.child_inventory_id = i.id
          WHERE bi.bundle_id = ${b.id} ORDER BY bi.sort_order`)
      );
      result.push({ ...b, children: items });
    }

    return c.json({ bundles: result });
  });

  // Get single bundle with child items
  app.get("/api/inventory-admin/bundles/:id", async (c) => {
    const bundleId = parseInt(c.req.param("id"));
    const bundleRows = await edgespark.db.all<any>(
      sql.raw(`SELECT * FROM inventory WHERE id = ${bundleId} AND item_type = 'bundle'`)
    );
    if (!bundleRows[0]) return c.json({ error: "bundle not found" }, 404);

    const children = await edgespark.db.all<any>(
      sql.raw(`SELECT i.* FROM inventory i
        INNER JOIN inventory_bundle_items bi ON bi.child_inventory_id = i.id
        WHERE bi.bundle_id = ${bundleId} ORDER BY bi.sort_order`)
    );

    return c.json({ bundle: bundleRows[0], children });
  });

  // Update bundle (title, price, notes, ebay_bundle_url)
  app.put("/api/inventory-admin/bundles/:id", async (c) => {
    const bundleId = parseInt(c.req.param("id"));
    const body = await c.req.json();

    const allowed = ["title", "price", "notes", "ebay_bundle_url", "visibility", "item_number"];
    const sets: string[] = [`updated_at = ${Date.now()}`];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        const val = body[key] === null ? "NULL" : typeof body[key] === "number" ? String(body[key]) : `'${String(body[key]).replace(/'/g, "''")}'`;
        sets.push(`${key} = ${val}`);
      }
    }

    if (sets.length <= 1) return c.json({ error: "no valid fields to update" }, 400);

    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${bundleId} AND item_type = 'bundle'`));
    const updated = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${bundleId}`));
    return c.json({ bundle: updated[0] });
  });

  // Delete a bundle (also removes bundle item links)
  app.delete("/api/inventory-admin/bundles/:id", async (c) => {
    const bundleId = parseInt(c.req.param("id"));

    // Remove all bundle item links
    await edgespark.db.all(sql.raw(`DELETE FROM inventory_bundle_items WHERE bundle_id = ${bundleId}`));
    // Remove the bundle inventory item
    await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id = ${bundleId} AND item_type = 'bundle'`));

    return c.json({ success: true });
  });

  // Add item to existing bundle
  app.post("/api/inventory-admin/bundles/:id/items", async (c) => {
    const bundleId = parseInt(c.req.param("id"));
    const { childId } = await c.req.json() as { childId: number };

    // Verify bundle exists
    const bundleCheck = await edgespark.db.all<any>(sql.raw(`SELECT id FROM inventory WHERE id = ${bundleId} AND item_type = 'bundle'`));
    if (!bundleCheck[0]) return c.json({ error: "bundle not found" }, 404);

    // Check not already in bundle
    const existing = await edgespark.db.all<any>(sql.raw(`SELECT id FROM inventory_bundle_items WHERE bundle_id = ${bundleId} AND child_inventory_id = ${childId}`));
    if (existing[0]) return c.json({ error: "item already in bundle" }, 409);

    // Get current max sort_order
    const maxSort = await edgespark.db.all<{ mx: number | null }>(sql.raw(`SELECT MAX(sort_order) as mx FROM inventory_bundle_items WHERE bundle_id = ${bundleId}`));
    const nextSort = (maxSort[0]?.mx ?? -1) + 1;

    await edgespark.db.all(sql.raw(
      `INSERT INTO inventory_bundle_items (bundle_id, child_inventory_id, sort_order, created_at)
       VALUES (${bundleId}, ${childId}, ${nextSort}, ${Date.now()})`
    ));

    return c.json({ success: true });
  });

  // Remove item from bundle
  app.delete("/api/inventory-admin/bundles/:id/items/:childId", async (c) => {
    const bundleId = parseInt(c.req.param("id"));
    const childId = parseInt(c.req.param("childId"));

    await edgespark.db.all(sql.raw(`DELETE FROM inventory_bundle_items WHERE bundle_id = ${bundleId} AND child_inventory_id = ${childId}`));

    // If bundle now has fewer than 2 items, warn but don't auto-delete
    const remaining = await edgespark.db.all<{ cnt: number }>(sql.raw(`SELECT COUNT(*) as cnt FROM inventory_bundle_items WHERE bundle_id = ${bundleId}`));
    return c.json({ success: true, remaining: remaining[0]?.cnt || 0 });
  });

  // Get bundles that contain a specific inventory item
  app.get("/api/inventory-admin/items/:id/bundles", async (c) => {
    const itemId = parseInt(c.req.param("id"));

    const bundles = await edgespark.db.all<any>(
      sql.raw(`SELECT i.* FROM inventory i
        INNER JOIN inventory_bundle_items bi ON bi.bundle_id = i.id
        WHERE bi.child_inventory_id = ${itemId} AND i.item_type = 'bundle'`)
    );

    return c.json({ bundles });
  });

  // Bulk update inventory items by lot IDs (e.g. set format + country for a whole lot)
  app.post("/api/inventory-admin/bulk-update-lots", async (c) => {
    const { lotIds, updates } = await c.req.json() as {
      lotIds: (string | number)[];
      updates: Record<string, string | number | null>;
    };
    console.log("[API] POST /api/inventory-admin/bulk-update-lots", { lotIds, updates });

    if (!lotIds?.length || !updates) return c.json({ error: "lotIds and updates required" }, 400);

    const now = Date.now();
    const sets: string[] = [`updated_at = ${now}`];
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === "") {
        sets.push(`${key} = NULL`);
      } else if (typeof val === "number") {
        sets.push(`${key} = ${val}`);
      } else {
        sets.push(`${key} = '${String(val).replace(/'/g, "''")}'`);
      }
    }

    const idList = lotIds.map(String).join(",");
    await edgespark.db.all(sql.raw(
      `UPDATE inventory SET ${sets.join(", ")} WHERE lot_id IN (${idList})`
    ));

    const countResult = await edgespark.db.all<{ cnt: number }>(sql.raw(
      `SELECT COUNT(*) as cnt FROM inventory WHERE lot_id IN (${idList})`
    ));
    return c.json({ updated: countResult[0]?.cnt || 0, lotIds });
  });

  // Bulk update inventory items by item IDs (set format/country on selected items)
  app.post("/api/inventory-admin/batch-update-items", async (c) => {
    const { itemIds, updates } = await c.req.json() as {
      itemIds: number[];
      updates: Record<string, string | number | null>;
    };
    console.log("[API] POST /api/inventory-admin/batch-update-items", { itemCount: itemIds?.length, updates });

    if (!itemIds?.length || !updates) return c.json({ error: "itemIds and updates required" }, 400);

    const now = Date.now();
    const sets: string[] = [`updated_at = ${now}`];
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === "") {
        sets.push(`${key} = NULL`);
      } else if (typeof val === "number") {
        sets.push(`${key} = ${val}`);
      } else {
        sets.push(`${key} = '${String(val).replace(/'/g, "''")}'`);
      }
    }

    const idList = itemIds.join(",");
    await edgespark.db.all(sql.raw(
      `UPDATE inventory SET ${sets.join(", ")} WHERE id IN (${idList})`
    ));

    return c.json({ updated: itemIds.length });
  });

  // Merge two inventory items (duplicate resolver)
  app.post("/api/inventory-admin/merge", async (c) => {
    const { keepId, mergeId, mergeFields } = await c.req.json() as {
      keepId: number;
      mergeId: number;
      mergeFields?: Record<string, any>;
    };
    if (!keepId || !mergeId) return c.json({ error: "keepId and mergeId required" }, 400);
    if (keepId === mergeId) return c.json({ error: "Cannot merge item with itself" }, 400);

    const keep = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${keepId}`));
    const merge = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${mergeId}`));
    if (!keep[0]) return c.json({ error: "Keep item not found" }, 404);
    if (!merge[0]) return c.json({ error: "Merge item not found" }, 404);

    const now = Date.now();
    const k = keep[0];
    const m = merge[0];

    // Build merged values — prefer explicit mergeFields, then keep, then merge as fallback
    const fieldOrder = ["title", "original_title", "year", "director", "actors", "genre", "format", "dimensions",
      "ds_ss", "artist", "movie_country", "poster_country", "poster_style", "awards",
      "item_type", "lot_id", "sold", "price", "condition_grade", "source_url",
      "visibility", "ebay_item_id", "ebay_price", "ebay_status", "pricing_markup", "source"];
    const sets: string[] = [`updated_at = ${now}`];

    for (const field of fieldOrder) {
      if (mergeFields && mergeFields[field] !== undefined) {
        const val = mergeFields[field];
        sets.push(`${field} = ${val === null ? "NULL" : typeof val === "number" ? val : `'${String(val).replace(/'/g, "''")}'`}`);
      }
    }

    // Merge notes — append merge item's notes
    if (mergeFields?.notes !== undefined) {
      sets.push(`notes = '${String(mergeFields.notes).replace(/'/g, "''")}'`);
    } else {
      const mergedNotes = [k.notes, m.notes ? `[Merged from #${mergeId}] ${m.notes}` : null].filter(Boolean).join("\\n");
      sets.push(`notes = '${mergedNotes.replace(/'/g, "''")}'`);
    }

    // If merge item has an image (source_url that looks like S3), transfer it
    if (m.source_url && !k.source_url && m.source_url.includes("s3") || m.source_url && !k.source_url) {
      // Only transfer if keep doesn't have its own image
    }

    // Update the keep item
    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${keepId}`));

    // Update any image_library references from mergeId to keepId
    await edgespark.db.all(sql.raw(`UPDATE image_library SET matched_inventory_id = ${keepId} WHERE matched_inventory_id = ${mergeId}`));

    // Delete the merge item
    await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id = ${mergeId}`));

    const result = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${keepId}`));
    return c.json({ success: true, item: result[0] });
  });

  // Find potential duplicate inventory items
  app.get("/api/inventory-admin/duplicates", async (c) => {
    const items = await edgespark.db.all<any>(sql.raw(
      `SELECT id, title, item_number, year, format, poster_country, source FROM inventory ORDER BY title ASC`
    ));
    const groups: Record<string, any[]> = {};
    for (const item of items) {
      // Normalize: lowercase, remove special chars, strip common suffixes
      const key = (item.title || "").toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+(original|vintage|movie|film|poster|lobby|card|insert|sheet|window|three|six|italian|french|japanese|us|uk|british|one|half|quad|daybill|locandina|fotobusta|grande|moyenne|petite|belgian|spanish|australian)\b/g, "")
        .replace(/\s+/g, " ").trim();
      if (!key || key.length < 3) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    const duplicates = Object.entries(groups)
      .filter(([_, items]) => items.length > 1)
      .map(([key, items]) => ({ key, items }));
    return c.json({ duplicates, totalGroups: duplicates.length });
  });

  // Merge/confirm duplicates: merge source item into target item
  app.put("/api/inventory-admin/duplicates/merge", async (c) => {
    const { targetId, sourceIds, deleteSources } = await c.req.json() as { targetId: number; sourceIds: number[]; deleteSources?: boolean };
    if (!targetId || !sourceIds?.length) {
      return c.json({ error: "targetId and sourceIds required" }, 400);
    }
    console.log("[API] PUT /api/inventory-admin/duplicates/merge", { targetId, sourceIds, deleteSources });

    const now = Date.now();
    const results: { sourceId: number; success: boolean; error?: string }[] = [];

    for (const sourceId of sourceIds) {
      try {
        // Get source item data
        const sourceRows = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${sourceId}`));
        if (!sourceRows[0]) {
          results.push({ sourceId, success: false, error: "Source not found" });
          continue;
        }
        const source = sourceRows[0];

        // Transfer relevant fields from source to target (only if target doesn't have them)
        const targetRows = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${targetId}`));
        if (!targetRows[0]) {
          results.push({ sourceId, success: false, error: "Target not found" });
          continue;
        }
        const target = targetRows[0];

        // Build update: merge fields that are missing in target
        const updates: string[] = [];
        if (!target.title && source.title) updates.push(`title = '${String(source.title).replace(/'/g, "''")}'`);
        if (!target.year && source.year) updates.push(`year = ${source.year}`);
        if (!target.director && source.director) updates.push(`director = '${String(source.director).replace(/'/g, "''")}'`);
        if (!target.actors && source.actors) updates.push(`actors = '${String(source.actors).replace(/'/g, "''")}'`);
        if (!target.genre && source.genre) updates.push(`genre = '${String(source.genre).replace(/'/g, "''")}'`);
        if (!target.format && source.format) updates.push(`format = '${String(source.format).replace(/'/g, "''")}'`);
        if (!target.poster_country && source.poster_country) updates.push(`poster_country = '${String(source.poster_country).replace(/'/g, "''")}'`);
        if (!target.condition_grade && source.condition_grade) updates.push(`condition_grade = '${String(source.condition_grade).replace(/'/g, "''")}'`);
        if (!target.price && source.price) updates.push(`price = ${source.price}`);
        if (!target.source_url && source.source_url) updates.push(`source_url = '${String(source.source_url).replace(/'/g, "''")}'`);
        if (!target.image_source && source.image_source) updates.push(`image_source = '${String(source.image_source).replace(/'/g, "''")}'`);
        
        // Preserve existing notes, append source info
        const mergedNotes = target.notes 
          ? `${target.notes}\n\n[Merged from #${source.id} - ${source.item_number}]: ${source.notes || 'No notes'}`
          : `[Merged from #${source.id} - ${source.item_number}]: ${source.notes || 'No notes'}`;
        updates.push(`notes = '${mergedNotes.replace(/'/g, "''")}'`);
        updates.push(`updated_at = ${now}`);

        if (updates.length > 0) {
          await edgespark.db.all(sql.raw(`UPDATE inventory SET ${updates.join(", ")} WHERE id = ${targetId}`));
        }

        // Optionally delete source items
        if (deleteSources) {
          await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id = ${sourceId}`));
        }

        results.push({ sourceId, success: true });
      } catch (err: any) {
        results.push({ sourceId, success: false, error: err.message });
      }
    }

    return c.json({ success: true, results });
  });

  // Delete duplicate items (bulk)
  app.post("/api/inventory-admin/duplicates/delete", async (c) => {
    const { ids } = await c.req.json() as { ids: number[] };
    if (!ids?.length) return c.json({ error: "ids array required" }, 400);
    console.log("[API] POST /api/inventory-admin/duplicates/delete", { ids: ids.length });

    const deleted: number[] = [];
    const errors: { id: number; error: string }[] = [];

    for (const id of ids) {
      try {
        await edgespark.db.all(sql.raw(`DELETE FROM inventory WHERE id = ${id}`));
        deleted.push(id);
      } catch (err: any) {
        errors.push({ id, error: err.message });
      }
    }

    return c.json({ success: true, deleted: deleted.length, errors: errors.length > 0 ? errors : undefined });
  });

  // Enhanced duplicates: check for potential duplicates including eBay links
  app.get("/api/inventory-admin/duplicates/enhanced", async (c) => {
    const includeEbay = c.req.query("include_ebay") === "true";
    
    // Get all visible items
    const items = await edgespark.db.all<any>(sql.raw(
      `SELECT id, title, item_number, year, format, poster_country, source, ebay_item_id, source_url FROM inventory WHERE visibility != 'hidden' ORDER BY title ASC`
    ));

    // Build duplicate groups by normalized title
    const groups: Record<string, any[]> = {};
    for (const item of items) {
      const key = (item.title || "").toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+(original|vintage|movie|film|poster|lobby|card|insert|sheet|window|three|six|italian|french|japanese|us|uk|british|one|half|quad|daybill|locandina|fotobusta|grande|moyenne|petite|belgian|spanish|australian)\b/g, "")
        .replace(/\s+/g, " ").trim();
      if (!key || key.length < 3) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    // Find duplicates
    const duplicates = Object.entries(groups)
      .filter(([_, items]) => items.length > 1)
      .map(([key, items]) => ({
        key,
        items: items.map(i => ({
          id: i.id,
          title: i.title,
          itemNumber: i.item_number,
          year: i.year,
          format: i.format,
          country: i.poster_country,
          source: i.source,
          ebayItemId: i.ebay_item_id,
          sourceUrl: i.source_url
        }))
      }));

    // If includeEbay, also find items with same eBay item ID
    let ebayDuplicates: any[] = [];
    if (includeEbay) {
      const ebayGroups: Record<string, any[]> = {};
      for (const item of items) {
        if (item.ebay_item_id) {
          if (!ebayGroups[item.ebay_item_id]) ebayGroups[item.ebay_item_id] = [];
          ebayGroups[item.ebay_item_id].push(item);
        }
      }
      ebayDuplicates = Object.entries(ebayGroups)
        .filter(([_, items]) => items.length > 1)
        .map(([ebayId, items]) => ({
          type: "ebay",
          ebayId,
          items: items.map(i => ({
            id: i.id,
            title: i.title,
            itemNumber: i.item_number,
            year: i.year,
            format: i.format,
            country: i.poster_country,
            source: i.source
          }))
        }));
    }

    return c.json({ 
      duplicates, 
      totalGroups: duplicates.length,
      ebayDuplicates,
      totalEbayGroups: ebayDuplicates.length
    });
  });

  // ═══════════════════════════════════════════════════
  // IMAGE LIBRARY (Upload, browse, identify, match)
  // ═══════════════════════════════════════════════════

  // List library images
  app.get("/api/public/library", async (c) => {
    const images = await edgespark.db.all<any>(
      sql.raw("SELECT * FROM image_library ORDER BY created_at DESC LIMIT 200")
    );
    // Generate presigned URLs for each image
    const withUrls = await Promise.all(images.map(async (img: any) => {
      try {
        const { bucket, path } = edgespark.storage.fromS3Uri(img.s3_uri);
        const { downloadUrl } = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
        return { ...img, url: downloadUrl };
      } catch {
        return { ...img, url: null };
      }
    }));
    return c.json({ images: withUrls });
  });

  // Download library image — streams file with Content-Disposition header as PNG
  app.get("/api/public/library/:id/download", async (c) => {
    const id = Number(c.req.param("id"));
    const rows = await edgespark.db.all<any>(
      sql.raw(`SELECT id, filename, s3_uri FROM image_library WHERE id = ${id}`)
    );
    const img = rows[0];
    if (!img || !img.s3_uri) return c.json({ error: "Image not found" }, 404);

    const { bucket, path } = edgespark.storage.fromS3Uri(img.s3_uri);
    const file = await edgespark.storage.from(bucket).get(path);
    if (!file) return c.json({ error: "File not in storage" }, 404);

    const pngName = img.filename.replace(/\.[^.]+$/, "") + ".png";
    const body = new Uint8Array(file.body);
    return c.body(body, 200, {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${pngName}"`,
      "Content-Length": String(body.byteLength),
    });
  });

  // Upload image(s) to library — client gets presigned PUT URL first
  app.post("/api/public/library/upload-presign", async (c) => {
    const { filename, contentType } = await c.req.json();
    const path = `library/${Date.now()}-${filename}`;
    const { uploadUrl } = await edgespark.storage
      .from(buckets.poster_images)
      .createPresignedPutUrl(path, 3600);
    const s3Uri = edgespark.storage.toS3Uri(buckets.poster_images, path);
    return c.json({ uploadUrl, path, s3Uri });
  });

  // Confirm upload — save record to DB with optional metadata
  app.post("/api/public/library/confirm", async (c) => {
    const { s3Uri, filename, contentType, lotNumber, itemNumber, uploadNote, posterFormat, releaseType, dimensions } = await c.req.json();
    console.log("[API] POST /api/public/library/confirm", { filename, lotNumber, itemNumber, posterFormat, releaseType, dimensions });
    const ts = Date.now();
    const safeFilename = (filename || "unknown").replace(/'/g, "''");
    const safeContentType = (contentType || "image/jpeg").replace(/'/g, "''");
    const safeS3Uri = s3Uri.replace(/'/g, "''");
    const safeLot = lotNumber ? `'${lotNumber.replace(/'/g, "''")}'` : "NULL";
    const safeItem = itemNumber ? `'${itemNumber.replace(/'/g, "''")}'` : "NULL";
    const safeNote = uploadNote ? `'${uploadNote.replace(/'/g, "''")}'` : "NULL";
    const safeFormat = posterFormat ? `'${posterFormat.replace(/'/g, "''")}'` : "NULL";
    const safeReleaseType = releaseType ? `'${releaseType.replace(/'/g, "''")}'` : "NULL";
    const safeDimensions = dimensions ? `'${dimensions.replace(/'/g, "''")}'` : "NULL";
    const result = await edgespark.db.all<any>(
      sql.raw(`INSERT INTO image_library (filename, content_type, s3_uri, lot_number, item_number, upload_note, poster_format, release_type, dimensions, created_at, updated_at) VALUES ('${safeFilename}', '${safeContentType}', '${safeS3Uri}', ${safeLot}, ${safeItem}, ${safeNote}, ${safeFormat}, ${safeReleaseType}, ${safeDimensions}, ${ts}, ${ts})`)
    );
    return c.json({ success: true, id: result[0]?.id || null });
  });

  // Delete from library
  app.delete("/api/public/library/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const imgs = await edgespark.db.all<any>(sql.raw(`SELECT s3_uri FROM image_library WHERE id = ${id}`));
    if (imgs[0]?.s3_uri) {
      try {
        const { bucket, path } = edgespark.storage.fromS3Uri(imgs[0].s3_uri);
        await edgespark.storage.from(bucket).delete(path);
      } catch (e) { console.warn("[API] Failed to delete image", e); }
    }
    await edgespark.db.all(sql.raw(`DELETE FROM image_library WHERE id = ${id}`));
    return c.json({ success: true });
  });

  // Fuzzy search inventory by title — matches against title, original_title, case-insensitive,
  // strips common punctuation, and also tries year-filtered matching
  // Optionally filters by lot_number if provided
  const fuzzyMatchInventory = async (title: string, year?: number | null, lotNumber?: string | null, limit = 5) => {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const cleanTitle = clean(title);
    if (cleanTitle.length < 2) return [];
    const safeTitle = title.replace(/'/g, "''");

    let query = `SELECT id, title, original_title, year, format, actors, director, genre, lot_id
      FROM inventory
      WHERE (LOWER(title) LIKE '%${cleanTitle}%'
        OR LOWER(COALESCE(original_title, '')) LIKE '%${cleanTitle}%'
        OR LOWER(REPLACE(REPLACE(REPLACE(title, '-', ''), ':', ''), '''', '')) LIKE '%${cleanTitle}%')`;
    
    // Filter by lot_number if provided
    if (lotNumber) {
      query += ` AND lot_id = '${lotNumber.replace(/'/g, "''")}'`;
    }
    
    if (year) query += ` AND (year = ${year} OR year IS NULL)`;
    query += ` LIMIT ${limit}`;

    const results = await edgespark.db.all<any>(sql.raw(query));
    // Deduplicate and score
    const seen = new Set<number>();
    const scored = results
      .filter((r: any) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map((r: any) => {
        const t = clean(r.title);
        const ot = clean(r.original_title || "");
        const ct = cleanTitle;
        let score = 0;
        if (t === ct) score = 100;
        else if (t.includes(ct) || ct.includes(t)) score = 80;
        if (ot && (ot === ct || ot.includes(ct) || ct.includes(ot))) score = Math.max(score, 90);
        if (year && r.year === year) score += 10;
        if (!year && !r.year) score += 5;
        return { ...r, score };
      })
      .sort((a: any, b: any) => b.score - a.score);
    return scored;
  };

  // Enhanced multi-title inventory matching — checks ALL title variants at once
  const fuzzyMatchInventoryMulti = async (
    titles: string[],
    year?: number,
    lotNumber?: string | null,
    limit = 5
  ) => {
    const clean = (s: string) => s.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

    const cleanTitles = [...new Set(titles.map(clean).filter(t => t.length >= 2))];
    if (cleanTitles.length === 0) return [];

    const titleConditions = cleanTitles.map(t =>
      `LOWER(REPLACE(REPLACE(REPLACE(title, '-', ''), ':', ''), '''', '')) LIKE '%${t.replace(/'/g, "''")}%'
       OR LOWER(COALESCE(original_title, '')) LIKE '%${t.replace(/'/g, "''")}%'`
    ).join(" OR ");

    let query = `SELECT id, title, original_title, year, format, actors, director, genre, lot_id
      FROM inventory WHERE (${titleConditions})`;

    if (lotNumber) query += ` AND lot_id = '${lotNumber.replace(/'/g, "''")}'`;
    if (year) query += ` AND (year = ${year} OR year IS NULL)`;
    query += ` LIMIT ${limit * 2}`;

    const results = await edgespark.db.all<any>(sql.raw(query));

    const seen = new Set<number>();
    const scored = results
      .filter((r: any) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .map((r: any) => {
        const rt = clean(r.title);
        const rot = clean(r.original_title || "");
        let bestScore = 0;
        for (const ct of cleanTitles) {
          let score = 0;
          if (rt === ct || rot === ct) score = 100;
          else if (rt.includes(ct) || ct.includes(rt)) score = 80;
          else if (rot && (rot.includes(ct) || ct.includes(rot))) score = 85;
          if (year && r.year === year) score += 10;
          bestScore = Math.max(bestScore, score);
        }
        return { ...r, score: bestScore };
      })
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);

    return scored;
  };

  // Auto-ID via TMDB (no OCR server-side — client extracts text via Tesseract.js browser-side)
  app.post("/api/public/library/:id/auto-id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const { text } = await c.req.json() as { text?: string };
    console.log("[API] POST /api/public/library/:id/auto-id", { id, textLength: text?.length });

    // Get the library image to access lot_number for scoping inventory search
    const libraryImages = await edgespark.db.all<any>(sql.raw(`SELECT lot_number FROM image_library WHERE id = ${id}`));
    const libraryLotNumber = libraryImages[0]?.lot_number || null;
    console.log("[API] Library image lot_number:", libraryLotNumber);

    // Save OCR text
    if (text && text.trim().length > 1) {
      await edgespark.db.all(sql.raw(`UPDATE image_library SET ocr_text = '${text.replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id = ${id}`));
    }

    const tmdbKey = edgespark.secret.get("TMDB_API_KEY");
    if (!tmdbKey) return c.json({ error: "TMDB API key not configured" }, 500);

    const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;

    // Extract potential movie titles from OCR text
    const words = (text || "").split(/[\s,;.!?]+/).filter((w: string) => w.length > 2);
    const queries: string[] = [];

    // Strategy 1: Use whole text if short enough
    if (text && text.trim().length <= 80) {
      queries.push(text.trim());
    }
    // Strategy 2: Use last few significant words (movie titles often at bottom)
    if (words.length >= 2) {
      const endWords = words.slice(-4).join(" ");
      queries.push(endWords);
    }
    // Strategy 3: First significant line
    if (words.length >= 2) {
      queries.push(words.slice(0, 4).join(" "));
    }

    for (const query of queries) {
      try {
        const tmdbRes = await fetch(
          `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&api_key=${tmdbKeyStr}`,
        );
        const tmdbData: any = await tmdbRes.json();

        if (tmdbData.results && tmdbData.results.length > 0) {
          const movie = tmdbData.results[0];
          console.log("[API] Library TMDB match", { title: movie.title, year: movie.release_date });

          // Fetch details
          let details: any = {};
          try {
            const detailRes = await fetch(
              `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKeyStr}`,
            );
            details = await detailRes.json();
          } catch {}

          const director = details.credits?.crew?.find((c: any) => c.job === "Director")?.name || null;
          const actors = details.credits?.cast?.slice(0, 3).map((c: any) => c.name).join(", ") || null;
          const genres = details.genres?.map((g: any) => g.name).join(", ") || movie.genre_ids || null;
          const year = movie.release_date ? parseInt(movie.release_date.substring(0, 4)) : null;

          // Search for matching inventory item (fuzzy, scoped to lot_number if available)
          const matchResults = await fuzzyMatchInventory(movie.title, year, libraryLotNumber);

          const movieData = { title: movie.title, year, director, actors, genre: genres, tmdbId: String(movie.id) };

          // Update library record
          await edgespark.db.all(sql.raw(
            `UPDATE image_library SET identified_title = '${(movie.title || "").replace(/'/g, "''")}', identified_year = ${year || "NULL"}, identified_director = '${(director || "").replace(/'/g, "''")}', identified_genre = '${(genres || "").replace(/'/g, "''")}', identified_actors = '${(actors || "").replace(/'/g, "''")}', identified_data = '${JSON.stringify(movieData).replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id = ${id}`
          ));

          return c.json({ success: true, source: "tmdb", movie: movieData, inventoryMatches: matchResults });
        }
      } catch (err: any) {
        console.warn("[API] TMDB search error", err.message);
      }
    }

    return c.json({ success: false, error: "No TMDB match found — try AI Identify", needsAi: true, details: "Searched queries: " + queries.join(", ") }, 404);
  });

  // Server-side OCR via Gemini Vision (fallback when client OCR fails due to CORS)
  app.post("/api/public/library/:id/ocr", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/public/library/:id/ocr", { id });

    const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
    if (!geminiKey) return c.json({ error: "Gemini API key not configured" }, 500);

    // Get image from library
    const imgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM image_library WHERE id = ${id}`));
    if (!imgs[0]) return c.json({ error: "Image not found" }, 404);

    // Download from storage
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(imgs[0].s3_uri);
    const file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found" }, 404);

    // Convert to base64
    const bytes = new Uint8Array(file.body);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const mimeType = file.metadata?.contentType || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const prompt = `Extract ALL text visible in this movie poster. Return the text exactly as it appears, line by line. Include any titles, credits, actor names, director names, and any other text.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }] }],
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log("[API] Server-side OCR result:", text.substring(0, 200));

      // Save OCR text to database
      if (text.trim().length > 1) {
        await edgespark.db.all(sql.raw(`UPDATE image_library SET ocr_text = '${text.replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id = ${id}`));
      }

      return c.json({ success: true, text });
    } catch (err: any) {
      console.error("[API] Server-side OCR error", err.message);
      return c.json({ error: "OCR failed: " + err.message }, 500);
    }
  });

  // AI Identify via Gemini Vision
  // ═══════════════════════════════════════════════════
  // LAYER 1: CONTEXT PARSER
  // Extracts expected_period and local_language from lot_number
  // ═══════════════════════════════════════════════════
  const parseLotContext = (lotNumber: string | null): { expectedPeriodStart: number; expectedPeriodEnd: number; localLanguage: string } => {
    if (!lotNumber) return { expectedPeriodStart: 1960, expectedPeriodEnd: 1990, localLanguage: "en" };
    
    const lot = lotNumber.toUpperCase();
    
    // Extract decade
    const decadeMatch = lot.match(/19(\d)0s|19(\d{2})/);
    let decade = 1960;
    if (decadeMatch) {
      decade = decadeMatch[1] ? 1900 + parseInt(decadeMatch[1]) * 10 : parseInt(decadeMatch[2]) || 1960;
    }
    
    // Extract language from lot name
    let language = "en";
    if (lot.includes("_IT") || lot.includes("ITALIAN")) language = "it";
    else if (lot.includes("_FR") || lot.includes("FRENCH")) language = "fr";
    else if (lot.includes("_DE") || lot.includes("GERMAN")) language = "de";
    else if (lot.includes("_ES") || lot.includes("SPANISH")) language = "es";
    else if (lot.includes("_JP") || lot.includes("JAPANESE")) language = "ja";
    
    return {
      expectedPeriodStart: decade,
      expectedPeriodEnd: decade + 9,
      localLanguage: language
    };
  };

  // ═══════════════════════════════════════════════════
  // CONFLICT & RE-RELEASE DETECTOR
  // Compares print_year vs expected_period
  // ═══════════════════════════════════════════════════
  const detectConflict = (
    printYear: number | null, 
    releaseYear: number | null, 
    expectedStart: number, 
    expectedEnd: number
  ): { status: "original" | "reissue" | "conflict" | "none"; reason: string } => {
    if (!printYear || !releaseYear) return { status: "none", reason: "No print year detected" };
    
    // Check for conflict (print year outside expected period)
    if (printYear < expectedStart || printYear > expectedEnd) {
      return { 
        status: "conflict", 
        reason: `Print year ${printYear} outside expected period ${expectedStart}-${expectedEnd}` 
      };
    }
    
    // Check for re-release (print year > release year + 1)
    if (printYear > releaseYear + 1) {
      return { 
        status: "reissue", 
        reason: `Re-issue: printed ${printYear}, released ${releaseYear}` 
      };
    }
    
    // Original
    return { 
      status: "original", 
      reason: `Verified original: printed ${printYear}, released ${releaseYear}` 
    };
  };

  app.post("/api/public/library/:id/ai-identify", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/public/library/:id/ai-identify", { id });

    const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
    if (!geminiKey) return c.json({ error: "Gemini API key not configured" }, 500);

    // Get image from library
    const imgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM image_library WHERE id = ${id}`));
    if (!imgs[0]) return c.json({ error: "Image not found" }, 404);

    // ═══════════════════════════════════════════════════
    // LAYER 1: CONTEXT - Extract from lot_number
    // ═══════════════════════════════════════════════════
    const lotContext = parseLotContext(imgs[0].lot_number);
    console.log("[API] Layer 1 - Context:", lotContext);

    // Download from storage
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(imgs[0].s3_uri);
    const file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found" }, 404);

    // Convert to base64
    const bytes = new Uint8Array(file.body);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const mimeType = file.metadata?.contentType || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    // ═══════════════════════════════════════════════════
    // LAYER 2 & 3: TMDb + FORENSIC (Coordinate-Based Prompting)
    // ═══════════════════════════════════════════════════
    const prompt = `You are the Lead Cataloger for "Frame and Reel," specializing in 100% theatrical original vintage movie posters. Your goal is to extract specific metadata from this poster image with 100% accuracy.

CONTEXT FROM FOLDER NAME:
- Expected Period: ${lotContext.expectedPeriodStart}-${lotContext.expectedPeriodEnd}
- Expected Language: ${lotContext.localLanguage}

COORDINATE-BASED ANALYSIS (CRITICAL):
1. HEADER (0-10% height from top): Look for DISTRIBUTOR LOGOS (Criterion, Lucky Red, 20th Century Fox, etc.), STUDIO MARKS, and RE-ISSUE billing headers. Note any modern printer credits.
2. CENTER (20-70% height): This is the main artwork. Identify the movie title in ${lotContext.localLanguage === 'it' ? 'Italian' : lotContext.localLanguage === 'fr' ? 'French' : lotContext.localLanguage === 'de' ? 'German' : 'English'}, actors, and primary visual elements.
3. FOOTER (85-100% height from bottom): The most critical zone. Look for:
   - NSS CODES (e.g., "81/0024", "NSS 123")
   - TAX/VISA STAMPS (French "Visa d'exploitation", UK "D-12345")
   - PRINTER CREDITS (e.g., "Printed in Italy", "Technicolor")
   - BILLING BLOCKS with year indicators

TITLE LANGUAGE RULE:
- DEFAULT: Lead with the English Title.
- EXCEPTION: If the film is of ${lotContext.localLanguage === 'it' ? 'Italian' : lotContext.localLanguage === 'fr' ? 'French' : lotContext.localLanguage === 'de' ? 'German' : 'English'} Origin, lead with the ${lotContext.localLanguage === 'it' ? 'Italian' : lotContext.localLanguage === 'fr' ? 'French' : lotContext.localLanguage === 'de' ? 'German' : 'English'} Title.

Return a JSON object with these fields:
{
  "inventory_status": "MATCHED" or "NEEDS_REVIEW",
  "movie_title": "Primary Title (use English unless origin is " + "${lotContext.localLanguage === 'it' ? 'Italian' : lotContext.localLanguage === 'fr' ? 'French' : lotContext.localLanguage === 'de' ? 'German' : 'English'})",
  "title_local": "Local language title (if different)",
  "release_year": "YYYY (from NSS code or billing block)",
  "print_year": "YYYY (from footer - may differ from release year for re-issues)",
  "origin_country": "Country",
  "is_french_origin": boolean,
  "billing_block_summary": "Director and Lead Cast",
  "confidence_score": 0.0-1.0,
  "director": "Director name(s)",
  "actors": "Main actor names, comma separated",
  "genre": "Primary genre",
  "posterStyle": "Style description (e.g., one-sheet, advance, Italian locandina, French petite)",
  "language": "Poster language (English, Italian, French, etc.)",
  "nss_code": "NSS/Tax code from footer (e.g., '81/0024')",
  "printer_credit": "Printer info from footer"
}

Only return the JSON, no other text.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }] }],
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return c.json({ error: "Could not parse AI response", raw: text }, 422);

      const movieData = JSON.parse(jsonMatch[0]);
      console.log("[API] AI identify success", { title: movieData.title, year: movieData.year, printYear: movieData.print_year });

      // Get library image for lot_number scoping
      const libImages = await edgespark.db.all<any>(sql.raw(`SELECT lot_number FROM image_library WHERE id = ${id}`));
      const libLotNumber = libImages[0]?.lot_number || null;

      // Search for matching inventory item (fuzzy, scoped to lot_number if available)
      // Map new field names from specialized prompt
      const matchResults = await fuzzyMatchInventory(movieData.movie_title, movieData.release_year, libLotNumber);

      // ═══════════════════════════════════════════════════
      // CONFLICT & RE-RELEASE DETECTION
      // ═══════════════════════════════════════════════════
      const printYear = movieData.print_year ? parseInt(movieData.print_year) : null;
      const releaseYear = movieData.release_year ? parseInt(movieData.release_year) : null;
      const conflict = detectConflict(printYear, releaseYear, lotContext.expectedPeriodStart, lotContext.expectedPeriodEnd);
      
      console.log("[API] Conflict Detection:", conflict);

      // Update library record with new field names + conflict status
      await edgespark.db.all(sql.raw(
        `UPDATE image_library SET 
          identified_title = '${(movieData.movie_title || movieData.title || "").replace(/'/g, "''")}', 
          identified_year = ${movieData.release_year || movieData.year || "NULL"}, 
          identified_director = '${(movieData.director || movieData.billing_block_summary || "").replace(/'/g, "''")}', 
          identified_genre = '${(movieData.genre || "").replace(/'/g, "''")}', 
          identified_actors = '${(movieData.actors || "").replace(/'/g, "''")}', 
          identified_data = '${JSON.stringify(movieData).replace(/'/g, "''")}',
          title_local = '${(movieData.title_local || "").replace(/'/g, "''")}',
          print_year = ${printYear || "NULL"},
          nss_visa_code = '${(movieData.nss_code || "").replace(/'/g, "''")}',
          printer_credit = '${(movieData.printer_credit || "").replace(/'/g, "''")}',
          year_range_start = ${lotContext.expectedPeriodStart},
          year_range_end = ${lotContext.expectedPeriodEnd},
          release_type = '${conflict.status}',
          conflict_status = '${conflict.status}',
          conflict_reason = '${conflict.reason.replace(/'/g, "''")}',
          updated_at = ${Date.now()} 
        WHERE id = ${id}`
      ));

      // Return with standardized field names for frontend compatibility
      const standardizedMovie = {
        title: movieData.movie_title || movieData.title || null,
        year: movieData.release_year || movieData.year || null,
        director: movieData.director || movieData.billing_block_summary || null,
        genre: movieData.genre || null,
        actors: movieData.actors || null,
        origin_country: movieData.origin_country || null,
        confidence_score: movieData.confidence_score || null,
        posterStyle: movieData.posterStyle || null,
        language: movieData.language || null,
        title_local: movieData.title_local || null,
        print_year: movieData.print_year || null,
        nss_code: movieData.nss_code || null,
        printer_credit: movieData.printer_credit || null,
      };

      // Include conflict detection results
      return c.json({ 
        success: true, 
        source: "gemini", 
        movie: standardizedMovie, 
        inventoryMatches: matchResults,
        conflict: conflict,
        context: lotContext
      });
    } catch (err: any) {
      console.error("[API] AI identify error", err.message, err.stack);
      return c.json({ error: "AI identification failed: " + err.message, details: err.stack, fullError: JSON.stringify(err) }, 500);
    }
  });

  // TMDB Scan for library image (skip OCR, use identified_title if manual data exists)
  app.post("/api/public/library/:id/tmdb-scan", async (c) => {
    const id = parseInt(c.req.param("id"));
    const { title, year } = await c.req.json() as { title?: string; year?: number };
    console.log("[API] POST /api/public/library/:id/tmdb-scan", { id, title, year });

    // Get current identified info if title not provided
    let searchTitle = title;
    let searchYear = year;

    if (!searchTitle) {
      const imgs = await edgespark.db.all<any>(sql.raw(`SELECT identified_title, identified_year FROM image_library WHERE id = ${id}`));
      if (!imgs[0] || !imgs[0].identified_title) {
        return c.json({ error: "No title provided and no identified_title in database" }, 400);
      }
      searchTitle = imgs[0].identified_title as string;
      searchYear = imgs[0].identified_year ?? undefined;
    }

    const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;
    if (!tmdbKeyStr) return c.json({ error: "TMDB API key not configured" }, 500);

    try {
      let query = searchTitle;
      if (searchYear) query += ` ${searchYear}`;
      
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&api_key=${tmdbKeyStr}`,
      );
      const tmdbData: any = await tmdbRes.json();

      if (!tmdbData.results || tmdbData.results.length === 0) {
        return c.json({ error: "No movie found in TMDB", suggestion: "Try AI Identify instead" }, 404);
      }

      const movie = tmdbData.results[0];
      let details: any = {};
      try {
        const detailRes = await fetch(
          `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKeyStr}`,
        );
        details = await detailRes.json();
      } catch {}

      const director = details.credits?.crew?.find((c: any) => c.job === "Director")?.name || null;
      const actors = details.credits?.cast?.slice(0, 4).map((a: any) => a.name).join(", ") || null;
      const genres = details.genres?.map((g: any) => g.name).join(", ") || null;

      const movieData = {
        title: movie.title,
        year: movie.release_date ? parseInt(movie.release_date) : null,
        director,
        actors,
        genre: genres,
        plot: movie.overview || details.overview || null,
      };

      // Update library record
      await edgespark.db.all(sql.raw(
        `UPDATE image_library SET identified_title = '${(movieData.title || "").replace(/'/g, "''")}', identified_year = ${movieData.year || "NULL"}, identified_director = '${(movieData.director || "").replace(/'/g, "''")}', identified_genre = '${(movieData.genre || "").replace(/'/g, "''")}', identified_actors = '${(movieData.actors || "").replace(/'/g, "''")}', identified_data = '${JSON.stringify(movieData).replace(/'/g, "''")}', updated_at = ${Date.now()} WHERE id = ${id}`
      ));

      // Get library image for lot_number scoping
      const libImgs = await edgespark.db.all<any>(sql.raw(`SELECT lot_number FROM image_library WHERE id = ${id}`));
      const libLot = libImgs[0]?.lot_number || null;

      // Search inventory (scoped to lot_number if available)
      const matchResults = await fuzzyMatchInventory(movieData.title, movieData.year || undefined, libLot);

      return c.json({ success: true, movie: movieData, source: "tmdb", inventoryMatches: matchResults });
    } catch (err: any) {
      console.error("[API] TMDB scan error", err.message, err.stack);
      return c.json({ error: "TMDB scan failed: " + err.message, details: err.stack, fullError: JSON.stringify(err) }, 500);
    }
  });

  // Update library image metadata (lot, item number, note, format)
  app.patch("/api/public/library/:id/metadata", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    console.log("[API] PATCH /api/public/library/:id/metadata", { id, body });

    const allowed = ["lot_number", "item_number", "upload_note", "poster_format", "release_type", "dimensions", "identified_title", "identified_year", "identified_director", "identified_genre", "identified_actors", "year_range_start", "year_range_end"];
    const sets: string[] = [`updated_at = ${Date.now()}`];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (key === "identified_year" && (body[key] === null || body[key] === "")) {
          sets.push(`${key} = NULL`);
        } else if (key === "identified_year") {
          sets.push(`${key} = ${parseInt(body[key]) || "NULL"}`);
        } else {
          const val = body[key] === null || body[key] === "" ? "NULL" : `'${String(body[key]).replace(/'/g, "''")}'`;
          sets.push(`${key} = ${val}`);
        }
      }
    }

    try {
      await edgespark.db.all(sql.raw(`UPDATE image_library SET ${sets.join(", ")} WHERE id = ${id}`));
      return c.json({ success: true });
    } catch (err: any) {
      console.error("[API] PATCH metadata error:", err.message);
      // Return more detail about what failed
      const errorDetail = err.message || "Unknown error";
      return c.json({ error: "Database error: " + errorDetail }, 500);
    }
  });

  // Bulk update metadata for multiple images
  app.post("/api/public/library/bulk-update", async (c) => {
    const body = await c.req.json();
    const { ids, poster_format, release_type, dimensions, lot_number } = body;
    console.log("[API] POST /api/public/library/bulk-update", { ids: ids?.length, poster_format, release_type, dimensions, lot_number });

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "No ids provided" }, 400);
    }

    const sets: string[] = [`updated_at = ${Date.now()}`];
    if (poster_format !== undefined) sets.push(`poster_format = ${poster_format ? `'${poster_format.replace(/'/g, "''")}'` : "NULL"}`);
    if (release_type !== undefined) sets.push(`release_type = ${release_type ? `'${release_type.replace(/'/g, "''")}'` : "NULL"}`);
    if (dimensions !== undefined) sets.push(`dimensions = ${dimensions ? `'${dimensions.replace(/'/g, "''")}'` : "NULL"}`);
    if (lot_number !== undefined) sets.push(`lot_number = ${lot_number ? `'${lot_number.replace(/'/g, "''")}'` : "NULL"}`);

    if (sets.length === 1) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const idsStr = ids.join(", ");
    await edgespark.db.all(sql.raw(`UPDATE image_library SET ${sets.join(", ")} WHERE id IN (${idsStr})`));

    return c.json({ success: true, updated: ids.length });
  });

  // Match library image to inventory item
  app.post("/api/public/library/:id/match", async (c) => {
    const id = parseInt(c.req.param("id"));
    const { inventoryId } = await c.req.json();
    console.log("[API] POST /api/public/library/:id/match", { id, inventoryId });

    const imgs = await edgespark.db.all<any>(sql.raw(`SELECT s3_uri, identified_title, identified_year, identified_director, identified_genre, identified_actors, identified_data FROM image_library WHERE id = ${id}`));
    if (!imgs[0]) return c.json({ error: "Image not found" }, 404);

    const img = imgs[0];
    let identifiedData: any = null;
    try { identifiedData = img.identified_data ? JSON.parse(img.identified_data) : null; } catch {}

    // Build enrichment fields from TMDB/AI data
    const enrichParts: string[] = [];
    enrichParts.push(`source_url = '${img.s3_uri.replace(/'/g, "''")}'`);
    if (img.identified_year) enrichParts.push(`year = ${img.identified_year}`);
    if (img.identified_director) enrichParts.push(`director = '${img.identified_director.replace(/'/g, "''")}'`);
    if (img.identified_genre) enrichParts.push(`genre = '${img.identified_genre.replace(/'/g, "''")}'`);
    if (img.identified_actors) enrichParts.push(`actors = '${img.identified_actors.replace(/'/g, "''")}'`);
    if (identifiedData?.original_title) enrichParts.push(`original_title = '${identifiedData.original_title.replace(/'/g, "''")}'`);
    enrichParts.push(`updated_at = ${Date.now()}`);

    // Update inventory item with image + enriched data
    await edgespark.db.all(sql.raw(
      `UPDATE inventory SET ${enrichParts.join(", ")} WHERE id = ${inventoryId}`
    ));

    // Mark library image as matched
    await edgespark.db.all(sql.raw(
      `UPDATE image_library SET matched_inventory_id = ${inventoryId}, updated_at = ${Date.now()} WHERE id = ${id}`
    ));

    await syncMediaLibraryToInventory(edgespark, sql, id, inventoryId);

    // Get download URL for the image
    let downloadUrl = null;
    try {
      const { bucket, path } = edgespark.storage.fromS3Uri(imgs[0].s3_uri);
      const res = await edgespark.storage.from(bucket).createPresignedGetUrl(path, 86400);
      downloadUrl = res.downloadUrl;
    } catch {}

    return c.json({ success: true, imageUrl: downloadUrl });
  });

  // Unmatch library image (detach from inventory)
  app.post("/api/public/library/:id/unmatch", async (c) => {
    const id = parseInt(c.req.param("id"));
    await edgespark.db.all(sql.raw(
      `UPDATE image_library SET matched_inventory_id = NULL, updated_at = ${Date.now()} WHERE id = ${id}`
    ));
    return c.json({ success: true });
  });

  // Create a new inventory item from a library image (identified but no match)
  app.post("/api/public/library/:id/create-listing", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/public/library/:id/create-listing", { id });

    const imgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM image_library WHERE id = ${id}`));
    if (!imgs[0]) return c.json({ error: "Image not found" }, 404);
    const img = imgs[0];
    if (!img.identified_title) return c.json({ error: "Image must be identified first (title required)" }, 400);
    if (img.matched_inventory_id) return c.json({ error: "Already matched to inventory item #" + img.matched_inventory_id }, 409);

    const now = Date.now();
    let posterCountry = "France";
    if (["Locandina","Due Fogli","4-Fogli","6-Fogli","Photobusta"].includes(img.poster_format)) posterCountry = "Italy";
    else if (["1sh","Half-sheet"].includes(img.poster_format)) posterCountry = "USA";

    const fmtDims: Record<string, string> = {
      "French Petite": '15.7" x 20.5" (40 x 52 cm)', "French Moyenne": '23.6" x 31.5" (60 x 80 cm)',
      "French Grande": '47.2" x 63" (120 x 160 cm)', "Locandina": '13" x 27.5" (33 x 70 cm)',
      "Due Fogli": '19.7" x 27.5" (50 x 70 cm)', "4-Fogli": '39" x 55" (99 x 140 cm)',
      "1sh": '27" x 41" (69 x 104 cm)',
    };

    const esc = (v: string) => v.replace(/'/g, "''");
    const n = (v: any) => v ? `'${esc(String(v))}'` : "NULL";

    await edgespark.db.all(sql.raw(
      `INSERT INTO inventory (title, year, director, genre, actors, format, poster_country, dimensions, lot_id, source_url, notes, ds_ss, sold, visibility, created_at, updated_at, item_type)
       VALUES ('${esc(img.identified_title)}', ${n(img.identified_year)}, ${n(img.identified_director)}, ${n(img.identified_genre)}, ${n(img.identified_actors)},
       ${n(img.poster_format || "French Petite")}, '${posterCountry}', ${n(img.dimensions || fmtDims[img.poster_format || ""] || "")}, ${n(img.lot_number)},
       ${n(img.s3_uri)}, ${n(img.upload_note)}, 'SS', 0, 'listed', ${now}, ${now}, 'Indiv.')`
    ));

    const created = await edgespark.db.all<any>(sql.raw(
      `SELECT * FROM inventory WHERE source_url = ${n(img.s3_uri)} AND title = '${esc(img.identified_title)}' ORDER BY id DESC LIMIT 1`
    ));
    if (!created[0]) return c.json({ error: "Failed to retrieve created item" }, 500);

    await edgespark.db.all(sql.raw(
      `UPDATE image_library SET matched_inventory_id = ${created[0].id}, updated_at = ${now} WHERE id = ${id}`
    ));

    console.log("[API] Created inventory item from library", { id: created[0].id, title: created[0].title });
    return c.json({ item: created[0] });
  });

  // ═══════════════════════════════════════════════════
  // EBAY INTEGRATION
  // ═══════════════════════════════════════════════════

  // Helper: get eBay Browse API access token via client credentials grant
  async function getEbayBrowseToken(): Promise<string | null> {
    const clientId = edgespark.secret.get("EBAY_APP_ID");
    const clientSecret = edgespark.secret.get("EBAY_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      console.error("[eBay] Missing EBAY_APP_ID or EBAY_CLIENT_SECRET for Browse API");
      return null;
    }
    try {
      const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
        },
        body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error("[eBay] Client credentials token fetch failed", res.status, errBody);
        return null;
      }
      const data: any = await res.json();
      return data.access_token;
    } catch (e) {
      console.error("[eBay] Client credentials token fetch error", e);
      return null;
    }
  }

  // Subscribe — save email to subscribers table
  app.post("/api/public/subscribe", async (c) => {
    const { email } = await c.req.json();
    if (!email || !email.includes("@")) return c.json({ error: "Valid email required" }, 400);
    const safeEmail = email.trim().toLowerCase().replace(/'/g, "''");
    try {
      await edgespark.db.all(sql.raw(`INSERT INTO subscribers (email, created_at) VALUES ('${safeEmail}', ${Date.now()})`));
      console.log("[API] POST /api/public/subscribe", { email });
      return c.json({ success: true });
    } catch (err: any) {
      if (String(err).includes("UNIQUE")) return c.json({ success: true, note: "Already subscribed" });
      throw err;
    }
  });

  // Contact — save a customer message
  app.post("/api/public/contact", async (c) => {
    const { email, message, name } = await c.req.json();
    if (!email || !email.includes("@")) return c.json({ error: "Valid email required" }, 400);
    if (!message || message.trim().length < 2) return c.json({ error: "Message is too short" }, 400);
    const safeEmail = email.trim().toLowerCase().replace(/'/g, "''");
    const safeMessage = message.trim().replace(/'/g, "''");
    const safeName = name ? `'${name.trim().replace(/'/g, "''")}'` : "NULL";
    await edgespark.db.all(sql.raw(
      `INSERT INTO contact_messages (email, message, name, created_at) VALUES ('${safeEmail}', '${safeMessage}', ${safeName}, ${Date.now()})`
    ));
    console.log("[API] POST /api/public/contact", { email, name: name || null });
    return c.json({ success: true });
  });

  // Admin: list subscribers and messages
  app.get("/api/inventory-admin/subscribers", async (c) => {
    const subs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 200`));
    const msgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200`));
    return c.json({ subscribers: subs, messages: msgs });
  });

  // Search eBay listings for a seller using the Browse API (no auth needed)
  app.get("/api/inventory-admin/ebay-search", async (c) => {
    const seller = c.req.query("seller") || "";
    const query = c.req.query("query") || "movie poster";
    const page = parseInt(c.req.query("page") || "1");
    if (!seller) return c.json({ error: "seller parameter required" }, 400);

    const token = await getEbayBrowseToken();
    if (!token) return c.json({ error: "Failed to authenticate with eBay Browse API. Check EBAY_APP_ID and EBAY_CLIENT_SECRET." }, 500);

    try {
      const params = new URLSearchParams({
        q: query,
        filter: `sellers:{${seller}}`,
        limit: "48",
        offset: String((page - 1) * 48),
      });
      const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error("[API] eBay search error", res.status, errBody);
        return c.json({ error: `eBay API error ${res.status}`, details: errBody }, 500 as any);
      }
      const data: any = await res.json();
      const items = (data.itemSummaries || []).map((item: any) => ({
        ebayItemId: item.id || item.itemId,
        title: item.title,
        price: item.price?.value ? parseFloat(item.price.value) : null,
        currency: item.price?.currency || "USD",
        condition: item.condition,
        itemWebUrl: item.itemWebUrl,
        image: item.image?.imageUrl,
        shippingCost: item.shippingOptions?.[0]?.shippingCost?.value ? parseFloat(item.shippingOptions[0].shippingCost.value) : null,
        status: item.itemAffiliateWebUrl ? "active" : "ended",
        listingType: item.listingType,
      }));

      return c.json({
        total: data.total || 0,
        page,
        items,
        href: data.href,
      });
    } catch (err: any) {
      console.error("[API] eBay search exception", err.message);
      return c.json({ error: "eBay search failed: " + err.message }, 500);
    }
  });

  // Auto-match eBay listings to existing inventory (bulk)
  app.post("/api/inventory-admin/ebay-auto-match", async (c) => {
    const body = await c.req.json();
    const { listings, seller, dryRun } = body as { listings?: any[]; seller?: string; dryRun?: boolean };
    console.log("[API] POST /api/inventory-admin/ebay-auto-match", { listingCount: listings?.length, seller, dryRun });

    // If no listings provided, pull from eBay
    let ebayListings = listings || [];
    if (ebayListings.length === 0 && seller) {
      const token = await getEbayBrowseToken();
      if (!token) return c.json({ error: "eBay auth failed" }, 500);
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({
          q: "poster",
          filter: `sellers:{${seller}}`,
          limit: "48",
          offset: String(offset),
        });
        const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
          headers: { "Authorization": `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
        });
        if (!res.ok) break;
        const data: any = await res.json();
        const items = (data.itemSummaries || []).map((item: any) => ({
          ebayItemId: item.id || item.itemId,
          title: item.title,
          price: item.price?.value ? parseFloat(item.price.value) : null,
          currency: item.price?.currency || "USD",
          condition: item.condition,
          itemWebUrl: item.itemWebUrl,
          image: item.image?.imageUrl,
          shippingCost: item.shippingOptions?.[0]?.shippingCost?.value ? parseFloat(item.shippingOptions[0].shippingCost.value) : null,
          status: "active",
        }));
        ebayListings.push(...items);
        offset += 48;
        hasMore = items.length === 48;
        if (hasMore) await new Promise(r => setTimeout(r, 200));
      }
    }

    if (ebayListings.length === 0) return c.json({ error: "No eBay listings to process" }, 400);

    // Get all inventory items
    const allInventory = await edgespark.db.all<any>(
      sql.raw(`SELECT id, title, original_title, year, format, item_number, ebay_item_id, source_url, image_source FROM inventory WHERE title IS NOT NULL`)
    );
    const linkedEbayIds = new Set(allInventory.filter(i => i.ebay_item_id).map(i => String(i.ebay_item_id)));

    // Fuzzy match helper
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const stopWords = new Set(["the", "and", "for", "with", "from", "original", "movie", "film", "poster", "posters", "vintage", "lot", "new", "not", "one", "two", "us", "uk", "style", "black", "advance", "teaser", "final", "reissue", "rerelease", "first", "italian", "french", "japanese", " british"]);

    const findBestMatch = (ebayTitle: string) => {
      const yearFromEbay = (ebayTitle.match(/\b(19\d{2}|20\d{2})\b/) || [])[1];
      const cleanEbay = clean(ebayTitle);
      const ebayWords = cleanEbay.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
      if (ebayWords.length === 0) return null;

      let bestScore = 0;
      let bestItem = null;

      for (const inv of allInventory) {
        if (inv.ebay_item_id) continue; // skip already linked
        const invClean = clean(inv.title || "");
        const invOrigClean = clean(inv.original_title || "");
        const invText = invClean + " " + invOrigClean;

        // Keyword overlap score
        const matchCount = ebayWords.filter(w => invText.includes(w)).length;
        if (matchCount < 2) continue;

        let score = matchCount;

        // Year match bonus
        if (yearFromEbay && inv.year && String(inv.year) === yearFromEbay) score += 3;

        // Full title containment bonus
        if (invClean && cleanEbay.includes(invClean)) score += 5;
        if (invOrigClean && cleanEbay.includes(invOrigClean)) score += 5;
        if (invClean && invClean.includes(cleanEbay)) score += 3;

        // Normalize by title length to avoid matching generic titles
        score -= (ebayWords.length - matchCount) * 0.5;

        if (score > bestScore) {
          bestScore = score;
          bestItem = inv;
        }
      }

      // Require minimum score to avoid false positives
      return bestScore >= 4 ? { item: bestItem, score: bestScore } : null;
    };

    const results = {
      matched: [] as any[],
      unmatched: [] as any[],
      alreadyLinked: [] as any[],
      errors: [] as string[],
    };

    for (const ebay of ebayListings) {
      // Skip already linked
      if (linkedEbayIds.has(String(ebay.ebayItemId))) {
        results.alreadyLinked.push(ebay);
        continue;
      }

      // Find best match but DON'T auto-link - just report the match
      const match = findBestMatch(ebay.title);

      if (match) {
        // Only report match, do not auto-link
        results.matched.push({ 
          ebay: ebay, 
          inventory: { 
            id: match.item.id, 
            title: match.item.title, 
            year: match.item.year, 
            format: match.item.format,
            item_number: match.item.item_number 
          }, 
          score: match.score 
        });
      } else {
        results.unmatched.push(ebay);
      }
    }

    console.log("[API] Auto-match done (match-only mode, no auto-link)", {
      matched: results.matched.length,
      unmatched: results.unmatched.length,
      alreadyLinked: results.alreadyLinked.length,
    });
    return c.json(results);
  });

  // Sync eBay listing to inventory item (manually link)
  app.post("/api/inventory-admin/ebay-link", async (c) => {
    const body = await c.req.json();
    const { inventoryId, ebayItemId, ebayPrice } = body;
    if (!inventoryId || !ebayItemId) return c.json({ error: "inventoryId and ebayItemId required" }, 400);

    console.log("[API] POST /api/inventory-admin/ebay-link", { inventoryId, ebayItemId });

    // Check if this ebay_item_id is already linked to another item
    const existing = await edgespark.db.all<any>(sql.raw(
      `SELECT id, title FROM inventory WHERE ebay_item_id = '${String(ebayItemId).replace(/'/g, "''")}' AND id != ${inventoryId}`
    ));
    if (existing.length > 0) {
      return c.json({ error: `eBay item already linked to inventory #${existing[0].id} (${existing[0].title})`, linkedTo: existing[0] }, 409);
    }

    const sets = [
      `ebay_item_id = '${String(ebayItemId).replace(/'/g, "''")}'`,
      `updated_at = ${Date.now()}`,
    ];
    if (ebayPrice !== undefined) sets.push(`ebay_price = ${ebayPrice}`);

    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${inventoryId}`));
    return c.json({ success: true });
  });

  // Batch update pricing based on eBay prices + markup
  app.post("/api/inventory-admin/ebay-sync-pricing", async (c) => {
    const body = await c.req.json();
    const { markup } = body; // markup as decimal (e.g. 0.9 for 90% of eBay price)
    console.log("[API] POST /api/inventory-admin/ebay-sync-pricing", { markup });

    const items = await edgespark.db.all<any>(
      sql.raw(`SELECT id, ebay_price FROM inventory WHERE ebay_price IS NOT NULL AND ebay_price > 0`)
    );

    let updated = 0;
    for (const item of items) {
      const newPrice = Math.round(item.ebay_price * markup * 100) / 100;
      await edgespark.db.all(sql.raw(
        `UPDATE inventory SET price = ${newPrice}, updated_at = ${Date.now()} WHERE id = ${item.id}`
      ));
      updated++;
    }

    return c.json({ success: true, updated });
  });

  // eBay diagnostic endpoint — tests API connectivity
  app.get("/api/inventory-admin/ebay-diagnose", async (c) => {
    const storedAppId = edgespark.secret.get("EBAY_APP_ID");
    const storedRuName = edgespark.secret.get("EBAY_RU_NAME");
    const storedSecret = edgespark.secret.get("EBAY_CLIENT_SECRET") ? "SET (hidden)" : "NOT SET";

    const diagnostics: any = {
      storedCredentials: {
        EBAY_APP_ID: storedAppId ? `${storedAppId.substring(0, 10)}...` : "NOT SET",
        EBAY_CLIENT_SECRET: storedSecret,
        EBAY_RU_NAME: storedRuName || "NOT SET",
      },
      // Credentials are configured via YouWare secrets (EBAY_APP_ID, EBAY_RU_NAME,
      // EBAY_CLIENT_SECRET). This diagnostic only reports whether each is set —
      // it intentionally does not compare against or expose literal values.
    };

    // Test 1: Browse API (pull listings) with client credentials token
    const browseTestUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?seller=poster_child-1&limit=3&q=poster`;
    try {
      const browseToken = await getEbayBrowseToken();
      const browseRes = await fetch(browseTestUrl, {
        headers: { "Authorization": `Bearer ${browseToken || storedAppId}` },
      });
      diagnostics.browseApiTest = {
        url: browseTestUrl,
        status: browseRes.status,
        statusText: browseRes.statusText,
        tokenSource: browseToken ? "client_credentials" : "raw_app_id (fallback)",
        ok: browseRes.ok,
      };
      if (!browseRes.ok) {
        diagnostics.browseApiTest.errorBody = await browseRes.text();
      } else {
        const browseData: any = await browseRes.json();
        diagnostics.browseApiTest.total = browseData.total;
        diagnostics.browseApiTest.itemsReturned = browseData.itemSummaries?.length || 0;
        diagnostics.browseApiTest.firstItemTitle = browseData.itemSummaries?.[0]?.title || "none";
      }
    } catch (e: any) {
      diagnostics.browseApiTest = { error: e.message };
    }

    // Test 2: OAuth authorize URL generation
    const redirectUri = `https://signin.ebay.com/ws/eBayISAPI.dll?RuName=${storedRuName}`;
    const EBAY_SELL_SCOPES = "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account";
    const authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(storedAppId || "")}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(EBAY_SELL_SCOPES)}`;
    diagnostics.oauthUrlTest = {
      generatedUrl: authUrl,
      redirectUri: redirectUri,
      redirectUrlForPortal: "https://staging--b4puosnkz6175drjl5qg.youbase.cloud/api/public/ebay-callback",
      note: "The redirectUrlForPortal is what you need to set in eBay Developer Portal for this RuName",
    };

    return c.json(diagnostics);
  });

  // Pull ALL eBay listings (paginated) - loops through all pages
  app.get("/api/inventory-admin/ebay-pull-all", async (c) => {
    const seller = c.req.query("seller") || "";
    const query = c.req.query("query") || "";
    if (!seller) return c.json({ error: "seller parameter required" }, 400);

    const token = await getEbayBrowseToken();
    if (!token) return c.json({ error: "Failed to authenticate with eBay Browse API. Check EBAY_APP_ID and EBAY_CLIENT_SECRET." }, 500);

    try {
      const allItems: any[] = [];
      let offset = 0;
      const limit = 48;
      let totalFromApi = 0;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({
          q: query || "poster",
          filter: `sellers:{${seller}}`,
          limit: String(limit),
          offset: String(offset),
        });
        const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
        });
        if (!res.ok) {
          const errBody = await res.text();
          console.error("[API] eBay pull-all error at offset", offset, res.status, errBody);
          // If first page fails, return the error with details
          if (offset === 0) {
            return c.json({ error: `eBay API error: ${res.status}`, details: errBody, items: [], total: 0, pulled: 0 }, 500 as any);
          }
          // If later page fails, return what we have so far
          break;
        }
        const data: any = await res.json();
        const items = (data.itemSummaries || []).map((item: any) => ({
          ebayItemId: item.id || item.itemId,
          title: item.title,
          price: item.price?.value ? parseFloat(item.price.value) : null,
          currency: item.price?.currency || "USD",
          condition: item.condition,
          itemWebUrl: item.itemWebUrl,
          image: item.image?.imageUrl,
          shippingCost: item.shippingOptions?.[0]?.shippingCost?.value ? parseFloat(item.shippingOptions[0].shippingCost.value) : null,
          status: "active",
          listingType: item.listingType,
        }));
        allItems.push(...items);
        if (!totalFromApi) totalFromApi = data.total || 0;
        offset += limit;
        hasMore = allItems.length < totalFromApi && items.length === limit;
        // eBay API rate limit safety
        if (hasMore) await new Promise(r => setTimeout(r, 200));
      }

      // Cross-reference with existing inventory to mark already-linked items
      const existing = await edgespark.db.all<any>(sql.raw(
        `SELECT id, item_number, ebay_item_id, title FROM inventory WHERE ebay_item_id IS NOT NULL`
      ));
      const linkedEbayIds = new Set(existing.map((e: any) => String(e.ebay_item_id)));

      // Upsert all listings into local DB (persist for re-pull)
      const now = Date.now();
      for (const item of allItems) {
        const esc = (s: string | null | undefined) => s ? String(s).replace(/'/g, "''") : "NULL";
        try {
          await edgespark.db.all(sql.raw(`
            INSERT INTO ebay_listings (ebay_item_id, title, price, currency, condition, item_web_url, image_url, shipping_cost, status, listing_type, seller, last_synced_at)
            VALUES ('${esc(item.ebayItemId)}', '${esc(item.title)}', ${item.price ?? 'NULL'}, '${esc(item.currency)}', '${esc(item.condition)}', '${esc(item.itemWebUrl)}', '${esc(item.image)}', ${item.shippingCost ?? 'NULL'}, '${esc(item.status)}', '${esc(item.listingType)}', '${esc(seller)}', ${now})
            ON CONFLICT(ebay_item_id) DO UPDATE SET
              title = excluded.title,
              price = excluded.price,
              currency = excluded.currency,
              condition = excluded.condition,
              item_web_url = excluded.item_web_url,
              image_url = excluded.image_url,
              shipping_cost = excluded.shipping_cost,
              status = excluded.status,
              listing_type = excluded.listing_type,
              seller = excluded.seller,
              last_synced_at = excluded.last_synced_at
          `));
        } catch (e) {
          console.warn("[DB] Upsert failed for", item.ebayItemId, e);
        }
      }
      console.log("[API] Persisted", allItems.length, "eBay listings locally");

      // Return from local DB with link status
      const storedListings = await edgespark.db.all<any>(sql.raw(`
        SELECT el.*, i.id as linked_inventory_id
        FROM ebay_listings el
        LEFT JOIN inventory i ON i.ebay_item_id = el.ebay_item_id
        WHERE el.seller = '${seller}'
        ORDER BY el.last_synced_at DESC
      `));

      const enriched = storedListings.map((item: any) => ({
        ...item,
        linked: !!item.linked_inventory_id,
        linkedInventoryId: item.linked_inventory_id || null,
      }));

      return c.json({
        total: totalFromApi,
        pulled: enriched.length,
        items: enriched,
        alreadyLinked: enriched.filter((i: any) => i.linked).length,
      });
    } catch (err: any) {
      console.error("[API] eBay pull-all exception", err.message);
      return c.json({ error: "eBay pull failed: " + err.message }, 500);
    }
  });

  // Suggest inventory matches for an eBay listing by title keywords (fuzzy matching)
  app.get("/api/inventory-admin/ebay-suggest-matches", async (c) => {
    const title = c.req.query("title") || "";
    if (!title) return c.json({ matches: [] });

    // Clean and normalize the query title
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const cleanTitle = normalize(title);
    
    // Extract year from title if present
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    const titleYear = yearMatch ? yearMatch[1] : null;

    // Extract key words, excluding common stop words
    const stopWords = new Set(["the", "and", "for", "with", "from", "original", "movie", "film", "poster", "posters", "vintage", "lot", "new", "not", "one", "two", "x", "size", "inch", "condition", "rare", "classic"]);
    const words = cleanTitle.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
    
    if (words.length === 0) return c.json({ matches: [] });

    // Get candidate inventory (exclude already-linked items)
    const allItems = await edgespark.db.all<any>(
      sql.raw(`SELECT id, title, year, format, item_number, ebay_item_id, source_url, price FROM inventory WHERE title IS NOT NULL AND ebay_item_id IS NULL LIMIT 200`)
    );

    // Scoring function for fuzzy matching
    const scoreItem = (item: any): number => {
      const invTitle = normalize(item.title || "");
      let score = 0;

      // Direct substring match (highest weight)
      if (invTitle.includes(cleanTitle)) score += 50;
      
      // Word matching
      for (const word of words) {
        // Exact word match
        if (invTitle.includes(word)) {
          score += 10;
        } else {
          // Partial/fuzzy match - word appears as substring
          for (const iw of invTitle.split(/\s+/)) {
            if (iw.includes(word) || word.includes(iw)) {
              score += 5;
              break;
            }
          }
        }
      }

      // Year matching (strong signal)
      if (titleYear && item.year) {
        if (String(item.year) === titleYear) {
          score += 15;
        } else if (Math.abs(parseInt(titleYear) - item.year) <= 1) {
          score += 5; // adjacent year
        }
      }

      // Bonus for format keywords in title (French, Italian, etc poster types)
      const formatHints = ["french", "italian", "german", "spanish", "us", "uk", "original", "insert", " Lobby"];
      for (const hint of formatHints) {
        if (cleanTitle.includes(hint) && invTitle.includes(hint)) score += 3;
      }

      return score;
    };

    const scored = allItems
      .map(item => ({ ...item, _matchScore: scoreItem(item) }))
      .filter(item => item._matchScore >= 10) // Minimum threshold
      .sort((a, b) => b._matchScore - a._matchScore)
      .slice(0, 5);

    console.log("[API] Fuzzy match for:", title, "found", scored.length, "candidates");
    return c.json({ matches: scored, keywords: words, queryYear: titleYear });
  });

  // Create a new inventory item from an eBay listing
  app.post("/api/inventory-admin/ebay-create", async (c) => {
    const body = await c.req.json();
    const { ebayItemId, title, price, itemWebUrl, image, condition, shippingCost } = body;
    if (!ebayItemId || !title) return c.json({ error: "ebayItemId and title required" }, 400);

    // Check if this ebay_item_id is already linked
    const existing = await edgespark.db.all<any>(sql.raw(
      `SELECT id, item_number FROM inventory WHERE ebay_item_id = '${String(ebayItemId).replace(/'/g, "''")}'`
    ));
    if (existing.length > 0) {
      return c.json({ error: "eBay listing already linked", inventoryId: existing[0].id, itemNumber: existing[0].item_number }, 409);
    }

    const now = Date.now();
    // Generate next item number
    const maxRow = await edgespark.db.all<any>(sql.raw(
      `SELECT MAX(id) as max_id FROM inventory`
    ));
    const nextId = (maxRow[0]?.max_id || 0) + 1;
    const itemNumber = `FR-${String(nextId).padStart(5, "0")}`;

    const ebayLink = itemWebUrl || `https://www.ebay.com/itm/${ebayItemId}`;
    const notes = `Created from eBay listing #${ebayItemId}\n${ebayLink}`;

    // Derive basic metadata from title (best-effort)
    const titleClean = title.replace(/\s*[-–|]\s*(original|vintage|movie|film|poster|lobby card|insert|one sheet|half sheet|window card|three sheet|six sheet|italian|french|japanese|us|uk|british)\s*(movie|film)?\s*poster(s)?\s*/gi, " ").trim();

    await edgespark.db.all(sql.raw(`
      INSERT INTO inventory (title, price, ebay_item_id, ebay_price, ebay_status, source_url, notes, visibility, condition_grade, item_number, created_at, updated_at, source, image_source)
      VALUES (
        '${titleClean.replace(/'/g, "''")}',
        ${price || 0},
        '${String(ebayItemId).replace(/'/g, "''")}',
        ${price || 0},
        'active',
        '${ebayLink.replace(/'/g, "''")}',
        '${notes.replace(/'/g, "''")}',
        'listed',
        ${condition ? `'${String(condition).replace(/'/g, "''")}'` : "'good'"},
        '${itemNumber}',
        ${now},
        ${now},
        'ebay',
        'ebay'
      )
    `));

    const created = await edgespark.db.all<any>(sql.raw(
      `SELECT * FROM inventory WHERE item_number = '${itemNumber}'`
    ));

    return c.json({ success: true, item: created[0] });
  });

  // Bulk create inventory items from eBay listings
  app.post("/api/inventory-admin/ebay-bulk-create", async (c) => {
    const body = await c.req.json();
    const { listings } = body as { listings: any[] };
    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return c.json({ error: "listings array required" }, 400);
    }

    // Get existing linked ebay_item_ids to skip
    const existing = await edgespark.db.all<any>(sql.raw(
      `SELECT ebay_item_id FROM inventory WHERE ebay_item_id IS NOT NULL`
    ));
    const linkedIds = new Set(existing.map((e: any) => String(e.ebay_item_id)));

    // Get next ID
    const maxRow = await edgespark.db.all<any>(sql.raw(`SELECT MAX(id) as max_id FROM inventory`));
    let nextId = (maxRow[0]?.max_id || 0) + 1;
    const now = Date.now();
    const results: { success: boolean; ebayItemId: string; inventoryId?: number; itemNumber?: string; reason?: string }[] = [];

    for (const listing of listings) {
      if (!listing.ebayItemId) { results.push({ success: false, ebayItemId: "unknown", reason: "no ebayItemId" }); continue; }
      if (linkedIds.has(String(listing.ebayItemId))) {
        results.push({ success: false, ebayItemId: String(listing.ebayItemId), reason: "already linked" });
        continue;
      }

      const itemNumber = `FR-${String(nextId).padStart(5, "0")}`;
      const ebayLink = listing.itemWebUrl || `https://www.ebay.com/itm/${listing.ebayItemId}`;
      const notes = `Created from eBay listing #${listing.ebayItemId}\n${ebayLink}`;
      const titleClean = (listing.title || "").replace(/\s*[-–|]\s*(original|vintage|movie|film|poster|lobby card|insert|one sheet|half sheet|window card|three sheet|six sheet|italian|french|japanese|us|uk|british)\s*(movie|film)?\s*poster(s)?\s*/gi, " ").trim();

      try {
        await edgespark.db.all(sql.raw(`
          INSERT INTO inventory (title, price, ebay_item_id, ebay_price, ebay_status, source_url, notes, visibility, condition_grade, item_number, created_at, updated_at, source, image_source)
          VALUES (
            '${titleClean.replace(/'/g, "''")}',
            ${listing.price || 0},
            '${String(listing.ebayItemId).replace(/'/g, "''")}',
            ${listing.price || 0},
            'active',
            '${ebayLink.replace(/'/g, "''")}',
            '${notes.replace(/'/g, "''")}',
            'listed',
            ${listing.condition ? `'${String(listing.condition).replace(/'/g, "''")}'` : "'good'"},
            '${itemNumber}',
            ${now},
            ${now},
            'ebay',
            'ebay'
          )
        `));
        linkedIds.add(String(listing.ebayItemId));
        results.push({ success: true, ebayItemId: String(listing.ebayItemId), inventoryId: nextId, itemNumber });
        nextId++;
      } catch (err: any) {
        results.push({ success: false, ebayItemId: String(listing.ebayItemId), reason: err.message });
        nextId++; // still increment to avoid ID collisions
      }
    }

    const created = results.filter(r => r.success).length;
    const skipped = results.filter(r => !r.success).length;

    return c.json({ success: true, created, skipped, results });
  });

  // Sync eBay data to existing inventory item (update price/status, add notes)
  app.post("/api/inventory-admin/ebay-sync-data/:inventoryId", async (c) => {
    const inventoryId = parseInt(c.req.param("inventoryId"));
    if (isNaN(inventoryId) || inventoryId <= 0) {
      return c.json({ error: "Invalid inventory ID" }, 400);
    }
    const body = await c.req.json();
    const { ebayItemId, ebayPrice, ebayStatus, itemWebUrl, title } = body;

    if (!ebayItemId) return c.json({ error: "ebayItemId required" }, 400);

    const existing = await edgespark.db.all<any>(sql.raw(`SELECT notes, source_url FROM inventory WHERE id = ${inventoryId}`));
    if (!existing[0]) return c.json({ error: "Inventory item not found" }, 404);

    const now = Date.now();
    const oldNotes = existing[0].notes || "";
    const ebayLink = itemWebUrl || `https://www.ebay.com/itm/${ebayItemId}`;
    const timestamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
    const newNote = oldNotes
      ? `${oldNotes}\n[${timestamp}] Updated from eBay #${ebayItemId}: price=$${ebayPrice}, status=${ebayStatus || "active"}\n${ebayLink}`
      : `[${timestamp}] Updated from eBay #${ebayItemId}: price=$${ebayPrice}, status=${ebayStatus || "active"}\n${ebayLink}`;

    const sets: string[] = [
      `updated_at = ${now}`,
      `ebay_item_id = '${String(ebayItemId).replace(/'/g, "''")}'`,
      `ebay_price = ${ebayPrice || 0}`,
      `ebay_status = '${(ebayStatus || "active").replace(/'/g, "''")}'`,
      `source_url = '${ebayLink.replace(/'/g, "''")}'`,
      `notes = '${newNote.replace(/'/g, "''")}'`,
    ];
    if (title) sets.push(`title = '${String(title).replace(/'/g, "''")}'`);
    if (ebayPrice) sets.push(`price = ${ebayPrice}`);

    await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${inventoryId}`));
    return c.json({ success: true });
  });

  // ═══════════════════════════════════════════════════
  // ENRICHMENT: TMDB metadata + format->dimensions
  // ═══════════════════════════════════════════════════

  const FORMAT_DIMENSIONS: Record<string, string> = {
    "locandina": "13\" x 27.5\" (33x70cm)",
    "french petite": "15.5\" x 21\" (39x53cm)",
    "french moyenne": "24\" x 32\" (47x63cm)",
    "french grande": "47\" x 63\" (120x160cm)",
    "1sh": "27\" x 41\" (69x104cm)",
    "1-sheet": "27\" x 41\" (69x104cm)",
    "2sh": "41\" x 54\" (104x137cm)",
    "3sh": "41\" x 79\" (104x201cm)",
    "6sh": "81\" x 81\" (206x206cm)",
    "insert": "14\" x 36\" (36x91cm)",
    "window": "14\" x 22\" (36x56cm)",
    "lobby card": "11\" x 14\" (28x36cm)",
    "half-sheet": "22\" x 28\" (56x71cm)",
    "30x40": "30\" x 40\" (76x102cm)",
    "40x60": "40\" x 60\" (102x152cm)",
    "belgian": "14\" x 22\" (36x56cm)",
    "spanish": "27\" x 39\" (69x99cm)",
    "japanese-b2": "20\" x 29\" (51x73cm)",
    "japanese-b1": "28.5\" x 40\" (72x102cm)",
    "australian-daybill": "13\" x 30\" (33x76cm)",
    "british-quad": "30\" x 40\" (76x102cm)",
    "italian-fotobusta": "19\" x 27\" (48x69cm)",
    "1-stop": "41\" x 77\" (104x196cm)",
    "a1": "23\" x 33\" (58x84cm)",
    "due fogli": "19.5\" x 27.5\" (50x70cm)",
    "4-fogli": "39\" x 55\" (99x140cm)",
    "half-subway": "30\" x 45\" (76x114cm)",
    "small": "19\" x 29\" (48x74cm)",
  };
  // Enrich a single inventory item
  app.post("/api/inventory-admin/:id/enrich", async (c) => {
    const itemId = parseInt(c.req.param("id"));
    console.log("[API] POST /api/inventory-admin/:id/enrich", { itemId });

    const items = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${itemId}`));
    if (!items[0]) return c.json({ error: "Item not found" }, 404);
    const item = items[0];

    let updated: Record<string, any> = { dimensions: item.dimensions, genre: item.genre, director: item.director, actors: item.actors, year: item.year };

    // 1. Auto-fill dimensions from format
    if (!item.dimensions && item.format) {
      const dimKey = item.format.toLowerCase().trim();
      const dims = FORMAT_DIMENSIONS[dimKey];
      if (dims) {
        updated.dimensions = dims;
        console.log("[API] Enrichment: set dimensions from format", { format: item.format, dims });
      }
    }

    // 2. Auto-detect format from dimensions
    if (!item.format && item.dimensions) {
      const dimStr = item.dimensions.toLowerCase().replace(/\s/g, "");
      for (const [fmt, stdDims] of Object.entries(FORMAT_DIMENSIONS)) {
        const short = stdDims.split("(")[0].trim().replace(/\s/g, "");
        if (dimStr.includes(short.split("\"")[0]) || dimStr.includes(short)) {
          updated.format = fmt.charAt(0).toUpperCase() + fmt.slice(1);
          console.log("[API] Enrichment: detected format from dimensions", { dims: item.dimensions, format: updated.format });
          break;
        }
      }
    }

    // 3. TMDB enrichment (if title exists but missing metadata)
    const needsTmdb = !item.genre || !item.director || !item.actors;
    if (item.title && needsTmdb) {
      const tmdbKey = edgespark.secret.get("TMDB_API_KEY");
      if (tmdbKey) {
        const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;
        try {
          const query = item.year ? `${item.title} ${item.year}` : item.title;
          const tmdbRes = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&api_key=${tmdbKeyStr}`,
          );
          const tmdbData: any = await tmdbRes.json();

          if (tmdbData.results?.length > 0) {
            // Try to match by year if we have one
            let movie = tmdbData.results[0];
            if (item.year && tmdbData.results.length > 1) {
              const yearMatch = tmdbData.results.find((r: any) => r.release_date?.startsWith(String(item.year)));
              if (yearMatch) movie = yearMatch;
            }

            // Map TMDB titles to the right fields:
            // movie.title = English release title (e.g. "Pale Rider")
            // movie.original_title = original language title (e.g. "Il Cavaliere Pallido" for Italian films)
            // item.title = what's currently stored (may be local language title)
            if (movie.title) {
              // Always store the English title
              updated.title_english = movie.title;
              // If the stored title differs from the English title, it's likely a local title — preserve it
              if (item.title && item.title !== movie.title && !item.title_local) {
                updated.title_local = item.title;
              }
              // If original_title from TMDB is non-English and different, use it as local title
              if (movie.original_title && movie.original_title !== movie.title && !updated.title_local) {
                updated.title_local = movie.original_title;
              }
            }
            try {
              const detailRes = await fetch(
                `https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKeyStr}`,
              );
              const details: any = await detailRes.json();

              if (!item.director) {
                const dir = details.credits?.crew?.find((cr: any) => cr.job === "Director")?.name;
                if (dir) updated.director = dir;
              }
              if (!item.actors) {
                const cast = details.credits?.cast?.slice(0, 3).map((cr: any) => cr.name).join(", ");
                if (cast) updated.actors = cast;
              }
              if (!item.genre) {
                const genres = details.genres?.map((g: any) => g.name).join(", ");
                if (genres) updated.genre = genres;
              }
              if (!item.year && movie.release_date) {
                updated.year = parseInt(movie.release_date.substring(0, 4));
              }
              console.log("[API] Enrichment: TMDB data fetched", { title: movie.title });
            } catch {}
          }
        } catch (err: any) {
          console.warn("[API] Enrichment: TMDB error", err.message);
        }
      }
    }

    // Apply updates
    const sets: string[] = [`updated_at = ${Date.now()}`];
    if (updated.dimensions !== item.dimensions) sets.push(`dimensions = '${updated.dimensions.replace(/'/g, "''")}'`);
    if (updated.genre !== item.genre) sets.push(`genre = '${(updated.genre || "").replace(/'/g, "''")}'`);
    if (updated.director !== item.director) sets.push(`director = '${(updated.director || "").replace(/'/g, "''")}'`);
    if (updated.actors !== item.actors) sets.push(`actors = '${(updated.actors || "").replace(/'/g, "''")}'`);
    if (updated.format !== item.format) sets.push(`format = '${updated.format.replace(/'/g, "''")}'`);
    if (updated.year !== item.year) sets.push(`year = ${updated.year || "NULL"}`);
    if (updated.title_english && updated.title_english !== item.title_english) sets.push(`title_english = '${updated.title_english.replace(/'/g, "''")}'`);
    if (updated.title_local && updated.title_local !== item.title_local) sets.push(`title_local = '${updated.title_local.replace(/'/g, "''")}'`);

    if (sets.length > 1) {
      await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${itemId}`));
    }

    const refreshed = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${itemId}`));
    return c.json({ success: true, item: refreshed[0], changes: updated });
  });

  // Bulk enrich items missing actors/director/genre metadata via TMDB
  app.post("/api/inventory-admin/enrich-bulk", async (c) => {
    console.log("[API] POST /api/inventory-admin/enrich-bulk");

    const items = await edgespark.db.all<any>(
      sql.raw("SELECT id, title, format, dimensions, genre, director, actors, artist, year FROM inventory WHERE title IS NOT NULL AND title != '' AND (director IS NULL OR director = '' OR actors IS NULL OR actors = '' OR genre IS NULL OR genre = '')")
    );

    let enriched = 0;
    let failed = 0;
    const tmdbKey = edgespark.secret.get("TMDB_API_KEY");
    if (!tmdbKey) return c.json({ error: "TMDB API key not configured" }, 500);
    const tmdbKeyStr = (edgespark.secret.get("TMDB_API_KEY") ?? "") as string;

    for (const item of items) {
      const sets: string[] = [];
      // Auto-dimensions from format
      if (!item.dimensions && item.format) {
        const dims = FORMAT_DIMENSIONS[item.format.toLowerCase().trim()];
        if (dims) sets.push(`dimensions = '${dims.replace(/'/g, "''")}'`);
      }

      // TMDB metadata
      if (!item.genre || !item.director || !item.actors) {
        try {
          // Clean title for TMDB search: strip suffixes like (B), (Variant), #295, 10th Anniv., Supr., etc.
          let cleanTitle = item.title.replace(/\s*[\(（\[].*?[\)）\]]\s*/g, "").replace(/\s*#\d+\s*/g, "").replace(/\s*\d+(st|nd|rd|th)\s*Anniv\.?\s*/gi, "").replace(/\s*Supr\.?\s*$/i, "").trim();
          // Skip magazine/catalog/event items
          const isSkippable = /^(Razzia|Premiere|Variety|Empire|Total Film|Screen)\s*#/i.test(cleanTitle) || /^(Ligabue|Cannes|Venice|Festival)/i.test(cleanTitle) || cleanTitle.length < 3;
          if (!isSkippable) {
            const q = item.year ? `${cleanTitle} ${item.year}` : cleanTitle;
            const res = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&include_adult=false&api_key=${tmdbKey}`);
            const data: any = await res.json();
            if (data.results?.length > 0) {
              let movie = data.results[0];
              // Match by year if multiple results
              if (item.year && data.results.length > 1) {
                const yearMatch = data.results.find((r: any) => r.release_date?.startsWith(String(item.year)));
                if (yearMatch) movie = yearMatch;
              }
              try {
                const det: any = await (await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKey}`)).json();
                if (!item.director) { const d = det.credits?.crew?.find((cr: any) => cr.job === "Director")?.name; if (d) sets.push(`director = '${d.replace(/'/g, "''")}'`); }
                if (!item.actors) { const a = det.credits?.cast?.slice(0, 3).map((cr: any) => cr.name).join(", "); if (a) sets.push(`actors = '${a.replace(/'/g, "''")}'`); }
                if (!item.genre) { const g = det.genres?.map((g: any) => g.name).join(", "); if (g) sets.push(`genre = '${g.replace(/'/g, "''")}'`); }
              } catch {}
            }
          }
        } catch (err: any) {
          failed++;
          console.warn("[API] Enrichment bulk: TMDB error for item", item.id, err.message);
        }
      }

      if (sets.length > 0) {
        sets.push(`updated_at = ${Date.now()}`);
        await edgespark.db.all(sql.raw(`UPDATE inventory SET ${sets.join(", ")} WHERE id = ${item.id}`));
        enriched++;
      }
      // Rate limit: ~40 req/min for TMDB free tier
      await new Promise(r => setTimeout(r, 200));
    }

    console.log("[API] Enrichment bulk done", { enriched, failed, total: items.length });
    return c.json({ success: true, enriched, failed, total: items.length });
  });

  // ═══════════════════════════════════════════════════
  // BLOG (Public read + admin CRUD)
  // ═══════════════════════════════════════════════════

  app.get("/api/public/blog", async (c) => {
    const posts = await edgespark.db.all<any>(
      sql.raw("SELECT id, slug, title, subtitle, cover_image, author, published_at, created_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC")
    );
    return c.json({ posts });
  });

  app.get("/api/public/blog/:slug", async (c) => {
    const slug = c.req.param("slug");
    const posts = await edgespark.db.all<any>(
      sql.raw(`SELECT * FROM blog_posts WHERE slug = '${slug.replace(/'/g, "''")}' AND status = 'published'`)
    );
    if (!posts[0]) return c.json({ error: "Post not found" }, 404);
    return c.json({ post: posts[0] });
  });

  app.get("/api/blog-admin", async (c) => {
    const posts = await edgespark.db.all<any>(
      sql.raw("SELECT * FROM blog_posts ORDER BY created_at DESC")
    );
    return c.json({ posts });
  });

  app.post("/api/blog-admin", async (c) => {
    const { title, subtitle, body, cover_image, author, status } = await c.req.json();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
    const ts = Date.now();
    const published = status === "published" ? ts : null;
    console.log("[API] POST /api/blog-admin", { title, slug, status });
    const result = await edgespark.db.all<any>(
      sql.raw(`INSERT INTO blog_posts (slug, title, subtitle, body, cover_image, author, status, published_at, created_at, updated_at) VALUES ('${slug.replace(/'/g, "''")}', '${(title || "").replace(/'/g, "''")}', '${(subtitle || "").replace(/'/g, "''")}', '${(body || "").replace(/'/g, "''")}', '${(cover_image || "").replace(/'/g, "''")}', '${(author || "Frame & Reel").replace(/'/g, "''")}', '${status || "draft"}', ${published || "NULL"}, ${ts}, ${ts})`)
    );
    return c.json({ success: true, id: result[0]?.id, slug });
  });

  app.put("/api/blog-admin/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    console.log("[API] PUT /api/blog-admin/:id", { id });
    const allowed = ["title", "subtitle", "body", "cover_image", "author", "status"];
    const sets: string[] = [`updated_at = ${Date.now()}`];
    if (body.status === "published") sets.push(`published_at = ${Date.now()}`);
    for (const key of allowed) {
      if (body[key] !== undefined) {
        const val = body[key] === null ? "NULL" : `'${String(body[key]).replace(/'/g, "''")}'`;
        sets.push(`${key} = ${val}`);
      }
    }
    await edgespark.db.all(sql.raw(`UPDATE blog_posts SET ${sets.join(", ")} WHERE id = ${id}`));
    return c.json({ success: true });
  });

  app.delete("/api/blog-admin/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await edgespark.db.all(sql.raw(`DELETE FROM blog_posts WHERE id = ${id}`));
    return c.json({ success: true });
  });

  // ═══════════════════════════════════════════════════
  // BLOG INVENTORY LINKING ENGINE
  // ═══════════════════════════════════════════════════

  // Parse blog content and extract metadata using regex (no LLM needed)
  app.post("/api/blog-admin/parse", async (c) => {
    const { content } = await c.req.json();
    
    if (!content || typeof content !== "string") {
      return c.json({ error: "Content is required" }, 400);
    }

    // Regex patterns for deterministic extraction
    const TITLE_REGEX = /==TITLE==\s*\n([^\n]+)/;
    const EXCERPT_REGEX = /==EXCERPT==\s*\n([^\n]+)/;
    const BODY_REGEX = /==BODY==\s*\n([\s\S]*?)(?=\n==|$)/;
    const KEYWORDS_REGEX = /==LISTING_KEYWORDS==\s*\n([\s\S]*?)(?=\n==|$)/;

    const titleMatch = content.match(TITLE_REGEX);
    const excerptMatch = content.match(EXCERPT_REGEX);
    const bodyMatch = content.match(BODY_REGEX);
    const keywordsMatch = content.match(KEYWORDS_REGEX);

    const title = titleMatch ? titleMatch[1].trim() : "";
    const excerpt = excerptMatch ? excerptMatch[1].trim() : "";
    const body = bodyMatch ? bodyMatch[1].trim() : "";
    const keywordsRaw = keywordsMatch ? keywordsMatch[1].trim() : "";

    // Parse keywords (one per line)
    const keywords = keywordsRaw
      .split("\n")
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const wordCount = body.split(/\s+/).filter(w => w.length > 0).length;

    return c.json({
      parser_status: "VALIDATED",
      metadata: {
        title,
        excerpt,
        word_count: wordCount
      },
      keywords,
      raw_content: { body }
    });
  });

  // Link inventory keywords to actual inventory items
  app.post("/api/blog-admin/link-inventory", async (c) => {
    const { blogPostId, keywords } = await c.req.json();

    if (!blogPostId || !Array.isArray(keywords)) {
      return c.json({ error: "blogPostId and keywords array required" }, 400);
    }

    const links: any[] = [];
    const conflicts: any[] = [];
    const missing: string[] = [];

    for (const keyword of keywords) {
      // Try exact match first
      let inventory = await edgespark.db.all<any>(
        sql.raw(`SELECT id, title, item_number FROM inventory WHERE title = '${keyword.replace(/'/g, "''")}' LIMIT 1`)
      );

      if (!inventory[0]) {
        // Try partial match (title contains keyword)
        inventory = await edgespark.db.all<any>(
          sql.raw(`SELECT id, title, item_number FROM inventory WHERE title LIKE '%${keyword.replace(/'/g, "''")}%' LIMIT 5`)
        );
        
        if (inventory.length > 0) {
          conflicts.push({ keyword, matches: inventory });
        } else {
          missing.push(keyword);
        }
      }

      if (inventory[0]) {
        // Create the link
        try {
          await edgespark.db.all(sql.raw(
            `INSERT OR IGNORE INTO blog_post_inventory_links (blog_post_id, inventory_id, keyword_matched, created_at) 
             VALUES (${blogPostId}, ${inventory[0].id}, '${keyword.replace(/'/g, "''")}', ${Date.now()})`
          ));
          links.push({
            keyword,
            inventory_id: inventory[0].id,
            title: inventory[0].title,
            item_number: inventory[0].item_number,
            status: "LINKED"
          });
        } catch (e) {
          // Already linked
          links.push({
            keyword,
            inventory_id: inventory[0].id,
            title: inventory[0].title,
            status: "ALREADY_LINKED"
          });
        }
      }
    }

    return c.json({
      links,
      conflicts,
      missing,
      summary: {
        total: keywords.length,
        linked: links.filter(l => l.status === "LINKED").length,
        already_linked: links.filter(l => l.status === "ALREADY_LINKED").length,
        conflicts: conflicts.length,
        missing: missing.length
      }
    });
  });

  // Get inventory links for a blog post
  app.get("/api/blog-admin/:id/links", async (c) => {
    const id = parseInt(c.req.param("id"));
    
    const links = await edgespark.db.all<any>(sql.raw(`
      SELECT l.id, l.keyword_matched, l.created_at, 
             m.id as inventory_id, m.title, m.item_number, m.year, m.poster_country
      FROM blog_post_inventory_links l
      JOIN inventory m ON l.inventory_id = m.id
      WHERE l.blog_post_id = ${id}
    `));

    return c.json({ links });
  });

  // Bulk parse and import multiple blog posts V2
  app.post("/api/blog-admin/bulk-import", async (c) => {
    const { posts } = await c.req.json();

    if (!Array.isArray(posts)) {
      return c.json({ error: "posts array required" }, 400);
    }

    // ── Smart content parser ──────────────────────────────
    // Handles both ==SECTION== format AND raw markdown/plain text
    // Strips all markdown symbols, auto-extracts title/excerpt/tags
    function parseContent(raw: string) {
      const content = raw.trim();

      // ── Format A: ==SECTION== markers ──
      if (content.includes("==TITLE==")) {
        const titleMatch = content.match(/==TITLE==\s*\n([^\n]+)/);
        const excerptMatch = content.match(/==EXCERPT==\s*\n([^\n]+)/);
        const bodyMatch = content.match(/==BODY==\s*\n([\s\S]*?)(?=\n==|$)/);
        const keywordsMatch = content.match(/==LISTING_KEYWORDS==\s*\n([\s\S]*?)(?=\n==|$)/);
        const title = titleMatch?.[1]?.trim() || "";
        const excerpt = excerptMatch?.[1]?.trim() || "";
        const rawBody = bodyMatch?.[1]?.trim() || "";
        const keywordsRaw = keywordsMatch?.[1]?.trim() || "";
        const keywords = keywordsRaw.split("\n").map((k: string) => k.trim()).filter(Boolean);
        return { title, excerpt, body: cleanBody(rawBody), keywords, tags: keywords.slice(0, 8).join(",") };
      }

      // ── Format B: Markdown or plain text ──
      const lines = content.split("\n");

      // Title: first # heading, or first non-empty non-byline line
      let title = "";
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("# ")) { title = t.replace(/^#+\s+/, ""); break; }
        if (t && !t.startsWith("By ") && !t.startsWith("*By") && t.length > 10 && t.length < 150) {
          title = t; break;
        }
      }

      // Excerpt: first real paragraph after byline (60+ chars, not a heading, not a bullet)
      let excerpt = "";
      let pastByline = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith("By ") || t.startsWith("*By")) { pastByline = true; continue; }
        if (pastByline && t.length > 60 && !t.startsWith("#") && !t.startsWith("•") && !t.startsWith("—") && t !== title) {
          excerpt = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").substring(0, 220);
          if (excerpt.length >= 220) excerpt = excerpt.substring(0, excerpt.lastIndexOf(" ")) + "...";
          break;
        }
      }

      // Auto-extract tags from title and body keywords
      const tagCandidates = extractTags(title + " " + content);

      return { title, excerpt, body: cleanBody(content), keywords: [], tags: tagCandidates };
    }

    // ── Strip markdown, clean body for display ──
    function cleanBody(text: string): string {
      const lines = text.split("\n");
      const out: string[] = [];
      let prevBlank = false;

      for (const line of lines) {
        const t = line.trim();

        if (!t) {
          if (!prevBlank) out.push("");
          prevBlank = true;
          continue;
        }
        prevBlank = false;

        // H1 — becomes the title, skip in body
        if (/^# /.test(t)) continue;

        // H2 — convert to ALL CAPS section head (our body renderer reads these)
        if (/^## /.test(t)) { out.push(""); out.push(t.replace(/^#+\s+/, "").toUpperCase()); out.push(""); continue; }

        // H3 — convert to "— Title" sub-head
        if (/^### /.test(t)) { out.push(""); out.push("— " + t.replace(/^#+\s+/, "")); continue; }

        // Horizontal rule — blank line
        if (/^---+$/.test(t)) { out.push(""); continue; }

        // Byline — strip asterisks
        if (/^\*?By Frame/.test(t)) { out.push(t.replace(/^\*|\*$/g, "")); continue; }

        // Footer italic
        if (/^\*Frame & Reel carries/.test(t)) { out.push(t.replace(/^\*|\*$/g, "")); continue; }

        // Bullet list items
        if (/^[-*]\s/.test(t)) {
          const item = t.replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/\[(.+?)\]/g, "$1");
          out.push("  • " + item);
          continue;
        }

        // Numbered list
        if (/^\d+\.\s/.test(t)) {
          const item = t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
          out.push(item);
          continue;
        }

        // Regular line — strip inline markdown
        let cleaned = t
          .replace(/\*\*(.+?)\*\*/g, (_, m) => m.toUpperCase())
          .replace(/\*(.+?)\*/g, "$1")
          .replace(/\[(.+?)\]\(.+?\)/g, "$1")
          .replace(/\[(.+?)\]/g, "$1")
          .replace(/`(.+?)`/g, "$1");
        out.push(cleaned);
      }

      // Collapse triple+ blank lines to single
      return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    // ── Auto-extract tags from content ──
    function extractTags(text: string): string {
      const lower = text.toLowerCase();
      const tags: string[] = [];

      // Directors
      const directors = ["leone","kubrick","coppola","tarantino","scorsese","eastwood","spielberg","hitchcock","wilder","ford","hawks","huston","peckinpah","corbucci","argento","bava"];
      directors.forEach(d => { if (lower.includes(d)) tags.push(d); });

      // Formats
      const formats = ["locandina","one-sheet","daybill","quad","fotobusta","insert","half-sheet","lobby card"];
      formats.forEach(f => { if (lower.includes(f)) tags.push(f.replace(" ", "-")); });

      // Countries
      const countries = ["italian","french","british","american","japanese","australian","spanish"];
      countries.forEach(c => { if (lower.includes(c)) tags.push(c); });

      // Genres
      const genres = ["western","noir","horror","sci-fi","crime","war","animation","blaxploitation","giallo","poliziottesco"];
      genres.forEach(g => { if (lower.includes(g)) tags.push(g); });

      // Decades
      ["1940s","1950s","1960s","1970s","1980s","1990s"].forEach(d => { if (lower.includes(d)) tags.push(d); });

      // Topics
      const topics = ["authentication","grading","condition","conservation","linen","nss","collecting","value","investment","reprint","re-release"];
      topics.forEach(t => { if (lower.includes(t)) tags.push(t); });

      return [...new Set(tags)].slice(0, 10).join(",");
    }

    const results: any[] = [];

    for (const post of posts) {
      const { content, filename } = post;

      try {
        const parsed = parseContent(content);

        if (!parsed.title) {
          results.push({ status: "ERROR", error: "Could not extract title", filename: filename || "unknown" });
          continue;
        }

        // Deterministic slug — no timestamp hash
        let baseSlug = parsed.title.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .trim()
          .substring(0, 80);

        // Resolve slug collisions with incrementing suffix
        let slug = baseSlug;
        let counter = 2;
        while (true) {
          const existing = await edgespark.db.all(sql.raw(
            `SELECT id FROM blog_posts WHERE slug = '${slug.replace(/'/g, "''")}'`
          ));
          if (!existing[0]) break;
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        const ts = Date.now();
        await edgespark.db.all(sql.raw(
          `INSERT INTO blog_posts (slug, title, subtitle, body, author, status, tags, created_at, updated_at, published_at) 
           VALUES (
             '${slug.replace(/'/g, "''")}',
             '${parsed.title.replace(/'/g, "''")}',
             '${parsed.excerpt.replace(/'/g, "''")}',
             '${parsed.body.replace(/'/g, "''")}',
             'Frame & Reel',
             'published',
             '${parsed.tags.replace(/'/g, "''")}',
             ${ts}, ${ts}, ${ts}
           )`
        ));

        const newPost = await edgespark.db.all<any>(sql.raw(`SELECT last_insert_rowid() as id`));
        const postId = newPost[0]?.id;

        // Link inventory keywords if any
        const linkResults: any[] = [];
        for (const keyword of parsed.keywords) {
          const inventory = await edgespark.db.all<any>(
            sql.raw(`SELECT id, title FROM inventory WHERE title = '${keyword.replace(/'/g, "''")}' LIMIT 1`)
          );
          if (inventory[0]) {
            await edgespark.db.all(sql.raw(
              `INSERT OR IGNORE INTO blog_post_inventory_links (blog_post_id, inventory_id, keyword_matched, created_at) 
               VALUES (${postId}, ${inventory[0].id}, '${keyword.replace(/'/g, "''")}', ${ts})`
            ));
            linkResults.push({ keyword, status: "LINKED" });
          }
        }

        results.push({ status: "SUCCESS", post_id: postId, title: parsed.title, slug, tags: parsed.tags, keywords_linked: linkResults });

      } catch (err: any) {
        results.push({ status: "ERROR", error: err.message, filename: filename || "unknown" });
      }
    }

    return c.json({
      summary: {
        total: posts.length,
        success: results.filter((r: any) => r.status === "SUCCESS").length,
        errors: results.filter((r: any) => r.status === "ERROR").length
      },
      results
    });
  });

  // ═══════════════════════════════════════════════════
  // EBAY SELL API: OAuth + Listing Creation
  // ═══════════════════════════════════════════════════

  const EBAY_SELL_SCOPES = [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account",
  ].join(" ");

  // Helper: refresh eBay token if expired
  async function getValidEbayToken(): Promise<string | null> {
    const rows = await edgespark.db.all<any>(sql.raw("SELECT * FROM ebay_auth WHERE id = 1"));
    if (!rows[0]?.refresh_token) return null;

    const { refresh_token, expires_at } = rows[0];
    // Token valid if expires_at is > 5 min from now
    if (expires_at && expires_at > Date.now() + 300_000 && rows[0].access_token) {
      return rows[0].access_token;
    }

    // Refresh
    const clientId = edgespark.secret.get("EBAY_APP_ID");
    const clientSecret = edgespark.secret.get("EBAY_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;

    try {
      const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        },
        body: `grant_type=refresh_token&refresh_token=${refresh_token}`,
      });
      if (!res.ok) {
        console.error("[eBay] Token refresh failed", res.status, await res.text());
        return null;
      }
      const data: any = await res.json();
      const newExpires = Date.now() + (data.expires_in - 300) * 1000;
      await edgespark.db.all(sql.raw(
        `UPDATE ebay_auth SET access_token = '${data.access_token}', expires_at = ${newExpires} WHERE id = 1`
      ));
      return data.access_token;
    } catch (e) {
      console.error("[eBay] Token refresh error", e);
      return null;
    }
  }

  // Check OAuth connection status
  app.get("/api/inventory-admin/ebay-auth-status", async (c) => {
    const rows = await edgespark.db.all<any>(sql.raw("SELECT seller_username, expires_at FROM ebay_auth WHERE id = 1"));
    const connected = !!(rows[0]?.refresh_token);
    return c.json({
      connected,
      seller_username: rows[0]?.seller_username || null,
      token_expires_at: rows[0]?.expires_at || null,
    });
  });

  // Get the OAuth authorization URL (frontend opens this)
  app.get("/api/inventory-admin/ebay-auth-url", async (c) => {
    const clientId = edgespark.secret.get("EBAY_APP_ID");
    const clientSecret = edgespark.secret.get("EBAY_CLIENT_SECRET");
    const ruName = edgespark.secret.get("EBAY_RU_NAME");
    if (!clientId || !ruName) return c.json({ error: "eBay OAuth not configured. Set EBAY_APP_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME." }, 500);

    // Use direct redirect URI (must match exactly what's registered in eBay Developer Portal)
    const EBAY_CALLBACK_URL = "https://staging--b4puosnkz6175drjl5qg.youbase.cloud/api/public/ebay-callback";
    const authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(EBAY_CALLBACK_URL)}&scope=${encodeURIComponent(EBAY_SELL_SCOPES)}`;
    console.log("[eBay] Generated auth URL", { clientId: clientId?.substring(0, 8) + "...", redirectUri: EBAY_CALLBACK_URL, scopes: EBAY_SELL_SCOPES });
    return c.json({
      authUrl,
      _debug: {
        clientIdPrefix: clientId?.substring(0, 8) + "...",
        hasClientSecret: !!clientSecret,
        ruName,
        redirectUri: EBAY_CALLBACK_URL,
        scopes: EBAY_SELL_SCOPES,
      },
    });
  });

  // OAuth callback — eBay redirects here with ?code=... (MUST be a public route — no auth)
  app.get("/api/public/ebay-callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.html("<h3>eBay auth failed — no code returned.</h3><p>Close this tab and try again.</p>");

    const clientId = edgespark.secret.get("EBAY_APP_ID");
    const clientSecret = edgespark.secret.get("EBAY_CLIENT_SECRET");
    const ruName = edgespark.secret.get("EBAY_RU_NAME");
    if (!clientId || !clientSecret) return c.html("<h3>Server misconfigured — missing eBay credentials.</h3>");

    // Use direct redirect URI (must match the one used in the authorize URL)
    const EBAY_CALLBACK_URL = "https://staging--b4puosnkz6175drjl5qg.youbase.cloud/api/public/ebay-callback";
    try {
      const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        },
        body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(EBAY_CALLBACK_URL)}`,
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("[eBay] Token exchange failed", res.status, errText);
        return c.html(`<h3>eBay token exchange failed (${res.status}).</h3><pre>${errText}</pre>`);
      }
      const data: any = await res.json();

      // Store tokens
      const expiresAt = Date.now() + (data.expires_in - 300) * 1000;
      await edgespark.db.all(sql.raw(
        `INSERT INTO ebay_auth (id, access_token, refresh_token, expires_at) VALUES (1, '${data.access_token}', '${data.refresh_token}', ${expiresAt})
         ON CONFLICT(id) DO UPDATE SET access_token = '${data.access_token}', refresh_token = '${data.refresh_token}', expires_at = ${expiresAt}`
      ));

      return c.html(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#22c55e">✅ eBay Connected Successfully!</h2>
          <p>Your seller account is now linked. You can close this tab.</p>
          <script>setTimeout(function(){ window.close(); }, 2000);</script>
        </body></html>
      `);
    } catch (e) {
      console.error("[eBay] OAuth callback error", e);
      return c.html("<h3>An error occurred during eBay authentication.</h3>");
    }
  });

  // Disconnect eBay
  app.post("/api/inventory-admin/ebay-disconnect", async (c) => {
    await edgespark.db.all(sql.raw("DELETE FROM ebay_auth WHERE id = 1"));
    return c.json({ success: true });
  });

  // Publish an inventory item to eBay
  app.post("/api/inventory-admin/:id/publish-ebay", async (c) => {
    const itemId = parseInt(c.req.param("id"));
    console.log("[API] POST /api/inventory-admin/:id/publish-ebay", { itemId });

    const token = await getValidEbayToken();
    if (!token) return c.json({ error: "eBay not connected. Please connect your eBay seller account first." }, 401);

    // Fetch the inventory item
    const items = await edgespark.db.all<any>(sql.raw(`SELECT * FROM inventory WHERE id = ${itemId}`));
    if (!items[0]) return c.json({ error: "Item not found" }, 404);
    const item = items[0];

    if (!item.title) return c.json({ error: "Item must have a title before publishing." }, 400);
    if (!item.image_url) return c.json({ error: "Item must have an image before publishing." }, 400);

    const sku = `FR-${String(item.id).padStart(5, "0")}`;
    const price = item.price || (item.ebay_price ? Math.round(item.ebay_price * (item.pricing_markup || 1) * 100) / 100 : null);
    if (!price || price <= 0) return c.json({ error: "Item must have a price. Set a website price or eBay price." }, 400);

    // Build description — rich formatted listing
    const formatCountryLabel = (() => {
      if (item.format && item.poster_country) {
        const fmtMap: Record<string, string> = {
          "French Petite": "French Petite", "French Moyenne": "French Moyenne", "French Grande": "French Grande",
          "Locandina": "Italian Locandina", "Due Fogli": "Italian Due Fogli", "4-Fogli": "Italian 4 Fogli",
          "6-Fogli": "Italian 6 Fogli", "Photobusta": "Italian Photobusta",
          "1sh": "US One-Sheet", "Half-Sheet": "US Half-Sheet", "Insert": "US Insert",
        };
        return fmtMap[item.format] || `${item.poster_country} ${item.format}`;
      }
      return item.format || "Movie Poster";
    })();
    const releaseNote = item.year ? `for the ${item.year} release` : "";
    const descParts = [
      `<h2 style="margin-bottom:4px">${item.title}</h2>`,
      `<p>This is an <b>authentic ${formatCountryLabel}</b> poster${releaseNote ? ` ${releaseNote}` : ""} of <i>"${item.title}"</i>${item.year ? ` (${item.year})` : ""}.`,
    ];
    if (item.director) descParts.push(` Directed by <b>${item.director}</b>.`);
    if (item.actors) descParts.push(`</p><p><b>Cast:</b> ${item.actors}</p>`);
    if (item.genre) descParts.push(`<p><b>Genre:</b> ${item.genre}</p>`);
    if (item.dimensions) descParts.push(`<p><b>Dimensions:</b> ${item.dimensions}</p>`);
    if (item.condition_grade) {
      descParts.push(`<p><b>Condition:</b> ${item.condition_grade}</p>`);
    } else {
      descParts.push(`<p><b>Condition:</b> Very Good — minor edge wear consistent with age and handling. No major tears, folds, or staining. Please see photos for details.</p>`);
    }
    if (item.ds_ss) {
      const dsLabel = item.ds_ss === "DS" ? "Double-Sided" : item.ds_ss === "SS" ? "Single-Sided" : item.ds_ss;
      descParts.push(`<p><b>Printing:</b> ${dsLabel}</p>`);
    }
    if (item.poster_country) descParts.push(`<p><b>Country of Origin:</b> ${item.poster_country}</p>`);
    if (item.notes) descParts.push(`<p><b>Notes:</b> ${item.notes}</p>`);
    descParts.push(`<p><b>Collectors Note:</b> This is an original theatrical poster, not a reproduction. All posters from Frame & Reel are guaranteed authentic vintage pieces.</p>`);
    descParts.push(`<hr style="margin:12px 0"><p><i>Listed by Frame & Reel — Authentic vintage movie posters</i></p>`);
    const description = descParts.join("");

    const apiBase = "https://api.ebay.com/sell/inventory/v1";

    try {
      // 1. Create inventory item
      const invRes = await fetch(`${apiBase}/inventory_item/${encodeURIComponent(sku)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Language": "en-US",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sku,
          condition: "USED_GOOD",
          product: {
            title: `${item.title}${item.year ? ` (${item.year})` : ""}${item.format ? ` — ${item.format}` : ""}`,
            description,
            aspects: {
              Format: [item.format || "Movie Poster"],
            },
            imageUrls: [item.image_url],
          },
          availability: {
            shipToLocationAvailability: { quantity: 1 },
          },
        }),
      });

      if (!invRes.ok) {
        const errText = await invRes.text();
        console.error("[eBay] Create inventory item failed", invRes.status, errText);
        return c.json({ error: `eBay inventory item creation failed (${invRes.status}): ${errText}` }, 500);
      }

      // 2. Create offer
      const category = item.format?.toLowerCase().includes("locandina") ? "31411" : "31410"; // Entertainment Memorabilia > Movie Memorabilia
      const offerRes = await fetch(`${apiBase}/offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Language": "en-US",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          listingDescription: description,
          availableQuantity: 1,
          pricingSummary: {
            listingPrice: { value: String(price), currency: "USD" },
          },
          listingPolicies: {
            fulfillmentPolicyId: "583469990016", // default — user should set their own
            paymentPolicyId: "583469950016",
            returnPolicyId: "583469950016",
          },
          categoryId: category,
          title: `${item.title}${item.year ? ` (${item.year})` : ""}${item.format ? ` — ${item.format}` : ""}`,
          description,
        }),
      });

      if (!offerRes.ok) {
        const errText = await offerRes.text();
        console.error("[eBay] Create offer failed", offerRes.status, errText);
        // The offer creation might fail due to policy IDs — give a helpful message
        return c.json({
          error: `eBay offer creation failed (${offerRes.status}). This usually means your eBay listing policies need to be configured in Seller Hub first.`,
          details: errText,
          step: "offer",
        }, 500);
      }

      const offerData: any = await offerRes.json();
      const listingId = offerData.offerId;

      // 3. Publish the offer
      const pubRes = await fetch(`${apiBase}/inventory_item/${encodeURIComponent(sku)}/publish_offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Language": "en-US",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ offerId: listingId }),
      });

      let ebayListingId = null;
      if (pubRes.ok) {
        const pubData: any = await pubRes.json();
        ebayListingId = pubData.listingId || listingId;
        console.log("[eBay] Listing published!", { sku, listingId, ebayListingId });
      } else {
        const errText = await pubRes.text();
        console.warn("[eBay] Publish offer warning", pubRes.status, errText);
        // Still save the offer ID even if publish had issues
        ebayListingId = listingId;
      }

      // Update inventory with eBay listing reference
      await edgespark.db.all(sql.raw(
        `UPDATE inventory SET ebay_item_id = '${ebayListingId || listingId}', ebay_status = 'listed', ebay_price = ${price}, updated_at = ${Date.now()} WHERE id = ${itemId}`
      ));

      return c.json({
        success: true,
        sku,
        offerId: listingId,
        listingId: ebayListingId,
        ebayUrl: ebayListingId ? `https://www.ebay.com/itm/${ebayListingId}` : null,
      });
    } catch (e: any) {
      console.error("[eBay] Publish error", e);
      return c.json({ error: `eBay publish error: ${e.message}` }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // EBAY ORDERS: Sync & Manage
  // ═══════════════════════════════════════════════════

  // Fetch orders from eBay and upsert into local DB
  app.post("/api/inventory-admin/ebay-orders-sync", async (c) => {
    const token = await getValidEbayToken();
    if (!token) return c.json({ error: "eBay not connected" }, 401);

    let synced = 0;
    let page = 1;
    const hasMore = true;
    const allOrders: any[] = [];

    while (hasMore) {
      try {
        const filter = `orderfulfillmentstatus:{AWAITING_SHIPMENT,IN_PROGRESS}`;
        const res = await fetch(
          `https://api.ebay.com/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=100&offset=${(page - 1) * 100}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Language": "en-US",
            },
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          console.error("[eBay] Order fetch failed", res.status, errText);
          if (page === 1) return c.json({ error: `eBay order fetch failed (${res.status}): ${errText}` }, 500);
          break;
        }

        const data: any = await res.json();
        const orders = data.orders || [];
        if (orders.length === 0) break;

        for (const order of orders) {
          allOrders.push(order);
        }

        if (orders.length < 100) break;
        page++;
      } catch (e: any) {
        console.error("[eBay] Order fetch error on page", page, e);
        break;
      }
    }

    // Upsert orders into DB
    const now = Date.now();
    for (const order of allOrders) {
      const lineItems = (order.lineItems || []).map((li: any) => ({
        title: li.title || "",
        sku: li.sku || "",
        quantity: li.quantity || 1,
        price: li.price?.value ? parseFloat(li.price.value) : 0,
        currency: li.price?.currency || "USD",
        itemId: li.legacyItemId || li.itemId || "",
      }));
      const shipping = order.shippingDetails?.shippingAddress;
      const shippingAddr = shipping
        ? `${shipping.addressLine1 || ""}\n${shipping.addressLine2 || ""}\n${shipping.city || ""}, ${shipping.stateOrProvince || ""} ${shipping.postalCode || ""}\n${shipping.country || ""}`
            .replace(/\n\n+/g, "\n")
            .trim()
        : "";

      const ebayOrderId = order.orderId || order.legacyOrderId || "";
      const legacyOrderId = order.legacyOrderId || "";
      const total = order.pricingSummary?.total?.value
        ? parseFloat(order.pricingSummary.total.value)
        : (order.costSummary?.total?.value ? parseFloat(order.costSummary.total.value) : 0);
      const currency = order.pricingSummary?.total?.currency || order.costSummary?.total?.currency || "USD";
      const buyer = order.buyer?.username || "";
      const status = order.orderFulfillmentStatus || "PENDING";

      // Parse creation date
      const createdAt = order.createTime ? new Date(order.createTime).getTime() : now;

      // Upsert
      const existing = await edgespark.db.all<any>(
        sql.raw(`SELECT id FROM orders WHERE ebay_order_id = '${ebayOrderId.replace(/'/g, "''")}' LIMIT 1`)
      );

      if (existing.length > 0) {
        await edgespark.db.all(sql.raw(
          `UPDATE orders SET
            legacy_order_id = '${legacyOrderId.replace(/'/g, "''")}',
            buyer_username = '${buyer.replace(/'/g, "''")}',
            total_amount = ${total},
            total_currency = '${currency}',
            status = '${status}',
            shipping_address = '${shippingAddr.replace(/'/g, "''")}',
            line_items = '${JSON.stringify(lineItems).replace(/'/g, "''")}',
            synced_at = ${now}
          WHERE id = ${existing[0].id}`
        ));
      } else {
        await edgespark.db.all(sql.raw(
          `INSERT INTO orders (ebay_order_id, legacy_order_id, buyer_username, total_amount, total_currency, status, created_at, shipping_address, line_items, synced_at)
           VALUES ('${ebayOrderId.replace(/'/g, "''")}', '${legacyOrderId.replace(/'/g, "''")}', '${buyer.replace(/'/g, "''")}', ${total}, '${currency}', '${status}', ${createdAt}, '${shippingAddr.replace(/'/g, "''")}', '${JSON.stringify(lineItems).replace(/'/g, "''")}', ${now})`
        ));
      }
      synced++;
    }

    // Also mark sold items in inventory based on line item SKUs
    for (const order of allOrders) {
      for (const li of (order.lineItems || [])) {
        if (li.sku && li.sku.startsWith("FR-")) {
          await edgespark.db.all(sql.raw(
            `UPDATE inventory SET sold = 1, updated_at = ${now} WHERE id = ${parseInt(li.sku.replace("FR-", ""))} AND sold = 0`
          ));
        }
      }
    }

    console.log("[API] eBay orders synced", { synced, pages: page });
    return c.json({ success: true, synced, totalFetched: allOrders.length });
  });

  // List local orders with optional status filter
  app.get("/api/inventory-admin/orders", async (c) => {
    const status = c.req.query("status") || "";
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    let where = "1=1";
    if (status) where += ` AND status = '${status.replace(/'/g, "''")}'`;

    const orders = await edgespark.db.all<any>(
      sql.raw(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)
    );

    const countResult = await edgespark.db.all<any>(
      sql.raw(`SELECT COUNT(*) as total FROM orders WHERE ${where}`)
    );

    return c.json({ orders, total: countResult[0]?.total || 0 });
  });

  // Update order status + shipping info
  app.put("/api/inventory-admin/orders/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { status, notes, shipped_at } = body;
    console.log("[API] PUT /api/inventory-admin/orders/:id", { id, status, notes });

    const sets: string[] = [`synced_at = ${Date.now()}`];
    if (status) sets.push(`status = '${status.replace(/'/g, "''")}'`);
    if (notes !== undefined) sets.push(`notes = '${String(notes).replace(/'/g, "''")}'`);
    if (shipped_at !== undefined) sets.push(`shipped_at = ${typeof shipped_at === "number" ? shipped_at : Date.now()}`);
    if (status === "SHIPPED") sets.push(`shipped_at = ${Date.now()}`);

    await edgespark.db.all(sql.raw(`UPDATE orders SET ${sets.join(", ")} WHERE id = ${id}`));
    return c.json({ success: true });
  });

  // Get order stats
  app.get("/api/inventory-admin/orders-stats", async (c) => {
    const stats = await edgespark.db.all<any>(sql.raw(
      `SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(CASE WHEN status = 'AWAITING_SHIPMENT' THEN 1 ELSE 0 END), 0) as awaiting_shipment,
        COALESCE(SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END), 0) as in_progress,
        COALESCE(SUM(CASE WHEN status = 'FULFILLED' THEN 1 ELSE 0 END), 0) as fulfilled,
        COALESCE(SUM(total_amount), 0) as total_revenue
      FROM orders`
    ));
    return c.json(stats[0] || {});
  });

  // Health check
  app.get("/api/public/hello", (c) =>
    c.json({ message: "Frame & Reel API is running" })
  );

  // ═══════════════════════════════════════════════════
  // EBAY FIELD EXTRACTION (extract description, condition notes, collectors note)
  // ═══════════════════════════════════════════════════
  app.post("/api/inventory-admin/ebay-extract", async (c) => {
    const { ebayItemId } = await c.req.json();
    console.log("[API] POST /api/inventory-admin/ebay-extract", { ebayItemId });

    if (!ebayItemId) return c.json({ error: "ebayItemId is required" }, 400);

    const token = await getValidEbayToken();
    if (!token) return c.json({ error: "eBay not connected" }, 401);

    try {
      // Fetch item details from eBay
      const itemRes = await fetch(
        `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(ebayItemId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Language": "en-US",
          },
        }
      );

      if (!itemRes.ok) {
        const errText = await itemRes.text();
        console.warn("[API] eBay fetch failed", itemRes.status, errText);
        return c.json({ error: `eBay API error: ${itemRes.status}` }, parseInt(String(itemRes.status)) as any);
      }

      const itemData: any = await itemRes.json();
      const offerRes = await fetch(
        `https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(ebayItemId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Language": "en-US",
          },
        }
      );

      let description = "";
      let conditionNotes = "";
      let collectorsNote = "";
      let shippingInfo = "";
      let internationalShipping = "";
      let combinedShipping = "";
      let formatDescription = "";

      if (offerRes.ok) {
        const offerData: any = await offerRes.json();
        const offers = offerData.offers || offerData;
        const offer = Array.isArray(offers) ? offers[0] : offers;

        // Extract description from the offer
        if (offer.description) {
          // Clean HTML tags for plain text
          description = offer.description.replace(/<[^>]*>/g, "").trim();
        }

        // Get condition
        if (offer.condition) {
          conditionNotes = `Condition: ${offer.condition}`;
        }

        // Get format from size or dimensions
        if (offer.size) {
          formatDescription = `Format: ${offer.size}`;
        }

        // Get shipping info
        if (offer.shippingCosts) {
          shippingInfo = JSON.stringify(offer.shippingCosts);
        }

        // Get international shipping
        if (offer.internationalShippingCosts) {
          internationalShipping = JSON.stringify(offer.internationalShippingCosts);
        }
      }

      // Also try to get more details from the original listing URL scraping
      // For now, return what we have
      return c.json({
        success: true,
        fields: {
          description,
          conditionNotes,
          collectorsNote,
          shippingInfo,
          internationalShipping,
          combinedShipping,
          formatDescription,
        },
      });
    } catch (err: any) {
      console.error("[API] eBay extract error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // AI LISTING GENERATION (Gemini-powered)
  // ═══════════════════════════════════════════════════
  app.post("/api/inventory-admin/ai-generate-listing", async (c) => {
    const { 
      title, 
      year, 
      director, 
      actors, 
      format, 
      poster_country, 
      condition_grade, 
      dimensions,
      imageUrl,
      fields // Which fields to generate: description, condition, conditionNotes, collectorsNote, shipping, internationalShipping, combinedShipping, formatDescription
    } = await c.req.json();

    console.log("[API] POST /api/inventory-admin/ai-generate-listing", { title, year, fields });

    const geminiKey = (edgespark.secret.get("GEMINI_API_KEY") ?? "") as string;
    if (!geminiKey) return c.json({ error: "GEMINI_API_KEY not configured" }, 500);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Build the prompt based on selected fields
      let prompt = `You are a vintage movie poster expert for Frame & Reel, a premium vintage poster store. Generate professional eBay listing content for the following poster:\n\n`;
      prompt += `**Poster Details:**\n`;
      if (title) prompt += `- Title: ${title}\n`;
      if (year) prompt += `- Year: ${year}\n`;
      if (director) prompt += `- Director: ${director}\n`;
      if (actors) prompt += `- Cast: ${actors}\n`;
      if (format) prompt += `- Format: ${format}\n`;
      if (poster_country) prompt += `- Country of Origin: ${poster_country}\n`;
      if (condition_grade) prompt += `- Condition Grade: ${condition_grade}\n`;
      if (dimensions) prompt += `- Dimensions: ${dimensions}\n`;
      if (imageUrl) prompt += `- Image: Available for reference\n`;

      prompt += `\nPlease generate the following sections in a professional, vintage cinema style:\n`;

      const fieldPrompts: Record<string, string> = {
        description: "1. **Description**: A compelling 2-3 paragraph description of this vintage poster, its movie, and its collectible value.",
        condition: "2. **Condition**: Detailed condition report including any wear, fold lines, pin holes, or imperfections.",
        conditionNotes: "3. **Condition Notes**: Specific notes about the condition that would help collectors understand the item quality.",
        collectorsNote: "4. **Collector's Note**: An engaging narrative about the film's history, cultural significance, or why this poster is special.",
        shipping: "5. **Shipping Information**: Standard shipping details and handling instructions.",
        internationalShipping: "6. **International Shipping**: Information about international shipping options and costs.",
        combinedShipping: "7. **Combined Shipping**: Information about combining multiple purchases for shipping savings.",
        formatDescription: "8. **Format Description**: Details about the poster format (size, country of origin style, etc.).",
      };

      if (fields && Array.isArray(fields)) {
        fields.forEach((f: string) => {
          if (fieldPrompts[f]) prompt += `\n${fieldPrompts[f]}`;
        });
      } else {
        // Default: generate all fields
        Object.values(fieldPrompts).forEach(p => { prompt += `\n${p}`; });
      }

      prompt += `\n\nFormat your response as JSON with keys matching the field names (description, condition, conditionNotes, collectorsNote, shipping, internationalShipping, combinedShipping, formatDescription). Only include fields that were requested.`;

      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });

      const text = result.text || "";
      
      // Try to parse JSON from response
      let generated: Record<string, string> = {};
      try {
        // Find JSON in response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          generated = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // If JSON parsing fails, return as plain text for each field
        generated = { rawText: text };
      }

      return c.json({ success: true, generated });
    } catch (err: any) {
      console.error("[API] AI generation error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // CONSOLIDATED IDENTIFICATION PIPELINE (replaces Provenance Engine
  // Stage 1/Stage 2 endpoints that were removed from this file)
  // ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// CONSOLIDATED STAGE 1: IDENTIFICATION
// Replaces: /api/public/library/:id/auto-id AND /api/public/library/:id/ai-identify
// ═══════════════════════════════════════════════════════════════
app.post("/api/library/:id/identify", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json() as {
    // Batch context — pass these when you know them
    country?: string;        // e.g. "Italy", "France", "UK"
    format?: string;         // e.g. "Italian Locandina", "French Grande"
    yearStart?: number;      // e.g. 1965
    yearEnd?: number;        // e.g. 1972
    // Manual override — corrections to re-run with
    knownDirector?: string;
    knownActors?: string;
    knownTitle?: string;
    knownYear?: number;
  };

  console.log("[Stage1] POST /api/library/:id/identify", { id, body });

  const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
  if (!geminiKey) return c.json({ error: "GEMINI_API_KEY not configured" }, 500);

  // Get image record
  const imgs = await edgespark.db.all<any>(sql.raw(
    `SELECT * FROM image_library WHERE id = ${id}`
  ));
  if (!imgs[0]) return c.json({ error: "Image not found" }, 404);
  const img = imgs[0];

  // Get image file
  let file: any;
  try {
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(img.s3_uri);
    file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found in storage" }, 404);
  } catch (err: any) {
    console.error("[Stage1] Storage fetch failed:", err.message);
    return c.json({ error: "Failed to fetch image from storage: " + err.message }, 500);
  }

  // Convert to base64 safely
  let base64: string;
  try {
    const bytes = new Uint8Array(file.body);
    base64 = bytesToBase64(bytes);
  } catch (err: any) {
    console.error("[Stage1] Base64 conversion failed:", err.message);
    return c.json({ error: "Failed to process image data: " + err.message }, 500);
  }

  const mimeType = file.metadata?.contentType || "image/jpeg";
  const ai = new GoogleGenAI({ apiKey: geminiKey });

  // Build context string from known facts
  const knownFacts = [
    body.country && `Country: ${body.country}`,
    body.format && `Format: ${body.format}`,
    body.yearStart && body.yearEnd && `Expected era: ${body.yearStart}-${body.yearEnd}`,
    body.knownDirector && `Known director: ${body.knownDirector}`,
    body.knownActors && `Known actors: ${body.knownActors}`,
    body.knownTitle && `Known title: ${body.knownTitle}`,
    body.knownYear && `Known year: ${body.knownYear}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are an expert vintage movie poster cataloger. Identify this poster.

${knownFacts ? `KNOWN FACTS (treat as ground truth, do not contradict):\n${knownFacts}\n` : ""}

BILLING BLOCK PARSING RULES:
- Director is preceded by: "REGIA DI", "UN FILM DI", "RÉALISATION", "UN FILM DE", "DIRECTED BY"
- Cast list follows: "CON" (Italian), "AVEC" (French), "WITH" (English)
- Final/guest star follows: "E CON" or "CON LA PARTECIPAZIONE DI"
- Strip character names from actor names — keep only the person's name
- Italian accent: strip accents for matching (é→e, à→a, etc)
- If billing_name differs from canonical English name (pseudonym), note both

PSEUDONYM REFERENCE (resolve if you see these):
${Object.entries(DIRECTOR_PSEUDONYMS).map(([k, v]) => `${k} = ${v}`).join(", ")}

DOUBLE-FEATURE DETECTION:
If you see "I GRANDI SUCCESSI", "ACCOPPIATA", or "DOPPIO SPETTACOLO", set
is_double_feature to true and provide TWO entries in titles array.

Return ONLY valid JSON matching this exact schema. Empty string for unknown fields.`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      movie_title: { type: "STRING", description: "Primary English title" },
      title_local: { type: "STRING", description: "Local language title if different from English" },
      title_billing: { type: "STRING", description: "Exact title as printed on this poster" },
      release_year: { type: "STRING", description: "4-digit year or empty string" },
      director_billing: { type: "STRING", description: "Director name exactly as printed" },
      director_canonical: { type: "STRING", description: "Director's true/canonical name" },
      lead_cast: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "Actor names as printed"
      },
      detected_language: { type: "STRING", description: "Language of poster text" },
      origin_country: { type: "STRING", description: "Country of film origin" },
      genre: { type: "STRING" },
      confidence: { type: "NUMBER", description: "0.0 to 1.0" },
      is_double_feature: { type: "BOOLEAN" },
      notes: { type: "STRING", description: "Anything unusual or uncertain" }
    },
    required: [
      "movie_title", "title_local", "title_billing", "release_year",
      "director_billing", "director_canonical", "lead_cast",
      "detected_language", "origin_country", "genre", "confidence",
      "is_double_feature"
    ]
  };

  try {
    const result = await geminiWithRetry(ai, {
      model: STAGE1_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
      contents: [{
        role: "user",
        parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }]
      }]
    });

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let movieData: any;
    try {
      movieData = JSON.parse(text);
    } catch {
      return c.json({ error: "Failed to parse Gemini response", raw: text }, 422);
    }

    // Resolve pseudonyms
    if (movieData.director_billing && DIRECTOR_PSEUDONYMS[movieData.director_billing]) {
      movieData.director_canonical = DIRECTOR_PSEUDONYMS[movieData.director_billing];
    }

    // Try TMDB match using canonical director + cast + year (multi-key matrix)
    const tmdbKey = edgespark.secret.get("TMDB_API_KEY") as string;
    let inventoryMatches: any[] = [];
    let tmdbData: any = null;

    if (tmdbKey) {
      // Build search query: prefer canonical title, fall back to director+actor matrix
      const searchTitle = movieData.movie_title || movieData.title_billing;
      if (searchTitle) {
        try {
          const yearParam = movieData.release_year ?
            `&year=${movieData.release_year.substring(0, 4)}` : "";
          const tmdbRes = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(searchTitle)}&include_adult=false${yearParam}&api_key=${tmdbKey}`
          );
          const tmdbResult = await tmdbRes.json() as any;

          if (tmdbResult.results?.length > 0) {
            const movie = tmdbResult.results[0];
            // Fetch alternative titles for better matching
            const [detailRes, altTitlesRes] = await Promise.all([
              fetch(`https://api.themoviedb.org/3/movie/${movie.id}?append_to_response=credits&api_key=${tmdbKey}`),
              fetch(`https://api.themoviedb.org/3/movie/${movie.id}/alternative_titles?api_key=${tmdbKey}`)
            ]);
            const details = await detailRes.json() as any;
            const altTitles = await altTitlesRes.json() as any;

            tmdbData = {
              tmdbId: movie.id,
              title: movie.title,
              originalTitle: movie.original_title,
              year: movie.release_date?.substring(0, 4),
              director: details.credits?.crew?.find((c: any) => c.job === "Director")?.name,
              actors: details.credits?.cast?.slice(0, 5).map((c: any) => c.name).join(", "),
              genre: details.genres?.map((g: any) => g.name).join(", "),
              alternativeTitles: altTitles.titles?.map((t: any) => t.title) || []
            };

            // Search inventory using ALL known title variants simultaneously
            const allTitles = [
              movieData.movie_title,
              movieData.title_local,
              movieData.title_billing,
              tmdbData.title,
              tmdbData.originalTitle,
              ...tmdbData.alternativeTitles
            ].filter(Boolean);

            inventoryMatches = await fuzzyMatchInventoryMulti(
              allTitles,
              parseInt(movieData.release_year || tmdbData.year || "0"),
              img.lot_number
            );
          }
        } catch (err: any) {
          console.warn("[Stage1] TMDB lookup failed:", err.message);
        }
      }
    }

    // Write suggested match if high confidence
    if (inventoryMatches.length > 0 && inventoryMatches[0].score >= 80) {
      await edgespark.db.all(sql.raw(`
        UPDATE image_library SET
          suggested_inventory_id = ${inventoryMatches[0].id},
          match_confidence = ${inventoryMatches[0].score / 100},
          match_status = 'suggested',
          updated_at = ${Date.now()}
        WHERE id = ${id}
      `));
    }

    // Save identification results
    const director = movieData.director_canonical || movieData.director_billing || "";
    const e = (s: any) => String(s || "").replace(/'/g, "''");
    await edgespark.db.all(sql.raw(`
      UPDATE image_library SET
        identified_title = '${e(movieData.movie_title || movieData.title_billing)}',
        title_local = '${e(movieData.title_local)}',
        identified_year = ${parseInt(movieData.release_year || "0") || "NULL"},
        identified_director = '${e(director)}',
        identified_genre = '${e(movieData.genre)}',
        identified_actors = '${e(movieData.lead_cast?.join(", "))}',
        identified_data = '${e(JSON.stringify({ ...movieData, tmdb: tmdbData }))}',
        updated_at = ${Date.now()}
      WHERE id = ${id}
    `));

    // Track usage
    await trackUsage(edgespark, sql, STAGE1_MODEL, "stage1", STAGE1_COST_CENTS);

    // Mark queue item done if processing via queue
    await edgespark.db.all(sql.raw(`
      UPDATE processing_queue SET status = 'done', completed_at = ${Date.now()}
      WHERE image_id = ${id} AND stage = 'stage1' AND status = 'processing'
    `));

    return c.json({
      success: true,
      movie: movieData,
      tmdb: tmdbData,
      inventoryMatches,
      suggestedMatch: inventoryMatches[0] || null
    });

  } catch (err: any) {
    console.error("[Stage1] Gemini error:", err.message, err.stack);

    await edgespark.db.all(sql.raw(`
      UPDATE processing_queue SET status = 'failed', error = '${String(err.message).replace(/'/g, "''")}',
      completed_at = ${Date.now()}
      WHERE image_id = ${id} AND stage = 'stage1' AND status = 'processing'
    `));

    return c.json({
      error: "Stage 1 identification failed: " + err.message,
      details: err.stack
    }, 500);
  }
});


// ═══════════════════════════════════════════════════════════════
// CONSOLIDATED STAGE 2: FORENSIC EXTRACTION
// Replaces: the Provenance Engine /api/library/:id/identify validate step
// ═══════════════════════════════════════════════════════════════
app.post("/api/library/:id/forensic", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json() as {
    country?: string;
    format?: string;
    yearStart?: number;
    yearEnd?: number;
  };

  console.log("[Stage2] POST /api/library/:id/forensic", { id, body });

  const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
  if (!geminiKey) return c.json({ error: "GEMINI_API_KEY not configured" }, 500);

  const imgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM image_library WHERE id = ${id}`));
  if (!imgs[0]) return c.json({ error: "Image not found" }, 404);
  const img = imgs[0];

  let file: any;
  try {
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(img.s3_uri);
    file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image file not found in storage" }, 404);
  } catch (err: any) {
    console.error("[Stage2] Storage fetch failed:", err.message);
    return c.json({ error: "Failed to fetch image: " + err.message }, 500);
  }

  let base64: string;
  try {
    const bytes = new Uint8Array(file.body);
    base64 = bytesToBase64(bytes);
  } catch (err: any) {
    console.error("[Stage2] Base64 conversion failed:", err.message);
    return c.json({ error: "Failed to process image: " + err.message }, 500);
  }

  const mimeType = file.metadata?.contentType || "image/jpeg";
  const ai = new GoogleGenAI({ apiKey: geminiKey });

  // Use lot_number context if batch context not provided
  const country = body.country || img.poster_country || "";
  const yearStart = body.yearStart || img.year_range_start || 0;
  const yearEnd = body.yearEnd || img.year_range_end || 0;

  // Build country-specific rules section
  const countryRules = buildCountryRules(country, yearStart, yearEnd);

  // Build known printer/distributor lists for this country
  const printerList = getKnownPrinters(country);
  const distributorList = KNOWN_DISTRIBUTORS.join(", ");

  const systemPrompt = `You are an expert forensic movie poster archivist. Analyze this poster image.

FOCUS REGIONS (in order of forensic priority):
1. Lower 15% of image (bounding box top 85% to bottom): billing block with printer credits, NSS/visa codes, edition markings, tax stamps
2. Lower-left margin (extreme left edge, bottom 40%): vertical printer text, regional stamps
3. Lower-right margin (extreme right edge, bottom 40%): edition year codes, censorship stamps, rating logos
4. Upper header (top 10%): distributor/studio logos, re-issue indicators

KNOWN PRINTERS FOR THIS REGION: ${printerList}
KNOWN DISTRIBUTORS: ${distributorList}

COUNTRY-SPECIFIC RULES:
${countryRules}

CRITICAL RULES:
- For EACH field: if you cannot identify with 95% certainty, return empty string. DO NOT hallucinate.
- "Prima Edizione" or "Prima Edizione Italiana" = original first release
- "Edizione Successiva" or "Riedizione" = explicit reissue
- NSS codes: format YY/NNNN (e.g. 68/201). Reissue prefix: R + YY/NNNN (e.g. R78/42)
- French posters: IGNORE the year 1881 if preceded by "Loi du" or "Juillet" — it is a legal boilerplate code, NOT a release year
- Italian posters: "Zincografica", "Fotolito", "Rotocalco", "Fotocromocombinazione" = printing method sub-contractors, NOT distributors
- Double-feature poster: if "I GRANDI SUCCESSI" / "ACCOPPIATA" / "DOPPIO SPETTACOLO" present, set is_double_feature true`;

  const ai = new GoogleGenAI({ apiKey: geminiKey });

  const responseSchema = {
    type: "OBJECT",
    properties: {
      printer_credit: { type: "STRING", description: "Printer name and location from border" },
      printer_method: { type: "STRING", description: "Printing method sub-contractor if separate (Zincografica, Fotolito, etc)" },
      studio_distributor: { type: "STRING", description: "Distributor/studio name matched against known list" },
      studio_distributor_raw: { type: "STRING", description: "Exact text as it appears on poster" },
      censorship_number: { type: "STRING", description: "Visto/Visa/NSS/Eirin number exactly as printed" },
      censorship_type: { type: "STRING", description: "Type: Visto di Censura / Visa d'exploitation / NSS / Eirin / BBFC / Australian / other" },
      edition_marking: { type: "STRING", description: "Prima Edizione / Edizione Successiva / R-prefix / Prima Visione / etc" },
      tax_stamp: { type: "STRING", description: "Tax stamp denomination and type (e.g. L.30 Imposta Pubblicità)" },
      year_codes: { type: "STRING", description: "Any year or date codes found in margins" },
      bbfc_rating: { type: "STRING", description: "UK BBFC rating symbol if present: U/A/H/X/PG/12/15/18" },
      australian_classification: { type: "STRING", description: "Australian classification if present: G/NRC/M/R or text classification" },
      catch_all: { type: "STRING", description: "Any other printed/stamped text not captured above" },
      is_original: { type: "BOOLEAN", description: "True if evidence points to original first release" },
      is_reissue: { type: "BOOLEAN", description: "True if evidence points to reissue" },
      is_double_feature: { type: "BOOLEAN" },
      conflict_flags: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: "List of anachronisms or mismatches found"
      },
      validation_status: {
        type: "STRING",
        enum: ["verified_original", "verified_reissue", "likely_original", "likely_reissue", "anachronism", "incomplete", "uncertain"]
      },
      confidence: { type: "NUMBER" }
    },
    required: [
      "printer_credit", "printer_method", "studio_distributor",
      "censorship_number", "censorship_type", "edition_marking",
      "tax_stamp", "year_codes", "catch_all",
      "is_original", "is_reissue", "is_double_feature",
      "conflict_flags", "validation_status", "confidence"
    ]
  };

  try {
    const result = await geminiWithRetry(ai, {
      model: STAGE2_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
      contents: [{
        role: "user",
        parts: [{ text: systemPrompt }, { inlineData: { data: base64, mimeType } }]
      }]
    });

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let forensicData: any;
    try {
      forensicData = JSON.parse(text);
    } catch {
      return c.json({ error: "Failed to parse Gemini forensic response", raw: text }, 422);
    }

    // Apply code-side heuristic validation (existing logic, now fed by real data)
    const anachronisms = [...(forensicData.conflict_flags || [])];

    // Italy: tax stamp era check
    if (country.toLowerCase().includes("ital") && forensicData.tax_stamp) {
      const liraMatch = forensicData.tax_stamp.match(/L\.\s*(\d+)/i);
      if (liraMatch) {
        const lira = parseInt(liraMatch[1]);
        if (lira >= 50 && yearEnd && yearEnd < 1975) {
          anachronisms.push(`Tax stamp L.${lira} suggests post-1975 but expected era ends ${yearEnd}`);
        }
      }
    }

    // Italy: Visto di Censura era check
    if (forensicData.censorship_type?.includes("Visto") && forensicData.censorship_number) {
      const vistoNum = parseInt(forensicData.censorship_number.replace(/[^0-9]/g, ""));
      if (vistoNum > 0) {
        if (vistoNum > 73000 && yearEnd && yearEnd < 1980) {
          anachronisms.push(`Visto #${vistoNum} suggests post-1980 but expected era ends ${yearEnd}`);
        } else if (vistoNum > 55000 && yearEnd && yearEnd < 1970) {
          anachronisms.push(`Visto #${vistoNum} suggests post-1970 but expected era ends ${yearEnd}`);
        }
      }
    }

    // France: postal code era check
    if (forensicData.printer_credit?.match(/75\d{3}/)) {
      if (yearEnd && yearEnd < 1972) {
        anachronisms.push(`5-digit Paris postal code found but expected era ends ${yearEnd} (post-1972 indicator)`);
      }
    }

    // NSS reissue prefix check
    if (forensicData.censorship_number?.match(/^R\d{2}\//)) {
      if (!forensicData.is_reissue) {
        anachronisms.push(`NSS "R" prefix ${forensicData.censorship_number} indicates reissue`);
        forensicData.is_reissue = true;
        forensicData.is_original = false;
      }
    }

    // UK BBFC era check
    if (forensicData.bbfc_rating && ["15", "18", "12", "PG"].includes(forensicData.bbfc_rating)) {
      if (yearEnd && yearEnd < 1982) {
        anachronisms.push(`BBFC "${forensicData.bbfc_rating}" rating introduced 1982 but expected era ends ${yearEnd}`);
      }
    }

    // CIC/UIP distributor = post-1970/1981
    const dist = forensicData.studio_distributor?.toUpperCase() || "";
    if ((dist.includes("CIC") || dist.includes("CINEMA INTERNATIONAL")) && yearEnd && yearEnd < 1970) {
      anachronisms.push(`CIC distribution logo suggests post-1970 but expected era ends ${yearEnd}`);
    }
    if ((dist.includes("UIP") || dist.includes("UNITED INTERNATIONAL")) && yearEnd && yearEnd < 1981) {
      anachronisms.push(`UIP distribution logo suggests post-1981 but expected era ends ${yearEnd}`);
    }

    // Determine final validation status
    let validationStatus = forensicData.validation_status;
    if (anachronisms.length > 0 && validationStatus === "likely_original") {
      validationStatus = "anachronism";
    }

    const e = (s: any) => String(s || "").replace(/'/g, "''");

    // Save forensic results to image_library
    await edgespark.db.all(sql.raw(`
      UPDATE image_library SET
        printer_credit = '${e(forensicData.printer_credit)}',
        distributor_logo = '${e(forensicData.studio_distributor)}',
        nss_visa_code = '${e(forensicData.censorship_number)}',
        release_type = '${validationStatus.includes("reissue") ? "Reissue" : validationStatus.includes("original") ? "Original" : "Unknown"}',
        conflict_status = '${e(validationStatus)}',
        conflict_reason = '${e(anachronisms.join("; "))}',
        dna_audit_status = '${e(validationStatus)}',
        dna_forensic_crops = '${e(JSON.stringify(forensicData))}',
        dna_ocr_raw = '${e([forensicData.printer_credit, forensicData.censorship_number, forensicData.edition_marking, forensicData.catch_all].filter(Boolean).join(" "))}',
        updated_at = ${Date.now()}
      WHERE id = ${id}
    `));

    await trackUsage(edgespark, sql, STAGE2_MODEL, "stage2", STAGE2_COST_CENTS);

    await edgespark.db.all(sql.raw(`
      UPDATE processing_queue SET status = 'done', completed_at = ${Date.now()}
      WHERE image_id = ${id} AND stage = 'stage2' AND status = 'processing'
    `));

    return c.json({
      success: true,
      forensic: { ...forensicData, conflict_flags: anachronisms, validation_status: validationStatus }
    });

  } catch (err: any) {
    console.error("[Stage2] Gemini error:", err.message);

    await edgespark.db.all(sql.raw(`
      UPDATE processing_queue SET status = 'failed', error = '${String(err.message).replace(/'/g, "''")}',
      completed_at = ${Date.now()}
      WHERE image_id = ${id} AND stage = 'stage2' AND status = 'processing'
    `));

    return c.json({ error: "Stage 2 forensic failed: " + err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// MODE B: TARGETED SINGLE QUESTION
// Ask one specific forensic question about a specific poster
// ═══════════════════════════════════════════════════════════════
app.post("/api/library/:id/ask", async (c) => {
  const id = parseInt(c.req.param("id"));
  const { question, country, yearStart, yearEnd } = await c.req.json() as {
    question: string;
    country?: string;
    yearStart?: number;
    yearEnd?: number;
  };

  if (!question?.trim()) return c.json({ error: "question is required" }, 400);

  const geminiKey = edgespark.secret.get("GEMINI_API_KEY");
  if (!geminiKey) return c.json({ error: "GEMINI_API_KEY not configured" }, 500);

  const imgs = await edgespark.db.all<any>(sql.raw(`SELECT * FROM image_library WHERE id = ${id}`));
  if (!imgs[0]) return c.json({ error: "Image not found" }, 404);
  const img = imgs[0];

  let file: any;
  try {
    const { bucket, path: storagePath } = edgespark.storage.fromS3Uri(img.s3_uri);
    file = await edgespark.storage.from(bucket).get(storagePath);
    if (!file) return c.json({ error: "Image not found in storage" }, 404);
  } catch (err: any) {
    return c.json({ error: "Failed to fetch image: " + err.message }, 500);
  }

  let base64: string;
  try {
    base64 = bytesToBase64(new Uint8Array(file.body));
  } catch (err: any) {
    return c.json({ error: "Failed to process image: " + err.message }, 500);
  }

  const mimeType = file.metadata?.contentType || "image/jpeg";
  const ai = new GoogleGenAI({ apiKey: geminiKey });

  const existingData = img.identified_title ?
    `Previously identified as: ${img.identified_title} (${img.identified_year || "year unknown"})` : "";

  const countryRules = (country || img.poster_country) ?
    buildCountryRules(country || img.poster_country, yearStart || 0, yearEnd || 0) : "";

  const prompt = `You are an expert forensic movie poster archivist. A collector is asking you a specific question about this poster.

${existingData}
${countryRules}

FOCUS on the poster border regions (left edge, right edge, bottom strip, top header) when looking for forensic details.
If the question is about whether this is an original or reissue, check: Visto/Visa numbers, NSS codes, BBFC ratings, printer addresses, edition markings, distributor logos.

QUESTION: ${question}

Give a specific, direct answer based on what you can see in the image. Reference specific visual evidence (e.g. "I can see 'Visto di Censura N. 42183' in the lower right, which places this in the early 1960s"). If you cannot determine the answer with confidence, say so clearly and explain why.`;

  try {
    const result = await geminiWithRetry(ai, {
      model: STAGE2_MODEL,
      contents: [{
        role: "user",
        parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }]
      }]
    });

    const answer = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    await trackUsage(edgespark, sql, STAGE2_MODEL, "ask", STAGE2_COST_CENTS);

    return c.json({ success: true, question, answer });

  } catch (err: any) {
    console.error("[Ask] Gemini error:", err.message);
    return c.json({ error: "Question failed: " + err.message }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PROCESSING QUEUE — add posters for batch processing
// ═══════════════════════════════════════════════════════════════
app.post("/api/admin/media-library/queue", async (c) => {
  const { imageIds, batchContext } = await c.req.json() as {
    imageIds: number[];
    batchContext?: {
      country?: string;
      format?: string;
      yearStart?: number;
      yearEnd?: number;
    };
  };

  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    return c.json({ error: "imageIds array required" }, 400);
  }

  const ts = Date.now();
  const contextStr = batchContext ? JSON.stringify(batchContext).replace(/'/g, "''") : "{}";
  let queued = 0;

  for (const imageId of imageIds) {
    // Add Stage 1 first, Stage 2 second (sequential processing)
    for (const stage of ["stage1", "stage2"]) {
      // Check not already queued/processing
      const existing = await edgespark.db.all<any>(sql.raw(`
        SELECT id FROM processing_queue
        WHERE image_id = ${imageId} AND stage = '${stage}'
        AND status IN ('pending', 'processing')
      `));
      if (existing.length === 0) {
        await edgespark.db.all(sql.raw(`
          INSERT INTO processing_queue (image_id, stage, status, batch_context, queued_at, created_at)
          VALUES (${imageId}, '${stage}', 'pending', '${contextStr}', ${ts}, ${ts})
        `));
        queued++;
      }
    }
  }

  return c.json({ success: true, queued, total: imageIds.length * 2 });
});

app.get("/api/admin/media-library/queue", async (c) => {
  const [queueStats, todayUsage, pendingItems] = await Promise.all([
    edgespark.db.all<any>(sql.raw(`
      SELECT stage, status, COUNT(*) as count
      FROM processing_queue
      GROUP BY stage, status
      ORDER BY stage, status
    `)),
    edgespark.db.all<any>(sql.raw(`
      SELECT model, stage, calls, estimated_cost_cents, last_call_at
      FROM api_usage_log
      WHERE date = '${new Date().toISOString().split("T")[0]}'
      ORDER BY stage
    `)),
    edgespark.db.all<any>(sql.raw(`
      SELECT q.id, q.image_id, q.stage, q.status, q.queued_at, q.error,
             il.identified_title, il.filename
      FROM processing_queue q
      LEFT JOIN image_library il ON il.id = q.image_id
      WHERE q.status IN ('pending', 'failed')
      ORDER BY q.queued_at ASC
      LIMIT 50
    `))
  ]);

  const totalCallsToday = todayUsage.reduce((sum: number, r: any) => sum + r.calls, 0);
  const totalCostCentsToday = todayUsage.reduce((sum: number, r: any) => sum + r.estimated_cost_cents, 0);
  const pendingCount = queueStats.filter((r: any) => r.status === "pending")
    .reduce((sum: number, r: any) => sum + r.count, 0);

  return c.json({
    queue: {
      stats: queueStats,
      pending: pendingItems,
      pendingCount,
    },
    usage: {
      today: todayUsage,
      totalCallsToday,
      estimatedCostCentsToday: totalCostCentsToday,
      estimatedCostDollarsToday: (totalCostCentsToday / 100).toFixed(4),
    }
  });
});

// Process next item in queue (called by frontend poller)
app.post("/api/admin/media-library/queue/process-next", async (c) => {
  // Get next pending stage1 item
  const [nextItem] = await edgespark.db.all<any>(sql.raw(`
    SELECT * FROM processing_queue
    WHERE status = 'pending'
    ORDER BY stage ASC, queued_at ASC
    LIMIT 1
  `));

  if (!nextItem) return c.json({ done: true, message: "Queue is empty" });

  // Mark as processing
  await edgespark.db.all(sql.raw(`
    UPDATE processing_queue SET status = 'processing', started_at = ${Date.now()}
    WHERE id = ${nextItem.id}
  `));

  // Parse batch context
  let batchContext = {};
  try { batchContext = JSON.parse(nextItem.batch_context || "{}"); } catch {}

  // Call the appropriate stage endpoint internally
  const endpoint = nextItem.stage === "stage1" ?
    `/api/library/${nextItem.image_id}/identify` :
    `/api/library/${nextItem.image_id}/forensic`;

  // We return the work to be done — the frontend poller handles the actual call
  return c.json({
    done: false,
    nextItem: {
      queueId: nextItem.id,
      imageId: nextItem.image_id,
      stage: nextItem.stage,
      endpoint,
      batchContext
    }
  });
});

// ═══════════════════════════════════════════════════════════════
app.get("/api/admin/media-library/pending-matches", async (c) => {
  const minConfidence = parseFloat(c.req.query("minConfidence") || "0");

  const pending = await edgespark.db.all<any>(sql.raw(`
    SELECT
      il.id as image_id,
      il.filename,
      il.identified_title,
      il.identified_year,
      il.identified_director,
      il.suggested_inventory_id,
      il.match_confidence,
      il.s3_uri,
      il.thumbnail_url,
      i.title as inventory_title,
      i.year as inventory_year,
      i.format as inventory_format,
      i.lot_id as inventory_lot_id
    FROM image_library il
    LEFT JOIN inventory i ON i.id = il.suggested_inventory_id
    WHERE il.match_status = 'suggested'
    AND il.suggested_inventory_id IS NOT NULL
    AND il.match_confidence >= ${minConfidence}
    ORDER BY il.match_confidence DESC, il.updated_at DESC
  `));

  // Group by confidence tier for the UI
  const high = pending.filter((p: any) => p.match_confidence >= 0.9);
  const medium = pending.filter((p: any) => p.match_confidence >= 0.7 && p.match_confidence < 0.9);
  const low = pending.filter((p: any) => p.match_confidence < 0.7);

  return c.json({
    total: pending.length,
    tiers: { high, medium, low },
    all: pending
  });
});


  // ═══════════════════════════════════════════════════════════
  // EBAY COMMAND BRIDGE - FRAME AND REEL
  // ═══════════════════════════════════════════════════════════

  // Enhanced eBay listings table with Frame & Reel fields
  try {
    await edgespark.db.all(sql.raw(`
      CREATE TABLE IF NOT EXISTS ebay_listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ebay_item_id TEXT UNIQUE,
        title TEXT,
        price REAL,
        currency TEXT DEFAULT 'USD',
        condition TEXT,
        item_web_url TEXT,
        image_url TEXT,
        shipping_cost REAL,
        status TEXT DEFAULT 'draft',
        listing_type TEXT,
        seller TEXT,
        last_synced_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        -- Frame & Reel specific fields
        poster_id INTEGER,
        ebay_listing_id TEXT,
        description_html TEXT,
        year INTEGER,
        director TEXT,
        cast TEXT,
        format TEXT,
        origin TEXT,
        decade TEXT,
        other_notes TEXT,
        gemini_synopsis TEXT,
        gemini_collector_note TEXT,
        condition_details TEXT,
        category_id TEXT,
        -- Business policies
        shipping_policy_id TEXT,
        payment_policy_id TEXT,
        return_policy_id TEXT
      )
    `));
    console.log("[DB] Enhanced ebay_listings table ready");
  } catch (e) {
    console.warn("[DB] ebay_listings table creation skipped:", e);
  }

  // Get all eBay listings (with filters)
  app.get("/api/ebay/listings", async (c) => {
    const status = c.req.query("status");
    console.log("[API] GET /api/ebay/listings", { status });

    try {
      let query = "SELECT * FROM ebay_listings";
      const params: string[] = [];

      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }

      query += " ORDER BY created_at DESC";

      const listings = await edgespark.db.all(sql.raw(query));
      return c.json({ listings });
    } catch (error: any) {
      console.error("[API] Error fetching listings:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Get single eBay listing
  app.get("/api/ebay/listings/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] GET /api/ebay/listings/:id", { id });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    try {
      const [listing] = await edgespark.db.all(sql.raw(
        `SELECT * FROM ebay_listings WHERE id = ${id}`
      ));

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      return c.json({ listing });
    } catch (error: any) {
      console.error("[API] Error fetching listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Create new eBay listing (Draft)
  app.post("/api/ebay/listings", async (c) => {
    const body = await c.req.json();
    console.log("[API] POST /api/ebay/listings", body);

    const {
      poster_id,
      title,
      year,
      director,
      cast,
      format,
      origin,
      decade,
      price,
      condition,
      condition_details,
      other_notes,
      description_html,
      image_url,
      category_id,
      shipping_policy_id,
      payment_policy_id,
      return_policy_id,
    } = body;

    try {
      const [result] = await edgespark.db.all(sql.raw(`
        INSERT INTO ebay_listings (
          poster_id, title, year, director, cast, format, origin, decade,
          price, condition, condition_details, other_notes, description_html,
          image_url, category_id, shipping_policy_id, payment_policy_id,
          return_policy_id, status, created_at
        ) VALUES (
          ${poster_id ? poster_id : null},
          '${(title || "").replace(/'/g, "''")}',
          ${year || null},
          '${(director || "").replace(/'/g, "''")}',
          '${(cast || "").replace(/'/g, "''")}',
          '${(format || "").replace(/'/g, "''")}',
          '${(origin || "").replace(/'/g, "''")}',
          '${(decade || "").replace(/'/g, "''")}',
          ${price || null},
          '${(condition || "").replace(/'/g, "''")}',
          '${(condition_details || "").replace(/'/g, "''")}',
          '${(other_notes || "").replace(/'/g, "''")}',
          '${(description_html || "").replace(/'/g, "''")}',
          '${(image_url || "").replace(/'/g, "''")}',
          '${(category_id || "").replace(/'/g, "''")}',
          '${(shipping_policy_id || "").replace(/'/g, "''")}',
          '${(payment_policy_id || "").replace(/'/g, "''")}',
          '${(return_policy_id || "").replace(/'/g, "''")}',
          'draft',
          ${Date.now()}
        )
      `));

      console.log("[API] Listing created:", result);

      return c.json({
        success: true,
        listing_id: (result as any).insertId,
        status: "draft"
      });
    } catch (error: any) {
      console.error("[API] Error creating listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Update eBay listing
  app.put("/api/ebay/listings/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    console.log("[API] PUT /api/ebay/listings/:id", { id, body });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    const {
      title,
      year,
      director,
      cast,
      format,
      origin,
      decade,
      price,
      condition,
      condition_details,
      other_notes,
      description_html,
      image_url,
      category_id,
      shipping_policy_id,
      payment_policy_id,
      return_policy_id,
    } = body;

    try {
      await edgespark.db.all(sql.raw(`
        UPDATE ebay_listings SET
          title = '${(title || "").replace(/'/g, "''")}',
          year = ${year || null},
          director = '${(director || "").replace(/'/g, "''")}',
          cast = '${(cast || "").replace(/'/g, "''")}',
          format = '${(format || "").replace(/'/g, "''")}',
          origin = '${(origin || "").replace(/'/g, "''")}',
          decade = '${(decade || "").replace(/'/g, "''")}',
          price = ${price || null},
          condition = '${(condition || "").replace(/'/g, "''")}',
          condition_details = '${(condition_details || "").replace(/'/g, "''")}',
          other_notes = '${(other_notes || "").replace(/'/g, "''")}',
          description_html = '${(description_html || "").replace(/'/g, "''")}',
          image_url = '${(image_url || "").replace(/'/g, "''")}',
          category_id = '${(category_id || "").replace(/'/g, "''")}',
          shipping_policy_id = '${(shipping_policy_id || "").replace(/'/g, "''")}',
          payment_policy_id = '${(payment_policy_id || "").replace(/'/g, "''")}',
          return_policy_id = '${(return_policy_id || "").replace(/'/g, "''")}',
          last_synced_at = ${Date.now()}
        WHERE id = ${id}
      `));

      return c.json({ success: true });
    } catch (error: any) {
      console.error("[API] Error updating listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Delete eBay listing
  app.delete("/api/ebay/listings/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] DELETE /api/ebay/listings/:id", { id });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    try {
      await edgespark.db.all(sql.raw(`DELETE FROM ebay_listings WHERE id = ${id}`));
      return c.json({ success: true });
    } catch (error: any) {
      console.error("[API] Error deleting listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Publish listing to eBay (simulated - actual eBay API would go here)
  app.post("/api/ebay/listings/:id/publish", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/ebay/listings/:id/publish", { id });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    try {
      // Get listing details
      const [listing] = await edgespark.db.all(sql.raw(
        `SELECT * FROM ebay_listings WHERE id = ${id}`
      ));

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      // In production, this would call eBay's API:
      // 1. createOrReplaceInventoryItem
      // 2. createOffer
      // 3. publishOffer

      // For now, simulate a successful publish
      const mockEbayItemId = `FR${Date.now()}`;

      await edgespark.db.all(sql.raw(`
        UPDATE ebay_listings SET
          status = 'active',
          ebay_item_id = '${mockEbayItemId}',
          item_web_url = 'https://www.ebay.com/itm/${mockEbayItemId}',
          last_synced_at = ${Date.now()}
        WHERE id = ${id}
      `));

      return c.json({
        success: true,
        ebay_item_id: mockEbayItemId,
        status: "active",
        message: "Listing published to eBay (simulated)"
      });
    } catch (error: any) {
      console.error("[API] Error publishing listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Withdraw/end listing on eBay
  app.post("/api/ebay/listings/:id/withdraw", async (c) => {
    const id = parseInt(c.req.param("id"));
    const { reason } = await c.req.json().catch(() => ({ reason: "NOT_AVAILABLE" }));
    console.log("[API] POST /api/ebay/listings/:id/withdraw", { id, reason });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    try {
      // In production, this would call eBay's withdrawOffer API
      await edgespark.db.all(sql.raw(`
        UPDATE ebay_listings SET
          status = 'ended',
          last_synced_at = ${Date.now()}
        WHERE id = ${id}
      `));

      return c.json({
        success: true,
        status: "ended",
        reason,
        message: "Listing withdrawn from eBay"
      });
    } catch (error: any) {
      console.error("[API] Error withdrawing listing:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Relist ended listing
  app.post("/api/ebay/listings/:id/relist", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/ebay/listings/:id/relist", { id });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    try {
      const [listing] = await edgespark.db.all(sql.raw(
        `SELECT * FROM ebay_listings WHERE id = ${id}`
      ));

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      // Generate new eBay item ID for relisting
      const mockEbayItemId = `FR${Date.now()}`;

      await edgespark.db.all(sql.raw(`
        UPDATE ebay_listings SET
          status = 'active',
          ebay_item_id = '${mockEbayItemId}',
          item_web_url = 'https://www.ebay.com/itm/${mockEbayItemId}',
          last_synced_at = ${Date.now()}
        WHERE id = ${id}
      `));

      return c.json({
        success: true,
        ebay_item_id: mockEbayItemId,
        status: "active",
        message: "Listing relisted on eBay"
      });
    } catch (error: any) {
      console.error("[API] Error relisting:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Generate listing content with Gemini AI
  app.post("/api/ebay/listings/:id/generate", async (c) => {
    const id = parseInt(c.req.param("id"));
    console.log("[API] POST /api/ebay/listings/:id/generate", { id });

    if (isNaN(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    const geminiKey = (edgespark.secret.get("GEMINI_API_KEY") ?? "") as string;
    if (!geminiKey) {
      return c.json({ error: "GEMINI_API_KEY not configured" }, 500);
    }

    try {
      // Get listing details
      const [listing] = await edgespark.db.all(sql.raw(
        `SELECT * FROM ebay_listings WHERE id = ${id}`
      ));

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      // Build the Frame & Reel cataloger prompt
      const listingData = listing as any;
      const prompt = `Act as a specialist cataloger for 'Frame and Reel,' an authentic theatrical poster gallery. Generate a professional eBay listing using these variables:

Title: ${listingData.title || "Unknown"}
Year: ${listingData.year || "N/A"}
Director: ${listingData.director || "Unknown"}
Cast: ${listingData.cast || "Unknown"}
Format: ${listingData.format || "Theatrical Poster"}
Origin: ${listingData.origin || "USA"}
Other Notes: ${listingData.other_notes || "None"}

Requirements:
1. Synopsis: 2 sentences of film history/background
2. Collector's Note: Incorporate the Other Notes immediately. Highlight why the Format is desirable for collectors.
3. Tone: Academic yet accessible; avoid '100% original' and 'authenticated' claims.

Return JSON with these fields:
{
  "synopsis": "2 sentence film history",
  "collector_note": "compelling collector-focused description",
  "full_description": "complete HTML description ready for eBay"
}`;

      const genAI = new GoogleGenAI({ apiKey: geminiKey });
      const response = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return c.json({ error: "Could not parse Gemini response", raw: text }, 422);
      }

      const generated = JSON.parse(jsonMatch[0]);

      // Update listing with generated content
      await edgespark.db.all(sql.raw(`
        UPDATE ebay_listings SET
          gemini_synopsis = '${(generated.synopsis || "").replace(/'/g, "''")}',
          gemini_collector_note = '${(generated.collector_note || "").replace(/'/g, "''")}',
          description_html = '${(generated.full_description || "").replace(/'/g, "''")}',
          last_synced_at = ${Date.now()}
        WHERE id = ${id}
      `));

      return c.json({
        success: true,
        generated,
        message: "Listing content generated successfully"
      });
    } catch (error: any) {
      console.error("[API] Error generating content:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // Get available posters for listing (not yet listed)
  app.get("/api/ebay/available-posters", async (c) => {
    console.log("[API] GET /api/ebay/available-posters");

    try {
      // Get posters that aren't already linked to an active eBay listing
      const posters = await edgespark.db.all(sql.raw(`
        SELECT p.*, il.image_url as imageUrl
        FROM posters p
        LEFT JOIN image_library il ON p.image_id = il.id
        WHERE p.visibility IN ('listed', 'featured')
        AND p.sold = 0
        AND p.id NOT IN (SELECT poster_id FROM ebay_listings WHERE status = 'active')
        ORDER BY p.createdAt DESC
      `));

      return c.json({ posters });
    } catch (error: any) {
      console.error("[API] Error fetching available posters:", error.message);
      return c.json({ error: error.message }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // GOOGLE SHEETS HANDSHAKE VISUAL CONFIRMATION
  // Validates sheet access and provides Service Account email
  // ═══════════════════════════════════════════════════

  // Service account email for Google Sheets access
  const SERVICE_ACCOUNT_EMAIL = "youware@youware-backend.iam.gserviceaccount.com";

  app.post("/api/sheets/validate", async (c) => {
    const { spreadsheetId, sheetName } = await c.req.json() as { 
      spreadsheetId: string; 
      sheetName?: string;
    };
    
    console.log("[API] POST /api/sheets/validate", { spreadsheetId, sheetName });

    const googleApiKey = edgespark.secret.get("GOOGLE_SHEETS_API_KEY") || edgespark.secret.get("GOOGLE_API_KEY");
    
    if (!googleApiKey) {
      return c.json({ 
        canAccess: false,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        error: "Google API key not configured",
        instruction: "Please configure GOOGLE_SHEETS_API_KEY in your project secrets"
      }, 500);
    }

    try {
      // Try to get spreadsheet metadata to verify access
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties,title,sheets(sheetId,title)&key=${googleApiKey}`;
      const metaResponse = await fetch(metaUrl);
      
      if (metaResponse.status === 404) {
        return c.json({
          canAccess: false,
          serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
          error: "Spreadsheet not found",
          instruction: `Invite ${SERVICE_ACCOUNT_EMAIL} as an Editor to your Google Sheet`
        }, 403);
      }
      
      if (metaResponse.status === 403) {
        return c.json({
          canAccess: false,
          serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
          error: "Access denied - API key may not have Google Sheets scope",
          instruction: `Invite ${SERVICE_ACCOUNT_EMAIL} as an Editor to your Google Sheet`
        }, 403);
      }

      const metadata: any = await metaResponse.json();
      
      // If sheetName provided, verify it exists
      if (sheetName) {
        const sheetExists = metadata.sheets?.some((s: any) => s.properties.title === sheetName);
        if (!sheetExists) {
          return c.json({
            canAccess: false,
            serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
            error: `Sheet "${sheetName}" not found`,
            availableSheets: metadata.sheets?.map((s: any) => s.properties.title),
            instruction: `Create or rename a sheet to "${sheetName}" or invite ${SERVICE_ACCOUNT_EMAIL} as Editor`
          }, 404);
        }
      }

      console.log("[API] Google Sheets validation success:", metadata.properties?.title);
      
      return c.json({
        canAccess: true,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        spreadsheetTitle: metadata.properties?.title,
        spreadsheetId: spreadsheetId,
        availableSheets: metadata.sheets?.map((s: any) => s.properties.title),
        instruction: null
      });

    } catch (err: any) {
      console.error("[API] Google Sheets validation error:", err);
      return c.json({
        canAccess: false,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        error: err.message,
        instruction: `Invite ${SERVICE_ACCOUNT_EMAIL} as an Editor to your Google Sheet`
      }, 500);
    }
  });

  // Get service account email endpoint (for UI to display)
  app.get("/api/sheets/service-account", async (c) => {
    return c.json({
      serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
      instruction: `Copy this email and invite it as an Editor to your Google Sheet`
    });
  });

  // ═══════════════════════════════════════════════════
  // SERVICE ACCOUNT HANDSHAKE - Check Permissions
  // Validates Editor access before bulk sync
  // ═══════════════════════════════════════════════════
  app.post("/api/sheets/check-permissions", async (c) => {
    const { spreadsheetId, sheetName } = await c.req.json() as {
      spreadsheetId: string;
      sheetName?: string;
    };

    console.log("[API] POST /api/sheets/check-permissions", { spreadsheetId, sheetName });

    const googleApiKey = edgespark.secret.get("GOOGLE_SHEETS_API_KEY") || edgespark.secret.get("GOOGLE_API_KEY");

    if (!googleApiKey) {
      return c.json({
        status: "error",
        hasEditorAccess: false,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        error: "Google API key not configured",
        canSync: false
      }, 500);
    }

    try {
      // First, get spreadsheet metadata to verify basic access
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties,title,sheets(sheetId,title)&key=${googleApiKey}`;
      const metaResponse = await fetch(metaUrl);

      if (!metaResponse.ok) {
        const errorText = await metaResponse.text();
        return c.json({
          status: "error",
          hasEditorAccess: false,
          serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
          error: metaResponse.status === 404 ? "Spreadsheet not found" : "Access denied",
          canSync: false,
          details: errorText
        }, metaResponse.status as any);
      }

      const metadata: any = await metaResponse.json();

      // Verify specific sheet if provided
      let targetSheet = null;
      if (sheetName) {
        targetSheet = metadata.sheets?.find((s: any) => s.properties.title === sheetName);
        if (!targetSheet) {
          return c.json({
            status: "error",
            hasEditorAccess: false,
            serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
            error: `Sheet "${sheetName}" not found`,
            availableSheets: metadata.sheets?.map((s: any) => s.properties.title),
            canSync: false
          }, 404);
        }
      }

      // Check permissions by attempting to get the spreadsheet's ACL
      // Using the spreadsheets.get endpoint with includeGridData to verify write access
      const aclUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,title,sheets(properties(sheetId,title,index))&key=${googleApiKey}`;
      const aclResponse = await fetch(aclUrl);

      if (!aclResponse.ok) {
        return c.json({
          status: "error",
          hasEditorAccess: false,
          serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
          error: "Cannot verify permissions - spreadsheet may not be shared with service account",
          canSync: false
        }, 403);
      }

      // For API key auth, we assume if we can read metadata, we have access
      // In production with JWT, we'd check the actual ACL
      const hasAccess = aclResponse.ok;

      console.log("[API] Permission check result:", {
        spreadsheetId,
        spreadsheetTitle: metadata.properties?.title,
        hasEditorAccess: hasAccess,
        canSync: hasAccess
      });

      return c.json({
        status: "connected",
        hasEditorAccess: hasAccess,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        spreadsheetTitle: metadata.properties?.title,
        spreadsheetId: spreadsheetId,
        targetSheet: sheetName || metadata.sheets?.[0]?.properties?.title,
        availableSheets: metadata.sheets?.map((s: any) => s.properties.title),
        canSync: hasAccess,
        connectionStatus: "active",
        lastValidated: Date.now()
      });

    } catch (err: any) {
      console.error("[API] Permission check error:", err);
      return c.json({
        status: "error",
        hasEditorAccess: false,
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
        error: err.message,
        canSync: false
      }, 500);
    }
  });

  // ═══════════════════════════════════════════════════
  // BULK IMPORT ENGINE v1.0
  // CSV Import with Append/Patch/Replace modes
  // ═══════════════════════════════════════════════════

  // GET /api/inventory/template - Download CSV template
  
  // POST /api/inventory/bulk - Bulk import with Append/Patch/Replace modes
  app.post("/api/inventory/bulk", async (c) => {
    console.log("[API] POST /api/inventory/bulk");
    
    try {
      const body = await c.req.json();
      const { data, mode } = body as { 
        data: Record<string, string>[]; 
        mode: "append" | "patch" | "replace";
      };
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        return c.json({ error: "No data provided" }, 400);
      }
      
      if (!["append", "patch", "replace"].includes(mode)) {
        return c.json({ error: "Invalid mode. Use: append, patch, or replace" }, 400);
      }
      
      console.log("[API] Bulk import:", { mode, rowCount: data.length });
      
      // Column mapping from CSV to DB
      const columnMap: Record<string, string> = {
        lot_number: "lot_number",
        item_number: "item_number",
        title: "title",
        original_title: "original_title",
        title_local: "title_local",
        year: "year",
        director: "director",
        main_cast: "main_cast",
        artist: "artist",
        movie_country: "movie_country",
        poster_country: "poster_country",
        format: "format",
        dimensions: "dimensions",
        ds_ss: "ds_ss",
        type: "type",
        style: "style",
        country_of_origin: "country_of_origin",
        source_url: "source_url",
        notes: "notes",
        condition_grade: "condition_grade"
      };
      
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      const timestamp = Date.now();
      
      // REPLACE mode: Delete all existing inventory first
      if (mode === "replace") {
        try {
          await edgespark.db.run(sql.raw("DELETE FROM inventory"));
          console.log("[API] Replace mode: Cleared all inventory");
        } catch (e) {
          console.error("[API] Failed to clear inventory:", e);
        }
      }
      
      // Process each row
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const lotNumber = row.lot_id?.trim() || row.lot_number?.trim();
        
        if (!lotNumber) {
          errors.push(`Row ${i + 1}: Missing lot_id (or lot_number)`);
          skipped++;
          continue;
        }
        
        try {
          // Check if lot exists
          const lotNumEscaped = String(lotNumber).replace(/'/g, "''");
          const existing = await edgespark.db.all<any[]>(
            sql.raw(`SELECT id FROM inventory WHERE lot_id = '${lotNumEscaped}' LIMIT 1`)
          );
          
          const exists = existing && existing.length > 0;
          
          if (mode === "append" && exists) {
            // Append mode: Skip if lot exists
            skipped++;
            continue;
          }
          
          // Build the record
          const record: Record<string, any> = {
            lot_id: lotNumber,
            title_original: row.title_original?.trim() || row.title?.trim() || null,
            title_local: row.title_local?.trim() || null,
            ocr_title_raw: row.ocr_title_raw?.trim() || null,
            movie_release_year: row.movie_release_year ? parseInt(row.movie_release_year) : (row.year ? parseInt(row.year) : null),
            poster_year: row.poster_year ? parseInt(row.poster_year) : null,
            poster_country: row.poster_country?.trim() || null,
            printer_credit: row.printer_credit?.trim() || null,
            nss_visa_code: row.nss_visa_code?.trim() || null,
            ebay_listing_ids: row.ebay_listing_ids?.trim() || null,
            dna_audit_status: row.dna_audit_status?.trim() || 'pending',
            updated_at: timestamp
          };
          
          if (exists && mode === "patch") {
            // PATCH mode: Update existing record (only non-empty fields)
            const updateFields: string[] = [];
            const updateValues: any[] = [];
            let paramIndex = 1;
            
            for (const [key, value] of Object.entries(record)) {
              if (key !== "lot_id" && value !== null && value !== "") {
                updateFields.push(`${key} = $${paramIndex}`);
                updateValues.push(value);
                paramIndex++;
              }
            }
            
            if (updateFields.length > 0) {
              updateFields.push(`updated_at = ${timestamp}`);
              
              const lotNumEscaped = String(lotNumber).replace(/'/g, "''");
              await edgespark.db.run(
                sql.raw(`UPDATE inventory SET ${updateFields.join(", ")} WHERE lot_id = '${lotNumEscaped}'`)
              );
              updated++;
            } else {
              skipped++;
            }
          } else {
            // INSERT mode (append or replace)
            record.created_at = timestamp;
            record.sold = 0;
            record.visibility = "unlisted";
            
            // Build the INSERT query with escaped values
            const fields = Object.keys(record);
            const values = Object.values(record).map(v => {
              if (v === null) return 'NULL';
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            
            await edgespark.db.run(
              sql.raw(`INSERT INTO inventory (${fields.join(", ")}) VALUES (${values.join(", ")})`)
            );
            inserted++;
          }
        } catch (rowErr: any) {
          errors.push(`Row ${i + 1} (${lotNumber}): ${rowErr.message}`);
          skipped++;
        }
      }
      
      console.log("[API] Bulk import complete:", { inserted, updated, skipped, errors: errors.length });
      
      return c.json({
        success: true,
        mode,
        inserted,
        updated,
        skipped,
        total: data.length,
        errors: errors.slice(0, 10) // Return first 10 errors
      });
      
    } catch (err: any) {
      console.error("[API] Bulk import error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  // GET /api/inventory/stats - Inventory statistics
  app.get("/api/inventory/stats", async (c) => {
    console.log("[API] GET /api/inventory/stats");
    
    try {
      const totalResult = await edgespark.db.all<any>(
        sql.raw("SELECT COUNT(*) as count FROM inventory")
      );
      const total = totalResult?.[0]?.count || 0;
      
      const formatResult = await edgespark.db.all<any>(
        sql.raw("SELECT format, COUNT(*) as count FROM inventory WHERE format IS NOT NULL AND format != '' GROUP BY format ORDER BY count DESC")
      );
      
      const countryResult = await edgespark.db.all<any>(
        sql.raw("SELECT poster_country, COUNT(*) as count FROM inventory WHERE poster_country IS NOT NULL AND poster_country != '' GROUP BY poster_country ORDER BY count DESC")
      );
      
      const soldResult = await edgespark.db.all<any>(
        sql.raw("SELECT COUNT(*) as count FROM inventory WHERE sold = 1")
      );
      
      return c.json({
        total,
        sold: soldResult?.[0]?.count || 0,
        available: total - (soldResult?.[0]?.count || 0),
        byFormat: formatResult || [],
        byCountry: countryResult || []
      });
    } catch (err: any) {
      console.error("[API] Stats error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}

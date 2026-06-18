# Context Handoff — Frame & Reel Inventory Import

## Primary Request
Import master inventory Excel data (~315 items) into the database AND build a full searchable/filterable inventory page in the storefront.

## Current State — What's Built & Deployed
1. **Real inventory on homepage** — Featured Posters section pulls from DB via public API
2. **Public API routes** — `GET /api/public/posters` and `GET /api/public/posters/:id` (no auth)
3. **Poster Detail page** — `#/poster/:id` with full details, buy on eBay CTA
4. **Visibility toggle in admin** — Featured/Listed/Hidden cycle button in PosterManager
5. **Backend deployed** — All routes live at staging
6. **Production build passing**

## Key Files Modified
- `src/App.tsx` — Full storefront + poster detail + hash router
- `src/components/PosterManager.tsx` — Admin with visibility toggle
- `backend/server/src/index.ts` — Public API + visibility in updatable fields
- `YOUWARE.md` — Updated docs

## Key Decisions
- Public API uses `/api/public/*` prefix (no auth required)
- Admin uses `/api/*` (auth required)
- Visibility values: `featured`, `listed`, `hidden`
- Hash router: `#/` storefront, `#/admin` admin, `#/poster/:id` detail
- EdgeSpark client baseUrl: `https://staging--b4puosnkz6175drjl5qg.youbase.cloud`

## Inventory Data
- **File**: `chat/d323dfdcpa.xlsx` (also converted to `chat/inventory-readme` markdown)
- **Tab 1 "Master Inventory of Auction Wins"**: ~65 entries (individuals + lots)
  - Fields: Title, Original Title, Movie Country, Poster Country, Year, Type (Indiv./Lot), Format, Dimensions, DS/SS, Director, Cast, Artist, Sold status, Item #
- **Tab 2 "Master Lot Inventory"**: ~250+ individual items unpacked from lots
  - Fields: Title, Year, Director, Format, Size, Country, Actors/Style, Source URL, Item #
  - Item # links back to Tab 1 lots (e.g., `7155264-01` → lot `7155264`)
- Some lots have rich metadata (Lot 7155499 has pricing tiers, style variants, value drivers)

## Pending Tasks (In Order)
1. **Expand DB schema** — Add fields: `itemNumber`, `lotId`, `type`, `format`, `dimensions`, `dsSs`, `artist`, `movieCountry`, `posterCountry`, `sold`, `sourceUrl`
2. **Import ~315 items** from Excel into the database (via SQL INSERT from parsed data)
3. **Build full filterable inventory page** at `#/collection` with:
   - Search bar
   - Filters: decade, format, country, DS/SS, artist, sold status
   - Lot groupings
4. **Link "Browse Collection"** button on homepage to new inventory page
5. Blog section (future task)
6. eBay listing sync (future task)

## Next Step
Read the inventory markdown file, plan DB schema expansion with `youbase_execute_sql`, parse the data, bulk-insert, then build the inventory page component.

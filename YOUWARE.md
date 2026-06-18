# Frame & Reel — Vintage Movie Poster Store

## Project Overview
Frame & Reel is a vintage original movie poster store with an admin inventory management system. The public storefront showcases the collection, while the admin panel (`#/admin`) provides bulk image upload, AI-powered movie scanning (Gemini), and poster management.

## Development Commands
- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build for production: `npm run build`

## Architecture

### Frontend (React 18 + Vite + Tailwind)
- **Public Storefront** (`#/`): Hero, poster grid (from DB), genre filtering, testimonials, newsletter
- **Poster Detail** (`#/poster/:id`): Full poster info with image, metadata, price, buy CTA
- **Admin Panel** (`#/admin`): Upload, split, scan, manage posters, visibility toggle
- **Auth**: Youbase managed auth UI — login required for admin access
- **Data Flow**: Storefront uses public API (`/api/public/*`), Admin uses protected API (`/api/*`)

### Backend (Youbase - Hono + Drizzle)
- **URL**: `https://staging--b4puosnkz6175drjl5qg.youbase.cloud`
- **Database Tables**: `poster_uploads`, `poster_images`, `posters`
- **Storage Bucket**: `poster-images`
- **Bundle Management**: `inventory_bundle_items` table links bundle items to child inventory items
- **Poster Visibility**: `featured` (homepage), `listed` (full inventory), `hidden` (admin only)
- **Item Types**: `individual` (default single poster), `bundle` (grouped items matching eBay bundle listings)
- **API Routes (Protected — auth required)**:
  - `POST /api/upload/presign` — Get presigned R2 upload URL
  - `POST /api/uploads/:id/confirm` — Confirm upload
  - `POST /api/uploads/:id/splits` — Register split images
  - `POST /api/posters/:id/ocr-scan` — OCR + TMDB scan
  - `POST /api/posters/:id/scan` — Scan poster with Gemini Vision
  - `GET /api/posters` — List all posters (admin)
  - `GET /api/posters/:id` — Get single poster (admin)
  - `PUT /api/posters/:id` — Update poster (incl. visibility)
  - `DELETE /api/posters/:id` — Delete poster
  - `GET /api/uploads` — List uploads
- **API Routes (Public — no auth)**:
  - `GET /api/public/posters` — List visible posters (?visibility=featured|listed)
  - `GET /api/public/posters/:id` — Get single poster detail

### Secrets Required
- `GEMINI_API_KEY` — Google Gemini API for movie poster scanning

## Design System
- **Typography**: Playfair Display (display/headings), Lora (body), Special Elite (typewriter accents)
- **Colors**: Cream (#F5F0E8), Burgundy (#8B1A1A), Antique Gold (#C8A951), Noir (#2C1810)
- **Aesthetic**: Vintage cinema — warm tones, grain texture overlay, gold accents, serif typography

## Key Files
- `src/App.tsx` — Public storefront + hash router
- `src/components/PosterManager.tsx` — Admin panel (upload, split, scan, CRUD)
- `src/components/MediaLibrary.tsx` — Media library with OCR scanning
- `backend/server/src/index.ts` — All backend API routes
- `backend/server/src/__generated__/` — Auto-generated schemas (do not edit)

## OCR/AI Scanning Features
The system uses Gemini 2.0 Flash for AI-powered movie poster identification with specialized prompts:
- **Frame & Reel Cataloger Prompt**: Uses billing blocks and NSS/Tax strings for year/origin identification
- **French Title Rule**: French titles for French-origin films, English for others
- **Confidence Scoring**: Returns confidence scores and inventory status (MATCHED/NEEDS_REVIEW)
- **Logic Bridge**: Auto-links identified posters to inventory records via fuzzy title matching

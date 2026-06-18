# Frame & Reel

Source code for [frameandreel.com](https://frameandreel.com) — a vintage movie poster e-commerce site selling authenticated original theatrical posters, with inventory weighted toward Italian (Locandina, Due Fogli, Quattro Fogli) and French (Petite, Moyenne, Grande) formats alongside US formats.

This repository is mirrored from the project's working environment on YouWare/EdgeSpark (editor: `youware.com/editor/7b7cb41e-62cb-49b5-b72f-0c035a3c6347`) and is intended as the canonical, version-controlled copy of the codebase for offline editing, history, and backup.

## Tech stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Hono + Drizzle ORM, deployed via EdgeSpark
- **Hosting/build**: YouWare (EdgeSpark), staging at `staging--b4puosnkz6175drjl5qg.youbase.cloud`

## Project structure

```
src/                       Frontend application
  App.tsx                  Main app component (storefront, routing, admin shell)
  components/              PosterManager, InventoryManager, BlogPage, BlogEditor,
                            MediaLibrary, EbayListingDashboard, MetadataModal, AdminLogin
  assets/                  Static images

backend/server/             Active backend (EdgeSpark app — see edgespark.toml: path = "server")
  src/index.ts              Hono backend entry point: API routes, business logic
  src/__generated__/        Auto-generated DB schema/types — do not hand-edit

data/                       Historical SQL batch files used for one-time inventory imports
docs/                       Reference screenshots and project handoff notes
```

Note: `backend/edgespark.toml` points the deploy path at `server/`, so `backend/server/` is the live backend. An earlier `backend/src/` duplicate existed in past exports and has been intentionally excluded here — it is stale and not deployed.

## Local development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build to dist/
```

Backend changes are deployed separately via the EdgeSpark CLI from within the YouWare environment (`cd backend && npx edgespark deploy`); this repo does not currently include a CI/CD pipeline for that step.

## Key conventions

- **Format naming**: always use full names in buyer-facing copy (e.g. "Italian Locandina", "French Petite") — country is implied by format, and insider jargon like "locandina" alone or "paper" should be avoided.
- **"Theatrical" is ambiguous** in public copy (can read as stage theater) — prefer "Original Cinema Posters".
- **Sourcing copy** is intentionally kept flexible and should not reference auction houses specifically.
- **Review attribution** displays as "Verified buyer" with item context only — no platform name, no edited review text.
- API routes: `/api/*` (auth required), `/api/public/*` (optional auth), `/api/webhooks/*` (no auth).

## History

See `docs/HANDOFF.md` for a snapshot of project state and decisions as of the last major inventory/storefront build session.

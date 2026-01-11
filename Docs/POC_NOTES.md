# POC Notes (Loveable Generated) — Inventory & Findings

Purpose: capture what the existing Loveable POC already has so agents can extend it without breaking it.
Plain language note: keep updates simple and jargon-free for non-technical readers.

## What we know
- Stack: Vite + React + TypeScript + Tailwind + shadcn/ui
- Source: Loveable-generated POC (do not rewrite from scratch)

## To fill in during intake (P0)
### Routing
- Router library: react-router-dom (v6)
- Where routes live: route table in `src/App.tsx`, page components in `src/pages/**`
- Public routes implemented: `/`, `/products`, `/products/commercial-robotic-machine`, `/products/mini`, `/products/micro`, `/supplies`, `/plus`, `/contact`, `/about`, `/resources`, `/cart`, `/login`
- Any portal/auth-gated routes present: `/portal`, `/portal/training`, `/portal/support`, `/portal/onboarding`, `/portal/orders`, `/portal/account` (no route guard yet; auth is mocked)

### State/data fetching
- Supabase present? No (no Supabase client found)
- Stripe present? Placeholder only (copy + mock checkout)
- Data fetching library (if any): @tanstack/react-query (QueryClient in App)

### Folder structure snapshot
- Key folders: `src/pages`, `src/pages/products`, `src/pages/portal`, `src/components`, `src/components/ui`, `src/contexts`, `src/lib`, `src/hooks`
- Where UI components live: `src/components` and `src/components/ui` (shadcn/ui)

### Environment variables
- `.env.example` exists? Yes
- Client env var prefixing (`VITE_`) handled? Yes in `.env.example` (no env usage found in code yet)
- Any accidental secrets in client config? No known secrets found in repo

### Known issues / tech debt
- Build warnings: Browserslist data is out of date (caniuse-lite)
- Console errors: none seen in dev server output; browser console not checked in this intake
- Lint warnings: `react-refresh/only-export-components` in generated UI files
- Dead code / unused deps: no clear dead code found yet; mock auth + mock checkout flows are placeholders

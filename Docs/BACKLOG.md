# Backlog

Guidelines:
- Keep tasks PR-sized (1–3 days of work for an agent).
- Mark dependencies explicitly.
- We are starting from a **Loveable-generated POC** — prefer incremental improvements over rewrites.

## P0 — Foundations (must come first)
1. **POC intake + repo hygiene**
   - Confirm the Loveable POC runs locally
   - Ensure these pass:
     - `npm ci`
     - `npm run dev` (manual start)
     - `npm run build`
     - `npm run lint --if-present`
   - Add/confirm:
     - `.env.example` (safe defaults + comments)
     - no secrets committed
   - Create/update `Docs/POC_NOTES.md` with:
     - routing library used
     - folder structure overview
     - any existing auth/payment stubs
     - known issues/tech debt
   - Dependency: none

2. **Routing + navigation skeleton (MVP pages)**
   - Use existing router if present; otherwise add `react-router-dom`
   - Add top-level navigation and placeholder routes for:
     - Home, Machines (Full/Micro/Mini), Supplies (Sugar), Plus, Resources, Contact
     - Portal shell routes (gated placeholders)
   - Dependency: (1)

3. **Environment + config hardening**
   - `.env.example` contains:
     - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (safe to expose)
     - server-only vars placeholders (Stripe secret/webhook secret) with clear warnings
   - Add typed config helper to prevent missing envs
   - Dependency: (1)

## P0 — Public site
4. Home page (hero + product entry points + trust section)
5. Machines pages (Full, Micro, Mini waitlist mode)
6. Supplies pages (Sugar first; sticks optional)
   - Sugar flavors: white (milk), orange, red (strawberry), blue (blueberry)
   - Make bulk sugar ordering easy (support large quantities per order)
7. Plus page (pricing + boundaries + CTA)
8. Resources/FAQ page
9. Contact + quote request forms (store leads in DB or send email)

## P0 — Member portal
10. Auth (magic link recommended) + protected routes
11. Portal shell layout + dashboard placeholder cards
12. Training library MVP (gated catalog + detail pages)
13. Onboarding checklist (track completion per user)
14. Support requests (concierge + parts assistance)

## P0 — Payments (test mode)
15. Sugar checkout (Stripe Checkout)
16. Plus Basic subscription checkout + customer portal link
17. Webhook sync (membership/order status → DB)

## P1 — Nice-to-have
18. Sticks product page (if offered)
19. Training progress tracking
20. Basic admin view for support requests

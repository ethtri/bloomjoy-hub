# Backlog

Guidelines:
- Keep tasks PR-sized (1-3 days of work for an agent).
- Mark dependencies explicitly.
- We are starting from a **Loveable-generated POC** - prefer incremental improvements over rewrites.

## P0 - Foundations (must come first)
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

## P0 - Public site
4. Home page (hero + product entry points + trust section)
5. Machines pages (Full, Micro, Mini live quote flow)
6. Supplies pages (Sugar first; sticks optional)
   - Sugar flavors: white (milk), orange, red (strawberry), blue (blueberry)
   - Make bulk sugar ordering easy (support large quantities per order)
7. Plus page (pricing + boundaries + CTA)
8. Resources/FAQ page
9. Contact + quote request forms (store leads in DB or send email)

## P0 - Member portal
10. Auth (magic link recommended) + protected routes
11. Portal shell layout + dashboard placeholder cards
12. Training library MVP (gated catalog + detail pages)
13. Onboarding checklist (track completion per user)
14. Support requests (concierge + parts assistance)

## P0 - Payments (test mode)
15. Sugar checkout (Stripe Checkout)
16. Plus Basic subscription checkout + customer portal link
17. Webhook sync (membership/order status -> DB)


## P0 - Training UX/performance hardening (new)
18. **Training performance: Vimeo load speed + startup UX** (`#89`)
   - Improve perceived startup speed for training detail video playback.
   - Add clear loading-state UX while Vimeo player initializes.
   - Dependency: existing training detail embeds.

19. **Training detail clarity: learning/checklist/resources sections** (`#91`)
   - Clarify purpose/copy for "What you will learn", "Checklist", and "Resources".
   - Add consistent structure + fallback states for empty content.
   - Dependency: existing training detail content model.

20. **Module tag support in training library (Module 1/2/3)** (`#90`)
   - Use module tags for library grouping/filtering and discovery.
   - Document operations workflow for Vimeo tag mapping/update.
   - Dependency: Vimeo tagging + training metadata sync.

## P1 - Nice-to-have
21. Sticks product page (if offered)
22. Training progress tracking
23. Basic admin view for support requests
24. Remove temporary static admin email allowlist and rely on `admin_roles` + RLS only
25. Replace third-party Vimeo thumbnail fallback (`vumbnail`) with first-party stored thumbnail URLs
26. **Training hub UX polish after content expansion** (`#125`)
   - Simplify the above-the-fold hierarchy so one primary next action is obvious.
   - Rebalance `Start Here`, task paths, featured items, and full-library stacking.
   - Make the new document-first job aids feel curated without adding clutter.
   - Validate final desktop/mobile hierarchy with authenticated QA on `/portal/training`.
27. **Public CX polish audit remediation**
   - Keep Micro Machine quote-led and remove direct machine cart behavior until direct machine commerce is intentionally implemented.
   - Make the shared cart resilient on mobile and keep checkout clearly sugar-only.
   - Tighten public page spacing on `/machines`, `/resources`, `/plus`, and `/contact` without changing the global visual system.
   - Improve contact form labels/input semantics, mobile icon-button labels, and product-gallery thumbnail state.
   - Validate the remediated public routes on desktop and common mobile viewport sizes.

## P2 - Ops hardening follow-ups
28. **Operationalize WeCom alerts + WeChat onboarding concierge** (`#110`)
   - Define referral-buddy onboarding runbook and response-time SLA.
   - Validate 1-week WeCom delivery reliability for quote/order/support alerts.
   - Capture sign-off evidence for onboarding intake + non-blocking alert failure behavior.

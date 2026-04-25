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

## P0 - Corporate partner reporting (current critical path)
18. **Harden Sunze sales source controls before partner report launch** (`#161`)
   - Merge the hardened Sunze sync controls before relying on weekly partner reporting.
   - Confirm mapped-machine imports, unmapped-machine quarantine, dry-run/live sync, and freshness reporting are green.
   - Dependency: merged sales reporting foundation.

19. **Streamline admin partnership setup** (`#167`)
   - Merge the selected-partnership setup workflow after syncing with `main`.
   - Keep participants, assigned machines, current machine tax rates, financial split terms, and weekly preview together in `/admin/partnerships`.
   - Dependency: Sunze controls and merged partnership reporting foundation.

20. **Corporate partner reviewed PDF milestone**
   - Add partner-report snapshot/run records for reporting period, rule version, assumptions, generated-by user, status, recipients/download metadata, storage path, and warning state.
   - Generate a polished weekly PDF with executive summary, machine-level appendix, calculation assumptions, amount owed, generated timestamp, and snapshot ID.
   - Keep delivery manual for V1: super-admin reviews, downloads, then sends outside automation until the report is trusted.
   - Dependency: partnership setup UX and reliable Sunze sales facts.

## P1 - Reporting UX/CX follow-ups
21. **Partner dashboard UX/CX and reporting tab design** (`#172`)
   - Design the reporting tab so users see operator-style reporting for assigned machines by default.
   - Add a partner dashboard concept for users with partner-dashboard permissions.
   - Default V1 partner dashboard access to super-admins only until explicit partner-viewer permissions are implemented.
   - Define dashboard KPIs, period controls, machine rollups, warning states, PDF export/review entry points, and mobile/desktop behavior.
   - Dependency: corporate partner reporting model and admin partnership setup direction.

22. **Operator performance dashboards** (`#171`)
   - Add operator dashboards only after corporate partner reporting reaches acceptance.
   - Show assigned-machine sales, units sold, trends, and machine comparisons.
   - Dependency: accepted corporate partner reporting flow.

## P0 - Training UX/performance hardening (new)
23. **Training performance: Vimeo load speed + startup UX** (`#89`)
   - Improve perceived startup speed for training detail video playback.
   - Add clear loading-state UX while Vimeo player initializes.
   - Dependency: existing training detail embeds.

24. **Training detail clarity: learning/checklist/resources sections** (`#91`)
   - Clarify purpose/copy for "What you will learn", "Checklist", and "Resources".
   - Add consistent structure + fallback states for empty content.
   - Dependency: existing training detail content model.

25. **Module tag support in training library (Module 1/2/3)** (`#90`)
   - Use module tags for library grouping/filtering and discovery.
   - Document operations workflow for Vimeo tag mapping/update.
   - Dependency: Vimeo tagging + training metadata sync.

## P1 - Nice-to-have
26. Sticks product page (if offered)
27. Training progress tracking
28. Basic admin view for support requests
29. Remove temporary static admin email allowlist and rely on `admin_roles` + RLS only
30. Replace third-party Vimeo thumbnail fallback (`vumbnail`) with first-party stored thumbnail URLs
31. **Training hub UX polish after content expansion** (`#125`)
   - Simplify the above-the-fold hierarchy so one primary next action is obvious.
   - Rebalance `Start Here`, task paths, featured items, and full-library stacking.
   - Make the new document-first job aids feel curated without adding clutter.
   - Validate final desktop/mobile hierarchy with authenticated QA on `/portal/training`.
32. **Public CX polish audit remediation**
   - Keep Micro Machine quote-led and remove direct machine cart behavior until direct machine commerce is intentionally implemented.
   - Make the shared cart resilient on mobile and keep checkout clearly sugar-only.
   - Tighten public page spacing on `/machines`, `/resources`, `/plus`, and `/contact` without changing the global visual system.
   - Improve contact form labels/input semantics, mobile icon-button labels, and product-gallery thumbnail state.
   - Validate the remediated public routes on desktop and common mobile viewport sizes.
33. **Simplify Sunze machine mapping admin flow** (`#174`)
   - Add a focused mapping action from `/admin/reporting` for newly discovered Sunze machines.
   - Keep location/site grouping optional and support multiple machines at the same location.
   - Let admins assign reporting users during mapping, while keeping partner/tax setup as a separate advanced step.

## P2 - Ops hardening follow-ups
34. **Operationalize WeCom alerts + WeChat onboarding concierge** (`#110`)
   - Define referral-buddy onboarding runbook and response-time SLA.
   - Validate 1-week WeCom delivery reliability for quote/order/support alerts.
   - Capture sign-off evidence for onboarding intake + non-blocking alert failure behavior.

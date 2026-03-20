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
5. Machines pages (Full, Micro, Mini waitlist mode)
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

## P2 - Ops hardening follow-ups
26. **Operationalize WeCom alerts + WeChat onboarding concierge** (`#110`)
   - Define referral-buddy onboarding runbook and response-time SLA.
   - Validate 1-week WeCom delivery reliability for quote/order/support alerts.
   - Capture sign-off evidence for onboarding intake + non-blocking alert failure behavior.

27. **Roll out English transcripts for the Vimeo training library** (`#115`)
   - Treat the newest copy of each duplicate Vimeo title as the canonical transcript target.
   - Preserve bilingual access for Chinese-audio videos by keeping Chinese tracks and adding English.
   - Reuse Vimeo auto-captions where possible and use OpenAI + local `ffmpeg` only for translation/transcription gaps.
   - Dependency: normalized Vimeo metadata is complete; execution still needs an `OPENAI_API_KEY`, local `ffmpeg`, and a draft-review pass before upload.

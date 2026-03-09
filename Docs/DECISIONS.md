# Decisions

Record decisions here so agents don’t “thrash” the stack.

## 2026-01-11 — Starting point and baseline stack (Loveable POC)
We are **not starting from scratch**. The current codebase started as a Loveable-generated proof-of-concept.

**Canonical baseline (keep unless a new decision says otherwise):**
- Frontend: **Vite + React + TypeScript**
- UI: **Tailwind CSS + shadcn/ui**
- Routing: reuse what the POC already uses; if missing, default to **react-router-dom (v6+)**
- Auth + DB (recommended): **Supabase (Auth + Postgres + Storage)**  
- Payments (recommended): **Stripe**
  - Important: Stripe secret keys must be used **server-side only** (never exposed as `VITE_` env vars)

Rationale:
- We already have a working POC in this stack → fastest path is incremental hardening + extension.
- Supabase + Stripe reduce custom backend surface area for MVP.

**Note:** `Docs/BUSINESS_CONTEXT.md` contains an older “suggested technical approach” (Next.js). That section is not canonical—this file is.

## 2026-01-11 — Server-side surface for Stripe
Because this is a Vite SPA, we still need a **server-side component** for:
- Creating Stripe Checkout Sessions
- Handling Stripe webhooks (subscription/order state sync)

Approved options (pick one early; record the final choice here):
1) **Vercel Functions** in `/api/*` (simple monorepo, good DX)
2) **Netlify Functions** in `/.netlify/functions/*`
3) **Supabase Edge Functions** (keeps infra in Supabase)

Until the option is chosen, keep integrations modular (thin client wrappers + clear boundaries).

## 2026-02-02 - Stripe server-side surface choice
We will use **Supabase Edge Functions** for Stripe Checkout and webhook handling.

**Why this choice**
- Hosting-agnostic: the Vite SPA can be hosted anywhere while functions live with Supabase.
- Tight integration with Postgres for webhook-driven state sync.
- Server-only secrets live in Supabase Function Secrets (no VITE_ exposure).
- Minimal, reversible changes: add edge functions and call them from the SPA.

## Open questions (resolve early)
- Hosting target: Vercel vs Netlify vs other (impacts serverless function layout)
- Machines purchase flow in MVP:
  - Quote-only for all machines? or “Buy now” for Micro?
- Membership perks in MVP:
  - Sugar discount vs shipping perk vs both vs neither
- Lead capture destination in MVP:
  - Supabase table vs email provider (Resend/Postmark) vs both

## 2026-01-22 — Training video hosting (MVP)
We will use **Vimeo (Starter/Standard)** for the training library MVP.

**Why this choice**
- Fastest embed path with a reliable player for a Vite React SPA.
- Domain-level embed restrictions provide basic protection.
- Works with Supabase RLS for gating catalog access.

**MVP implementation notes**
- Store training metadata and assets in Supabase tables (`trainings`, `training_assets`).
- Store `provider_video_id` + `provider_hash` (for unlisted embeds).
- Embed via iframe: `https://player.vimeo.com/video/{videoId}?h={hash}&dnt=1`.
- Restrict embeds to approved domains in Vimeo settings.

## 2026-01-22 — Membership gating source of truth (MVP)
We will use a **dedicated `subscriptions` table** synced from Stripe webhooks as the source of truth for membership status.

**Why this choice**
- Avoids relying on client-managed flags for access control.
- Enables accurate access decisions using Stripe subscription state.
- Supports future upgrades (multiple plans, seats, trials).

**MVP implementation notes**
- Use RLS policies that allow training data when the subscription status is `active` or `trialing`.
- Optional: keep a denormalized `profiles.is_member` flag as a cache, but derive it from `subscriptions` only.

## 2026-02-21 — Plus pricing model by machine count (MVP)
We will price Bloomjoy Plus at **$100 per machine per month** using Stripe subscription quantity.

**Pricing model**
- Single recurring Stripe price (`STRIPE_PLUS_PRICE_ID`) set to $100/month per unit
- Checkout quantity = selected machine count
- Monthly charge = `machine_count * $100`

**MVP scope choice**
- Machine count is self-declared at checkout (user selects count in UI)
- Keep webhook and `subscriptions` schema unchanged for membership gating compatibility
- Use quantity-based subscriptions now; revisit account-linked inventory pricing after MVP

## 2026-02-23 - Super-admin MVP role model and operations choices (`#37`)
For MVP admin operations, we will use a single internal role and keep workflow complexity minimal.

**Approved choices**
- Internal role model: `super_admin` only for MVP (no `ops_agent` in MVP)
- Support ticket statuses: `new`, `triaged`, `waiting_on_customer`, `resolved` (optional terminal `closed`)
- Machine count source of truth: app-managed machine count in admin portal is authoritative for operations
- Ticket notifications: defer email alerts for MVP; monitor via admin queue dashboard

**Why this choice**
- Minimizes authz/RLS complexity while landing core operations capability quickly.
- Keeps support workflow reportable without over-modeling states too early.
- Allows operations to maintain real-world machine inventory independent of billing timing.
- Avoids notification plumbing in MVP and keeps scope focused on secure admin workflows.

## 2026-02-26 - Temporary admin email allowlist for auth/training QA (`#75`)
To unblock local QA while role provisioning catches up, we temporarily allow two known owner emails to behave as admin in app auth and training-access checks:
- `etrifari@bloomjoysweets.com`
- `ethtri@gmail.com`

This is a temporary release aid, not the long-term authorization model.

Follow-up requirement:
- Remove static email allowlist before production and rely on `admin_roles` + RLS as the only source of admin access.

## 2026-02-26 - Training thumbnails strategy for Vimeo Module 1 (`#75`)
Training library cards use Vimeo-based thumbnails derived from `provider_video_id`:
- `https://vumbnail.com/{video_id}.jpg`

Rationale:
- Fast, no-backend thumbnail path for current MVP scope.

Follow-up requirement:
- Move to first-party thumbnail URLs stored in `training_assets.meta.thumbnail_url` (or Supabase Storage) for production durability.

## 2026-03-01 - First-party training thumbnail strategy (`#79`)
Training library cards now prefer first-party thumbnail values from `training_assets.meta.thumbnail_url`.

**Storage convention**
- `thumbnail_url` stores either:
  - a public URL (`https://...`) when provided by operations, or
  - a Supabase Storage object key in bucket `training-thumbnails` (example: `vimeo/<video_id>.jpg`).

**Why this choice**
- Removes runtime dependency on third-party thumbnail host availability.
- Keeps thumbnail source controlled by Bloomjoy infrastructure and data.
- Supports environment-specific Supabase hosts without hardcoded thumbnail domains.

**Implementation notes**
- Frontend resolves storage keys via `supabaseClient.storage.from('training-thumbnails').getPublicUrl(...)`.
- Default visual fallback remains first-party (`/placeholder.svg`) for rows missing a thumbnail value.

## 2026-03-02 - Internal quote/order notification email provider
We will use **Resend** from Supabase Edge Functions for internal operations notifications.

**Scope**
- Quote request notifications from `lead-submission-intake`.
- Sugar order notifications from `stripe-webhook` (`checkout.session.completed` payment mode).

**Why this choice**
- Keeps email API keys server-side only in function secrets.
- Minimal change surface: no client secret exposure and no new frontend provider SDK.
- Fast to implement with plain HTTPS calls from Deno edge functions.

## 2026-03-02 - Auth transactional email provider for launch hardening (`#77`)
For production auth email branding and deliverability, we will use **Resend** as the SMTP provider for Supabase Auth emails.

**Why this choice**
- Fastest path to branded sender setup for launch timelines.
- Clear domain authentication workflow (SPF/DKIM) with strong deliverability posture.
- Keeps implementation minimal by using Supabase Auth SMTP configuration (no app rewrite).

**Implementation notes**
- Configure and verify Bloomjoy sender domain in Resend.
- Use Resend SMTP credentials in Supabase Auth email settings for signup confirmation, magic link, and recovery templates.
- Record final test evidence in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.

## 2026-03-09 - Machine sales-sheet baseline (commercial/mini) + micro pricing correction
To keep sales copy and quote intake consistent with current sales materials, we will align machine pricing/wrap language to the latest internal sales-sheet inputs.

**Canonical updates**
- Micro machine target/list price for current sales messaging: **`$2,200`**.
- Commercial machine wrap options must show:
  - Standard Bloomjoy wrap.
  - Custom wrap, explicitly marked as **Commercial-only** and handled offline by the Bloomjoy design team.
- Mini and Micro should not advertise a custom wrap option in MVP copy/flows.

**Source documents reviewed (internal)**
- `Commercial Sales Sheet.pdf` - Quote `20260201B3` dated `2026-02-01` (price effective `2026-05-30`).
- `Mini Sales SHeet.pdf` - Quote `20260228Mini` dated `2026-02-28` (price effective `2026-05-31`).

**Implementation notes**
- Keep custom wrap handling as a manual design handoff (no self-serve design builder in MVP).
- Ensure public product copy, quote CTA language, and smoke checklist coverage stay aligned to these rules.

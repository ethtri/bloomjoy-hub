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

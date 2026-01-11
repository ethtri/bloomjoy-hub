# Architecture (MVP)

## High-level
- **Vite + React** single-page app (SPA)
- **Tailwind + shadcn/ui** for UI
- **Supabase** for auth + database (recommended)
- **Stripe** for payments (requires a server-side surface)

## Why a server-side surface exists (even with a SPA)
Stripe Checkout session creation and webhook handling must run with **secret keys**.
That means we need one of:
- Serverless functions (Vercel/Netlify) OR
- Supabase Edge Functions OR
- A small Node API service

See `Docs/DECISIONS.md` for the chosen option.

## Suggested repo layout (recommended, adapt to the existing POC)
- `src/`
  - `routes/` or `pages/` — route components (public + portal)
  - `components/` — shared UI components (shadcn + app-level)
  - `features/` — feature modules (products, supplies, plus, training, support)
  - `lib/` — clients + utilities (supabase client, API wrappers, auth helpers)
  - `styles/` — Tailwind + global styles
- `api/` (if Vercel Functions) OR `/.netlify/functions/` (if Netlify) OR `supabase/functions/` (if Edge Functions)
- `Docs/` — agent context + sponsor test steps

## Routing shape (conceptual)
Public:
- `/` (Home)
- `/machines/full`
- `/machines/micro`
- `/machines/mini` (or waitlist mode)
- `/supplies/sugar`
- `/supplies/sticks` (optional)
- `/plus`
- `/resources`
- `/contact`

Portal (auth-gated):
- `/portal` (dashboard)
- `/portal/orders`
- `/portal/training`
- `/portal/onboarding`
- `/portal/support`
- `/portal/settings`

## Data entities (minimum viable)
- User (Supabase Auth)
- Membership
  - plan_id (Plus Basic), status
  - stripe_customer_id, stripe_subscription_id
- Order
  - order_id, user_id, items, totals, status, fulfillment metadata
- Product
  - sku, name, type (machine/supply), price, flags
- TrainingContent
  - title, description, tags, access_level (public/member), media_url, sort_order
- SupportRequest
  - type (concierge/parts_assistance/onboarding)
  - status (new, triaged, waiting_on_customer, resolved)
  - notes + links

## Security baseline (non-negotiable)
- Never commit secrets
- Never expose Stripe secret keys to the client (no `VITE_` secret keys)
- RLS policies for user-owned tables (Supabase)
- Validate inputs on the server-side function endpoints

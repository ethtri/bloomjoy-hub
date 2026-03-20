# Local Dev (Sponsor-Friendly)

## Prereqs
- Node.js LTS installed (recommend Node 20+)
- Git installed

## Setup
1) Clone the repo
2) Copy `.env.example` to `.env` (or `.env.local`) and fill in values
   - **Client-exposed env vars must be prefixed with `VITE_`** (Vite rule)
   - **Never put secrets** (Stripe secret key, webhook secret) in `VITE_` vars
   - **Do not commit `.env`**. It stays on your machine only.
   - If you do not see `.env` in File Explorer, turn on "Hidden items"
   - Supabase client env vars used by the app:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
   - Optional client env var for local Google GIS button rendering:
     - `VITE_GOOGLE_CLIENT_ID`
     - `VITE_USE_GIS_BUTTON=true` (optional; if omitted, app uses redirect-based Google sign-in)
   - Optional local QA-only admin override:
     - `VITE_DEV_ADMIN_EMAILS=ethtri@gmail.com` (comma-separated list; applies only in local dev mode)
3) Install deps:
   - `npm ci`
4) Start dev server (from your worktree folder, e.g. `C:\Repos\wt-<task>`):
   - `npm run dev`
5) Open the URL printed in the terminal (usually):
   - http://localhost:8080

## Testing a PR branch
1) Checkout the PR branch (or use a worktree)
2) Run `npm ci`
3) Run `npm run dev`
4) Follow `Docs/QA_SMOKE_TEST_CHECKLIST.md`

## Supabase setup (training library + memberships)
1) Apply migration: `supabase/migrations/20260122_training_and_membership.sql`
   - Orders sync migration: `supabase/migrations/20260202_orders.sql`
2) Seed data (optional for local dev): `supabase/seed/20260122_training_seed.sql`
3) Populate Vimeo fields after account setup:
   - `provider_video_id`
   - `provider_hash`
   - `meta.thumbnail_url` (first-party key in `training-thumbnails` bucket, for example `vimeo/<video_id>.jpg`)

## Vimeo module tag sync (operations helper)
Use this when Vimeo uploads are missing module taxonomy tags (for example `Module 1`).

1) Ensure your local env includes `VIMEO_ACCESS_TOKEN` with Vimeo write access
2) Dry run:
   - `node scripts/vimeo-ensure-tag.mjs --tag "Module 1" --dry-run`
3) Apply updates:
   - `node scripts/vimeo-ensure-tag.mjs --tag "Module 1"`

Notes:
- Script is idempotent and skips videos that already have the target tag.
- Current helper targets all videos visible to the authenticated Vimeo account (`/me/videos`).

## Supabase auth setup (password + Google + magic link)
To use all login methods in local dev:
1) Open Supabase Dashboard -> Authentication -> Providers.
2) Enable `Email` provider with:
   - Magic link (email OTP) enabled
   - Email/password sign-in enabled
3) Enable `Google` provider and add Google OAuth client credentials.
4) Open Supabase Dashboard -> Authentication -> URL Configuration and include:
   - Site URL: `http://localhost:8080`
   - Additional redirects:
     - `http://localhost:8080`
     - `http://localhost:8080/login`
     - `http://localhost:8080/portal`
     - `http://localhost:8080/reset-password`


## Agent best practices (plain language)
- Each agent uses its own worktree and its own `.env` file.
- Do not copy another person's `.env`; create your own from `.env.example`.
- Never commit or paste secret keys in PRs, issues, or chat.
- Keep PRs small and focused; one change set per PR.
- Enable repo git hooks once per clone: `git config core.hooksPath .githooks`
- Fetch before checking recent merges or status: `git fetch origin`
- Write notes and docs so non-technical readers can follow.
- Avoid editing the main repo folder directly; work inside your worktree.



## Preflight check (1 minute)
1) Confirm you are in a worktree folder like `C:\Repos\wt-<task>`
2) Confirm your branch starts with `agent/`
3) Run `git fetch origin` to update your view of recent merges
4) Run `git status -sb` and make sure it looks clean
5) Run `npm run auth:preflight` when working on auth/OAuth launch tasks
6) If you are in `C:\Repos\Bloomjoy_hub`, stop and switch to a worktree

## Session closeout hygiene (2 minutes)
1) Run `git status -sb` and leave the worktree clean, or write down exactly what is intentionally left for the next session.
2) Remove temp artifacts that are not meant to ship, such as scratch files, downloaded exports, ad hoc screenshots, and one-off debug scripts.
3) Stop extra local dev servers you started, or document the active URL/port if the next agent needs the server left running.
4) Update the PR, issue, or handoff note with the next step, blockers, and any env/setup details the next person will need.
5) Investigate stale worktrees safely before deleting anything; only prune/delete a worktree after confirming its branch or PR is merged, closed, or intentionally abandoned.

## Priority workflow (P0-P3)
- Source of truth: GitHub Issues labeled `P0`, `P1`, `P2`, `P3`.
- Use a GitHub Project board for "Backlog -> Ready -> In Progress -> Review -> Done".
  Board: https://github.com/users/ethtri/projects/2
- Keep repo docs light: `Docs/CURRENT_STATUS.md` is a short, plain-language snapshot.
- If you keep personal notes, store them locally and do not commit them.


## Asset access (local-only)
- Create a local folder for photos, e.g. `C:\Repos\Bloomjoy_assets`.
- Do not place large assets in the Git repo. They should stay local.
- Agents should keep their own copy of this folder.
- If an asset is needed in the app, add a small optimized version in `public/` and document it.

## Stripe and submission server-side functions (current)
Stripe checkout/webhook flows and lead submission notifications currently run on Supabase Edge Functions.
For production deployment order and rollback, use `Docs/PRODUCTION_RUNBOOK.md`.

### Supabase Edge Functions (Stripe + submissions)
1) Install Supabase CLI (once): https://supabase.com/docs/guides/cli
2) Set function secrets (server-only):
   - `supabase secrets set STRIPE_SECRET_KEY=...`
   - `supabase secrets set STRIPE_SUGAR_PRICE_ID=...`
   - `supabase secrets set STRIPE_PLUS_PRICE_ID=...`
   - `supabase secrets set STRIPE_WEBHOOK_SECRET=...`
   - `supabase secrets set RESEND_API_KEY=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_FROM_EMAIL=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=etrifari@bloomjoysweets.com,ian@bloomjoysweets.com`
   - Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available to functions
3) Run functions locally:
   - `supabase functions serve stripe-sugar-checkout --no-verify-jwt`
   - `supabase functions serve stripe-plus-checkout --no-verify-jwt`
   - `supabase functions serve stripe-customer-portal --no-verify-jwt`
   - `supabase functions serve stripe-webhook --no-verify-jwt`
   - `supabase functions serve lead-submission-intake --no-verify-jwt`
4) Ensure `.env` has `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` for the SPA.

## Common issues
- Missing env vars can break pages. Check console + `.env` (or `.env.local`).
- If Stripe webhook forwarding isn't configured, subscription/order sync may not update locally.

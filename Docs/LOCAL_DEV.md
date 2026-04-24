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
   - WeChat onboarding support migration: `supabase/migrations/202603100001_wechat_onboarding_support.sql`
   - Training experience upgrade migration: `supabase/migrations/202603190001_training_experience_upgrade.sql`
   - Sales reporting foundation migration: `supabase/migrations/202604240001_sales_reporting_foundation.sql`
2) Seed data (optional for local dev): `supabase/seed/20260122_training_seed.sql`
3) Populate Vimeo fields after account setup:
   - `provider_video_id`
   - `provider_hash`
   - `meta.thumbnail_url` (first-party key in `training-thumbnails` bucket, for example `vimeo/<video_id>.jpg`)

## Sales reporting import helpers
Use these before the Sunze service account exists, after the sales reporting migration has been applied.

1) Ensure your local env includes:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Import or dry-run normalized Sunze/manual sales CSV rows:
   - `npm run reporting:import-sales -- --file scripts/sample-sales-reporting.csv --dry-run`
   - `npm run reporting:import-sales -- --file path/to/sunze-export.csv --source manual_csv`
3) Import or dry-run refund/complaint adjustments exported from Google Sheets:
   - `npm run reporting:import-refunds -- --file scripts/sample-refund-adjustments.csv --dry-run`
   - `npm run reporting:import-refunds -- --file path/to/refunds.csv --source-reference <sheet-or-export-id>`

Notes:
- CSV rows must map to configured reporting machines by `machine_id`/`reporting_machine_id` or `sunze_machine_id`.
- `machine_sales_facts` stores Sunze/manual sales as net sales. `sales_adjustment_facts` stores refunds separately so gross sales can be calculated as net plus refunds.
- Server-only function secrets for reporting are `REPORT_SCHEDULER_SECRET`, `SUNZE_LOGIN_URL`, `SUNZE_REPORTING_EMAIL`, `SUNZE_REPORTING_PASSWORD`, `GOOGLE_REFUNDS_SHEET_ID`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Never prefix Sunze, Google, service-role, or scheduler secrets with `VITE_`.

## Training document upload helper
Use this after the training experience migration is applied and `training-documents` exists.

1) Ensure your local env includes:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Run the upload helper:
   - `npm run training:upload-docs`
3) Optional alternate source root:
   - `node scripts/upload-training-documents.mjs --source-root "I:/Shared drives/Bloomjoy Training/CottonCandy"`

Notes:
- The helper uploads `Software setup.pdf` and `Cotton Candy Maintenance Guide.pdf`.
- Uploaded files are private; the portal should access them through signed URLs only.

## Training guide catalog sync (operations helper)
Use this after uploading the source PDFs when guide/checklist rows need to be created or refreshed in Supabase.

1) Ensure your local env includes:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Audit without writing:
   - `npm run training:sync-guides -- --dry-run`
3) Upsert the guide/checklist rows and attach the source PDFs:
   - `npm run training:sync-guides`

Notes:
- This keeps the document-first training rows aligned with the local portal content for software setup, shutdown/cooldown, cleaning hotspots, diagnostics, and consumables.
- Run `npm run training:upload-docs` first so the signed PDF downloads resolve correctly from the portal.

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

## Vimeo catalog sync (operations helper)
Use this when Vimeo uploads already exist but are not discoverable in the portal because Supabase catalog rows are missing or stale.

1) Ensure your local env includes:
   - `VIMEO_ACCESS_TOKEN`
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Audit without writing:
   - `node scripts/sync-vimeo-training-catalog.mjs --dry-run`
3) Upsert missing rows and refresh existing Vimeo-backed entries:
   - `node scripts/sync-vimeo-training-catalog.mjs`

Notes:
- The script flags unmapped uploads, duplicate catalog rows, stale Vimeo references, and uploads missing module labels.
- Vimeo remains the media host, but Supabase `trainings` + `training_assets` stay the portal source of truth.

## Training catalog duplicate cleanup (operations helper)
Use this after the Vimeo catalog sync if duplicate uploads exist in Vimeo and you want the Supabase-backed operator library to show only the canonical rows.

1) Ensure your local env includes:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Audit duplicate rows without writing:
   - `npm run training:dedupe-catalog -- --dry-run`
3) Mark non-canonical duplicate training rows as `draft`:
   - `npm run training:dedupe-catalog`

Notes:
- The helper only updates duplicate Vimeo-backed `trainings` rows in Supabase; it does not delete Vimeo uploads.
- Canonical MG320 Vimeo IDs from the shared catalog manifest are preserved automatically.
- Existing `draft` rows stay draft on later syncs because the Vimeo sync helper does not overwrite visibility.

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
6) Run `npm run commerce:preflight` when working on Stripe/order/notification changes
7) If you are in `C:\Repos\Bloomjoy_hub`, stop and switch to a worktree

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
   - `supabase secrets set STRIPE_SUGAR_MEMBER_PRICE_ID=...`
   - `supabase secrets set STRIPE_SUGAR_NON_MEMBER_PRICE_ID=...`
   - Optional migration bridge only: `supabase secrets set STRIPE_SUGAR_PRICE_ID=...`
   - `supabase secrets set STRIPE_STICKS_PRICE_ID=...`
   - `supabase secrets set STRIPE_PLUS_PRICE_ID=...`
   - `supabase secrets set STRIPE_WEBHOOK_SECRET=...`
   - `supabase secrets set RESEND_API_KEY=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_FROM_EMAIL=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=etrifari@bloomjoysweets.com,ian@bloomjoysweets.com`
   - `supabase secrets set WECOM_CORP_ID=...`
   - `supabase secrets set WECOM_AGENT_ID=...`
   - `supabase secrets set WECOM_AGENT_SECRET=...`
   - `supabase secrets set WECOM_ALERT_TO_USERIDS=ethan.trifari,ops.manager`
   - `supabase secrets set REPORT_SCHEDULER_SECRET=...`
   - `supabase secrets set SUNZE_LOGIN_URL=...`
   - `supabase secrets set SUNZE_REPORTING_EMAIL=...`
   - `supabase secrets set SUNZE_REPORTING_PASSWORD=...`
   - `supabase secrets set GOOGLE_REFUNDS_SHEET_ID=...`
   - `supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=...`
   - Ensure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are available to functions
3) Run the commerce release preflight before deploy:
   - Local env check: `npm run commerce:preflight`
   - Remote secret presence check: `npm run commerce:preflight -- --project-ref <project-ref>`
4) Run functions locally:
   - `supabase functions serve stripe-sugar-checkout --no-verify-jwt`
   - `supabase functions serve stripe-sticks-checkout --no-verify-jwt`
   - `supabase functions serve stripe-plus-checkout --no-verify-jwt`
   - `supabase functions serve stripe-customer-portal --no-verify-jwt`
   - `supabase functions serve stripe-webhook --no-verify-jwt`
   - `supabase functions serve lead-submission-intake --no-verify-jwt`
   - `supabase functions serve support-request-intake --no-verify-jwt`
   - `supabase functions serve sales-report-export --no-verify-jwt`
   - `supabase functions serve sales-report-scheduler --no-verify-jwt`
   - `supabase functions serve sunze-sales-sync --no-verify-jwt`
   - `supabase functions serve refund-adjustment-sync --no-verify-jwt`
5) Ensure `.env` has `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` for the SPA.

## Stripe order backfill helper
Use this when a paid Stripe checkout must be imported into `public.orders` because webhook replay is unavailable or the webhook failed before persistence.

1) Ensure your local env includes:
   - `STRIPE_SECRET_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Find the Stripe Checkout Session ID(s) in Stripe Dashboard.
3) Dry run one or more sessions:
   - `npm run orders:backfill -- --session-id <cs_...> --dry-run`
4) Import the order snapshot into Supabase:
   - `npm run orders:backfill -- --session-id <cs_...>`

Notes:
- The helper writes the order snapshot only. It does not resend internal/customer/WeCom notifications.
- Use Stripe event replay first when possible; use the backfill helper when replay is unavailable or insufficient.

## Common issues
- Missing env vars can break pages. Check console + `.env` (or `.env.local`).
- If Stripe webhook forwarding isn't configured, subscription/order sync may not update locally.
- If training documents do not open from Supabase-backed rows, confirm the `training-documents` bucket exists and that the upload helper was run with a valid service-role key.

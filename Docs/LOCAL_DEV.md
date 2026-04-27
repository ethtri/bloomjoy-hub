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
   - Sales reporting daily automation helpers: `supabase/migrations/202604250001_sales_reporting_daily_automation.sql`
   - Sunze sales reliability controls: `supabase/migrations/202604260002_sunze_sales_controls.sql`
   - Sunze unmapped machine queue: `supabase/migrations/202604260003_sunze_unmapped_machine_queue.sql`
   - Reporting admin/partner foundation repair: `supabase/migrations/202604260004_reporting_admin_rpc_repair.sql`
   - Sunze enriched sales upsert repair: `supabase/migrations/202604260005_sunze_enriched_fact_upsert.sql`
   - Sunze order-hash idempotency repair: `supabase/migrations/202604260006_sunze_order_hash_index_repair.sql`
   - Partner dashboard period preview: `supabase/migrations/202604260007_partner_period_preview.sql`
   - Technician entitlement data model: `supabase/migrations/202604260008_technician_entitlements_data_model.sql`
   - Technician grant/revoke RPCs: `supabase/migrations/202604260009_technician_entitlements_rpcs.sql`
   - Database migration hygiene repairs: `supabase/migrations/202604260010_database_migration_hygiene.sql`
   - Reporting setup corrections: `supabase/migrations/202604260011_reporting_setup_corrections.sql`
   - Technician management context: `supabase/migrations/202604260012_technician_management_context.sql`
   - Partnership contract terms: `supabase/migrations/202604260014_partnership_contract_terms.sql`
   - Partner report CSV export storage: `supabase/migrations/202604260015_partner_report_csv_exports.sql`
   - Technician invite resolution: `supabase/migrations/202604260016_technician_invite_resolution.sql`
   - Partner dashboard amount owed repair: `supabase/migrations/202604260017_partner_dashboard_amount_owed_repair.sql`
   - Reporting partnership participant remove RPC: `supabase/migrations/202604260018_reporting_partnership_party_remove_rpc.sql`
   - Partner report weekly/monthly export metadata: `supabase/migrations/202604260019_partner_report_period_exports.sql`
   - Refund adjustment review/matching: `supabase/migrations/202604270001_refund_adjustment_review_matching.sql`
   - Live refund sheet ingestion source marker: `supabase/migrations/202604270002_live_refund_sheet_ingestion.sql`
   - Scoped Admin entitlements: `supabase/migrations/202604270003_scoped_admin_entitlements.sql`
2) Seed data (optional for local dev): `supabase/seed/20260122_training_seed.sql`
3) Populate Vimeo fields after account setup:
   - `provider_video_id`
   - `provider_hash`
   - `meta.thumbnail_url` (first-party key in `training-thumbnails` bucket, for example `vimeo/<video_id>.jpg`)

Migration notes:
- Supabase will not replay an edited migration after production has marked that version applied. Add a later forward-only repair migration when production schema drift needs to be fixed.
- After migrations that add or replace frontend-facing RPCs, verify `supabase db push --dry-run` is clean and confirm the live REST endpoint does not return `404` or `PGRST202` for the changed RPCs.

## Sales reporting import helpers
Use these after the sales reporting migration has been applied.

1) Ensure your local env includes:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
2) Import or dry-run normalized Sunze/manual sales CSV rows:
   - `npm run reporting:import-sales -- --file scripts/sample-sales-reporting.csv --dry-run`
   - `npm run reporting:import-sales -- --file path/to/sunze-export.csv --source manual_csv`
3) Import or dry-run refund/complaint adjustments from a sanitized CSV/export:
   - `npm run reporting:import-refunds -- --file scripts/sample-refund-adjustments.csv --dry-run`
   - `npm run reporting:import-refunds -- --file path/to/refunds.csv --source-reference <refund-export-id>`
   - Required/referrable columns are `location` / `Location of Purchase`, `refund_date` / `Decision Date`, `refund_amount_usd` / `Refund Amount`, and `status` / `Status`. Optional fields include `request_amount` / `Request Amount`, `order_date` / `Date and Time of Incident`, `source_row_reference` / `Request ID`, `decision` / `Refund Decision`, and `complaint_count`. If `Refund Amount` is blank, `Request Amount` is used only for `Closed` rows with an approve-style `Decision`; open, denied, missing-decision, unmatched, duplicate, or invalid rows remain review-only. Free-text reason/incident fields are not stored in reporting payloads or used for duplicate detection.
   - For the current customer service export, only `Status=Closed` with an approve-style `Decision` and one conservative machine match auto-applies. `Open`, `Deny`, missing/unknown decision, ambiguous, unmatched, duplicate, invalid, missing-status, or low-confidence rows stay in the admin review ledger and do not change partner settlement. The source list can include non-Bloomjoy-Hub machines, such as phone-case machines, so confirmed out-of-scope rows should stay review-only or be resolved as out of scope rather than mapped to cotton-candy reporting machines.
4) Run the live refund source sync through the Supabase Edge Function after secrets are configured:
   - Local dry run: `curl -X POST http://127.0.0.1:54321/functions/v1/refund-adjustment-sync -H "Authorization: Bearer $REPORT_SCHEDULER_SECRET" -H "Content-Type: application/json" --data "{\"dryRun\":true}"`
   - Production trigger: run the `Refund Adjustment Sync` GitHub Action first with `dry_run=true`, then without dry run after aggregate counts look right. Manual workflow dispatch defaults to dry run. Scheduled runs skip until the repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true`; manual runs fail fast if required GitHub secrets are missing.
   - The live sync reads the configured sheet range in pages, stages all rows, applies only safe rows, and returns aggregate counts only. Use optional repository variable `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` to tune page size; the function caps each page at 100 rows to stay under Edge Function timeouts.
5) Validate sanitized reporting parser/matching fixtures:
   - `npm run reporting:validate-provider-parser`
   - `npm run reporting:validate-refund-adjustments`
6) Dry-run the Sunze browser export locally:
   - `npm run reporting:sunze-sync -- --env-file path/to/local.env --dry-run`
   - Historical backfill dry run with a supported Sunze preset:
     `npm run reporting:sunze-sync -- --env-file path/to/local.env --date-preset "Last Month" --dry-run`
   - Add `--summary-machine-codes <comma-separated-sunze-ids>` when you need date-level counts for specific machines without logging raw order rows.
   - Do not use Sunze `Custom Range` for automated backfills; it has produced corrupted workbooks. Use `Last 7 Days`, `Last Month`, or `Last 3 Months`, then verify the parsed `windowStart`/`windowEnd` before running without `--dry-run`.
   - Large exports are posted to ingest in chunks so historical presets stay below the locked endpoint row limit.
   - In GitHub Actions, dry-runs also validate the Supabase ingest and machine mappings without writing sales facts. Local dry-runs skip ingest validation unless `REPORTING_INGEST_URL` and `REPORTING_INGEST_TOKEN` are present.
6) Run the Sunze import freshness check without touching Sunze:
   - `npm run reporting:sunze-health -- --event freshness_check --stale-hours 30`
7) In production, run the scheduled GitHub Action with encrypted repository secrets:
   - `SUNZE_LOGIN_URL`
   - `SUNZE_REPORTING_EMAIL`
   - `SUNZE_REPORTING_PASSWORD`
   - `REPORTING_INGEST_URL`
   - `REPORTING_INGEST_TOKEN`

Notes:
- Sales CSV rows must map to configured reporting machines by `machine_id`/`reporting_machine_id` or `sunze_machine_id`.
- Refund CSV and live source rows are staged first and map through `reporting_machine_aliases`; do not paste raw private refund exports into repo files, issues, PRs, or chat. Reporting payloads keep calculation/audit fields only and omit customer names, emails, payment identifiers, card digits, and free-text incident descriptions.
- `machine_sales_facts` stores Sunze/manual sales as net sales. `sales_adjustment_facts` stores approved refund adjustments separately so partner gross sales remains the imported sales basis while refund impact reduces net sales and split base.
- `sunze-sales-ingest` requires `REPORTING_INGEST_TOKEN` and `REPORTING_ROW_HASH_SALT` as Supabase function secrets. The GitHub worker receives only `REPORTING_INGEST_TOKEN`, never the Supabase service-role key.
- GitHub encrypted secrets for the Sunze worker are `SUNZE_LOGIN_URL`, `SUNZE_REPORTING_EMAIL`, `SUNZE_REPORTING_PASSWORD`, `REPORTING_INGEST_URL`, and `REPORTING_INGEST_TOKEN`.
- GitHub encrypted secrets for the refund sync worker are `REFUND_ADJUSTMENT_SYNC_URL` and `REFUND_ADJUSTMENT_SYNC_TOKEN`; set the repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after manual dry-run/live validation. Optional variable `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` controls page size and defaults to 50. The GitHub workflow does not receive the Google service-account JSON or Supabase service-role key.
- Server-only Supabase function secrets for reporting are `REPORT_SCHEDULER_SECRET`, `REPORTING_INGEST_TOKEN`, `REPORTING_ROW_HASH_SALT`, `GOOGLE_REFUNDS_SHEET_ID`, optional `GOOGLE_REFUNDS_SHEET_RANGE`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Sunze sync controls use optional `SUNZE_EXPECTED_MACHINE_COUNT`, `SUNZE_SYNC_STALE_HOURS=30`, and `SUNZE_REPORTING_TIMEZONE=America/Los_Angeles` by default. The scheduled sync workflow uses `Last 7 Days` daily for rolling overlap and `Last Month` monthly as a safety sweep, then performs a post-import freshness check. The separate Sunze health workflow checks again later for missed/stale imports. Set the expected count only after confirming how many machines the workflow Sunze account exposes in the top-level Machine Center; new visible machines are placed in the `/admin/reporting` mapping queue instead of blocking already mapped sales.
- Admins map newly discovered Sunze IDs from `/admin/reporting`; the current PR flow pre-fills the broader `/admin/partnerships` machine form. Pending rows for unmapped machines are quarantined in normalized form and replayed into `machine_sales_facts` after the Sunze ID is mapped to a canonical reporting machine. Follow-up `#174` tracks a simpler machine-first mapping flow so new Sunze machines do not become recurring engineering blockers.
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

## Post-merge hygiene (2 minutes)
Use this after a PR is merged or intentionally closed. Do not remove a worktree that still has uncommitted work.

1) Confirm the PR state and branch:
   - `gh pr view <number> --json state,mergedAt,headRefName`
2) In the task worktree, confirm there is nothing local to keep:
   - `git status -sb`
3) Refresh local remote-tracking refs:
   - `git fetch --prune origin`
4) Remove the task worktree:
   - `git worktree remove C:\Repos\wt-<task>`
5) Delete the local task branch with the safe form:
   - `git branch -d agent/<task>`
6) Prune stale worktree metadata:
   - `git worktree prune`
7) Verify cleanup:
   - `git worktree list`
   - `git branch --all --list "*<task>*"`

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
   - `supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=ops@bloomjoyusa.com,support@bloomjoyusa.com`
   - `supabase secrets set WECOM_CORP_ID=...`
   - `supabase secrets set WECOM_AGENT_ID=...`
   - `supabase secrets set WECOM_AGENT_SECRET=...`
   - `supabase secrets set WECOM_ALERT_TO_USERIDS=ethan.trifari,ops.manager`
   - `supabase secrets set REPORT_SCHEDULER_SECRET=...`
   - `supabase secrets set REPORTING_INGEST_TOKEN=...`
   - `supabase secrets set REPORTING_ROW_HASH_SALT=...`
   - `supabase secrets set SUNZE_SYNC_STALE_HOURS=30`
   - `supabase secrets set GOOGLE_REFUNDS_SHEET_ID=...`
   - `supabase secrets set GOOGLE_REFUNDS_SHEET_RANGE="'Form Responses 1'!A:T"`
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
   - `supabase functions serve sunze-sales-ingest --no-verify-jwt`
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

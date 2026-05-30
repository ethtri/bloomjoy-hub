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
   - Scoped Admin entitlements: `supabase/migrations/202604270004_scoped_admin_entitlements.sql`
   - Technician entitlement resolver production repair: `supabase/migrations/202604270006_restore_technician_entitlement_resolution_rpc.sql`
   - Scoped Admin reporting visibility repair: `supabase/migrations/202604280008_scoped_admin_reporting_visibility.sql`
   - Scoped Admin training/partner-dashboard repair: `supabase/migrations/202604280009_scoped_admin_training_partner_dashboard.sql`
2) Seed data (optional for local dev): `supabase/seed/20260122_training_seed.sql`
3) Populate Vimeo fields after account setup:
   - `provider_video_id`
   - `provider_hash`
   - `meta.thumbnail_url` (first-party key in `training-thumbnails` bucket, for example `vimeo/<video_id>.jpg`)

Migration notes:
- Supabase will not replay an edited migration after production has marked that version applied. Add a later forward-only repair migration when production schema drift needs to be fixed.
- Before production pushes for any migration branch, run `npm run db:validate-migrations`. This creates a temporary local Supabase project, copies `supabase/migrations`, starts a disposable local Postgres container on random ports, applies every migration from an empty database, and then tears it down. It requires Docker plus the Supabase CLI, but it does not require secrets or production data.
- `supabase db push --dry-run` is still useful after linking a project because it checks local/remote migration history and shows which migrations would be pushed. It does not execute the SQL, so it can miss parse/apply failures inside SQL scripts or function bodies. `npm run db:validate-migrations` performs the actual local parse/apply validation.
- After migrations that add or replace frontend-facing RPCs, run `npm run db:validate-migrations`, verify `supabase db push --dry-run` is clean, and confirm the live REST endpoint does not return `404` or `PGRST202` for the changed RPCs.

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
   - `npm run reporting:provider-sync -- --env-file path/to/local.env --dry-run`
   - Historical monthly backfill dry run with the repaired Sunze custom range flow:
     `npm run reporting:provider-sync -- --env-file path/to/local.env --date-start 2026-01-01 --date-end 2026-01-31 --dry-run`
   - Manual monthly backfill from a Sunze Export Task `.zip`/`.xlsx`, using the same parser/date-window/ingest validation:
     `npm run reporting:provider-sync -- --env-file path/to/local.env --parse-file path/to/sunze-2026-01.zip --date-start 2026-01-01 --date-end 2026-01-31 --dry-run`
   - Add `--summary-machine-codes <comma-separated-sunze-ids>` for local-only date-level counts for specific machines; logs use neutral `summaryMachine#` labels instead of raw source IDs or raw order rows. GitHub workflow runs must use the masked `SUNZE_SUMMARY_MACHINE_CODES` repository secret for this optional summary, not workflow inputs.
   - Daily automation remains on `Last 7 Days`. Historical backfills should use explicit monthly `--date-start` / `--date-end` chunks, then verify parsed `windowStart`/`windowEnd` before running without `--dry-run`.
   - The GitHub `Sales Import Sync` manual dispatch defaults to `dry_run=true`; manual live imports require `dry_run=false` and `confirm_live=true`.
   - Scheduled `Sales Import Sync` runs a primary live `Last 7 Days` replay at `13:30 UTC` plus a backup replay at `17:30 UTC`. The monthly `14:45 UTC` run on the first day of the month is the only scheduled sync that defaults to `Last Month`.
   - `Sales Import Recovery` automatically replays a live `Last 7 Days` sync when a scheduled `Sales Import Sync` run on `main` fails, is cancelled, or times out. Manual recovery dispatch defaults to `dry_run=true`; manual live recovery requires `dry_run=false` and `confirm_live=true`.
   - Sunze export now completes through Export Task List. The worker confirms the export, pins the requested task after the request timestamp, downloads it after completion, parses `.xlsx` or `.zip` files, and deletes raw downloads after parsing.
   - If a manual provider file is used for backfill, keep it outside the repo/CI artifacts and delete it after the dry-run/live ingest checks are complete.
   - Large exports are posted to ingest in chunks so historical date ranges stay below the locked endpoint row limit.
   - In GitHub Actions, dry-runs also validate the Supabase ingest and machine mappings without writing sales facts. Local dry-runs skip ingest validation unless `REPORTING_INGEST_URL` and `REPORTING_INGEST_TOKEN` are present.
7) Run the Sunze import freshness check without touching Sunze:
   - `npm run reporting:provider-health -- --event freshness_check --stale-hours 30`
8) In production, run the scheduled GitHub Action with encrypted repository secrets:
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
- GitHub encrypted secrets for the Sunze worker are `SUNZE_LOGIN_URL`, `SUNZE_REPORTING_EMAIL`, `SUNZE_REPORTING_PASSWORD`, `REPORTING_INGEST_URL`, and `REPORTING_INGEST_TOKEN`. Optional secret `SUNZE_SUMMARY_MACHINE_CODES` can provide comma-separated source IDs for neutral-label date summaries without exposing them through workflow inputs or npm command logs.
- GitHub encrypted secrets for the refund sync worker are `REFUND_ADJUSTMENT_SYNC_URL` and `REFUND_ADJUSTMENT_SYNC_TOKEN`; set the repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after manual dry-run/live validation. Optional variable `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` controls page size and defaults to 50. The GitHub workflow does not receive the Google service-account JSON or Supabase service-role key.
- Server-only Supabase function secrets for reporting are `REPORT_SCHEDULER_SECRET`, `REPORTING_INGEST_TOKEN`, `REPORTING_ROW_HASH_SALT`, `GOOGLE_REFUNDS_SHEET_ID`, optional `GOOGLE_REFUNDS_SHEET_RANGE`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Sunze sync controls use optional `SUNZE_EXPECTED_MACHINE_COUNT`, `SUNZE_SYNC_STALE_HOURS=30`, `SUNZE_REPORTING_TIMEZONE=America/Los_Angeles`, `SUNZE_EXPORT_TASK_TIMEOUT_MS`, `SUNZE_EXPORT_DOWNLOAD_TIMEOUT_MS`, and `SUNZE_EXPORT_TASK_CLOCK_SKEW_MS` by default. The scheduled sync workflow uses primary and backup `Last 7 Days` daily replays for rolling overlap, plus `Last Month` monthly as a safety sweep, then performs a post-import freshness check. The worker retries transient Export Task List wait/download-start timeouts before failing the workflow; the recovery workflow automatically retries failed/cancelled/timed-out scheduled syncs before the separate Sunze health workflow checks later for missed/stale imports. Set the expected count only after confirming how many machines the workflow Sunze account exposes in the top-level Machine Center; Machine Center discovery is advisory, and missing visibility should not block a valid Orders export because row machine IDs still flow into `/admin/reporting` setup/quarantine.
- Admins set up newly discovered Sunze IDs from `/admin/reporting` by choosing the report/partnership, confirming machine label/location/type/tax, and saving once. Pending rows for unconfigured machines are quarantined in normalized form and replayed into `machine_sales_facts` after the Sunze ID is connected to a report-ready machine.
- Never prefix Sunze, Google, service-role, or scheduler secrets with `VITE_`.

## Nayax Lynx API notes
Use `Docs/NAYAX_LYNX_API.md` as the current agent-facing source for Nayax status, endpoint coverage, and permission gaps.

Current server-only secret:
- Supabase production project `ygbzkgxktzqsiygjlqyg`: `NAYAX_LYNX_API_TOKEN`

Set or rotate it with:

```bash
supabase secrets set NAYAX_LYNX_API_TOKEN=... --project-ref ygbzkgxktzqsiygjlqyg
```

For local-only endpoint testing, store the token in your own `.env` as `NAYAX_LYNX_API_TOKEN` or another clearly named local key. Do not commit it, do not paste it into chat, and never prefix it with `VITE_`.

As of 2026-05-11, `GET https://lynx.nayax.com/operational/v1/machines` and `GET /machines/{MachineID}/lastSales` work. `GET /devices` and dashboard widget endpoints return `403`, so future agents should not block a first machine/sales sync on device access.

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


## Refund operations agent QA and proof review
Use this path for agent-run QA of `/refunds/request`, `/portal/refunds`, and Admin > Machines without Google OAuth and without sharing a password.

Executive proof review happens only after agent QA has a pass/fail evidence packet. The executive sponsor should not be the first person to discover broken saves, missing test data, or access-boundary defects.

For manager-wide shadow-pilot go/no-go tracking, use `Docs/REFUND_OPERATIONS_SHADOW_PILOT.md`.

Prereqs:
- Local Supabase is running and the refund operations migration has been applied.
- `.env` or `.env.local` contains local-only `SUPABASE_URL` or `VITE_SUPABASE_URL`, plus server-only `SUPABASE_SERVICE_ROLE_KEY`.
- The Supabase URL should be `localhost`, `127.0.0.1`, or `::1`. The helper refuses non-local Supabase URLs by default.
- For card lookup UAT, set server-only `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` or the fallback `NAYAX_LYNX_API_TOKEN`, and keep `NAYAX_LYNX_BASE_URL=https://lynx.nayax.com/operational/v1`. Do not use `VITE_` for Nayax secrets.
- Nayax card refund execution defaults to disabled/dry-run/kill-switch-on. Use `npm run refunds:validate-nayax-execution` to verify the fail-closed foundation; do not run real provider execution without sponsor go/no-go.
- Server-side Nayax machine mapping must exist before the lookup button can return card candidates. Machine Managers use `/portal/refunds` for case processing and do not see setup controls.

Steps:
1) Start the agent UAT server from the worktree:
   - `npm run dev:uat`
   - Open `http://127.0.0.1:8081`.
2) Seed synthetic fixtures and generate a one-click local magic link:
   - `node scripts/refunds/local-refund-uat.mjs --email refund-agent-uat@bloomjoy.localhost`
   - Add `--open` to open the generated link automatically.
3) Open the printed magic link. It should land on `/portal/refunds` as a local super-admin/Machine Manager. `/admin/refunds` is only a compatibility path.
4) Review the synthetic queue cases:
   - `RF-UAT-CARD`: approved card path with matched transaction evidence.
   - `RF-UAT-WAIT`: waiting-on-customer path with confirmation and more-info message history.
   - `RF-UAT-CASH`: correlated cash/Zelle path marked completed with reporting write-through evidence.
5) Open `/refunds/request?demo=on` separately to review the public customer intake form against synthetic location/machine options without creating a real case.
6) Run the mocked refund-only portal QA harness against the running app:
   - `npm run refunds:validate-portal-uat -- --app-url http://127.0.0.1:8081`
   - The script uses synthetic mocked Auth/RPC responses, writes screenshots under `output/playwright`, and does not touch Supabase data.

Three validation modes:
- `DEMO DATA - visual review only`: append `?demo=on` on localhost/127.0.0.1 for synthetic, browser-only visual review. Demo mode must not be used as evidence that saves, Nayax lookup, access scope, or reporting write-through work.
- Seeded functional UAT: use the local Supabase helper above. This is the path for save/write-through and real state-transition testing.
- Post-production shadow mode: use live authenticated Machine Managers with the Google Form/AppSheet fallback still active. Agents capture pass/fail evidence and exceptions before any executive proof review.

Admin > Machines Machine Manager UAT:
- For visual review without remote data, open `/admin/machines?demo=on`; use the listed `example.test` demo users only. Demo assignments save in the browser and do not write to Supabase.
- For functional UAT, open `/admin/machines`, edit a machine, and use the Machine Managers people lookup to search/add an authenticated user email.
- The target person must have signed in to Bloomjoy at least once before assignment can save. If the person is not an authenticated user yet, the UI should explain that they need to sign in once first.
- Machine Manager changes autosave immediately. There is no separate `Save Machine Managers` button.
- After adding or removing a manager, confirm the status changes to `Saved`, close the sheet, and confirm the manager email is visible in the machine row.
- The bottom `Save machine changes` button saves machine identity plus customer-refund setup fields. Machine Manager assignment autosaves separately when a person is added or removed.

Privacy guardrails:
- The helper writes only synthetic `example.test` customer records and synthetic machine/sales/refund data.
- Remote preview seeding is blocked unless the target is explicitly confirmed as `preview-uat`, the Supabase project ref is supplied twice, and the app URL is not a Bloomjoy production host. Do not use remote seeding against the production Supabase project.
- Do not paste real customer names, emails, card digits, payment IDs, source exports, or free-text complaint content into local fixtures, docs, PRs, issues, or chat.
- Do not commit `.env` files or service-role keys. Never put service-role keys in `VITE_` variables.


## Agent best practices (plain language)
- Start from a GitHub issue and Bloomjoy Project board item. Those are the source of truth for active status, priority, blockers, and acceptance.
- Generate compact kickoff context with `npm run agent:context -- --issue <number>`.
- Run `npm run agent:github-hygiene` for weekly or as-requested GitHub issue/board hygiene reports.
- Use `/goal` for multi-step, multi-PR, high-risk, or ambiguous work. Use `/plan` first if acceptance is unclear.
- Each agent uses its own worktree and its own `.env` file.
- Do not copy another person's `.env`; create your own from `.env.example`.
- Never commit or paste secret keys, raw customer data, payment IDs, vendor exports, or free-text complaint content in PRs, issues, docs, or chat.
- Keep PRs small and focused; one change set per PR.
- Use green/yellow/red merge autonomy: agents may merge green/yellow PRs after evidence is complete, but red-lane PRs require owner direction.
- Run `npm run agent:merge-gate -- --pr <number>` before any agent-initiated merge.
- Enable repo git hooks once per clone: `git config core.hooksPath .githooks`
- Fetch before checking recent merges or status: `git fetch origin`
- Write notes and docs so non-technical readers can follow.
- Keep task chronology in issue/PR comments. Keep repo docs durable and compact.
- Avoid editing the main repo folder directly; work inside your worktree.



## Preflight check (1 minute)
1) Confirm you are in a worktree folder like `C:\Repos\wt-<task>`.
2) Confirm your branch starts with `agent/`.
3) Run `git fetch origin` to update your view of recent merges.
4) Run `npm run agent:preflight`.
5) Run `npm run agent:context -- --issue <number>` when the task has a GitHub issue.
6) Run `git status -sb` and make sure the output is reviewable.
7) Run `npm run agent:validate-workflow` when changing workflow docs, GitHub templates, Codex config, skills, or agent scripts.
8) Run `npm run agent:merge-gate -- --pr <number>` before agent-merging a PR.
9) Run `npm run auth:preflight` when working on auth/OAuth launch tasks.
10) Run `npm run commerce:preflight` when working on Stripe/order/notification changes.
11) Run `npm run db:validate-migrations` when working on Supabase migrations.
12) If you are in `C:\Repos\Bloomjoy_hub`, stop and switch to a worktree.

## Merge autonomy lanes
- Green: low-risk docs, workflow tooling, lint/build cleanup, safe dependency updates, tests, or narrow non-sensitive cleanup. Agents may merge when checks are green and the PR evidence is complete.
- Yellow: UI changes, shared code/workflow changes, performance/build changes, or P0/P1 work without risk labels. Agents may merge after the PR includes the extra browser/design/overlap/performance evidence that matches the change.
- Red: `needs-owner-decision`, `uat-required`, `blocked`, `blocked-external`, `risky-db-change`, or `risky-auth-payment`. Agents do not merge red-lane PRs without explicit owner direction.

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
- Use the Bloomjoy Project board for status, sequencing, blockers, and closeout evidence.
  Board: https://github.com/users/ethtri/projects/2
- Keep repo docs light: `Docs/CURRENT_STATUS.md` is a short, plain-language snapshot and `Docs/BACKLOG.md` is only a historical pointer.
- Capture task status, handoffs, and test evidence in issue/PR comments instead of static markdown.
- Use `npm run agent:context -- --issue <number>` to summarize issue, project, linked PR, docs, and verification context before asking agents to implement.
- Use `npm run agent:github-hygiene` to surface missing board items, stale active work, stale P0/P1 status comments, red-lane PRs, and open PRs needing cleanup.
- If you keep personal notes, store them locally and do not commit them.


## Asset access (local-only)
- Create a local folder for photos, e.g. `C:\Repos\Bloomjoy_assets`.
- Do not place large assets in the Git repo. They should stay local.
- Agents should keep their own copy of this folder.
- If an asset is needed in the app, add a small optimized version in `public/` and document it.

## Stripe and submission server-side functions (current)
Stripe checkout/webhook flows and quote/procurement lead submission notifications currently run on Supabase Edge Functions.
For production deployment order and rollback, use `Docs/PRODUCTION_RUNBOOK.md`.

### Supabase Edge Functions (Stripe + submissions)
1) Install Supabase CLI (once): https://supabase.com/docs/guides/cli
2) Set function secrets (server-only):
   - `supabase secrets set STRIPE_SECRET_KEY=...`
   - `supabase secrets set STRIPE_SUGAR_MEMBER_PRICE_ID=...`
   - `supabase secrets set STRIPE_SUGAR_NON_MEMBER_PRICE_ID=...`
   - Optional migration bridge only: `supabase secrets set STRIPE_SUGAR_PRICE_ID=...`
   - `supabase secrets set STRIPE_STICKS_PRICE_ID=...`
   - `supabase secrets set STRIPE_STICKS_MEMBER_PRICE_ID=...`
   - `supabase secrets set STRIPE_PLUS_PRICE_ID=...`
   - Optional local/dev only: `supabase secrets set BLOOMJOY_ALLOW_LOCAL_REDIRECT_URLS=true` when serving commerce/invite functions locally against a non-local `SUPABASE_URL`
   - Optional preview/UAT only: `supabase secrets set BLOOMJOY_ALLOWED_VERCEL_PREVIEW_ORIGINS=https://<exact-preview>.vercel.app` when invite emails must link back to a Vercel preview. Use exact origins only; do not set this for production launch.
   - `supabase secrets set STRIPE_WEBHOOK_SECRET=...`
   - `supabase secrets set RESEND_API_KEY=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_FROM_EMAIL=...`
   - `supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=etrifari@bloomjoysweets.com,ian@bloomjoysweets.com`
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
   - Refund operations local env check: `npm run commerce:preflight -- --include-refunds`
   - Remote secret presence check: `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds`
4) Run functions locally:
   - `supabase functions serve stripe-sugar-checkout --no-verify-jwt`
   - `supabase functions serve stripe-sticks-checkout --no-verify-jwt`
   - `supabase functions serve stripe-plus-checkout --no-verify-jwt`
   - `supabase functions serve stripe-customer-portal --no-verify-jwt`
   - `supabase functions serve stripe-webhook --no-verify-jwt`
   - `supabase functions serve lead-submission-intake --no-verify-jwt`
   - `supabase functions serve custom-sticks-artwork-upload --no-verify-jwt`
   - `supabase functions serve custom-sticks-artwork-link --no-verify-jwt`
   - `supabase functions serve support-request-intake --no-verify-jwt`
   - `supabase functions serve access-invite --no-verify-jwt`
   - `supabase functions serve sales-report-export --no-verify-jwt`
   - `supabase functions serve sales-report-scheduler --no-verify-jwt`
   - `supabase functions serve sunze-sales-sync --no-verify-jwt`
   - `supabase functions serve sunze-sales-ingest --no-verify-jwt`
   - `supabase functions serve refund-adjustment-sync --no-verify-jwt`
   - `supabase functions serve refund-case-intake --no-verify-jwt`
   - `supabase functions serve refund-case-admin-update --no-verify-jwt`
   - `supabase functions serve refund-case-message-send --no-verify-jwt`
   - `supabase functions serve refund-case-automation-sweep --no-verify-jwt`
   - `supabase functions serve nayax-card-refund --no-verify-jwt`
   - `supabase functions serve nayax-transaction-lookup --no-verify-jwt`
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

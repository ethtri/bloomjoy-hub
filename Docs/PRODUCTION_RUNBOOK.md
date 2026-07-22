# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-05-13

## 1) Roles and ownership
- Release owner: coordinates launch window and final go/no-go call.
- Technical owner: executes frontend + Supabase deploy steps.
- Billing owner: verifies Stripe products/prices/webhook health.
- Auth owner: executes auth provider, redirect, and branded email configuration.
- QA owner: runs smoke checklist and signs off.

## 2) Production configuration matrix
Set the following values before launch.

| Variable | Scope | Used by | Source of truth | Owner |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend (public) | SPA Supabase client | Supabase project settings | Technical owner |
| `VITE_SUPABASE_ANON_KEY` | Frontend (public) | SPA Supabase client | Supabase project API keys | Technical owner |
| `STRIPE_SECRET_KEY` | Server-only | Stripe Edge Functions | Stripe Dashboard > Developers > API keys | Billing owner |
| `STRIPE_SUGAR_MEMBER_PRICE_ID` | Server-only | `stripe-sugar-checkout` | Stripe member sugar price (`$8/kg`) | Billing owner |
| `STRIPE_SUGAR_NON_MEMBER_PRICE_ID` | Server-only | `stripe-sugar-checkout` | Stripe public sugar price (`$10/kg`) | Billing owner |
| `STRIPE_SUGAR_PRICE_ID` | Server-only (legacy bridge only) | `stripe-sugar-checkout` fallback | Legacy member sugar price during rollout | Billing owner |
| `STRIPE_STICKS_PRICE_ID` | Server-only | `stripe-sticks-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_STICKS_MEMBER_PRICE_ID` | Server-only | `stripe-sticks-checkout` | Stripe member sticks price config | Billing owner |
| `STRIPE_PLUS_PRICE_ID` | Server-only | `stripe-plus-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_WEBHOOK_SECRET` | Server-only | `stripe-webhook` | Stripe webhook endpoint signing secret | Billing owner |
| `RESEND_API_KEY` | Server-only | `stripe-webhook`, `lead-submission-intake`, `access-invite`, `refund-case-intake`, `refund-case-message-send` | Resend API key | Technical owner |
| `INTERNAL_NOTIFICATION_FROM_EMAIL` | Server-only | `stripe-webhook`, `lead-submission-intake`, `access-invite`, `refund-case-intake`, `refund-case-message-send` | Verified sender in Resend | Technical owner |
| `INTERNAL_NOTIFICATION_RECIPIENTS` | Server-only | `stripe-webhook`, `lead-submission-intake` | Additional internal recipient list; Ethan/Ian are always included by the email helper | Release owner |
| `WECOM_CORP_ID` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_AGENT_ID` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_AGENT_SECRET` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom app settings | Technical owner |
| `WECOM_ALERT_TO_USERIDS` | Server-only | `lead-submission-intake`, `stripe-webhook`, `support-request-intake` | WeCom recipient user IDs (comma-separated) | Release owner |
| `SUPABASE_URL` | Server-only | Stripe/order/support Edge Functions, `refund-adjustment-sync`, `refund-case-intake`, `refund-case-admin-update`, `refund-case-message-send`, `refund-case-automation-sweep`, `nayax-transaction-lookup`, `nayax-card-refund` | Supabase project URL | Technical owner |
| `SUPABASE_ANON_KEY` | Server-only | `stripe-sugar-checkout`, `stripe-plus-checkout`, `stripe-customer-portal` | Supabase project anon key | Technical owner |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | `stripe-webhook`, `stripe-sugar-checkout`, `lead-submission-intake`, `support-request-intake`, `access-invite`, `refund-adjustment-sync`, `refund-case-intake`, `refund-case-admin-update`, `refund-case-message-send`, `refund-case-automation-sweep`, `nayax-transaction-lookup` | Supabase service role key | Technical owner |
| `PUBLIC_INTAKE_ABUSE_HASH_SALT` | Server-only | `refund-case-intake` | Generated server-only salt | Technical owner |
| `NAYAX_LYNX_BASE_URL` | Server-only | `nayax-transaction-lookup` | `https://lynx.nayax.com/operational/v1` | Technical owner |
| `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` | Server-only | `nayax-transaction-lookup` | Nayax Lynx token for TGPACI USA DB | Technical owner |
| `NAYAX_LYNX_API_TOKEN` | Server-only fallback | `nayax-transaction-lookup` | Fallback Nayax Lynx token only when account-specific token names are not used | Technical owner |
| `NAYAX_LOOKUP_WINDOW_HOURS` | Server-only | `nayax-transaction-lookup`, `refund-case-automation-sweep` | Default `6`; conservative card lookup window around reported incident time | Release owner |
| `REFUND_NAYAX_CANDIDATE_TTL_HOURS` | Server-only | `nayax-transaction-lookup`, `refund-case-automation-sweep` | Default `24`; tokenized evidence review window | Release owner |
| `REFUND_REPLY_TO_EMAIL` | Server-only | Refund customer email functions | Default `info@bloomjoysweets.com`; customer replies during pilot | Release owner |
| `NAYAX_REFUND_EXECUTION_ENABLED` | Server-only | `nayax-card-refund` | Keep `false` until explicit card-refund execution go/no-go | Release owner |
| `NAYAX_REFUND_EXECUTION_DRY_RUN` | Server-only | `nayax-card-refund` | Keep `true` until controlled provider validation | Release owner |
| `NAYAX_REFUND_EXECUTION_KILL_SWITCH` | Server-only | `nayax-card-refund` | Keep `true` except during approved execution pilot | Release owner |
| `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` | Server-only | `nayax-card-refund` | Leave unset during shadow-mode setup; set only after sponsor approval for live execution | Release owner |
| `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED` | Server-only | `nayax-card-refund` | Set only after Nayax refund endpoint contract is validated | Technical owner |
| `NAYAX_REFUND_MAX_AMOUNT_CENTS` | Server-only | `nayax-card-refund` | Global per-refund cap for first execution pilot | Release owner |
| `NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS` | Server-only | `nayax-card-refund` | Global daily amount cap for first execution pilot | Release owner |
| `NAYAX_REFUND_DAILY_COUNT_CAP` | Server-only | `nayax-card-refund` | Global daily count cap for first execution pilot | Release owner |
| `NAYAX_REFUND_IDEMPOTENCY_SECRET` | Server-only | `nayax-card-refund` | Generated HMAC secret for execution idempotency | Technical owner |
| `REFUND_AUTOMATION_SWEEP_SECRET` | Server-only | `refund-case-automation-sweep` | Scheduler secret; may match `REPORT_SCHEDULER_SECRET` | Technical owner |
| `REPORT_SCHEDULER_SECRET` | Server-only | `sales-report-scheduler`, `refund-adjustment-sync` | Generated secret stored in function secrets | Technical owner |
| `REPORTING_INGEST_TOKEN` | Server-only + GitHub Actions secret | `sunze-sales-ingest`, Sunze sync workflow | Generated ingest token | Technical owner |
| `REPORTING_ROW_HASH_SALT` | Server-only | `sunze-sales-ingest` | Generated secret stored in function secrets | Technical owner |
| `GOOGLE_REFUNDS_SHEET_ID` | Server-only | `refund-adjustment-sync` | Google Sheet ID for refunds/complaints | Operations owner |
| `GOOGLE_REFUNDS_SHEET_RANGE` | Server-only | `refund-adjustment-sync` | Optional A1 range, default `'Form Responses 1'!A:T` | Technical owner |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Server-only | `refund-adjustment-sync` | Google service account JSON | Technical owner |
| `REFUND_ADJUSTMENT_SYNC_URL` | GitHub Actions secret | Refund sync workflow | Supabase Edge Function URL | Technical owner |
| `REFUND_ADJUSTMENT_SYNC_TOKEN` | GitHub Actions secret | Refund sync workflow | Same scheduler token value, never a service-role key | Technical owner |
| `REFUND_ADJUSTMENT_SYNC_ENABLED` | GitHub Actions variable | Refund sync workflow | Set to `true` only after manual dry-run/live validation | Technical owner |
| `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` | GitHub Actions variable | Refund sync workflow | Optional page size, default `50`, max `100` | Technical owner |
| `SUNZE_LOGIN_URL` | GitHub Actions secret | Sunze sync workflow | Sunze service-account login URL | Technical owner |
| `SUNZE_REPORTING_EMAIL` | GitHub Actions secret | Sunze sync workflow | Sunze service-account email | Technical owner |
| `SUNZE_REPORTING_PASSWORD` | GitHub Actions secret | Sunze sync workflow | Sunze service-account password | Technical owner |
| `REPORTING_INGEST_URL` | GitHub Actions secret | Sunze sync workflow | Supabase `sunze-sales-ingest` function URL | Technical owner |

Security rule:
- Never place secrets in `VITE_` variables.
- Leave `BLOOMJOY_ALLOWED_VERCEL_PREVIEW_ORIGINS` unset in production. For temporary preview/UAT invite testing only, set it to comma-separated exact `https://<preview>.vercel.app` origins that should be allowed in invite login links.

## 3) Pre-launch checklist (T-24h)
- [ ] Launch freeze announced (no unrelated merges to `main` during launch window).
- [ ] Branch is synced with latest `main`.
- [ ] Auth launch checklist is prepared and assigned (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] Verification commands pass on launch commit:
  - [ ] `npm ci`
  - [ ] `npm run build`
  - [ ] `npm test --if-present`
  - [ ] `npm run lint --if-present`
- [ ] `npm run db:validate-migrations` passes before any production Supabase migration push.
- [ ] `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds` passes
- [ ] `npm run refunds:validate-release-tooling` passes.
- [ ] `npm run refunds:release:check` confirms that the six Refund Operations functions, required migrations, and `verify_jwt` settings match the approved release manifest.
- [ ] Before deployment, `supabase db push --dry-run` reports exactly the reviewed pending migration set and no unexpected migration. Save the sanitized command result; the Edge Function drift check does not prove remote migration parity.
- [ ] Supabase production backup/snapshot confirmed before applying new migrations.
- [ ] Stripe products/prices verified (`STRIPE_SUGAR_MEMBER_PRICE_ID`, `STRIPE_SUGAR_NON_MEMBER_PRICE_ID`, `STRIPE_STICKS_PRICE_ID`, `STRIPE_STICKS_MEMBER_PRICE_ID`, `STRIPE_PLUS_PRICE_ID`).
- [ ] Domain and HTTPS confirmed for both production frontend hosts:
  - [ ] `https://www.bloomjoyusa.com`
  - [ ] `https://app.bloomjoyusa.com`

## 4) Deploy sequence (launch day)
Use this order exactly.

### Step A: Set/refresh Edge Function secrets and run preflight
Set secrets before applying the refund automation migration train so preflight can fail fast without touching production schema.

Run once per environment or when values rotate:

```bash
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_SUGAR_MEMBER_PRICE_ID=...
supabase secrets set STRIPE_SUGAR_NON_MEMBER_PRICE_ID=...
# Optional migration bridge only:
supabase secrets set STRIPE_SUGAR_PRICE_ID=...
supabase secrets set STRIPE_STICKS_PRICE_ID=...
supabase secrets set STRIPE_STICKS_MEMBER_PRICE_ID=...
supabase secrets set STRIPE_PLUS_PRICE_ID=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
supabase secrets set RESEND_API_KEY=...
supabase secrets set INTERNAL_NOTIFICATION_FROM_EMAIL=...
supabase secrets set INTERNAL_NOTIFICATION_RECIPIENTS=etrifari@bloomjoysweets.com,ian@bloomjoysweets.com
supabase secrets set WECOM_CORP_ID=...
supabase secrets set WECOM_AGENT_ID=...
supabase secrets set WECOM_AGENT_SECRET=...
supabase secrets set WECOM_ALERT_TO_USERIDS=ethan.trifari,ops.manager
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_ANON_KEY=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set REPORT_SCHEDULER_SECRET=...
supabase secrets set REPORTING_INGEST_TOKEN=...
supabase secrets set REPORTING_ROW_HASH_SALT=...
supabase secrets set GOOGLE_REFUNDS_SHEET_ID=...
supabase secrets set GOOGLE_REFUNDS_SHEET_RANGE="'Form Responses 1'!A:T"
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=...
supabase secrets set PUBLIC_INTAKE_ABUSE_HASH_SALT=...
supabase secrets set NAYAX_LYNX_BASE_URL=https://lynx.nayax.com/operational/v1
supabase secrets set NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB=...
# Fallback only if account-specific token names are not used:
supabase secrets set NAYAX_LYNX_API_TOKEN=...
supabase secrets set NAYAX_REFUND_EXECUTION_ENABLED=false
supabase secrets set NAYAX_REFUND_EXECUTION_DRY_RUN=true
supabase secrets set NAYAX_REFUND_EXECUTION_KILL_SWITCH=true
supabase secrets set NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false
supabase secrets set NAYAX_REFUND_MAX_AMOUNT_CENTS=1000
supabase secrets set NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS=5000
supabase secrets set NAYAX_REFUND_DAILY_COUNT_CAP=10
supabase secrets set NAYAX_REFUND_IDEMPOTENCY_SECRET=...
supabase secrets set REFUND_AUTOMATION_SWEEP_SECRET=...
```

Do not set `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` during shadow-mode setup. It stays unset until a separate live card-refund execution pilot is explicitly approved.

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref> --include-refunds
```

Remote preflight validates secret presence by name. Before deploying, separately verify the fail-closed values are set as intended: `NAYAX_REFUND_EXECUTION_ENABLED=false`, `NAYAX_REFUND_EXECUTION_DRY_RUN=true`, `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`, and `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false`.

For Refund Full Automation PR `#432`, use `Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md` as the merge-readiness checklist before moving the PR out of draft.

### Step B: Deploy database migrations
Apply all `supabase/migrations/*.sql` not already applied, oldest to newest.

Recommended:
1) Validate migration SQL against a disposable local database:
   - `npm run db:validate-migrations`
2) Link Supabase project:
   - `supabase link --project-ref <project-ref>`
3) Preview pending migration history:
   - `supabase db push --dry-run`
4) Push migrations:
   - `supabase db push`
5) If a migration adds or replaces frontend-facing RPCs, confirm PostgREST schema visibility:
   - Changed RPCs do not return `404` or `PGRST202`.
   - Admin/reporting examples: `admin_get_account_summaries`, `admin_set_user_machine_reporting_access`, and `admin_get_partnership_reporting_setup`.

Validation note:
- `supabase db push --dry-run` checks migration history and lists what would be pushed to the linked project, but it does not execute the SQL. Use `npm run db:validate-migrations` first because it actually applies repo migrations to disposable local Postgres and catches SQL parse/apply errors without production data or secrets.

Migration repair rule:
- Do not edit an already-applied migration and expect production to replay it.
- If production is missing schema from an already-applied migration, add a later forward-only, idempotent repair migration and include `select pg_notify('pgrst', 'reload schema');`.

WeCom note:
- If token auth succeeds but live sends fail with `60020: not allow to access from your ip`, the remaining issue is WeCom-side network/IP policy, not the secret values. Fix the app/network restriction in WeCom admin, then re-run a live smoke order.

Refund source note:
- Enable Google Sheets API for the service account project, share the refund source sheet with the service account email as Viewer, and keep `GOOGLE_SERVICE_ACCOUNT_JSON` only in Supabase function secrets.
- Add GitHub secrets `REFUND_ADJUSTMENT_SYNC_URL` and `REFUND_ADJUSTMENT_SYNC_TOKEN`. The token should match `REPORT_SCHEDULER_SECRET`; do not use the Supabase service-role key. Manual runs fail fast if they are missing. Scheduled runs skip until the repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true`.

### Step C: Deploy Supabase Edge Functions
Deploy all current checkout, submission, invite, and reporting functions:

Before deploying reporting functions, confirm Step B has completed and `supabase db push --dry-run` reports the remote database is up to date. Reporting exports may depend on newly added snapshot columns or indexes.

After applying the reviewed migrations, rerun `supabase db push --dry-run` and require zero pending migrations before deploying dependent Refund Operations functions.

Before deploying Refund Operations functions, run `npm run refunds:release:check`. Deploy only the six explicitly listed refund functions from the reviewed release worktree. Keep Nayax execution fail-closed and keep `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` unset unless issue `#430` contains the explicit sponsor approval.

```bash
supabase functions deploy stripe-sugar-checkout --no-verify-jwt
supabase functions deploy stripe-sticks-checkout --no-verify-jwt
supabase functions deploy stripe-plus-checkout --no-verify-jwt
supabase functions deploy stripe-customer-portal --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy lead-submission-intake --no-verify-jwt
supabase functions deploy custom-sticks-artwork-upload --no-verify-jwt
supabase functions deploy custom-sticks-artwork-link --no-verify-jwt
supabase functions deploy support-request-intake --no-verify-jwt
supabase functions deploy access-invite --no-verify-jwt
supabase functions deploy sales-report-export --no-verify-jwt
supabase functions deploy partner-report-export --no-verify-jwt
supabase functions deploy sales-report-scheduler --no-verify-jwt
supabase functions deploy sunze-sales-ingest --no-verify-jwt
supabase functions deploy sunze-sales-sync --no-verify-jwt
supabase functions deploy refund-adjustment-sync --no-verify-jwt
supabase functions deploy refund-case-intake --no-verify-jwt
supabase functions deploy nayax-transaction-lookup --no-verify-jwt
supabase functions deploy refund-case-admin-update --no-verify-jwt
supabase functions deploy refund-case-message-send --no-verify-jwt
supabase functions deploy refund-case-automation-sweep --no-verify-jwt
supabase functions deploy nayax-card-refund --no-verify-jwt
```

After deploying the six Refund Operations functions:

1. Capture only the sanitized production metadata under the gitignored `output/` directory. Capture downloads each deployed source bundle to an operating-system temporary directory, verifies its normalized transitive source digest against the reviewed manifest, and removes the temporary copy before succeeding:
   - `npm run refunds:release:capture-production -- --project-ref <project-ref> --confirm-project-ref <project-ref> --output output/refund-production-release.json`
2. Review each function's `ACTIVE` status, version, `verify_jwt`, bundle digest, and approved source digest.
3. Update `scripts/refunds/refund-production-release.json` through a reviewed PR. Do not treat the capture as automatic approval.
4. Run `npm run refunds:release:check-production -- --project-ref <project-ref>` and require all six functions to pass.
5. Run the refund production smoke rows in `Docs/QA_SMOKE_TEST_CHECKLIST.md` using sanitized evidence only.

Supabase function version numbers are audit evidence, not rollback targets. A rollback redeploy creates a new version number.
The manifest's `sourceGitCommit` is checked against every function's transitive source. `preDeploymentProduction` records the exact live baseline, including missing functions. `approvedRestoreSource` is a separately validated, immutable six-function source set chosen for restoration because the old live baseline is incomplete.

Refund sync validation:
- First run the `Refund Adjustment Sync` workflow manually with `dry_run=true`. The workflow should print aggregate counts only.
- Then run it manually with `dry_run=false` and confirm `/admin/reporting` shows the completed refund import run plus any review-only rows.
- Set the GitHub repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after the manual live run is validated.
- If the source sheet has hundreds of rows, keep the default paged sync or set `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` no higher than `100` so each Edge Function request stays below timeout limits.

### Step D: Configure Stripe webhook endpoint
Stripe endpoint URL:
- `https://<project-ref>.functions.supabase.co/stripe-webhook`

Required events:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

After endpoint creation/update, copy new signing secret to `STRIPE_WEBHOOK_SECRET`.

### Step E: Deploy frontend SPA
Deploy current launch commit to your chosen host (Vercel/Netlify/etc.) with:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Production host expectations:
  - `www.bloomjoyusa.com` serves marketing/storefront routes
  - `app.bloomjoyusa.com` serves operator login, reset-password, portal, and admin routes
  - host redirects are active so `www` forwards app-only paths to `app`, and `app` forwards public routes back to `www`

## 5) Launch verification checklist (T+0)
Run immediately after deploy:
- [ ] Public routes load (`/`, `/machines`, `/supplies`, `/plus`, `/resources`, `/contact`).
- [ ] `https://www.bloomjoyusa.com/login` and `https://www.bloomjoyusa.com/portal` redirect to `https://app.bloomjoyusa.com/...`
- [ ] `https://app.bloomjoyusa.com/` and public marketing paths on `app` redirect back to `https://www.bloomjoyusa.com/...`
- [ ] Login works, password recovery works, and protected routes redirect correctly on `app.bloomjoyusa.com`.
- [ ] Auth launch sign-off checklist is completed with evidence (`Docs/AUTH_PRODUCTION_SIGNOFF.md`).
- [ ] `Docs/QA_SMOKE_TEST_CHECKLIST.md` core payment/auth checks pass.
- [ ] Admin asset smoke passes: current `/admin`, `/admin/access`, `/admin/reporting`, and `/admin/partnerships` JS chunks return `application/javascript`; a stale or bogus `/assets/*.js` URL returns `404 text/plain` instead of `index.html`; a hard refresh or incognito load reaches the admin app shell.
- [ ] Anonymous/non-member sugar checkout charges `$10/kg` and creates `orders` record in Supabase.
- [ ] Bloomjoy Plus sugar checkout charges `$8/kg` and creates `orders` record in Supabase.
- [ ] Sugar checkout test order stores customer contact, billing/shipping address, pricing tier, receipt URL, and color breakdown in `orders`.
- [ ] Sugar checkout test order sends internal summary email to Ethan/Ian plus any configured additional recipients.
- [ ] Sugar checkout test order sends customer confirmation email with the branded HTML confirmation layout, order summary, and receipt link.
- [ ] Sugar checkout test order sends WeCom alert when `WECOM_*` secrets are configured and the WeCom app/network policy allows traffic from the live function egress IPs.
- [ ] Bloomjoy branded sticks checkout test order (5+ boxes) creates `orders` record in Supabase with size/address/shipping metadata.
- [ ] Bloomjoy branded sticks checkout test order sends internal summary email to Ethan/Ian plus any configured additional recipients.
- [ ] Bloomjoy branded sticks checkout test order sends customer confirmation email with the branded HTML confirmation layout.
- [ ] Under-5 branded-stick procurement request creates a `lead_submissions` record and sends internal procurement email to Ethan/Ian plus any configured additional recipients.
- [ ] Custom-stick procurement request creates a `lead_submissions` record with private artwork metadata and sends internal procurement email to Ethan/Ian plus any configured additional recipients.
- [ ] Plus checkout test subscription creates/updates `subscriptions` record in Supabase.
- [ ] Refund Adjustment Sync manual `dry_run=true` run returns aggregate counts only, with no private customer/payment/free-text values in logs.
- [ ] Refund Adjustment Sync manual `dry_run=false` run creates a completed import run in `/admin/reporting`, applies only approved closed matched refunds, and leaves open/denied/unmatched/ambiguous/invalid rows in review.
- [ ] Quote request on `/contact` sends internal summary email to Ethan/Ian plus any configured additional recipients.
- [ ] Quote/procurement/order/support events send WeCom alerts to configured internal recipients (or log non-blocking warning on dispatch failure).
- [ ] `/admin/orders` shows the fulfillment packet, address, pricing tier, receipt URL, order breakdown, and notification status for the test orders.
- [ ] `/admin/access?tab=users` loads account summaries without a red error state.
- [ ] `/admin/access?tab=reporting-access` can save machine reporting grants with a required reason.
- [ ] `/admin/partnerships` loads setup tabs without missing-RPC errors.
- [ ] Admin/reporting network console does not show `404` or `PGRST202` for `admin_get_account_summaries`, `admin_set_user_machine_reporting_access`, or `admin_get_partnership_reporting_setup`.
- [ ] `/portal/reports` for an entitled test user shows only the machines granted to that user.
- [ ] WeChat onboarding concierge submit on `/portal/support` creates `support_requests.request_type=wechat_onboarding` with populated `intake_meta`.
- [ ] Stripe customer portal opens from `/portal/account`.
- [ ] No critical frontend console errors on key pages.

## 5b) Incident recovery for missed order sync
Use this when a payment succeeded in Stripe but the order is missing in `public.orders`.

Preferred order of operations:
1) Repair and deploy the webhook.
2) Replay the Stripe event to the repaired webhook.
3) If replay is unavailable or insufficient, import the order snapshot manually:
   - `npm run orders:backfill -- --session-id <cs_...> --dry-run`
   - `npm run orders:backfill -- --session-id <cs_...>`
4) Verify the imported order appears in `/admin/orders` with:
   - customer email and phone
   - billing and shipping address
   - pricing tier and unit price
   - sugar color breakdown or Bloomjoy branded stick order details
   - notification status fields

## 6) Rollback checklist
Trigger rollback if critical checkout/auth/data sync regressions are found.

Immediate actions:
- [ ] Declare rollback and pause new release changes.
- [ ] Temporarily disable promotion/checkout CTAs if needed.

Rollback order:
1) Frontend:
   - Re-deploy previous known-good frontend release.
2) Edge Functions:
   - Re-deploy previous known-good function versions for:
     - `stripe-sugar-checkout`
     - `stripe-sticks-checkout`
     - `stripe-plus-checkout`
     - `stripe-customer-portal`
     - `stripe-webhook`
     - `support-request-intake`
     - `access-invite`
     - `refund-case-intake`
     - `nayax-transaction-lookup`
     - `refund-case-admin-update`
     - `refund-case-message-send`
     - `refund-case-automation-sweep`
     - `nayax-card-refund`
   - Restore refund functions from a clean worktree at the `approvedRestoreSource` commit recorded in the refund production release manifest. Use `preDeploymentProduction` only to compare against the exact old live state; do not recreate its missing message endpoint.
   - Reconfirm the four Nayax fail-closed values and the absence of sponsor go/no-go before redeploying.
   - Never delete `refund-case-message-send` as a rollback step. Restore a known-good implementation instead.
3) Secrets:
   - Restore prior secrets only if rotation caused failure.
4) Database:
   - Do not run destructive rollback SQL during incident response.
   - If a migration caused breakage, recover via pre-launch backup/snapshot and controlled restore.

Post-rollback:
- [ ] Confirm site/checkout baseline health.
- [ ] Run `npm run refunds:release:capture-production` and update the approved manifest through review.
- [ ] Confirm all six refund routes respond and `nayax-card-refund` remains fail-closed.
- [ ] Log incident summary and root cause.
- [ ] Create follow-up issue before reattempting launch.

## 7) Dry-run record (staging-like rehearsal)
Date: 2026-02-23
- Scope rehearsed: full command/checklist walkthrough for migration, function deploy, webhook wiring, frontend deploy, and rollback path.
- Verification baseline: local release commands pass (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).
- Outcome: runbook validated for launch use; production credential execution remains owner-controlled.

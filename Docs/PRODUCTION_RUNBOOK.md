# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-08-11

Refund release-state note: production still runs the deployed `#644` baseline. PR `#760` is the current production-readiness candidate, with ten manifest-tracked Refund Operations functions and 41 required refund/Nayax migrations. Its initial release is the safe foundation only: Gmail automation, automatic customer contact, manager reminders, GPT triage, and live Nayax execution stay off; the official-action database gate and production Nayax provider adapter remain statically disabled until their separate reviewed gates pass.

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
| `RESEND_API_KEY` | Server-only | `stripe-webhook`, `lead-submission-intake`, `access-invite`, `refund-case-intake`, `refund-case-message-send`, `refund-case-automation-sweep` | Resend API key | Technical owner |
| `INTERNAL_NOTIFICATION_FROM_EMAIL` | Server-only | `stripe-webhook`, `lead-submission-intake`, `access-invite`, `refund-case-intake`, `refund-case-message-send`, `refund-case-automation-sweep` | Verified sender in Resend | Technical owner |
| `INTERNAL_NOTIFICATION_RECIPIENTS` | Server-only | `stripe-webhook`, `lead-submission-intake`, `refund-case-automation-sweep` | Additional internal recipient list; Ethan/Ian are always included by the email helper | Release owner |
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
| `NAYAX_REFUND_EXECUTOR_ASSERTION` | Server-only | `nayax-card-refund` | Separate generated function identity; only its SHA-256 digest is registered in the database during an approved gate-on change | Technical owner |
| `REFUND_AUTOMATION_SWEEP_SECRET` | Server-only | `refund-case-automation-sweep` | Scheduler secret; may match `REPORT_SCHEDULER_SECRET` | Technical owner |
| `REFUND_AUTOMATION_ENABLED` | Server-only | `refund-case-automation-sweep` | Default `false`; set `true` only after synthetic manual-run and alert proof | Release owner |
| `REFUND_AUTOMATION_TIMEZONE` | Server-only | `refund-case-automation-sweep` | Customer-contact policy timezone; default `America/Los_Angeles` | Release owner |
| `REFUND_AUTOMATION_START_HOUR` | Server-only | `refund-case-automation-sweep` | Local inclusive start hour; default `8` | Release owner |
| `REFUND_AUTOMATION_END_HOUR` | Server-only | `refund-case-automation-sweep` | Local exclusive end hour; default `20` | Release owner |
| `GMAIL_SUPPORT_CLIENT_ID` | Server-only | `refund-gmail-sync`, Gmail reply transport | Google OAuth client ID for the designated support mailbox | Technical owner |
| `GMAIL_SUPPORT_CLIENT_SECRET` | Server-only | `refund-gmail-sync`, Gmail reply transport | Google OAuth client secret | Technical owner |
| `GMAIL_SUPPORT_REFRESH_TOKEN` | Server-only | `refund-gmail-sync`, Gmail reply transport | Refresh token with only Gmail read-only and send grants | Auth owner |
| `GMAIL_SUPPORT_MAILBOX` | Server-only | `refund-gmail-sync`, Gmail reply transport | Exact designated support mailbox address | Operations owner |
| `GMAIL_REFUND_LABEL_ID` | Server-only | `refund-gmail-sync` | Gmail label ID used only for refund intake | Operations owner |
| `GMAIL_REFUND_START_AT` | Server-only, optional | `refund-gmail-sync` | ISO timestamp limiting initial historical import | Operations owner |
| `GMAIL_REFUND_MAX_THREADS_PER_RUN` | Server-only, optional | `refund-gmail-sync` | Default `100`, maximum `500`; bounds one sync run | Technical owner |
| `REFUND_GMAIL_SYNC_SECRET` | Server-only | `refund-gmail-sync` | Dedicated scheduler secret; never a service-role key | Technical owner |
| `REFUND_GMAIL_ENABLED` | Server-only | `refund-gmail-sync` | Default `false`; enable only for approved synthetic/shadow validation | Release owner |
| `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED` | Server-only | Deterministic refund customer transport | Default `false`; requires the database customer-contact gate too | Release owner |
| `REFUND_MANAGER_AGING_NOTICES_ENABLED` | Server-only | `refund-case-automation-sweep` manager-aging lane | Default `false`; independent of other sweep actions | Release owner |
| `REFUND_GMAIL_RETENTION_ENABLED` | Server-only | `refund-gmail-sync` retention-only lane | Default `false`; requires database owner approval and may run with Gmail sync/OAuth off | Privacy/security owner |
| `REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED` | Server-only | Gmail quarantine scanning | Default `false`; requires an approved scanner version | Privacy/security owner |
| `OPENAI_API_KEY` | Server-only | `refund-gpt-triage` | Production project-scoped OpenAI key; never supplied to the browser or GitHub Actions | Technical owner |
| `OPENAI_REFUND_TRIAGE_SAFETY_SALT` | Server-only | `refund-gpt-triage` | Random 32+ character salt for one-way safety identifiers | Privacy/security owner |
| `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED` | Server-only | `refund-gpt-triage` | Default `false`; set `true` only after `#635` records the exact OpenAI project retention mode and privacy/security approval | Privacy/security owner |
| `OPENAI_REFUND_TRIAGE_MODEL` | Server-only, optional | `refund-gpt-triage` | Approved `gpt-5.6-terra` default or explicitly reviewed family variant | Technical owner |
| `REFUND_GPT_TRIAGE_SYNC_SECRET` | Server-only | `refund-gpt-triage` | Dedicated scheduler secret; never the OpenAI or service-role key | Technical owner |
| `REFUND_GPT_TRIAGE_ENABLED` | Server-only | `refund-gpt-triage` | Default `false`; independent Edge kill switch | Release owner |
| `REFUND_GPT_TRIAGE_MAX_JOBS_PER_RUN` | Server-only, optional | `refund-gpt-triage` | Bounded job count from `1` to `10`; default `5` | Technical owner |
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
| `REFUND_AUTOMATION_SWEEP_URL` | GitHub Actions secret | Refund Automation Sweep/Health workflows | Supabase `refund-case-automation-sweep` function URL | Technical owner |
| `REFUND_AUTOMATION_SWEEP_TOKEN` | GitHub Actions secret | Refund Automation Sweep/Health workflows | Same value as `REFUND_AUTOMATION_SWEEP_SECRET`; never a service-role key | Technical owner |
| `REFUND_AUTOMATION_SWEEP_ENABLED` | GitHub Actions variable | Refund Automation Sweep/Health workflows | Default `false`; controls scheduled workflow dispatch only | Release owner |
| `REFUND_GMAIL_SYNC_URL` | GitHub Actions secret | Refund Gmail Sync workflow | Supabase `refund-gmail-sync` function URL | Technical owner |
| `REFUND_GMAIL_SYNC_TOKEN` | GitHub Actions secret | Refund Gmail Sync workflow | Same value as `REFUND_GMAIL_SYNC_SECRET`; never a service-role key | Technical owner |
| `REFUND_GMAIL_SYNC_ENABLED` | GitHub Actions variable | Refund Gmail Sync workflow | Default `false`; controls scheduled workflow dispatch only | Release owner |
| `REFUND_GMAIL_RETENTION_ENABLED` | GitHub Actions variable | Refund Gmail retention workflow | Default `false`; independent retention-only schedule | Privacy/security owner |
| `REFUND_GPT_TRIAGE_SYNC_URL` | GitHub Actions secret | Refund GPT Triage workflow | Supabase `refund-gpt-triage` function URL | Technical owner |
| `REFUND_GPT_TRIAGE_SYNC_TOKEN` | GitHub Actions secret | Refund GPT Triage workflow | Same value as `REFUND_GPT_TRIAGE_SYNC_SECRET`; never an OpenAI or service-role key | Technical owner |
| `REFUND_GPT_TRIAGE_SYNC_ENABLED` | GitHub Actions variable | Refund GPT Triage workflow | Default `false`; controls scheduled dispatch only | Release owner |
| `SUNZE_LOGIN_URL` | GitHub Actions secret | Sunze sync workflow | Sunze service-account login URL | Technical owner |
| `SUNZE_REPORTING_EMAIL` | GitHub Actions secret | Sunze sync workflow | Sunze service-account email | Technical owner |
| `SUNZE_REPORTING_PASSWORD` | GitHub Actions secret | Sunze sync workflow | Sunze service-account password | Technical owner |
| `REPORTING_INGEST_URL` | GitHub Actions secret | Sunze sync workflow | Supabase `sunze-sales-ingest` function URL | Technical owner |

Security rule:
- Never place secrets in `VITE_` variables.
- Leave `BLOOMJOY_ALLOWED_VERCEL_PREVIEW_ORIGINS` unset in production. For temporary preview/UAT invite testing only, set it to comma-separated exact `https://<preview>.vercel.app` origins that should be allowed in invite login links.
- Environment switches alone are insufficient for deterministic customer contact, retention, or GPT. Their database settings must also be explicitly enabled for the same approved window. Official actions have no mutable production toggle in the candidate: `refund_official_actions_enabled()` remains immutable `false` until a later reviewed migration.

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
- [ ] `npm run refunds:validate-gmail` passes, and Gmail-copy retention, visible-CC privacy, and the pilot attachment-off policy are approved in `Docs/REFUND_GMAIL_DATA_HANDLING.md` before Gmail enablement.
- [ ] `npm run refunds:validate-gpt-triage` passes. Confirm the production OpenAI credential is not configured, `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false`, and the GitHub, Edge, and database GPT switches remain false until the approvals and sanitized evaluation in `Docs/REFUND_GPT_TRIAGE.md` pass.
- [ ] If Gmail enablement is approved for this release, `npm run refunds:preflight-gmail -- --project-ref <project-ref>` passes secret-name presence checks without printing values. If Gmail is deferred, record that the OAuth/mailbox secrets are intentionally absent and keep both Gmail switches off; missing optional Gmail credentials do not block the all-switches-off core deployment.
- [ ] Before any automatic refund-email class or mapped-manager CC is enabled, the gates in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md` pass: deterministic template/version review, original-thread Gmail transport, participant classification, visible-recipient privacy review, canonical manager case links, exactly-once first contact, legacy-responder cutover/rollback, hard-bounce hold, and proof that email identities cannot perform a Nayax action.
- [ ] Keep the separate manager-aging lane off until `#685` proves one deterministic manager-only notice at two business days and one escalation at five business days per attention version, current mapped-manager resolution at send time, routing-exception fallback, pause/terminal suppression, exact authenticated case links, and delivery-uncertainty handling.
- [ ] Official refund actions remain hard-off. Before any separate gate-on review, `#689` and `#692` pass integrated UAT for current mapped-manager-only authority, the frozen two-minute per-action intent, exact owner-approved TOTP factor, single-use server proof/receipt, replay and concurrency failure, owner-supervised enrollment/recovery, enrollment-window closure, and no agent/shared-session action. `#430` remains a separate provider gate.
- [ ] `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds` passes
- [ ] `npm run refunds:validate-release-tooling` passes.
- [ ] `npm run refunds:release:check` confirms that the ten candidate Refund Operations functions, required migrations, source commit, and `verify_jwt` settings match the approved release manifest. Do not substitute the separate eight-route `OPTIONS` smoke count for the manifest count.
- [ ] The same fresh `Refund UAT Evidence` run contains exactly 40 reviewed synthetic screenshots and the five sanitized JSON artifacts named below; the final manifest hashes every artifact and binds to the reviewed PR head. Final migration/test-file counts and SHA are generated from that tree, not copied from an earlier branch or written by hand.
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
supabase secrets set NAYAX_REFUND_EXECUTOR_ASSERTION=...
supabase secrets set REFUND_AUTOMATION_SWEEP_SECRET=...
supabase secrets set REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false
supabase secrets set REFUND_MANAGER_AGING_NOTICES_ENABLED=false
supabase secrets set REFUND_GMAIL_ENABLED=false
supabase secrets set REFUND_GMAIL_RETENTION_ENABLED=false
supabase secrets set REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED=false
supabase secrets set REFUND_GPT_TRIAGE_ENABLED=false
```

Do not set `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` during shadow-mode setup. It stays unset until a separate live card-refund execution pilot is explicitly approved. Generate the idempotency secret and executor assertion independently; neither may reuse the Supabase service-role key. Do not register an executor assertion in `refund_nayax_provider_callers` until the vendor contract, QA proof, independent review, and owner-controlled gate-on are complete. The raw assertion belongs only in the Edge Function secret; the database stores its SHA-256 digest.

Gmail and GPT credentials are enablement-time secrets, not prerequisites for the initial all-switches-off core deployment. Do not configure Gmail OAuth/mailbox secrets before the approvals in `#634`, and do not configure the production OpenAI key before the privacy/data-control approval in `#635`. Both functions deploy safely without Gmail or OpenAI credentials and remain inaccessible/disabled until their dedicated scheduler secret and enablement gates are configured.

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref> --include-refunds
# Run only when the Gmail lane is approved/configured:
npm run refunds:preflight-gmail -- --project-ref <project-ref>
```

Remote preflight validates secret presence by name. Before deploying, separately verify the fail-closed values are set as intended: `NAYAX_REFUND_EXECUTION_ENABLED=false`, `NAYAX_REFUND_EXECUTION_DRY_RUN=true`, `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`, and `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false`. These historic safety values do not enable the candidate handler: its production provider adapter remains statically disabled, and the local synthetic adapter is available only through dependency injection in tests.

For the deployed `#644` baseline, use `Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md` as the historical merge, deployment, smoke, rollback, pilot, and sponsor-decision record. Do not apply it unmodified to the unmerged `#409` integration candidate. The candidate requires its own reviewed final manifest/evidence and all open owner/provider/mailbox gates. `Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md` remains historical and must not be used to deploy the candidate.

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

Before deploying Refund Operations functions, run `npm run refunds:release:check`. For the unmerged candidate, deploy only the ten explicitly listed refund functions from the final reviewed release worktree. Keep official actions statically false, keep the production Nayax adapter disabled, and keep `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` unset. Issue `#430` requires a separate implementation/contract review and controlled go/no-go; this candidate cannot be turned live by setting an environment value.

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
supabase functions deploy refund-gmail-sync --no-verify-jwt
supabase functions deploy refund-gpt-triage --no-verify-jwt
supabase functions deploy nayax-card-refund --no-verify-jwt
supabase functions deploy refund-manager-action-step-up --no-verify-jwt
supabase functions deploy refund-manager-totp-enrollment --no-verify-jwt
```

After deploying the ten manifest-tracked Refund Operations functions:

1. Run the no-auth, no-body route smoke. It deliberately probes the eight established application routes only; that probe count is not the ten-function manifest count. It sends only `OPTIONS`, creates no case, sends no email, and makes no Nayax/OpenAI/Gmail provider request:
   - `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
2. Run the aggregate-only public-options smoke. It fails when an internal `Unmapped`/`Unknown` label, duplicate machine/display row, or missing Atlanta/DC/Seattle option remains and never prints machine/location identifiers:
   - `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
3. Run the aggregate-only Nayax mapping smoke. It confirms every active refund-intake machine has one non-duplicate account/machine mapping, one to three active managers, and a location timezone while live execution stays off. The SELECT-only audit prints no identifiers, writes no records, makes no provider call, and does not replace the later transaction-lookup or controlled-execution evidence:
   - `npm run refunds:smoke-nayax-mapping -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
4. Run the refund intake/email smoke in read-only preflight mode for the privately approved synthetic machine. It verifies that the machine is public-intake ready and has an active assigned manager; it creates no case and sends no email:
   - `npm run refunds:smoke-intake-email -- --project-ref <project-ref> --confirm-project-ref <project-ref> --machine-id <approved-uuid>`
5. Only during the approved production-smoke window, set `REFUND_SMOKE_CUSTOMER_EMAIL` and `REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL` to the same owner-controlled test inbox and repeat the command with `--execute-synthetic --synthetic-run-id <new-uuid> --authorize-email-send "SEND SYNTHETIC REFUND EMAILS"`. This creates one retained synthetic case. Customer delivery may occur only when the exact current mapped-manager visible CC route passes; any operations fallback is a separate internal routing-repair notice and never substitutes for CC. Reuse the same run UUID after an uncertain retry; the runner reuses the existing case rather than sending again. The command prints only aggregate safe fields and never prints identities, machine IDs, payment data, or message content.
6. Capture only the sanitized production metadata under the gitignored `output/` directory. Capture downloads each deployed source bundle to an operating-system temporary directory, verifies its normalized transitive source digest against the reviewed manifest, and removes the temporary copy before succeeding:
   - `npm run refunds:release:capture-production -- --project-ref <project-ref> --confirm-project-ref <project-ref> --output output/refund-production-release.json`
7. Review each function's `ACTIVE` status, version, `verify_jwt`, bundle digest, and approved source digest.
8. Update `scripts/refunds/refund-production-release.json` through a reviewed PR. Do not treat the capture as automatic approval.
9. Run `npm run refunds:release:check-production -- --project-ref <project-ref>` and require all ten manifest-tracked functions to pass.
10. Run the remaining refund production smoke rows in `Docs/QA_SMOKE_TEST_CHECKLIST.md` using sanitized evidence only.

Before clean-manager UAT, run the read-only role audit with exact project confirmation. It queries only aggregate counts and refuses unexpected result columns:

```bash
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref>
# After the owner approves a cohort, repeat once per approved machine:
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref> --pilot-machine-id <uuid>
```

The discovery audit passes only when a manager-only identity has at least one shadow-ready assignment. The cohort audit passes only when an identity has no broader access or assignments outside the supplied pilot set and every assigned pilot machine is shadow-ready. Keep identity selection private and post counts only in `#435`.

Supabase function version numbers are audit evidence, not rollback targets. A rollback redeploy creates a new version number.
The manifest's `sourceGitCommit` is checked against every function's transitive source. `preDeploymentProduction` records the exact live baseline, including missing functions. `approvedRestoreSource` validates the immutable known-good source for every existing core function; newly introduced disable-only functions such as `refund-gmail-sync`, `refund-gpt-triage`, `refund-manager-action-step-up`, and `refund-manager-totp-enrollment` record `restoreAction=disable` and use their documented switch-off procedures instead of pretending an older deployed source existed.

Refund sync validation:
- First run the `Refund Adjustment Sync` workflow manually with `dry_run=true`. The workflow should print aggregate counts only.
- Then run it manually with `dry_run=false` and confirm `/admin/reporting` shows the completed refund import run plus any review-only rows.
- Set the GitHub repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after the manual live run is validated.
- If the source sheet has hundreds of rows, keep the default paged sync or set `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` no higher than `100` so each Edge Function request stays below timeout limits.

Refund automation scheduler validation:
- Apply the automation ledger migration, deploy `refund-case-automation-sweep`, and deploy the frontend before configuring either workflow.
- Set `REFUND_AUTOMATION_SWEEP_URL` and `REFUND_AUTOMATION_SWEEP_TOKEN`. Keep GitHub variable `REFUND_AUTOMATION_SWEEP_ENABLED=false`, Edge secret `REFUND_AUTOMATION_ENABLED=false`, and the independent `REFUND_MANAGER_AGING_NOTICES_ENABLED=false` during setup.
- Manually run **Refund Automation Sweep** with `failure_test` and a new synthetic UUID in `run_key`. Confirm the designated operations recipients receive the PII-free test alert and the workflow prints aggregate fields only. Dispatch `failure_test` again with the exact same UUID; require `duplicate_suppressed` and no second alert.
- With approved synthetic/shadow cases only, set Edge secret `REFUND_AUTOMATION_ENABLED=true`, manually run **Refund Automation Sweep** with `run` plus a new synthetic UUID in `run_key` during the configured policy window, and confirm each due action fires once. Dispatch `run` again with the exact same UUID; require `duplicate_suppressed` without another message, state change, or event. GitHub creates a new workflow run for the replay, so the reusable UUID - not `GITHUB_RUN_ID` - is the idempotency proof.
- Manually run **Refund Automation Health** and confirm `/refunds` shows the same healthy/last-success state for an authorized Machine Manager.
- Set GitHub variable `REFUND_AUTOMATION_SWEEP_ENABLED=true` only after those checks pass. The sweep runs at minutes 7/22/37/52; the independent health check runs hourly at minute 43.
- Quick disable without taking down the refund workflow: first set `REFUND_AUTOMATION_SWEEP_ENABLED=false`, then set Edge secret `REFUND_AUTOMATION_ENABLED=false`. Manually dispatch one `run` with a new synthetic UUID in `run_key` to record/confirm `disabled`; verify `/refunds` intake and manager actions still work. Re-enable only after the linked incident is resolved and synthetic proof passes again.
- Manager aging may be enabled only after its separate UAT proves one current-manager reminder at two and one escalation at five Los Angeles business days per attention version, exact navigation-only case links, pause/terminal suppression, send-time route resolution, and no blind retry. With `REFUND_MANAGER_AGING_NOTICES_ENABLED=false`, executable evidence must show zero fetch, claim, reservation, and send calls for that lane.

Refund Gmail intake validation:
- Mailbox evidence observed on 2026-08-03 is limited to the `info@bloomjoysweets.com` connected profile and visible `Refund Operations` label. Before production, separately prove Hub OAuth/secrets, label-filter population, legacy-responder inventory/cutover, and any `support@bloomjoysweets.com` alias/send-as through owner configuration plus Gmail `SENT` evidence. Do not use forwarding into a personal inbox.
- Create an OAuth client for the exact designated support mailbox and grant only `gmail.readonly` and `gmail.send`. Verify each approved Gmail send-as alias in the mailbox owner configuration, and require `SENT`-label evidence before treating alias-origin mail as Bloomjoy outbound. Record any required Google verification or security review before production use.
- Apply the Gmail migrations; deploy `refund-gmail-sync`, the updated refund message/admin functions, and the frontend. Set `REFUND_GMAIL_SYNC_URL` and `REFUND_GMAIL_SYNC_TOKEN`, but keep `REFUND_GMAIL_SYNC_ENABLED=false`, `REFUND_GMAIL_ENABLED=false`, `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false`, database `refund_customer_contact_settings.automatic_customer_contact_enabled=false`, `REFUND_GMAIL_RETENTION_ENABLED=false` at GitHub and Edge, and database `refund_gmail_retention_settings.cleanup_enabled=false` during setup.
- Approve and record the 180-day Gmail-copy retention, visible-CC privacy model, participant classification, first-contact cutover, and attachment-off pilot policy in `Docs/REFUND_GMAIL_DATA_HANDLING.md`. A future attachment-enabled release requires a separately reviewed quarantine and malware-scanning design. Do not enable the schedule while any approval is pending.
- Run the workflow manually with `failure_test` while real Gmail access remains disabled; confirm central-admin health shows a safe failure signal and the workflow output contains aggregate fields only.
- With synthetic messages only, set `REFUND_GMAIL_ENABLED=true` and manually run the workflow. An explicitly labeled test email must create one draft visible to a Super Admin or Scoped Admin, but not to a location-only Machine Manager. Re-running the same delivery must not create a second case, message, or event.
- Reply to the test thread and run sync again. The reply must append chronologically to the same case. A manager-approved or approved deterministic response must appear in that original Gmail thread exactly once and must not start a parallel Resend conversation.
- Prove with one, two, and three synthetic current managers that every manual and automatic customer-facing refund message has the exact case customer as sole To and each current active mapped manager once in visible CC. Change a mapping between preview and send and confirm send-time re-resolution. Unresolved machines, zero-manager routes, invalid/over-cap mappings, and empty safe recipient sets must block Gmail and transactional customer delivery before any provider call; the redacted internal operations notice is the routing-repair path and can never substitute for the required customer-message CC.
- Prove a manager Reply All remains manager correspondence, the customer sees no internal portal link, and the separate action-needed/aging/exception manager notice opens the canonical `/refunds?case=<case-id>` route without changing case state. Completion must use one customer-facing message with managers CC and no duplicate manager-only completion notice.
- With the legacy responder still authoritative, run Hub first-contact in no-send "would send" mode. Any active-send proof must use an isolated synthetic mailbox/label excluded from the legacy responder. Cut over atomically by disabling/verifying the legacy sender before enabling the Hub sender; rollback disables Hub before restoring legacy so the two never overlap for the same thread population.
- Keep both production switches false during local/staging/isolated-lane UAT. After policy and recipient approvals pass, a bounded owner-approved production synthetic window may set only `REFUND_GMAIL_ENABLED=true` for a manual test while the scheduled `REFUND_GMAIL_SYNC_ENABLED` switch stays false, then reset the Edge switch before go/no-go.
- Force an authenticated synthetic permanent hard bounce for the exact case customer and confirm contact pauses case-wide, including a newer linked thread, while the mapped manager receives a safe exception with the exact case link. Recovery must be an authenticated manager action that verifies the exact customer address and clears all linked pauses atomically; service, scheduler, ingest, replay, newest-only, and partial-clear attempts remain blocked.
- Confirm unrelated and unlabeled messages remain untouched, including label, archive, deletion, and read state. Confirm an incoming Luhn-valid test card number is stored/displayed only as redacted last four and does not appear in logs or workflow output.
- Confirm the pilot is attachment-free: the public form renders no file control, hosted intake rejects every non-empty attachment payload, and Gmail ingestion stores no attachment metadata or bytes. Do not enable quarantine or downloads until a separate scanner, retention, and privacy review is approved.
- Revoke the test refresh token. Gmail health must show authorization failure while hosted-form cases, queue access, and manual non-Gmail replies continue to work. Reauthorize before any scheduled pilot.
- Prove crash-safe retention with synthetic data: reserve a tokenized database upload intent before Storage; accept only the exact private bucket/canonical UUID path; settle deletion before metadata purge; hold corrupt, noncanonical, failed, or unknown objects for manual review; and still purge unrelated eligible storage-free content. Then revoke Gmail OAuth and prove the independently approved retention-only run can still clean local copies.
- Enable `REFUND_GMAIL_SYNC_ENABLED=true` only after every check above passes. Quick disable order is the GitHub variable first and Edge secret second; this must not disable form intake, existing case handling, or independently approved retention cleanup. Automatic customer contact remains behind its separate Edge and database gates.

Refund GPT triage validation:
- Apply both GPT triage migrations and deploy `refund-gpt-triage`, the updated refund message function, and the frontend while `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, `REFUND_GPT_TRIAGE_ENABLED=false`, and `refund_gpt_triage_settings.enabled=false`.
- Configure the production OpenAI key only as a Supabase server secret after `#635` approves that destination. The same issue must record the exact OpenAI project data-control mode and privacy/security approval; `store=false` prevents response application-state storage but does not by itself eliminate the provider's default abuse-monitoring retention. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists. Do not copy the local developer `.env.local` into GitHub Actions or a tracked file. Run `npm run refunds:preflight-gpt-triage -- --project-ref <project-ref>` to verify required secret names without printing values.
- Run `npm run refunds:validate-gpt-triage`, the full migration test suite, and Refund portal UAT. The provider suite is mocked and proves `store=false`, strict schema, no tools, key exclusion from request bodies, and fail-closed refusal/HTTP/timeout/schema/configuration paths without incurring an API call.
- Manually dispatch `failure_test` while the acknowledgement and Edge switch remain false and confirm aggregate-only failure output. Then, only with approved sanitized content and a recorded OpenAI project retention decision, set `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=true` plus the Edge and database switches true for a bounded manual evaluation. Confirm one latest-message job, no automatic retry, stale-suggestion superseding, editable manager review, rejection sends nothing, and policy-sensitive input exposes no GPT draft or send action.
- During the human-reviewed pilot, require the thresholds in `Docs/REFUND_GPT_TRIAGE.md`, retain reviewer outcomes, and stop immediately on any unsafe draft. Automatic sending remains structurally prohibited by the database.
- Quick disable: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`, and reset `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` when the approval window ends. Verify Gmail/form-created cases and deterministic missing-information replies still work; preserve job/audit rows and allow the bounded content purges to continue.

Refund provider candidate validation:
- Keep `refund_official_actions_enabled()` immutable `false` and the production provider adapter statically disabled. The success/rejected/timeout/unknown adapters are dependency-injected local test dependencies only; no request body, browser value, or environment variable may select them in the production handler.
- Local/CI tests must prove manager/TOTP authorization and one high-entropy server-only provider claim are consumed atomically for one attempt. The browser, logs, screenshots, JSON evidence, issues, and PRs contain neither the raw claim nor provider/customer identifiers.
- Confirmed synthetic success must atomically commit provider outcome, case completion, and reporting before the DB-owned `refund_nayax_completion_v2` message can be claimed in the original Gmail thread. The receipt states the exact amount, masked card destination when available, action date, and the up-to-4-business-day card timeline. The full current manager set is visibly CC'd and no separate manager completion email is created.
- Synthetic rejected, timeout, and unknown outcomes leave the case open and produce no customer success, fallback notice, manager completion, or blind provider retry. Replay after any terminal outcome produces zero new provider calls; timeout/unknown creates reconciliation work.
- `refund-case-admin-update` must reject eligible-card completion or approved/completed success mail outside this provider settlement. More-info/non-success status remains human-reviewed; denial mail follows only a durably valid official denial; cash/Zelle uses its separate evidence-gated completion.
- Live account contract, credentials, amount units, caps, allowlist, response/status semantics, provider identifiers, idempotency, reconciliation, controlled smoke, and gate-on review remain deferred to `#430`. Passing synthetic UAT does not authorize a live call.

Integrated Refund UAT evidence:
- In one fresh workflow run, generate exactly 40 reviewed synthetic screenshots and exactly five sanitized JSON artifacts: `refund-portal-assertions.json`, `refund-database-counts.json`, `refund-gmail-mime-roles.json`, `refund-kill-switches.json`, and `refund-provider-outcomes.json`.
- The finalizer rejects stale, missing, extra, malformed, duplicate-image, PII-bearing, UUID/provider-ID-bearing, URL-bearing, or free-text-bearing artifacts. The database producer derives exact migration and test-file counts from the final tree; do not write those counts or the final release SHA by hand.
- The portal evidence must prove zero side effects from exact links, filter/queue navigation, and initial render; exactly one lookup after **Check Nayax transaction**; and no admin-update or message shortcut on provider success. The provider JSON must prove one success, rejection, timeout, and unknown attempt with zero provider attempts on replay.

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
     - `refund-gmail-sync`
     - `refund-gpt-triage`
     - `nayax-card-refund`
     - `refund-manager-action-step-up`
     - `refund-manager-totp-enrollment`
   - Restore refund functions from a clean worktree at the `approvedRestoreSource` commit recorded in the refund production release manifest. Use `preDeploymentProduction` only to compare against the exact old live state; do not recreate its missing message endpoint.
   - Reconfirm the four Nayax fail-closed values and the absence of sponsor go/no-go before redeploying.
   - Never delete `refund-case-message-send` as a rollback step. Restore a known-good implementation instead.
3) Secrets:
   - Restore prior secrets only if rotation caused failure.
4) Database:
   - Do not run destructive rollback SQL during incident response.
   - If a migration caused breakage, recover via pre-launch backup/snapshot and controlled restore.

Gmail-only rollback: set `REFUND_GMAIL_SYNC_ENABLED=false`, then `REFUND_GMAIL_ENABLED=false`, and revoke the Gmail refresh token if compromise is suspected. Do not delete Gmail linkage tables during an incident. Verify hosted-form refund intake and non-Gmail case work remain available.

Automatic-contact-only rollback: set `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false`, then set `refund_customer_contact_settings.automatic_customer_contact_enabled=false`. This leaves manual review and the independently controlled Gmail/retention lanes available.

Manager-aging-only rollback: set `REFUND_MANAGER_AGING_NOTICES_ENABLED=false`. If the whole scheduler must stop, also disable `REFUND_AUTOMATION_SWEEP_ENABLED` and `REFUND_AUTOMATION_ENABLED`. A disabled-lane proof must show zero fetch, claim, reservation, and send calls.

Gmail-retention-only rollback: set the GitHub and Edge `REFUND_GMAIL_RETENTION_ENABLED=false`, then set `refund_gmail_retention_settings.cleanup_enabled=false`. Do not disable approved retention merely because Gmail OAuth is revoked; revocation is an expected condition under which local cleanup must remain available.

GPT-only rollback: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`. The legacy restore source disables the newly introduced function rather than inventing an older deployment. Do not delete job/review/audit rows; verify the deterministic missing-information reply remains available.

Post-rollback:
- [ ] Confirm site/checkout baseline health.
- [ ] Run `npm run refunds:release:capture-production` and update the approved manifest through review.
- [ ] Confirm the ten manifest-tracked functions match the reviewed restore/disable plan, the separate eight no-auth route probes return their exact safe statuses, official actions remain statically false, and both `refund-gpt-triage` and `nayax-card-refund` remain fail-closed.
- [ ] Log incident summary and root cause.
- [ ] Create follow-up issue before reattempting launch.

## 7) Dry-run record (staging-like rehearsal)
Date: 2026-02-23
- Scope rehearsed: full command/checklist walkthrough for migration, function deploy, webhook wiring, frontend deploy, and rollback path.
- Verification baseline: local release commands pass (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).
- Outcome: runbook validated for launch use; production credential execution remains owner-controlled.

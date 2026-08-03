# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-08-06

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
| `MICRO_CHECKOUT_ENABLED` | Server-only | `stripe-sugar-checkout` | Exact `true` only after `#717`; absent/false keeps Micro fail-closed | Release owner |
| `STRIPE_MICRO_PRICE_ID` | Server-only, conditional | `stripe-sugar-checkout`, `stripe-webhook` | Required only when Micro checkout is enabled | Billing owner |
| `STRIPE_MICRO_SHIPPING_RATE_ID` | Server-only, conditional | `stripe-sugar-checkout` | Required only when Micro checkout is enabled | Billing owner |
| `STRIPE_PLUS_PRICE_ID` | Server-only | `stripe-plus-checkout` | Stripe product/price config | Billing owner |
| `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` | Server-only | `stripe-customer-portal` | Active Stripe portal configuration with payment-method updates, invoice history, and `at_period_end` cancellation/renewal | Billing owner |
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
- [ ] `npm run refunds:validate-gmail` passes, and Gmail retention/quarantine approval is recorded in `Docs/REFUND_GMAIL_DATA_HANDLING.md` before Gmail enablement.
- [ ] `npm run refunds:validate-gpt-triage` passes. Confirm the production OpenAI credential is not configured, `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false`, and the GitHub, Edge, and database GPT switches remain false until the approvals and sanitized evaluation in `Docs/REFUND_GPT_TRIAGE.md` pass.
- [ ] If Gmail enablement is approved for this release, `npm run refunds:preflight-gmail -- --project-ref <project-ref>` passes secret-name presence checks without printing values. If Gmail is deferred, record that the OAuth/mailbox secrets are intentionally absent and keep both Gmail switches off; missing optional Gmail credentials do not block the all-switches-off core deployment.
- [ ] `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds` passes
- [ ] If Micro is approved later, rerun commerce preflight with `--micro-enabled` so remote secret-name validation requires the server switch plus both Micro IDs.
- [ ] `npm run refunds:validate-release-tooling` passes.
- [ ] `npm run refunds:release:check` confirms local source, migration, and `verify_jwt` alignment with the approved Refund Operations release manifest.
- [ ] `npm run refunds:release:check-production -- --project-ref <project-ref>` confirms all eight deployed Refund Operations functions match the approved production metadata.
- [ ] If the standard production drift check is red only because the pinned QR/wallet source requires the pending schema, use the reviewed pre-migration bridge below. No other drift may use this exception.
- [ ] Before deployment, `supabase db push --dry-run` reports exactly the reviewed pending migration set and no unexpected migration. Save the sanitized command result; the Edge Function drift check does not prove remote migration parity.
- [ ] Supabase production backup/snapshot confirmed before applying new migrations.
- [ ] Stripe products/prices and the active Plus portal configuration are verified (`STRIPE_SUGAR_MEMBER_PRICE_ID`, `STRIPE_SUGAR_NON_MEMBER_PRICE_ID`, `STRIPE_STICKS_PRICE_ID`, `STRIPE_STICKS_MEMBER_PRICE_ID`, `STRIPE_PLUS_PRICE_ID`, `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`). The portal must enable payment-method updates and invoice history, and use `subscription_cancel.mode=at_period_end` so a scheduled cancellation can be renewed before access ends.
- [ ] `MICRO_CHECKOUT_ENABLED` is absent and `VITE_MICRO_CHECKOUT_ENABLED=false` while `#717` is deferred. If Micro is approved later, verify both Micro IDs before setting either gate to `true`.
- [ ] Complete the remaining California deployment gate in `Docs/SALES_TAX_OPERATIONS.md`: live collection was owner-approved and activated on 2026-08-08, and the three reviewed checkout creators were deployed. Sanitized no-payment evidence confirms California Sugar exemption, positive California branded-sticks tax, and no collection for a no-registration destination. Require every remaining unpaid diagnostic Checkout Session to expire before launch and record the final zero-open-session evidence in `#718`. Shipping and the final Bloomjoy Plus code remain documented working positions.
- [ ] A non-production Stripe webhook/backend has passed paid, unpaid, canceled, replayed/concurrent, notification-retry, and synthetic delayed-payment UAT for the checkout paths in this release.
- [ ] Domain and HTTPS confirmed for both production frontend hosts:
  - [ ] `https://www.bloomjoyusa.com`
  - [ ] `https://app.bloomjoyusa.com`

## 4) Deploy sequence (launch day)
Use this order exactly.

### Step A: Set/refresh Edge Function secrets and run preflight
Set secrets before applying the refund automation migration train so preflight can fail fast without touching production schema.

For the `#629/#716` bridge, do not execute any mutating Step A command until bridge steps 1-4 below have passed, including compatibility, backup, and the exact dry run. Then execute the required fail-closed writes in bridge step 5 before applying migrations. Secret-name inspection and other read-only preflight may run earlier.

Run once per environment or when values rotate:

```bash
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_SUGAR_MEMBER_PRICE_ID=...
supabase secrets set STRIPE_SUGAR_NON_MEMBER_PRICE_ID=...
# Optional migration bridge only:
supabase secrets set STRIPE_SUGAR_PRICE_ID=...
supabase secrets set STRIPE_STICKS_PRICE_ID=...
supabase secrets set STRIPE_STICKS_MEMBER_PRICE_ID=...
# Keep MICRO_CHECKOUT_ENABLED absent while #717 is deferred. When approved later:
# supabase secrets set MICRO_CHECKOUT_ENABLED=true STRIPE_MICRO_PRICE_ID=... STRIPE_MICRO_SHIPPING_RATE_ID=...
supabase secrets set STRIPE_PLUS_PRICE_ID=...
supabase secrets set STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=...
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
supabase secrets set REFUND_AUTOMATION_ENABLED=false
supabase secrets set REFUND_GMAIL_ENABLED=false
supabase secrets set REFUND_GPT_TRIAGE_ENABLED=false
supabase secrets set OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false
supabase secrets unset NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO MICRO_CHECKOUT_ENABLED --yes

gh variable set REFUND_AUTOMATION_SWEEP_ENABLED --repo ethtri/bloomjoy-hub --body false
gh variable set REFUND_GMAIL_SYNC_ENABLED --repo ethtri/bloomjoy-hub --body false
gh variable set REFUND_GPT_TRIAGE_SYNC_ENABLED --repo ethtri/bloomjoy-hub --body false

supabase db query --linked --output json "update public.refund_gpt_triage_settings set enabled = false, auto_send_enabled = false, human_review_required = true, updated_at = now() where singleton; select count(*) as settings_rows, bool_and(not enabled and not auto_send_enabled and human_review_required) as fail_closed from public.refund_gpt_triage_settings;"
```

Do not set `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` during shadow-mode setup. It stays unset until a separate live card-refund execution pilot is explicitly approved.

Gmail and GPT credentials are enablement-time secrets, not prerequisites for the initial all-switches-off core deployment. Do not configure Gmail OAuth/mailbox secrets before the approvals in `#634`, and do not configure the production OpenAI key before the privacy/data-control approval in `#635`. Both functions deploy safely without provider credentials and remain inaccessible/disabled until their dedicated scheduler secret and enablement gates are configured.

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref> --include-refunds
# Run only when the Gmail lane is approved/configured:
npm run refunds:preflight-gmail -- --project-ref <project-ref>
```

Remote preflight validates secret presence by name. The explicit writes above are required because Supabase does not return secret values. Require the commands to succeed, confirm the GitHub variables read back as exact `false`, require the GPT settings query to report exactly one fail-closed row, and confirm both unset secrets are absent by name. Before deploying, separately verify the four Nayax values were written as `false`, `true`, `true`, and `false`, respectively. Do not print any secret value.

For the current Refund Operations source plus the narrow `#629/#716` bridge, use `Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md` as the authoritative merge, deployment, smoke, rollback, pilot, and sponsor-decision sequence. `Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md` is a historical May 2026 packet and must not be used to deploy the current release.

#### Reviewed pre-migration bridge for #629 / #716

This bridge is limited to the pinned five-migration sequence in `scripts/refunds/refund-production-release.json`. It exists because the reviewed QR/wallet Refund Operations sources require the first three pending migrations, while Supabase applies those migrations together with the two additive commerce migrations. It does not declare production current and does not authorize commerce deployment.

1. Run `npm run refunds:release:check` and require the local manifest check to pass.
2. Run `npm run refunds:release:check-production -- --project-ref <project-ref>`; retain its exact expected 13-row mismatch as sanitized evidence: five approved repository sources are not paired with production, and all eight deployed versions differ from the approved manifest after version-only restarts. There must be no missing, inactive, bundle, JWT, import-map, or other failure. Any different count or failure type invalidates this bridge.
3. Run `npm run refunds:release:check-pre-migration -- --project-ref <project-ref> --confirm-project-ref <project-ref>`. It downloads all eight live sources and passes only when they match the immutable July 22 source baseline, the bundle digests match, versions have not regressed, `verify_jwt=false`, no import map is present, and the exact five migration files match their pinned checksums.
4. Recheck the latest completed physical backup and run `supabase db push --dry-run`. Require exactly the five pinned migrations in manifest order and no other migration.
5. Force and verify every fail-closed value in Step A: Nayax execution, automation schedules and Edge execution, Gmail schedule and Edge execution, GPT schedule, Edge, privacy, and database execution, plus the absent Nayax sponsor and Micro switches. Do not run intake/email smoke or send customer/manager communications during this bridge.
6. Apply the five migrations once with `supabase db push`, then require `supabase db push --dry-run` to report zero pending migrations.
7. Follow the dedicated **#629/#716 bridge override** at the start of Step C. Before any commerce function deployment, deploy the eight Refund Operations functions in its exact order; run only the no-auth route and aggregate public-options health checks; capture verified production metadata; update the manifest production fields; obtain fresh independent review; and run `npm run refunds:release:check-production -- --project-ref <project-ref>` until it passes cleanly.
8. Stop on any ambiguous migration, function, source, switch, or health state. Commerce remains blocked until step 7 is green.

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

#### #629/#716 bridge override

When the reviewed pre-migration bridge is active, this block overrides the normal Step C order. Immediately after Step B reaches zero pending migrations, deploy only these eight Refund Operations functions in this exact order, before any commerce function:

```bash
supabase functions deploy refund-case-intake --no-verify-jwt
supabase functions deploy nayax-transaction-lookup --no-verify-jwt
supabase functions deploy refund-case-admin-update --no-verify-jwt
supabase functions deploy refund-case-message-send --no-verify-jwt
supabase functions deploy refund-case-automation-sweep --no-verify-jwt
supabase functions deploy refund-gmail-sync --no-verify-jwt
supabase functions deploy refund-gpt-triage --no-verify-jwt
supabase functions deploy nayax-card-refund --no-verify-jwt
```

Run only the no-auth route and aggregate public-options health checks at lines below; do not run intake/email, manager, provider, or optional-lane smokes. Capture production metadata, update and independently review the manifest-only change, and require `refunds:release:check-production` to pass. Only then return here and start the commerce cutover order. Do not repeat the eight refund deploys in the general command inventory below.

Commerce cutover order is fail-closed and must precede the frontend merge:
1. Record the current production function versions/commit.
2. Deploy `stripe-sugar-checkout`, `stripe-sticks-checkout`, and `stripe-plus-checkout` first. After all three deployments succeed, record the marker-enforcement UTC timestamp.
3. Run the no-payment tax previews in `Docs/SALES_TAX_OPERATIONS.md` and confirm each new session reports `automatic_tax.enabled=true`. Keep every preview unpaid and retain only sanitized results.
4. Before deploying the stricter webhook, list every open or pending Checkout Session without `checkout_source=bloomjoy_storefront`, including the two unpaid tax-diagnostic sessions created on 2026-08-08 and any session created before the marker-enforcement timestamp. Let unpaid sessions expire, and manually expire one only after confirming no payment is pending; reconcile any paid session through the existing webhook/backfill procedure. Require zero unresolved unmarked sessions.
5. Audit active/trialing Plus subscriptions at the approved Plus Price. Before the stricter webhook is deployed, add `checkout_source=bloomjoy_storefront`, `order_type=plus_subscription`, and the correct `user_id` metadata to every verified existing Bloomjoy Plus subscription. Stop if any subscription cannot be safely matched.
6. Deploy `stripe-checkout-status` and `stripe-webhook`, update the live Stripe event selection, and complete backend smoke checks before merging `main`.

2026-08-08 rollout checkpoint: step 2 is complete. The active production versions are Sugar `34`, sticks `34`, and Plus `33`, with marker enforcement recorded at 17:18:21 UTC. Sugar and sticks passed the post-marker no-payment Automatic Tax checks, including California Sugar exemption, positive California sticks tax, and no collection for sticks sent to a no-registration destination. The Plus preview remains blocked until the reviewed authenticated portal checkout entry is deployed. All diagnostic Checkout Sessions remain unpaid and must expire before step 4 can pass; do not deploy the stricter status/webhook functions yet.

Before deploying reporting functions, confirm Step B has completed and `supabase db push --dry-run` reports the remote database is up to date. Reporting exports may depend on newly added snapshot columns or indexes.

After applying the reviewed migrations, rerun `supabase db push --dry-run` and require zero pending migrations before deploying dependent Refund Operations functions.

Outside the #629/#716 bridge, run both `npm run refunds:release:check` and `npm run refunds:release:check-production -- --project-ref <project-ref>` before deploying Refund Operations functions. Under the bridge, the passing local and compatibility commands plus the exact zero-pending post-push result temporarily replace only the pre-deploy production check; the standard production check must pass immediately after deployment, manifest capture, update, and independent review. Deploy only the eight explicitly listed refund functions from the reviewed release worktree. Keep Nayax execution fail-closed and keep `NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO` unset unless issue `#430` contains the explicit sponsor approval.

```bash
supabase functions deploy stripe-sugar-checkout --no-verify-jwt
supabase functions deploy stripe-sticks-checkout --no-verify-jwt
supabase functions deploy stripe-plus-checkout --no-verify-jwt
supabase functions deploy stripe-customer-portal --no-verify-jwt
supabase functions deploy stripe-checkout-status --no-verify-jwt
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
# Refund Operations: use the dedicated bridge block above for #629/#716.
# Outside that bridge, deploy the same eight functions in the exact order shown there.
```

After deploying the eight Refund Operations functions:

1. Run the no-auth, no-body route smoke. It sends only `OPTIONS`, creates no case, sends no email, and makes no Nayax/OpenAI/Gmail provider request:
   - `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
2. Run the aggregate-only public-options smoke. It fails when the public option count does not equal the active eligible Commercial/Mini portfolio, any portfolio option is missing, an internal `Unmapped`/`Unknown` label or duplicate machine/display row remains, or Atlanta/DC/Seattle is missing. It never prints machine/location identifiers:
   - `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
3. Run the aggregate-only Nayax mapping smoke. It confirms every active refund-intake machine has one non-duplicate account/machine mapping, one to three active managers, and a location timezone while live execution stays off. The SELECT-only audit prints no identifiers, writes no records, makes no provider call, and does not replace the later transaction-lookup or controlled-execution evidence:
   - `npm run refunds:smoke-nayax-mapping -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
4. Run the refund intake/email smoke in read-only preflight mode for the privately approved synthetic machine. It verifies that the machine is public-intake ready and has an active assigned manager; it creates no case and sends no email:
   - `npm run refunds:smoke-intake-email -- --project-ref <project-ref> --confirm-project-ref <project-ref> --machine-id <approved-uuid>`
5. Only during the approved production-smoke window, set `REFUND_SMOKE_CUSTOMER_EMAIL` and `REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL` to the same owner-controlled test inbox and repeat the command with `--execute-synthetic --synthetic-run-id <new-uuid> --authorize-email-send "SEND SYNTHETIC REFUND EMAILS"`. This creates one retained synthetic card case and sends the customer acknowledgement plus assigned-manager/operations-fallback notification. Reuse the same run UUID after an uncertain retry; the runner reuses the existing case rather than sending again. The command prints only case reference, event type, recipient count, and delivery state; it never prints the test inbox, machine ID, customer fields, payment data, or message content.
6. Capture only the sanitized production metadata under the gitignored `output/` directory. Capture downloads each deployed source bundle to an operating-system temporary directory, verifies its normalized transitive source digest against the reviewed manifest, and removes the temporary copy before succeeding:
   - `npm run refunds:release:capture-production -- --project-ref <project-ref> --confirm-project-ref <project-ref> --output output/refund-production-release.json`
7. Review each function's `ACTIVE` status, version, `verify_jwt`, bundle digest, and approved source digest.
8. Update `scripts/refunds/refund-production-release.json` through a reviewed PR. Do not treat the capture as automatic approval.
9. Run `npm run refunds:release:check-production -- --project-ref <project-ref>` and require all eight functions to pass.
10. Run the remaining refund production smoke rows in `Docs/QA_SMOKE_TEST_CHECKLIST.md` using sanitized evidence only.

Before clean-manager UAT, run the read-only role audit with exact project confirmation. It queries only aggregate counts and refuses unexpected result columns:

```bash
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref>
# After the owner approves a cohort, repeat once per approved machine:
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref> --pilot-machine-id <uuid>
```

The discovery audit passes only when a manager-only identity has at least one shadow-ready assignment. The cohort audit passes only when an identity has no broader access or assignments outside the supplied pilot set and every assigned pilot machine is shadow-ready. Keep identity selection private and post counts only in `#435`.

Supabase function version numbers are audit evidence, not rollback targets. A rollback redeploy creates a new version number.
The manifest's `sourceGitCommit` is checked against every function's transitive source. `preDeploymentProduction` records the exact live baseline, including missing functions. `approvedRestoreSource` validates the immutable known-good source for every existing core function; newly introduced disable-only functions such as `refund-gmail-sync` and `refund-gpt-triage` record `restoreAction=disable` and use their documented switch-off procedures instead of pretending an older deployed source existed.

Refund sync validation:
- First run the `Refund Adjustment Sync` workflow manually with `dry_run=true`. The workflow should print aggregate counts only.
- Then run it manually with `dry_run=false` and confirm `/admin/reporting` shows the completed refund import run plus any review-only rows.
- Set the GitHub repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after the manual live run is validated.
- If the source sheet has hundreds of rows, keep the default paged sync or set `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` no higher than `100` so each Edge Function request stays below timeout limits.

Refund automation scheduler validation:
- Apply the automation ledger migration, deploy `refund-case-automation-sweep`, and deploy the frontend before configuring either workflow.
- Set `REFUND_AUTOMATION_SWEEP_URL` and `REFUND_AUTOMATION_SWEEP_TOKEN`. Keep GitHub variable `REFUND_AUTOMATION_SWEEP_ENABLED=false` and Edge secret `REFUND_AUTOMATION_ENABLED=false` during setup.
- Manually run **Refund Automation Sweep** with `failure_test` and a new synthetic UUID in `run_key`. Confirm the designated operations recipients receive the PII-free test alert and the workflow prints aggregate fields only. Dispatch `failure_test` again with the exact same UUID; require `duplicate_suppressed` and no second alert.
- With approved synthetic/shadow cases only, set Edge secret `REFUND_AUTOMATION_ENABLED=true`, manually run **Refund Automation Sweep** with `run` plus a new synthetic UUID in `run_key` during the configured policy window, and confirm each due action fires once. Dispatch `run` again with the exact same UUID; require `duplicate_suppressed` without another message, state change, or event. GitHub creates a new workflow run for the replay, so the reusable UUID—not `GITHUB_RUN_ID`—is the idempotency proof.
- Manually run **Refund Automation Health** and confirm `/refunds` shows the same healthy/last-success state for an authorized Machine Manager.
- Set GitHub variable `REFUND_AUTOMATION_SWEEP_ENABLED=true` only after those checks pass. The sweep runs at minutes 7/22/37/52; the independent health check runs hourly at minute 43.
- Quick disable without taking down the refund workflow: first set `REFUND_AUTOMATION_SWEEP_ENABLED=false`, then set Edge secret `REFUND_AUTOMATION_ENABLED=false`. Manually dispatch one `run` with a new synthetic UUID in `run_key` to record/confirm `disabled`; verify `/refunds` intake and manager actions still work. Re-enable only after the linked incident is resolved and synthetic proof passes again.

Refund Gmail intake validation:
- Create an OAuth client for the exact designated support mailbox and grant only `gmail.readonly` and `gmail.send`. Record any required Google verification or security review before production use.
- Apply the Gmail migration; deploy `refund-gmail-sync`, the updated refund message/admin functions, and the frontend. Set `REFUND_GMAIL_SYNC_URL` and `REFUND_GMAIL_SYNC_TOKEN`, but keep both `REFUND_GMAIL_SYNC_ENABLED=false` and `REFUND_GMAIL_ENABLED=false` during setup.
- Approve and record the 180-day Gmail-copy retention and quarantine-until-malware-cleared behavior in `Docs/REFUND_GMAIL_DATA_HANDLING.md`. Do not enable the schedule while either approval is pending.
- Run the workflow manually with `failure_test` while real Gmail access remains disabled; confirm central-admin health shows a safe failure signal and the workflow output contains aggregate fields only.
- With synthetic messages only, set `REFUND_GMAIL_ENABLED=true` and manually run the workflow. An explicitly labeled test email must create one draft visible to a Super Admin or Scoped Admin, but not to a location-only Machine Manager. Re-running the same delivery must not create a second case, message, or event.
- Reply to the test thread and run sync again. The reply must append chronologically to the same case. A manager-approved response must appear in that original Gmail thread exactly once.
- Confirm unrelated and unlabeled messages remain untouched, including label, archive, deletion, and read state. Confirm an incoming Luhn-valid test card number is stored/displayed only as redacted last four and does not appear in logs or workflow output.
- Send allowed and rejected synthetic attachments. PDF/JPEG/PNG files at or below 5 MB and within the three-file limit must remain private and quarantined; unsupported, oversized, or excess files must be rejected without exposing content or paths.
- Revoke the test refresh token. Gmail health must show authorization failure while hosted-form cases, queue access, and manual non-Gmail replies continue to work. Reauthorize before any scheduled pilot.
- Enable `REFUND_GMAIL_SYNC_ENABLED=true` only after every check above passes. Quick disable order is the GitHub variable first and Edge secret second; this must not disable form intake or existing case handling.

Refund GPT triage validation:
- Apply both GPT triage migrations and deploy `refund-gpt-triage`, the updated refund message function, and the frontend while `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, `REFUND_GPT_TRIAGE_ENABLED=false`, and `refund_gpt_triage_settings.enabled=false`.
- Configure the production OpenAI key only as a Supabase server secret after `#635` approves that destination. The same issue must record the exact OpenAI project data-control mode and privacy/security approval; `store=false` prevents response application-state storage but does not by itself eliminate the provider's default abuse-monitoring retention. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists. Do not copy the local developer `.env.local` into GitHub Actions or a tracked file. Run `npm run refunds:preflight-gpt-triage -- --project-ref <project-ref>` to verify required secret names without printing values.
- Run `npm run refunds:validate-gpt-triage`, the full migration test suite, and Refund portal UAT. The provider suite is mocked and proves `store=false`, strict schema, no tools, key exclusion from request bodies, and fail-closed refusal/HTTP/timeout/schema/configuration paths without incurring an API call.
- Manually dispatch `failure_test` while the acknowledgement and Edge switch remain false and confirm aggregate-only failure output. Then, only with approved sanitized content and a recorded OpenAI project retention decision, set `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=true` plus the Edge and database switches true for a bounded manual evaluation. Confirm one latest-message job, no automatic retry, stale-suggestion superseding, editable manager review, rejection sends nothing, and policy-sensitive input exposes no GPT draft or send action.
- During the human-reviewed pilot, require the thresholds in `Docs/REFUND_GPT_TRIAGE.md`, retain reviewer outcomes, and stop immediately on any unsafe draft. Automatic sending remains structurally prohibited by the database.
- Quick disable: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`, and reset `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` when the approval window ends. Verify Gmail/form-created cases and deterministic missing-information replies still work; preserve job/audit rows and allow the bounded content purges to continue.

### Step D: Configure Stripe webhook endpoint
Stripe endpoint URL:
- `https://<project-ref>.functions.supabase.co/stripe-webhook`

Required events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

After endpoint creation/update, copy new signing secret to `STRIPE_WEBHOOK_SECRET`.

### Step E: Deploy frontend SPA
The connected Vercel project automatically creates a Production deployment when `main` is merged. Do not merge the release PR until the migration, checkout/status/webhook functions, live webhook events, tax approval, private recipient checks, and paid UAT gates above are complete. If the release owner intentionally pauses Vercel production deployment, record that platform change and its restoration plan before merging.

Deploy current launch commit to your chosen host (Vercel/Netlify/etc.) with:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MICRO_CHECKOUT_ENABLED=false` while `#717` is deferred
- Production host expectations:
  - `www.bloomjoyusa.com` serves marketing/storefront routes
  - `app.bloomjoyusa.com` serves operator login, reset-password, portal, and admin routes
  - host redirects are active so `www` forwards app-only paths to `app`, and `app` forwards public routes back to `www`

### Step E1: Recover an early-expired Plus Checkout attempt
Use this forward-only hotfix path when Stripe cleanup expires an unpaid Plus Checkout Session before its original `expires_at`, while `plus_checkout_attempts` still contains the corresponding `ready` retry row. Do not edit or replay `202608080001_plus_checkout_attempts.sql`.

1. Require a reviewed source commit containing exactly the forward migration `202608100001_plus_expired_checkout_recovery.sql`, the matching `stripe-plus-checkout` recovery logic, focused tests, and no unrelated release change.
2. Re-run the physical-backup, secret-name, Stripe zero-open-session, clean-branch, hosted-check, and independent-review gates. The linked migration dry run must show exactly `202608100001_plus_expired_checkout_recovery.sql`; any other pending migration stops the hotfix.
3. Apply that one migration, require a zero-pending follow-up dry run, then deploy only `stripe-plus-checkout` from the reviewed hotfix commit.
4. With an authenticated baseline account whose earlier unpaid diagnostic Session was explicitly expired, select **Start Plus Membership**. Require a fresh open `$100/month` subscription Checkout with Automatic Tax and the `/portal/account` success/cancel returns. A second request must reuse that same fresh open Session.
5. Confirm no payment, PaymentIntent, subscription, order, entitlement, or communication was created. Expire the fresh diagnostic Session through the documented Stripe cleanup procedure and require the final live open Checkout Session count to return to zero.
6. Merge only after the hotfix smoke, normal commerce checks, and all hosted checks pass. Confirm the Vercel deployment is promoted to the production domains; an existing Instant Rollback must not leave the domains pinned to an older frontend.

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
- [ ] Bloomjoy branded sticks checkout test order (1 box) charges the approved business/residential shipping rule and creates one `orders` record.
- [ ] Bloomjoy branded sticks checkout test order sends internal summary email to Ethan/Ian plus any configured additional recipients.
- [ ] Bloomjoy branded sticks checkout test order sends customer confirmation email with the branded HTML confirmation layout.
- [ ] Custom sticks remain visibly unavailable and create no unpaid procurement submission until their payment-first artwork, plate-fee, shipping, tax, and proofing flow is approved.
- [ ] Plus checkout test subscription creates/updates `subscriptions` record in Supabase.
- [ ] Sugar, sticks, and Plus return pages verify their server-marked Checkout Session through `stripe-checkout-status`; unrelated Stripe sessions are rejected.
- [ ] Paid Checkout events with missing/invalid storefront marker, order type, or Price ID create no order or notification.
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
- [ ] Record the exact pre-deployment commerce function versions/commit before cutover; use that immutable source for rollback rather than reconstructing old code from production.

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
   - Restore refund functions from a clean worktree at the `approvedRestoreSource` commit recorded in the refund production release manifest. Use `preDeploymentProduction` only to compare against the exact old live state; do not recreate its missing message endpoint.
   - Reconfirm the four Nayax fail-closed values and the absence of sponsor go/no-go before redeploying.
   - Never delete `refund-case-message-send` as a rollback step. Restore a known-good implementation instead.
   - `stripe-checkout-status` has no pre-release production version. After a frontend rollback, leave the now-unused endpoint deployed unless a separate approved incident procedure explicitly disables or deletes it.
3) Secrets:
   - Restore prior secrets only if rotation caused failure.
4) Database:
   - Do not run destructive rollback SQL during incident response.
   - If a migration caused breakage, recover via pre-launch backup/snapshot and controlled restore.

Gmail-only rollback: set `REFUND_GMAIL_SYNC_ENABLED=false`, then `REFUND_GMAIL_ENABLED=false`, and revoke the Gmail refresh token if compromise is suspected. Do not delete Gmail linkage tables during an incident. Verify hosted-form refund intake and non-Gmail case work remain available.

GPT-only rollback: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`. The legacy restore source disables the newly introduced function rather than inventing an older deployment. Do not delete job/review/audit rows; verify the deterministic missing-information reply remains available.

Post-rollback:
- [ ] Confirm site/checkout baseline health.
- [ ] Run `npm run refunds:release:capture-production` and update the approved manifest through review.
- [ ] Confirm all eight refund routes respond and both `refund-gpt-triage` and `nayax-card-refund` remain fail-closed.
- [ ] Log incident summary and root cause.
- [ ] Create follow-up issue before reattempting launch.

## 7) Dry-run record (staging-like rehearsal)
Date: 2026-02-23
- Scope rehearsed: full command/checklist walkthrough for migration, function deploy, webhook wiring, frontend deploy, and rollback path.
- Verification baseline: local release commands pass (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).
- Outcome: runbook validated for launch use; production credential execution remains owner-controlled.

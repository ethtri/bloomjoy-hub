# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-09-13

## Nayax card-refund operation (current authority)

The product workflow is [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md). The live case
procedure is [REFUND_AGENT_OPERATIONS.md](REFUND_AGENT_OPERATIONS.md), and the
provider request/response details are in
[NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md). Historical
release artifacts do not add steps to the current workflow.

### Normal refund

1. Let the System search Bloomjoy and Nayax before asking the customer for more
   information. Missing mapping, account, timezone, or search coverage is an
   internal defect, not customer work.
2. The System saves the single clear purchase based on the complete evidence.
   When results are ambiguous, a case worker reviews them and saves the exact
   purchase. The triage actor may differ from the assigned Machine Manager or
   Super-admin who approves.
3. The assigned Machine Manager or a Super-admin makes one **Approve refund** or
   **Decline** decision. Approval defaults to the selected transaction's full
   provider total, including tax, and atomically queues one System-owned attempt.
4. The System claims that same frozen attempt, rechecks exact transaction binding
   and duplicate/idempotency state, and performs the frozen execution plan. These
   checks add no second business approval.
5. Confirmed provider success completes the payment and customer update. A
   timeout, unknown result, or error after transport holds that same attempt for
   verification. Evidence may confirm success or leave it held. Exact DTM or
   support proof that no refund occurred may advance the same attempt once under
   the original approval; a provider rejection label alone cannot. There is no
   blind retry or manual card completion. For cash, the Manager sends Zelle first
   and then confirms the completed payment in Bloomjoy.

### Immediate rollback

For a genuine systemic defect, set the kill switch first, then disable execution and preserve the attempt/journal evidence. Do not reverse a committed refund, reporting adjustment, or customer completion. A single uncertain transaction is transaction-scoped work, not a reason to disable an account or unrelated customers.

## 1) Roles and ownership
- Release owner: owns operational configuration and may engage the kill switch; no repeated per-case release decision is required.
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
| `REFUND_CUSTOMER_FROM_EMAIL` | Server-only | refund customer-message paths | Exact verified refund sender `refunds@bloomjoysweets.com`; never falls back to the OAuth login or internal notification sender | Technical owner |
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
| `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` | Server-only | `nayax-transaction-lookup` | Nayax Lynx reporting/lookup token for TGPACI USA DB; never a refund-write fallback | Technical owner |
| `NAYAX_LYNX_API_TOKEN` | Server-only fallback | `nayax-transaction-lookup` | Fallback Nayax Lynx token only when account-specific token names are not used | Technical owner |
| `NAYAX_REFUND_REQUEST_WRITE_TOKEN_<ACCOUNT_KEY>` | Server-only | `nayax-card-refund` | Dedicated account-scoped refund-request credential; never falls back to a reporting token | Technical owner |
| `NAYAX_REFUND_APPROVE_WRITE_TOKEN_<ACCOUNT_KEY>` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Dedicated account-scoped refund-approval credential; never falls back to a reporting token | Technical owner |
| `NAYAX_REFUND_ATTEMPT_QUEUE_ENABLED` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Keep `true` during healthy card-refund operation. When off, the processor leaves exact durable approved attempts queued and resumes them after recovery; it does not erase manager approval. | Release owner |
| `NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Normalized exact account processed by the bounded attempt queue. A different account holds unmatched queued attempts for the correct processor instead of revoking payment authority. | Technical owner |
| `NAYAX_REFUND_MANAGER_CONTRACT_JSON` | Server-only | `nayax-card-refund`, `refund-case-admin-update`, `refund-case-automation-sweep` | Exact schema-v2 Bearer contract with the account-confirmed request/approval response pairs | Technical owner |
| `NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED` | Server-only | `nayax-card-refund` | `true` only after the intended Core/API identity and account contract are independently confirmed | Technical owner |
| `NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED` | Server-only | `nayax-card-refund` | `true` only after readback proves the dedicated approval credential has the intended account scope | Technical owner |
| `NAYAX_LOOKUP_WINDOW_HOURS` | Server-only | `nayax-transaction-lookup`, `refund-case-automation-sweep` | Default `6`; conservative card lookup window around reported incident time | Release owner |
| `REFUND_REPLY_TO_EMAIL` | Server-only | Refund customer email functions | Exact monitored refund address `refunds@bloomjoysweets.com`; customer replies | Release owner |
| `NAYAX_REFUND_EXECUTION_ENABLED` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Preserve `true` for normal qualified operations through compatible deployments; disable only for a demonstrated release incompatibility, incident or rollback | Release owner |
| `NAYAX_REFUND_EXECUTION_DRY_RUN` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Preserve `false` for normal qualified operations through compatible deployments; use `true` only for explicitly isolated validation or a justified incident/release pause | Release owner |
| `NAYAX_REFUND_EXECUTION_KILL_SWITCH` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | `false` during healthy operation; set `true` first for rollback or a systemic stop condition | Release owner |
| `NAYAX_REFUND_IDEMPOTENCY_SECRET` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Generated HMAC secret for execution idempotency | Technical owner |
| `NAYAX_REFUND_EXECUTOR_ASSERTION` | Server-only | `nayax-card-refund`, `refund-case-automation-sweep` | Separate generated function identity; only its SHA-256 digest is registered in the database during an approved gate-on change | Technical owner |
| `REFUND_AUTOMATION_SWEEP_SECRET` | Server-only | `refund-case-automation-sweep` | Dedicated scheduler secret matching GitHub and Vault copies; never a service-role key | Technical owner |
| `REFUND_AUTOMATION_ENABLED` | Server-only | `refund-case-automation-sweep` | Default `false`; set `true` only after synthetic manual-run and alert proof | Release owner |
| `REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED` | Server-only | `refund-case-message-send`, `refund-case-automation-sweep` | Default `true`; incident-only `false` stops manager-message worker claims while preserving queued evidence | Release owner |
| `REFUND_AUTOMATION_TIMEZONE` | Server-only | `refund-case-automation-sweep` | Customer-contact policy timezone; default `America/Los_Angeles` | Release owner |
| `REFUND_AUTOMATION_START_HOUR` | Server-only | `refund-case-automation-sweep` | Local inclusive start hour; default `8` | Release owner |
| `REFUND_AUTOMATION_END_HOUR` | Server-only | `refund-case-automation-sweep` | Local exclusive end hour; default `20` | Release owner |
| `GMAIL_SUPPORT_CLIENT_ID` | Server-only | `refund-gmail-sync`, Gmail reply transport | Google OAuth client ID for the designated support mailbox | Technical owner |
| `GMAIL_SUPPORT_CLIENT_SECRET` | Server-only | `refund-gmail-sync`, Gmail reply transport | Google OAuth client secret | Technical owner |
| `GMAIL_SUPPORT_REFRESH_TOKEN` | Server-only | `refund-gmail-sync`, Gmail reply transport | Refresh token with only Gmail read-only and send grants | Auth owner |
| `GMAIL_SUPPORT_MAILBOX` | Server-only | `refund-gmail-sync`, Gmail reply transport | OAuth login account `info@bloomjoysweets.com`; separate from the public refund sender | Operations owner |
| `GMAIL_REFUND_LABEL_ID` | Server-only | `refund-gmail-sync` | Gmail label ID used only for refund intake | Operations owner |
| `GMAIL_REFUND_START_AT` | Server-only, optional | `refund-gmail-sync` | ISO timestamp limiting initial historical import | Operations owner |
| `GMAIL_REFUND_MAX_THREADS_PER_RUN` | Server-only, optional | `refund-gmail-sync` | Default `100`, maximum `500`; bounds one sync run | Technical owner |
| `REFUND_GMAIL_SYNC_SECRET` | Server-only | `refund-gmail-sync` | Dedicated scheduler secret; never a service-role key | Technical owner |
| `REFUND_GMAIL_SCHEDULER_SECRET` | Server-only | `refund-gmail-sync` independent recovery lane | Separate generated secret matching only the Vault `refund_gmail_scheduler_secret`; never reuse the GitHub token or a service-role key | Technical owner |
| `REFUND_GMAIL_ENABLED` | Server-only | `refund-gmail-sync` | `true` when operational Gmail sync is intended; `false` disables the integration | Release owner |
| `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED` | Server-only | Deterministic refund customer transport | `true` for the systematic acknowledgement and limited clarification/follow-up workflow; the matching database setting must agree | Release owner |
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
| `refund_automation_scheduler_url` / `refund_automation_scheduler_secret` | Supabase Vault | Database refund automation scheduler | Exact sweep function URL and the same dedicated token accepted by `REFUND_AUTOMATION_SWEEP_SECRET`; one secret of each name | Technical owner |
| `REFUND_GMAIL_SYNC_URL` | GitHub Actions secret | Refund Gmail Sync workflow | Supabase `refund-gmail-sync` function URL | Technical owner |
| `REFUND_GMAIL_SYNC_TOKEN` | GitHub Actions secret | Refund Gmail Sync workflow | Same value as `REFUND_GMAIL_SYNC_SECRET`; never a service-role key | Technical owner |
| `REFUND_GMAIL_SYNC_ENABLED` | GitHub Actions variable | Refund Gmail Sync workflow | Default `false`; controls scheduled workflow dispatch only | Release owner |
| `refund_gmail_scheduler_url` / `refund_gmail_scheduler_secret` | Supabase Vault | Database Gmail watchdog | Exact function URL and dedicated recovery token; one secret of each name, readable only by the security-definer watchdog | Technical owner |
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
- Environment switches alone are insufficient for deterministic customer contact, retention, or GPT. Their database settings must also be explicitly enabled under the existing authority. The refund workflow is live; preserve the current enabled state and use the latest #628/#990 decisions and production evidence rather than the historical all-switches-off candidate.

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
- [ ] Run the focused checks in `Docs/QA_SMOKE_TEST_CHECKLIST.md` for the refund
  slice being changed. Verification proves the one-decision workflow, exact
  selected-transaction binding, duplicate/idempotency behavior, customer-message
  delivery, and unknown-result reconciliation without creating extra product
  gates.
- [ ] Preserve normal refund operation during compatible deployments. Pause only
  an affected operation for a demonstrated incident or release incompatibility;
  do not introduce a cap, cohort, observer, customer prerequisite, TOTP ceremony,
  or repeat Manager decision.
- [ ] `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds` passes
- [ ] `npm run refunds:validate-release-tooling` passes.
- [ ] On the final clean release-candidate source commit, run `npm run refunds:release:seal-candidate`, review the diff, and commit only the resulting manifest seal. Do not reseal the manifest on intermediate feature commits.
- [ ] From that manifest-seal commit, `npm run refunds:release:check` confirms that all protected refund functions, required migrations, source commit, and `verify_jwt` settings match the current approved release manifest. Use its function count; do not substitute a historical route-smoke count.
- [ ] Browser evidence covers the changed refund path at desktop and mobile widths
  with synthetic data. Reuse unchanged automated evidence instead of requiring a
  fixed screenshot count or a new ceremony for every release.
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
supabase secrets set REFUND_CUSTOMER_FROM_EMAIL=refunds@bloomjoysweets.com
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
# Initial isolated setup only: do not run these disabled defaults against live
# production. Preserve its existing controls under the current #628/#990 decision.
supabase secrets set NAYAX_REFUND_EXECUTION_ENABLED=false
supabase secrets set NAYAX_REFUND_EXECUTION_DRY_RUN=true
supabase secrets set NAYAX_REFUND_EXECUTION_KILL_SWITCH=true
supabase secrets set NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED=false
supabase secrets set NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED=false
supabase secrets set NAYAX_REFUND_IDEMPOTENCY_SECRET=...
supabase secrets set NAYAX_REFUND_EXECUTOR_ASSERTION=...
supabase secrets set REFUND_AUTOMATION_SWEEP_SECRET=...
# Initial isolated setup only. Preserve production's existing contact, Gmail,
# retention, attachment, and GPT controls; do not reset them during deployment.
supabase secrets set REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false
supabase secrets set REFUND_MANAGER_AGING_NOTICES_ENABLED=false
supabase secrets set REFUND_GMAIL_ENABLED=false
supabase secrets set REFUND_GMAIL_RETENTION_ENABLED=false
supabase secrets set REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED=false
supabase secrets set REFUND_GPT_TRIAGE_ENABLED=false
```

Generate the idempotency secret and executor assertion independently; neither may reuse the Supabase service-role key. Register the executor assertion only after the vendor request/approval contract and dedicated credentials are verified. The raw assertion belongs only in the Edge Function secret; the database stores its SHA-256 digest. The retired sponsor, canary, broad-reopen, and amount-cap secrets do not govern production and should not be configured.

Gmail and GPT credentials were enablement-time secrets rather than prerequisites for the historical all-switches-off core deployment. The production Gmail OAuth/mailbox connection, scheduled intake, and approved automatic customer contact are now live. Preserve their current settings and sending authority; this deployment procedure grants no new email class or recipient scope. The optional GPT lane remains governed separately by `#635` and its existing privacy/data-control authority.

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref> --include-refunds
# Run only when the Gmail lane is approved/configured:
npm run refunds:preflight-gmail -- --project-ref <project-ref>
```

Remote preflight validates secret presence by name, including the active manager contract/confirmation, approval-scope confirmation, and at least one matching `NAYAX_REFUND_REQUEST_WRITE_TOKEN_<ACCOUNT_KEY>` / `NAYAX_REFUND_APPROVE_WRITE_TOKEN_<ACCOUNT_KEY>` pair; it no longer treats the historical controlled-pilot assertion as release readiness. Local preflight additionally parses the schema-v2 contract, requires the exact production endpoint, and applies the adapter's credential-shape and separate/shared-token rules. Before deploying, inspect the effective remote controls against the current #628/#990 decision and preserve the enabled production state. A compatible release must not reset execution, dry-run, kill-switch, manager-contract, or approval-scope settings to their historical disabled defaults. The production adapter exists but cannot reserve or call Nayax while any independent gate is closed; the synthetic adapter is available only through dependency injection in tests.

### Step B: Deploy database migrations
Before applying migrations that expose new action controls, check mixed-version behavior. If an older handler could misinterpret the new action, deploy and independently verify its backward-compatible replacement first while the existing database still withholds that action. Then apply the migrations, deploy the remaining dependent functions, and capture all protected sources. Preserve unrelated operation and existing sending authority throughout this sequence.
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

After applying the reviewed migrations, rerun `supabase db push --dry-run` and require zero pending migrations before deploying dependent refund functions.

For the manager-message outbox slice, apply `20260902002716_refund_manual_message_outbox.sql` before deploying the matching `refund-case-message-send` and `refund-case-automation-sweep` bundles. Keep `REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED=true` for normal operation. Reuse valid unchanged evidence that the immediate request or scheduled sweep settles the same message ID once. If this release changes that behavior or leaves a concrete verification gap, verify it using a Bloomjoy-controlled synthetic message under the existing sending authority; do not use an open customer or a payment-capable synthetic case.

Before deploying refund functions, run `npm run refunds:release:check`.
Deploy only the functions listed in the release manifest from the exact clean,
reviewed canonical-main commit. Use the root-pinned wrapper rather than a raw
`supabase functions deploy` command. Preserve current runtime execution, dry-run,
and kill-switch settings during compatible deployments. A temporary pause must
address a demonstrated release incompatibility or incident. The normal Manager
action uses dedicated server-side Nayax account credentials and the existing
ordinary approval for that exact selected transaction.

The current inventory adds `refund-nayax-outcome-resolve`, which is called by the existing manager reconciliation UI and shares the completion-delivery helpers. Its `additionalFunctionBaselines` entry records the independently downloaded ACTIVE v35 source, canonical entrypoint, bundle, capture time, and exact matching restore commit. The historical `preDeploymentProduction`, `approvedRestoreSource`, and ten-function/51-migration bridge stay unchanged; they are not an eleven-function restore plan. A resolver rollback must use its separately pinned source and full dependency tree only after review against the deployed schema, not the historical ten-function source root. `refund-nayax-inventory-sync` and `refund-adjustment-sync` remain outside this release: the 2026-09-02 read-only audit found both deployed transitive source trees identical to the reviewed current source.

A successful `--all` wrapper run also downloads and checks all eleven deployed source trees and writes `output/refund-production-postdeploy-<exact-head>.json`; a mismatch fails release acceptance after the Auth post-check. A selective `--function` deployment is not release acceptance: run the complete production capture below before smoke or enablement. No capture changes the approved manifest automatically.

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
```

First inspect the no-write plan. It prints only the ordered approved function names:

```bash
npm run refunds:deploy:functions -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --all
```

During the governed production window, with the owner-held short-lived `SUPABASE_AUTH_CONFIG_READ_TOKEN` present only in that private shell, execute the same approved plan:

```bash
npm run refunds:deploy:functions -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --all --execute --authorize "DEPLOY CANONICAL REFUND FUNCTIONS"
```

For an isolated canonical-entrypoint repair, replace `--all` with one or more approved `--function <slug>` values. Never loosen the production capture to accept a function-local entrypoint. Redeploy the exact reviewed `origin/main` source through this wrapper, then rerun the pre-deployment baseline capture and require the canonical `supabase/functions/<slug>/index.ts` identity before continuing.

1. Run the no-auth, no-body route smoke. It deliberately probes the eight established application routes only; that probe count is not the eleven-function manifest count. It sends only `OPTIONS`, creates no case, sends no email, and makes no Nayax/OpenAI/Gmail provider request:
   - `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
2. Run the aggregate-only public-options smoke. It fails when an internal `Unmapped`/`Unknown` label, duplicate machine/display row, or missing Atlanta/DC/Seattle option remains and never prints machine/location identifiers:
   - `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`
3. Run the aggregate-only Nayax mapping smoke. It confirms every active refund-intake machine has one non-duplicate account/machine mapping, one to four active managers, and a location timezone, and that the live-enabled count exactly matches the reviewed pre-launch or activated count. The SELECT-only audit prints no identifiers, writes no records, makes no provider call, and does not replace the later transaction-lookup or controlled-execution evidence:
   - `npm run refunds:smoke-nayax-mapping -- --project-ref <project-ref> --confirm-project-ref <project-ref> --expected-live-count <reviewed-count>`
4. Run the refund intake/email smoke in read-only preflight mode for the privately approved synthetic machine. It verifies that the machine is public-intake ready and has an active assigned manager; it creates no case and sends no email:
   - `npm run refunds:smoke-intake-email -- --project-ref <project-ref> --confirm-project-ref <project-ref> --machine-id <approved-uuid>`
5. Only during the approved production-smoke window, set `REFUND_SMOKE_CUSTOMER_EMAIL` and `REFUND_SMOKE_CONFIRM_CUSTOMER_EMAIL` to the same owner-controlled test inbox and repeat the command with `--execute-synthetic --synthetic-run-id <new-uuid> --authorize-email-send "SEND SYNTHETIC REFUND EMAILS"`. This creates one retained synthetic case. Customer delivery may occur only when the exact current mapped-manager visible CC route passes; any operations fallback is a separate internal routing-repair notice and never substitutes for CC. Reuse the same run UUID after an uncertain retry; the runner reuses the existing case rather than sending again. The command prints only aggregate safe fields and never prints identities, machine IDs, payment data, or message content.
6. Capture only the sanitized production metadata under the gitignored `output/` directory. Capture downloads each deployed source bundle to an operating-system temporary directory, verifies its normalized transitive source digest against the reviewed manifest, and removes the temporary copy before succeeding. The timestamped receipt records the live version counter separately from the version where the bundle was approved. It reduces Supabase's host-specific absolute `entrypoint_path` to the exact canonical `supabase/functions/<slug>/index.ts` identity; raw absolute paths are never retained, and an unsafe or unexpected suffix fails closed:
   - `npm run refunds:release:capture-production -- --project-ref <project-ref> --confirm-project-ref <project-ref> --output output/refund-production-release.json`
7. Review each function's `ACTIVE` status, live version, approved-bundle version, version relation, `verify_jwt`, canonical entrypoint identity, bundle digest, and downloaded source digest.
8. When a receipt reports `new_bundle_candidate`, update `scripts/refunds/refund-production-release.json` through a reviewed PR; capture is not automatic approval. When it reports `same_bundle_later_revision`, preserve the sealed manifest and do not rewrite its historical counter solely to match mutable live metadata.
9. Run `npm run refunds:release:check-production -- --project-ref <project-ref>` and require every manifest-tracked function to pass. This scheduled/manual monitor validates the exact last sealed artifact and its pinned source, then compares that artifact with live production; later `main` commits do not require a reseal or change the comparison baseline. The live counter must not regress below the approved-bundle version, while the bundle digest, source pairing, JWT setting, import-map state, and canonical entrypoint identity remain exact.
10. Run the remaining refund production smoke rows in `Docs/QA_SMOKE_TEST_CHECKLIST.md` using sanitized evidence only.

### Refund release verification

When a release changes refund behavior, run the focused checks in
[QA_SMOKE_TEST_CHECKLIST.md](QA_SMOKE_TEST_CHECKLIST.md), the release manifest
check, and proportionate desktop/mobile UAT with synthetic data. Verify the
one-decision workflow, exact selected-transaction binding, full provider-total
default, Manager override, cash confirmation semantics, customer clarification
limit, duplicate protection, and a same-attempt verification hold for an unknown
result. If exact Nayax or support evidence later proves that no refund occurred,
the System continues that same approved attempt without another Manager decision.

A release document or passing test does not authorize a customer refund,
customer message, production deployment, or configuration change. Existing
authority still applies. No historical pilot, TOTP ceremony, fixed screenshot
count, cohort, cap, or repeat Manager approval is a release prerequisite.

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
- [ ] After the intended GitHub `Production` deployment reports its latest status as `success`, run `npm run refunds:release:verify-portal -- <deployment-id>`. Save the read-only JSON result with the exact `https://app.bloomjoyusa.com/refunds` URL, observation time, full deployment SHA, successful independent main-build run ID, and verified index/Vite-asset SHA-256 values in #1432. The public `/refund-portal-build.json` is an untrusted build claim; the validator requires a successful `CI` push-to-main build artifact for the exact deployment SHA, compares its complete public inventory to the live metadata, then reads the canonical portal index and every manifest-referenced asset. A missing independent build, differing production build, wrong SHA, missing file, redirect, or changed bytes fails. Keep portal attribution open until this succeeds against the deployed canonical host; a GitHub deployment record or local build alone is not live proof. This does not replace the Supabase migration/function checks above.
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

## 5a) Recover a proven-unsent automatic refund status email

Use this only after the refund transactional-fallback release is deployed. The
recovery is deliberately two-step: release one exact failed automation action,
then let the normal scheduler re-evaluate the current case and create a fresh
status message. It does not resend the immutable failed row and does not touch
refund payment execution.

1. Confirm the exact `refund_case_messages.id` is an automatic SLA
   `status_update` failed with `gmail_source_thread_required` and has all of the following:
   `sent_at`, `provider_message_id`, `delivery_transport`,
   `delivery_state_updated_at`, and `manual_delivery_provider_attempted_at` are
   null; no `refund_gmail_messages` row references it. Stop if any provider
   evidence exists or delivery is accepted, deferred, or delivered.
2. As a service-role operator, release only that reviewed message:

   ```sql
   select public.service_release_proven_unsent_refund_status(
     '<exact-refund-case-message-uuid>'::uuid
   );
   ```

   The expected response has `released=true`, `payloadRedacted=true`, and
   `replayed=false` on the first call. Repeating the exact call is a no-op with
   `replayed=true`.
3. Run the normal refund automation workflow once with a new manual run key, or
   wait for its next scheduled run. Current eligibility is checked again. A
   terminal or no-longer-due case is not contacted.
4. Verify a new status message is `sent` with
   `delivery_transport='resend'`, a provider message ID, and the provider
   idempotency key derived from the new message ID. Confirm the original failed
   row remains unchanged and its failed automation action remains in the audit
   history under `recovered-failed-status:<message-id>`.

The message ledger's default `delivery_state='unknown'` is eligible only when
all provider-attempt and delivery-evidence fields above remain null. Never use
this recovery for provider delivery uncertainty (an unknown state with a
provider-attempt timestamp, transport binding, provider ID, Gmail row, or
delivery-state timestamp), a customer completion email, or any case with a
payment/refund attempt. Those paths retain their existing reconciliation
procedures.

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
   - Restore refund functions from a clean worktree at the `approvedRestoreSource` commit recorded in the refund production release manifest. Use `preDeploymentProduction` only to compare against the exact old live state; do not recreate its missing message endpoint.
   - Reconfirm the Nayax execution and kill-switch values before redeploying.
   - Never delete `refund-case-message-send` as a rollback step. Restore a known-good implementation instead.
3) Secrets:
   - Restore prior secrets only if rotation caused failure.
4) Database:
   - Do not run destructive rollback SQL during incident response.
   - If a migration caused breakage, recover via pre-launch backup/snapshot and controlled restore.

Gmail-only rollback: set `REFUND_GMAIL_SYNC_ENABLED=false`, then `REFUND_GMAIL_ENABLED=false`, and revoke the Gmail refresh token if compromise is suspected. Do not delete Gmail linkage tables during an incident. Verify hosted-form refund intake and non-Gmail case work remain available.

Automatic-contact-only rollback: set `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false`, then set `refund_customer_contact_settings.automatic_customer_contact_enabled=false`. This leaves manual review and the independently controlled Gmail/retention lanes available.

Manager-message-outbox-only rollback: set `REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED=false` first. This stops worker claims but preserves queued, claimed, sent, failed, and unknown evidence. Inspect queued/claimed rows and provider/thread evidence before any function rollback. Do not deploy the retired direct-send implementation, delete message rows, clear claims manually, switch transport, or resend an unknown result. Use a reviewed forward-only repair, then re-enable and drain the original message IDs.

Manager-aging-only rollback: set `REFUND_MANAGER_AGING_NOTICES_ENABLED=false`. If the whole scheduler must stop, first call `public.service_set_refund_automation_scheduler_enabled(false)`, then disable `REFUND_AUTOMATION_SWEEP_ENABLED` and `REFUND_AUTOMATION_ENABLED`. A disabled-lane proof must show zero fetch, claim, reservation, and send calls.

Gmail-retention-only rollback: set the GitHub and Edge `REFUND_GMAIL_RETENTION_ENABLED=false`, then set `refund_gmail_retention_settings.cleanup_enabled=false`. Do not disable approved retention merely because Gmail OAuth is revoked; revocation is an expected condition under which local cleanup must remain available.

GPT-only rollback: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`. The legacy restore source disables the newly introduced function rather than inventing an older deployment. Do not delete job/review/audit rows; verify the deterministic missing-information reply remains available.

Post-rollback:
- [ ] Confirm site/checkout baseline health.
- [ ] Run `npm run refunds:release:capture-production` and update the approved manifest through review.
- [ ] Confirm the eleven manifest-tracked functions match the reviewed historical restore/disable plan plus the separately pinned resolver restore source, the separate eight no-auth route probes return their exact safe statuses, official actions remain statically false, and both `refund-gpt-triage` and `nayax-card-refund` remain fail-closed.
- [ ] Log incident summary and root cause.
- [ ] Create follow-up issue before reattempting launch.

## 7) Dry-run record (staging-like rehearsal)
Date: 2026-02-23
- Scope rehearsed: full command/checklist walkthrough for migration, function deploy, webhook wiring, frontend deploy, and rollback path.
- Verification baseline: local release commands pass (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).
- Outcome: runbook validated for launch use; production credential execution remains owner-controlled.

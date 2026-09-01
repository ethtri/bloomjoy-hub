# Production Runbook (Go-Live + Rollback)

Purpose: provide a single launch-day procedure for Bloomjoy Hub production release and rollback.

Last updated: 2026-08-30

## Nayax card-refund operation (current authority)

Bloomjoy is in production. Follow `Docs/REFUND_PRODUCTION_POLICY.md`; do not reintroduce pilot caps, canaries, account-wide holds, or first-proof ceremony.

### Normal refund

1. Search Bloomjoy and Nayax records before asking the customer for more information.
   - If lookup reports missing machine mapping, account scope, or account access, assign it to **Refund Operations**. Confirm the exact reporting machine and location-scoped Nayax account. A separate account must never use the default account credential. Run at most one server-authorized read-only retry for the current fact version; after that use the reviewed manual Nayax portal fallback. Do not ask the customer to repeat the selected machine, location, or purchase facts Bloomjoy already holds.
2. Confirm the exact settled transaction, machine/account, provider time, currency, and full transaction amount. Customer amount, card type, and last four are clues; the selected provider transaction is authoritative.
   - In the manager evidence card, copy the **Selected Nayax transaction ID** into Dynamic Transactions Monitor and use the separately labeled **Provider machine-local time** plus its IANA timezone for the report window. Do not reconstruct the ID from raw data or ask the customer to repeat details Bloomjoy already holds.
3. Run the privacy-safe preflight: active mapped machine and manager; no successful or unresolved attempt on this transaction; exact transaction uniqueness; current case version; idempotency, unique-attempt, unique-provider-stage, journal, and kill-switch controls present.
4. Healthy operation uses execution enabled, dry-run false, kill switch false, the idempotency secret, executor assertion, exact provider contract, and separate account-scoped request/approval credentials. No case allowlist or amount/count cap is required.
5. The mapped manager selects **Refund $X** and confirms once immediately before money moves. One immutable generation permits at most one Nayax request and one approval. Double-click, reload, stale tab, concurrency, and replay cannot create a second send.
6. On confirmed success, require one case completion, reporting adjustment, audit result, and customer completion. On confirmed rejection or authoritative proof that no refund occurred, offer a fresh manager-confirmed generation. On timeout, pending, unknown, or conflict, pause only that transaction and check Nayax before another attempt. Unrelated refunds continue.

### Immediate rollback

For a genuine systemic defect, set the kill switch first, then disable execution and preserve the attempt/journal evidence. Do not reverse a committed refund, reporting adjustment, or customer completion. A single uncertain transaction is transaction-scoped work, not a reason to disable an account or unrelated customers.

## Historical refund manager-session cutover

This section records the earlier held-case migration. It is not current authority for new refunds and must not reintroduce TOTP/operator, non-customer canary, staffing, or repeated-approval ceremony.

1. Confirm hosted Auth ends with TOTP enrollment off and verification on. No manager enrollment window is opened.
2. Apply `20260820150000_refund_nayax_support_resolution_close.sql`, `20260821035000_refund_manager_session_simplification.sql`, `20260821080000_refund_form_completion_transport.sql`, and `20260821083000_refund_completion_delivery_decoupling.sql`. The first safely revokes legacy operator/enrollment authority; the second enables mapped-manager receipts and provider-free outcome confirmation; the third preserves original-thread Gmail replies while routing website-form completions through the existing customer-email channel; the fourth keeps the one email-only recovery independent of retired provider identity and private payment tables.
3. Deploy `refund-case-admin-update`, `nayax-card-refund`, `refund-nayax-outcome-resolve`, and `refund-case-message-send` with `--no-verify-jwt`. The first two share the new manager-session authorizer; the resolver authenticates the user itself and never calls Nayax; the message sender can claim the exact pending website-form completion once without provider access.
4. Deploy the frontend and verify `/refunds` shows only **Action needed**, **Waiting**, **Done**, search, one current state, and one next action. No authenticator setup/code control or routine system-health banner may appear.
5. Resolve the held case with the exact mapped manager, `provider_confirmed_success`, source `nayax_support_ticket`, public reference `SUPPORT:NAYAX-CS1500666`, and the authoritative refund time. Verify zero new provider attempts, one reporting adjustment, one source-appropriate customer completion with the mapped manager copied, and terminal case status. If the committed website-form completion is pending, use only **Recover interrupted completion** once; verify it sends the saved transactional email, increments the email retry count once, and leaves provider-attempt, resolution, and adjustment counts unchanged.

Rollback before a manager action: redeploy the prior frontend/functions and apply a new forward-only migration that restores the official-action and resolver gates to false. Rollback after a committed result must never reverse the reporting adjustment, reopen the attempt, resend the customer message, or call Nayax; preserve the immutable outcome and roll back UI/function availability only.

Refund release-state note: the canonical ten-function/51-migration object remains immutable pre-`#427` evidence. Nayax support confirmed the held transaction refunded, so the reviewed closeout adds a paired provider-free resolution-window/closure sequence. No request or approval is permitted. Gmail automation, automatic customer contact, manager reminders, GPT triage, broad official actions, and live Nayax execution stay off; only the existing structured resolver and its one original-thread completion may run inside the exact window.

## 1) Roles and ownership
- Release owner: owns the operating limits and may engage the kill switch; no repeated per-case go/no-go is required after the current policy is recorded.
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
| `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` | Server-only | `nayax-transaction-lookup` | Nayax Lynx reporting/lookup token for TGPACI USA DB; never a refund-write fallback | Technical owner |
| `NAYAX_LYNX_API_TOKEN` | Server-only fallback | `nayax-transaction-lookup` | Fallback Nayax Lynx token only when account-specific token names are not used | Technical owner |
| `NAYAX_REFUND_REQUEST_WRITE_TOKEN_<ACCOUNT_KEY>` | Server-only | `nayax-card-refund` | Dedicated account-scoped refund-request credential; never falls back to a reporting token | Technical owner |
| `NAYAX_REFUND_APPROVE_WRITE_TOKEN_<ACCOUNT_KEY>` | Server-only | `nayax-card-refund` | Dedicated account-scoped refund-approval credential; never falls back to a reporting token | Technical owner |
| `NAYAX_REFUND_MANAGER_CONTRACT_JSON` | Server-only | `nayax-card-refund`, `refund-case-admin-update` | Exact schema-v2 Bearer contract with the account-confirmed request/approval response pairs | Technical owner |
| `NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED` | Server-only | `nayax-card-refund` | `true` only after the intended Core/API identity and account contract are independently confirmed | Technical owner |
| `NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED` | Server-only | `nayax-card-refund` | `true` only after readback proves the dedicated approval credential has the intended account scope | Technical owner |
| `NAYAX_LOOKUP_WINDOW_HOURS` | Server-only | `nayax-transaction-lookup`, `refund-case-automation-sweep` | Default `6`; conservative card lookup window around reported incident time | Release owner |
| `REFUND_NAYAX_CANDIDATE_TTL_HOURS` | Server-only | `nayax-transaction-lookup`, `refund-case-automation-sweep` | Default `24`; tokenized evidence review window | Release owner |
| `REFUND_REPLY_TO_EMAIL` | Server-only | Refund customer email functions | Default `info@bloomjoysweets.com`; customer replies during pilot | Release owner |
| `NAYAX_REFUND_EXECUTION_ENABLED` | Server-only | `nayax-card-refund` | `true` for the qualified operating lane after the automated preflight; `false` during deploy or rollback | Release owner |
| `NAYAX_REFUND_EXECUTION_DRY_RUN` | Server-only | `nayax-card-refund` | `false` for the qualified operating lane; `true` during deployment validation | Release owner |
| `NAYAX_REFUND_EXECUTION_KILL_SWITCH` | Server-only | `nayax-card-refund` | `false` during healthy operation; set `true` first for rollback or a systemic stop condition | Release owner |
| `NAYAX_REFUND_IDEMPOTENCY_SECRET` | Server-only | `nayax-card-refund` | Generated HMAC secret for execution idempotency | Technical owner |
| `NAYAX_REFUND_EXECUTOR_ASSERTION` | Server-only | `nayax-card-refund` | Separate generated function identity; only its SHA-256 digest is registered in the database during an approved gate-on change | Technical owner |
| `REFUND_AUTOMATION_SWEEP_SECRET` | Server-only | `refund-case-automation-sweep` | Dedicated scheduler secret matching GitHub and Vault copies; never a service-role key | Technical owner |
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
| `REFUND_GMAIL_SCHEDULER_SECRET` | Server-only | `refund-gmail-sync` independent recovery lane | Separate generated secret matching only the Vault `refund_gmail_scheduler_secret`; never reuse the GitHub token or a service-role key | Technical owner |
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
- [ ] Keep the unrelated optional GPT lane disabled. GPT credentials, evaluation, and enablement are not Refund Operations v1 deployment or pilot gates.
- [ ] If Gmail enablement is approved for this release, `npm run refunds:preflight-gmail -- --project-ref <project-ref>` passes secret-name presence checks without printing values. If Gmail is deferred, record that the OAuth/mailbox secrets are intentionally absent and keep both Gmail switches off; missing optional Gmail credentials do not block the all-switches-off core deployment.
- [ ] Before any automatic refund-email class or mapped-manager CC is enabled, the gates in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md` pass: deterministic template/version review, original-thread Gmail transport, participant classification, visible-recipient privacy review, canonical manager case links, exactly-once first contact, legacy-responder cutover/rollback, hard-bounce hold, and proof that email identities cannot perform a Nayax action.
- [ ] Keep the separate manager-aging lane off until `#685` proves one deterministic manager-only notice at two business days and one escalation at five business days per attention version, current mapped-manager resolution at send time, routing-exception fallback, pause/terminal suppression, exact authenticated case links, and delivery-uncertainty handling.
- [ ] Official refund actions remain hard-off during deployment. Before reopening normal operation, prove current mapped-manager-only authority, exact selected transaction and provider amount, one explicit financial confirmation, single-use server authorization, replay/concurrency rejection, exact-transaction uniqueness, and settlement handling. No manufactured purchase, amount cap, canary, staffing, observer, recruited UAT, or refund-specific TOTP/operator ceremony is required.
- [ ] `npm run commerce:preflight -- --project-ref <project-ref> --include-refunds` passes
- [ ] `npm run refunds:validate-release-tooling` passes.
- [ ] `npm run refunds:release:check` confirms that the ten candidate Refund Operations functions, required migrations, source commit, and `verify_jwt` settings match the approved release manifest. Do not substitute the separate eight-route `OPTIONS` smoke count for the manifest count.
- [ ] The same fresh `Refund UAT Evidence` run contains exactly 81 reviewed synthetic screenshots and the five sanitized JSON artifacts named below; the final manifest hashes every artifact and binds to the reviewed PR head. The evidence covers form-only intake, card-network evidence, Nayax inventory/Snapcase, the manual-portal-only machine state, branded messages and same-case appeals, duplicate decisions, the source-aware manager queue, routine-manager isolation, the Internal/test disposition/archive, provider-free existing-refund reconciliation, and transactional delivery truth without production data or provider identifiers. Final migration/test-file counts and SHA are generated from that tree, not copied from an earlier branch or written by hand.
- [ ] In the owner's private shell, `npm run refunds:production-auth-closed -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --phase predeploy` passes with the short-lived `SUPABASE_AUTH_CONFIG_READ_TOKEN`. This is the final read-only barrier before the first refund production database/function write.
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
supabase secrets set NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED=false
supabase secrets set NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED=false
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

Generate the idempotency secret and executor assertion independently; neither may reuse the Supabase service-role key. Register the executor assertion only after the vendor request/approval contract and dedicated credentials are verified. The raw assertion belongs only in the Edge Function secret; the database stores its SHA-256 digest. The retired sponsor, canary, broad-reopen, and amount-cap secrets do not govern production and should not be configured.

Gmail and GPT credentials were enablement-time secrets rather than prerequisites for the historical all-switches-off core deployment. The production Gmail OAuth/mailbox connection is now configured and proved under `#634`, while Gmail schedules, broad customer contact, and the legacy-responder cutover remain off. Do not configure the production OpenAI key before the privacy/data-control approval in `#635`. Both functions remain fail-closed unless their dedicated scheduler secret and enablement gates are configured.

Before continuing, run:

```bash
npm run commerce:preflight -- --project-ref <project-ref> --include-refunds
# Run only when the Gmail lane is approved/configured:
npm run refunds:preflight-gmail -- --project-ref <project-ref>
```

Remote preflight validates secret presence by name, including the active manager contract/confirmation, approval-scope confirmation, and at least one matching `NAYAX_REFUND_REQUEST_WRITE_TOKEN_<ACCOUNT_KEY>` / `NAYAX_REFUND_APPROVE_WRITE_TOKEN_<ACCOUNT_KEY>` pair; it no longer treats the historical controlled-pilot assertion as release readiness. Local preflight additionally parses the schema-v2 contract, requires the exact production endpoint, and applies the adapter's credential-shape and separate/shared-token rules. Before deploying, separately verify the remote fail-closed values are set as intended: `NAYAX_REFUND_EXECUTION_ENABLED=false`, `NAYAX_REFUND_EXECUTION_DRY_RUN=true`, `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`, `NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED=false`, and `NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED=false`. The production adapter exists but cannot reserve or call Nayax while any independent gate is closed; the synthetic adapter is available only through dependency injection in tests.

For the deployed `#644` baseline, use `Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md` as the historical merge, deployment, smoke, rollback, pilot, and sponsor-decision record. The current strict release is governed by the exact reviewed canonical-main manifest and evidence. Issue `#409` tracks the remaining staffed shadow and production-label/legacy-responder no-overlap cutover; it is not an unmerged integration release candidate and does not require a separate release manifest. `Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md` remains historical and must not be used as current deployment authority.

#### Refund Auth closed-state barrier (required before Step B)

The owner places a newly created short-lived Management API token only in the private shell variable `SUPABASE_AUTH_CONFIG_READ_TOKEN`, without printing it. Do not place it in an env file, GitHub, an issue, a PR, a screenshot, or task output. Then run:

```bash
npm run refunds:production-auth-closed -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --phase predeploy
```

This command first validates the reviewed repository source, then makes exactly one GET of the exact production project's Auth configuration. It prints only pass/fail plus the enrollment and verification booleans. It never PATCHes, auto-restores, or changes Auth. Do not reuse or broaden `SUPABASE_EDGE_FUNCTIONS_READ_TOKEN`; that protected credential remains limited to Edge Functions Read.

If the gate reports enrollment on, verification off, a project mismatch, missing authority, or an unreadable response, stop before `supabase db push` or any function deployment. Keep every refund operational switch off. The owner—not an agent or automation—must open the exact Supabase project, turn only TOTP enrollment off while leaving verification on, and rerun the command. If the owner cannot prove the closed state, record the sanitized blocker in `#789` and do not deploy. Clear the private shell token immediately after the postdeploy check.

A future scheduled alert-only monitor is allowed only if Supabase offers an exact-project Auth-configuration read credential. Never substitute a broad PAT, reuse the Edge drift token, or add a write-capable auto-restorer.

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

Before deploying Refund Operations functions, run `npm run refunds:release:check`. Deploy only the ten functions listed in the release manifest from the exact immutable, reviewed canonical-main commit. Revalidate the manifest and transitive source binding immediately before deployment. Keep the runtime Nayax execution gates off during deployment (`NAYAX_REFUND_EXECUTION_ENABLED=false`, `NAYAX_REFUND_EXECUTION_DRY_RUN=true`, and `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`). The normal manager action uses dedicated server-side Nayax account credentials only after the reviewed migration and function are deployed, the machine is qualified and enabled, the executor assertion is registered, and the genuine runtime safety gates are deliberately opened. Retired pilot, sponsor, canary, broad-reopen, and cap flags do not authorize or block a normal manager action.

`Docs/REFUND_NAYAX_CONTROLLED_OWNER_PILOT.md` is historical documentation for the retired owner-only runner. It is not current launch authority and must not impose case allowlists, amount caps, TOTP, staffing, non-customer-only, observer, retention-review, or repeated go/no-go ceremony on the normal authenticated-manager path. Current operation is governed by `Docs/REFUND_PRODUCTION_POLICY.md` and the first section of this runbook.

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
supabase functions deploy refund-nayax-outcome-resolve --no-verify-jwt
```

After deploying the ten manifest-tracked Refund Operations functions:

Before any smoke, UAT, or enablement decision, rerun the exact read-only gate:

```bash
npm run refunds:production-auth-closed -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --phase postdeploy
```

If it does not pass, stop. Keep all operational switches off and use the same owner-only remediation above. The command never auto-restores or changes Auth; a passing result proves the deployment ended with enrollment off and verification on.

1. Run the no-auth, no-body route smoke. It deliberately probes the eight established application routes only; that probe count is not the ten-function manifest count. It sends only `OPTIONS`, creates no case, sends no email, and makes no Nayax/OpenAI/Gmail provider request:
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
9. Run `npm run refunds:release:check-production -- --project-ref <project-ref>` and require all ten manifest-tracked functions to pass. The live counter must not regress below the approved-bundle version, while the bundle digest, source pairing, JWT setting, import-map state, and canonical entrypoint identity remain exact.
10. Run the remaining refund production smoke rows in `Docs/QA_SMOKE_TEST_CHECKLIST.md` using sanitized evidence only.

### Reconcile a refund completed in Nayax before Bloomjoy recorded an attempt (`#971`)

1. Confirm the case is card-paid, still in manager review, bound to one exact Nayax transaction, has matching sale/refund amounts and USD currency, and has no provider attempt, completion, reporting adjustment, or unresolved reconciliation. If any fact differs, stop.
2. In Dynamic Transactions Monitor or a Nayax support response, verify one separate authoritative refund record for the exact matched card and amount. Do not infer success from a requested/pending row and do not retry the refund.
3. The exact mapped manager clicks **Review existing refund**. Confirm the receipt states that no payment was attempted and the customer was not contacted. The action only opens a synthetic evidence hold.
4. Enter the safe DTM/support reference and exact refund time. The time must not predate the matched sale. Choose **Keep waiting for confirmation** if evidence is incomplete or conflicts.
5. Immediately before **Complete case & notify customer**, recheck the exact amount, last four, refund time, and separate negative/refund record. This final action records reporting and queues one source-appropriate completion; it still makes no Nayax call.
6. Postcheck exactly one evidence-only attempt, one outcome resolution, one reporting adjustment, one completion message, no additional provider attempt, and no retry-ready generation. If delivery is uncertain, use only the existing email-reconciliation lane; never rerun the refund or outcome completion.

Before mapped-manager UAT, run the read-only role audit with exact project confirmation. It queries only aggregate counts and refuses unexpected result columns:

```bash
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref>
# After the owner approves a cohort, repeat once per approved machine:
npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref> --pilot-machine-id <uuid>
```

The discovery audit passes when a currently mapped manager has at least one shadow-ready assignment. The cohort audit passes only when the same identity is mapped to every selected pilot machine and those assignments are shadow-ready. Broader admin access is reported as context but neither grants nor revokes refund authority; the exact machine mapping and personal action-bound TOTP remain mandatory. Keep identity selection private and post counts only in `#435`.

Owner-supervised refund authenticator enrollment (`#782`):

1. Deploy only the reviewed migration/Edge/frontend release. Deployment and the checked-in Auth configuration must leave TOTP enrollment **off** and verification **on**. Official actions, Nayax execution, Gmail, customer contact, and schedules also remain off; deployment does not open an enrollment window.
2. Before the private session, use the owner-controlled Supabase project dashboard to confirm **Authentication > Multi-Factor Authentication > TOTP enrollment** is off and TOTP verification is on. As a second read-only check, use the owner's short-lived private-shell `SUPABASE_AUTH_CONFIG_READ_TOKEN` and run `npm run refunds:owner-totp-auth-readiness -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --expect closed`. The script reads only the two Auth flags, prints no configuration or token, and cannot change settings.
3. From the owner's own private, non-agent browser, sign into the portal and open `/refunds`. The setup card appears only for the exact preapproved owner-manager and states that setup cannot issue a refund. Confirm the owner is ready with their authenticator before changing Auth.
4. Start a five-minute human timer. In the owner-controlled Supabase dashboard, temporarily enable only TOTP enrollment; do not run a broad Auth config push or change any other setting. Immediately run the same exact-project read-only command with `--expect open`. If it does not pass, restore TOTP enrollment off and stop before the owner clicks setup.
5. The owner immediately clicks **Begin private setup**. The database opens its own five-minute, self-only window and the real Auth enrollment endpoint must also be ready before the UI displays QR material. The owner personally scans the QR and enters the current setup code. Do not screen-share, screenshot, copy, dictate, log, or send the QR or code to an agent or another person.
6. On success, cancel, UI expiry, start/verify failure, or any interruption, immediately restore TOTP enrollment **off** in the Supabase dashboard. Run the read-only check again with `--expect closed`. Do this even if the portal already says the database window closed; the Auth setting and database window are independent fail-closed layers. If restoration cannot be confirmed inside five minutes, stop and treat setup as failed.
7. Confirm the portal says the authenticator is ready, the private dialog/QR is gone, the database window is closed, and no refund was issued. Do not open another setup window or attempt factor replacement during pilot readiness.
8. A later official action is a separate ceremony: the mapped manager reviews the exact case/action and personally enters a new current code bound to that action. Enrollment never substitutes for provider approval or the official-action gate.

This temporary Auth phase is owner-supervised control-plane work, not an agent/API toggle. Do not add a generic dashboard, service-role RPC, Edge secret, workflow dispatch, or application setter for it. The repository steady state remains enrollment-off/verification-on, and the portal fails before QR display when the real Auth enrollment endpoint reports that enrollment is disabled.

Evidence is aggregate and sanitized only: eligible/enrolled/window-open booleans, Auth-open/Auth-closed pass/fail, lifecycle counts, expiry behavior, and zero side-effect proof. Never place the owner identity, QR, factor identifier, code, token, case, payment data, or control-plane response in logs, screenshots, issues, or PRs. If setup fails, keep every operational switch off, close/cancel from the owner's portal, restore Auth enrollment off, and do not use a generic admin or service-role database setter.

Legacy card-state normalization (`#784`, `#793`):

1. Do not run this during deployment. Apply the reviewed migration first while official actions, Nayax execution, Gmail, automatic customer contact, and schedules remain off.
2. In a private database-owner session after confirming a production backup, run an aggregate-only precheck. Require exactly one card case with `card_refund_pending`, `decision=approved`, provider state `not_requested`, exactly zero provider-attempt rows, exactly two total/sent messages consisting of one `confirmation` and one `approved`, zero non-sent, pending, failed, skipped, completed, duplicate, or other message types/statuses, and no completion/reference/adjustment evidence. If the count is not exactly one, stop; do not broaden the predicate. The former one-approval-only shape is intentionally ineligible.
3. Privately resolve that one case UUID without copying it into logs, issues, PRs, screenshots, or chat. Run `public.owner_normalize_refund_legacy_card_state(<private-case-uuid>, 'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION')` once. The function is unavailable to browser, service, anonymous, and workflow roles.
4. Save only the returned aggregate booleans/counts: normalized, already-normalized, status, decision, provider-attempt count, one historical confirmation, one historical approval, two total historical messages, provider execution state, and payload-redacted. Never save the case UUID, customer identity, card details, provider identifiers, message IDs, or message content as evidence.
5. Run aggregate-only postchecks. Require one append-only `legacy_card_state_normalized` event; current state `needs_review` with no current decision, refund amount, selected Nayax match, recommendation, or cached lookup candidate; provider `not_requested`; zero provider attempts; both original sent messages byte-for-byte and metadata-equivalent to the private precheck; zero new customer messages; and zero provider, completion, reporting-adjustment, or official-action side effects. The redacted event must retain the prior decision and only presence-level match/recommendation facts plus aggregate confirmation/approval/candidate counts, never a message ID, candidate token, or provider identifier.
6. In the assigned manager's portal, refresh the exact private case. Require **Historical payment review**, **Manager review needed**, **No refund is recorded**, and only **Refresh transaction results**. Confirm even an adversarial stale browser response cannot display or select an old candidate or hide the refresh button; refund/retry, approve, deny, and customer-email paths remain frozen on desktop and mobile.
7. Run a fresh transaction check only after the manager is ready to review new evidence. That later evaluation may clear the historical-review freeze, but does not itself approve, issue, complete, or communicate a refund; all ordinary independent gates still apply.

There is no destructive rollback. If any precheck/postcheck differs, keep every operational switch off and preserve the event/message history. Use a new reviewed forward-only repair based on the immutable normalization event; never rewrite/delete the event or manually infer provider success.

Supabase function version numbers are monotonic audit evidence, not source identity or rollback targets. A rollback redeploy creates a new version number. Each manifest `production.version` records where its exact bundle was approved, so a lower live counter fails closed; a higher counter passes only when the approved bundle digest, source pairing, JWT setting, import-map state, and canonical entrypoint identity remain exact, and is reported as a same-bundle later revision. Host/worktree prefixes in Supabase's absolute `entrypoint_path` are discarded, but traversal, query/fragment suffixes, backslashes, a wrong function slug, or any entrypoint other than `index.ts` are rejected. This classification does not approve a secret or control-plane change; the separate operational-gate checks remain authoritative.
The manifest's `sourceGitCommit` is checked against every function's transitive source. `preDeploymentProduction` records the exact live baseline, including missing functions. `approvedRestoreSource` validates the immutable known-good source for every existing core function; newly introduced disable-only functions such as `refund-gmail-sync`, `refund-gpt-triage`, `refund-manager-action-step-up`, and `refund-manager-totp-enrollment` record `restoreAction=disable` and use their documented switch-off procedures instead of pretending an older deployed source existed.

Refund sync validation:
- First run the `Refund Adjustment Sync` workflow manually with `dry_run=true`. The workflow should print aggregate counts only.
- Then run it manually with `dry_run=false` and confirm `/admin/reporting` shows the completed refund import run plus any review-only rows.
- Set the GitHub repository variable `REFUND_ADJUSTMENT_SYNC_ENABLED=true` only after the manual live run is validated.
- If the source sheet has hundreds of rows, keep the default paged sync or set `REFUND_ADJUSTMENT_SYNC_ROW_LIMIT` no higher than `100` so each Edge Function request stays below timeout limits.

Refund automation scheduler validation:
- Apply the automation ledger, scheduler-reliability, and 30-minute cadence migrations, then deploy `refund-case-automation-sweep` and the frontend. The database primary jobs install disabled; do not enable them before the function and migrations agree.
- Generate a dedicated 32+ character token privately. Set it as the Edge secret `REFUND_AUTOMATION_SWEEP_SECRET` and GitHub secret `REFUND_AUTOMATION_SWEEP_TOKEN`; store the same value in Supabase Vault as `refund_automation_scheduler_secret`, and store the exact production function URL as `refund_automation_scheduler_url`. Require exactly one Vault secret with each name. Never print, commit, or paste the token into an issue, PR, browser console, or evidence artifact.
- Keep `public.refund_automation_scheduler_settings.enabled=false`, GitHub variable `REFUND_AUTOMATION_SWEEP_ENABLED=false`, Edge secret `REFUND_AUTOMATION_ENABLED=false`, and `REFUND_MANAGER_AGING_NOTICES_ENABLED=false` during setup. Through the owner SQL lane, call `public.service_dispatch_refund_automation_scheduler('run')` and `('health_check')`; both must return `status=disabled`, `dispatched=false`, and `payloadRedacted=true`.
- Manually run **Refund Automation Sweep** with `failure_test` and a new synthetic UUID in `run_key`. Confirm the designated operations recipients receive the PII-free test alert and the workflow prints aggregate fields only. Dispatch `failure_test` again with the exact same UUID; require `duplicate_suppressed` and no second alert.
- With approved synthetic/shadow cases only, set Edge secret `REFUND_AUTOMATION_ENABLED=true`, manually run **Refund Automation Sweep** with `run` plus a new synthetic UUID in `run_key` during the configured policy window, and confirm each due action fires once. Dispatch `run` again with the exact same UUID; require `duplicate_suppressed` without another message, state change, or event. GitHub creates a new workflow run for the replay, so the reusable UUID - not `GITHUB_RUN_ID` - is the idempotency proof.
- Manually run **Refund Automation Health** and confirm `/refunds` shows the same healthy/last-success state for an authorized Machine Manager.
- Enable the Supabase primary only with `public.service_set_refund_automation_scheduler_enabled(true)`. Its minute 7/37 sweep and minute 13/43 health jobs use advisory locks, a dispatch ledger, and the same UTC 30-minute keys as GitHub. Enable `REFUND_AUTOMATION_SWEEP_ENABLED=true` only after the primary produces a successful sweep and health check; GitHub is then the independent fallback, not the clock.
- Soak both lanes for at least two hours. Require at least four primary in-policy sweep successes, no scheduler-heartbeat gap reaching 60 minutes, no duplicate run key, no concurrent case action, and no duplicate customer/manager/provider effect. An outside-policy no-op may prove clock liveness but cannot reset a processing failure or start recovery. Health must remain non-stale through 90 minutes since the last scheduler heartbeat, then open one incident after that threshold; the ledger must show no repeat inside 24 hours and one recovery claim only after a real in-policy success followed by 60 continuous healthy minutes.
- Primary-only rollback is `public.service_set_refund_automation_scheduler_enabled(false)` while the GitHub fallback remains available. Whole-lane disable then sets `REFUND_AUTOMATION_SWEEP_ENABLED=false` and `REFUND_AUTOMATION_ENABLED=false`; manually dispatch one new UUID to prove `disabled` and confirm intake plus manager actions remain available.

Refund Gmail independent primary and recovery schedulers (`#1009`):

- Deploy the reviewed primary/watchdog migrations and `refund-gmail-sync` function with both database scheduler gates disabled. The Supabase primary is the supported ten-minute scheduler, GitHub remains an independent fallback, and the database watchdog remains a second recovery lane only.
- Generate a new 32+ character recovery token privately. Set it as the Edge secret `REFUND_GMAIL_SCHEDULER_SECRET`; store the same value in Supabase Vault as `refund_gmail_scheduler_secret`, and store the exact production function URL as `refund_gmail_scheduler_url`. Require exactly one Vault secret with each name. Never print, commit, or copy the token into an issue, PR, browser console, or evidence artifact.
- With both database scheduler gates disabled, invoke `public.service_dispatch_refund_gmail_primary_scheduler()` and `public.service_dispatch_refund_gmail_scheduler_watchdog()` through the owner SQL lane. Require `status=disabled`, `dispatched=false`, and `payloadRedacted=true` from both. Verify the GitHub schedule and a manual GitHub run still use their separate original token.
- Before primary enablement, require `refund_gmail_retention_run_key_is_valid('pre-sync:supabase-primary:<aligned-ten-minute-UTC-bucket>', 'pre_sync')` to pass and the corresponding off-bucket key to fail. Enable only with `public.service_set_refund_gmail_primary_scheduler_enabled(true)`. The minute-2 ten-minute cron uses a distinct source-bound UTC bucket, advisory lock, dispatch ledger, mandatory retention ledger, and existing sync claim. A delayed GitHub event may therefore overlap safely without duplicating a thread, message, case, or customer contact.
- Before watchdog enablement, require `refund_gmail_retention_run_key_is_valid('pre-sync:supabase-recovery:<aligned-five-minute-UTC-bucket>', 'pre_sync')` to pass and the corresponding off-bucket key to fail. Enable only with `public.service_set_refund_gmail_scheduler_enabled(true)`. The five-minute cron may dispatch only after Gmail intake is enabled, the last successful sync is at least 20 minutes old, and no sync attempt occurred in the prior ten minutes. The exact five-minute UTC bucket is the run key; advisory locking, the dispatch ledger, the mandatory retention ledger, and the existing sync claim suppress concurrent or replayed calls.
- Prove recovery without customer or payment effects: pause only the GitHub schedule, leave Gmail read-only intake active, and confirm one recovery dispatch begins before 30 minutes, produces one successful aggregate sync, creates no duplicate thread/message/case, and returns the manager health indicator to healthy. Restore the GitHub schedule immediately.
- Soak the Supabase primary, GitHub fallback, and watchdog for at least two hours. Require at least 12 Supabase primary successes, no gap reaching 30 minutes, no duplicate run key, no concurrent claim, zero failed messages, and no new customer/provider/refund action attributable to either database scheduler before starting or resuming the integrated 72-hour certificate.
- Quick disable is `public.service_set_refund_gmail_primary_scheduler_enabled(false)` followed by `public.service_set_refund_gmail_scheduler_enabled(false)`. If the shared read-only Edge credential may be exposed, disable both first, rotate/remove both matching secret copies, and redeploy the Edge secret. Do not retry an uncertain customer message or refund; neither scheduler has either authority.
- Manager aging may be enabled only after its separate UAT proves one current-manager reminder at two and one escalation at five Los Angeles business days per attention version, exact navigation-only case links, pause/terminal suppression, send-time route resolution, and no blind retry. With `REFUND_MANAGER_AGING_NOTICES_ENABLED=false`, executable evidence must show zero fetch, claim, reservation, and send calls for that lane.

Refund Gmail intake validation:
- Evidence recorded on 2026-08-12 proves exact Hub OAuth for the directly connected production customer-service mailbox, `info@bloomjoysweets.com`, with Gmail read-only/send scopes and verified Info/Support/Refunds send-as mailbox identities. Treat each identity as Bloomjoy mailbox-origin only when the approved mailbox configuration and provider `SENT`-label evidence agree and every existing delivery gate passes. Do not use forwarding into a personal inbox.
- Keep the OAuth client bound to that exact designated support mailbox with only `gmail.readonly` and `gmail.send`. `etrifari@bloomjoysweets.com` and its plus-addresses may be used only as an owner-controlled synthetic customer/test sender or recipient, or for vendor/account correspondence; they are not the production refund-assistant mailbox. Record any required Google verification or security review before production use.
- Apply the Gmail migrations; deploy `refund-gmail-sync`, the updated refund message/admin functions, and the frontend. Set `REFUND_GMAIL_SYNC_URL` and `REFUND_GMAIL_SYNC_TOKEN`, but keep `REFUND_GMAIL_SYNC_ENABLED=false`, `REFUND_GMAIL_ENABLED=false`, `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false`, database `refund_customer_contact_settings.automatic_customer_contact_enabled=false`, and `REFUND_GMAIL_RETENTION_ENABLED=false` at GitHub and Edge during setup. The database retention policy remains armed for the approved 180-day sanitized-copy period; without both runtime gates, recurring cleanup is dormant.
- Approve and record the 180-day Gmail-copy retention, visible-CC privacy model, participant classification, first-contact cutover, and attachment-off pilot policy in `Docs/REFUND_GMAIL_DATA_HANDLING.md`. A future attachment-enabled release requires a separately reviewed quarantine and malware-scanning design. Do not enable the schedule while any approval is pending.
- Run the workflow manually with `failure_test` while real Gmail access remains disabled; confirm central-admin health shows a safe failure signal and the workflow output contains aggregate fields only.
- With synthetic messages only, set `REFUND_GMAIL_ENABLED=true` and manually run the workflow. An explicitly labeled test email must create one draft visible to a Super Admin or Scoped Admin, but not to a location-only Machine Manager. Re-running the same delivery must not create a second case, message, or event.
- Reply to the test thread and run sync again. The reply must append chronologically to the same case. After machine resolution, a manager-approved or approved deterministic customer-facing response must originate through the designated support mailbox, appear in that original Gmail thread exactly once, include the complete current mapped-manager CC set, and never start a parallel Resend conversation.
- Prove with one, two, and three synthetic current managers that every manual and automatic customer-facing refund message has the exact case customer as sole To and each current active mapped manager once in visible CC. Change a mapping between preview and send and confirm send-time re-resolution. Unresolved machines, zero-manager routes, invalid/over-cap mappings, and empty safe recipient sets must block Gmail and transactional customer delivery before any provider call; the redacted internal operations notice is the routing-repair path and can never substitute for the required customer-message CC.
- Prove a manager Reply All remains manager correspondence, the customer sees no internal portal link, and the separate action-needed/aging/exception manager notice opens the canonical `/refunds?case=<case-id>` route without changing case state. Completion must use one customer-facing message with managers CC and no duplicate manager-only completion notice.
- With the legacy responder still authoritative, run Hub first-contact in no-send "would send" mode. Any active-send proof must use an isolated synthetic mailbox/label excluded from the legacy responder. Use a staffed, sequenced no-overlap handoff: keep Hub disabled, disable and verify the legacy sender, record a fresh UTC boundary, manually review and handle transition-interval messages, and only then enable Hub. Rollback must disable and verify Hub off before restoring the legacy sender so the two never overlap for the same thread population.
- Keep both production switches false during local/staging/isolated-lane UAT. After policy and recipient approvals pass, a bounded owner-approved production synthetic window may set only `REFUND_GMAIL_ENABLED=true` for a manual test while the scheduled `REFUND_GMAIL_SYNC_ENABLED` switch stays false, then reset the Edge switch before go/no-go.
- The owner-controlled case-specific Gmail proof is completed historical evidence; do not recreate it as a manual dashboard/portal ceremony. The portal intentionally has no proof-token control, and a normal **Reply in Gmail thread** click cannot carry the one-shot authorization. If a future rerun is explicitly approved, use only the reviewed owner runner from `#810`; it keeps the browser free of recipient, case, copy, token, and gate controls.
- Prepare a private env file outside the repository. Set the exact production project twice (`REFUND_SYNTHETIC_GMAIL_PROOF_PROJECT_REF` and `REFUND_SYNTHETIC_GMAIL_PROOF_CONFIRM_PROJECT_REF`), the privately selected case UUID twice (`..._CASE_ID` and `..._CONFIRM_CASE_ID`), the exact database adapter, an owner-held Supabase management token able to read/write Edge secrets, read function metadata/backups (`backups_read`), and run exact-project database queries (`database_write`), the production publishable/anon key, and a current authenticated portal-user JWT whose user can manage that exact case. Use `REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_ADAPTER=management-api-owner` when an owner login URL is unavailable and leave `REFUND_SYNTHETIC_GMAIL_PROOF_DATABASE_URL` empty; the existing `direct-postgres` adapter still requires an exact-project database-owner connection. Never put this file in the repo, an issue, chat, shell history, screenshot, or artifact. There is no recipient, subject, body, alias, endpoint, attachment, or retry input.
- Supabase's Management API `read_only` request flag selects a non-owner database role, so the owner adapter deliberately submits `read_only=false` for all six fixed operations and re-proves `current_user=session_user=database owner` on every response. This does not make its four read lanes arbitrary writers: their complete SQL strings are held in a closed immutable registry, use parameter arrays only, and are protected by exact full-string snapshots plus a conservative single-statement/mutation-keyword guard. Only the fixed prepare and close functions may mutate. No operation is retried; after an ambiguous prepare response, recovery can only find the one active authorization for the exact confirmed case after Gmail is restored off, and any ambiguous close remains a failure even if later aggregate counts are zero.
- First run `npm run refunds:synthetic-gmail-proof -- --mode dry-run --env-file <private-absolute-path>`. It performs aggregate-only checks: database-owner session; zero unclosed authorization; zero unresolved Gmail outbound; exact eligible Gmail/owner-plus-address case; one original thread; zero attachments; one-to-four complete current mapped managers; authorized current user; a latest completed production backup no more than 36 hours old; exact production function alignment; and every unrelated Edge/GitHub/database gate off. The backup proof is a read-only exact-project Management API check and does not assume PITR is enabled. It writes nothing and prints only booleans/counts.
- For the single approved live window, add `REFUND_SYNTHETIC_GMAIL_PROOF_LIVE_CONFIRMATION=RUN_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_PROOF` and run the same command with `--mode live`. One process generates the token, prepares the five-minute database authorization, temporarily changes only `REFUND_GMAIL_ENABLED`, posts the fixed default `status_update`, restores Gmail false in `finally`, reads the redacted summary, closes the authorization, and proves all gates/schedules are off. The raw token, case/auth/message/thread/provider IDs, identities, addresses, JWTs, content, and secret values are never stdout or artifacts.
- If the send is rejected, times out, or has an uncertain response, do not rerun it. The one-shot authorization prevents replay. Let the runner restore Gmail false, read the aggregate summary, close, and stop. If Gmail false cannot be confirmed, the runner deliberately leaves the exclusive authorization open so unrelated sends remain blocked; restore the Edge gate privately, then close through a reviewed recovery. Never close the exclusive row while Gmail may still be enabled.
- Acceptance is `proofPassed=true`, deltas of exactly one case message and one Gmail outbound, zero attachment delta, exact Info sender/original thread/customer digest/complete manager-route digest, zero unresolved delivery, `activeAuthorizationCount=0`, and every unrelated gate still off. Because project secret updates can change live Edge version metadata without source changes, immediately capture and review the timestamped production receipt before declaring release alignment current. Preserve the sealed manifest when the receipt proves a same-bundle later revision; do not replace its historical counter merely to mirror mutable metadata.
- Force an authenticated synthetic permanent hard bounce for the exact case customer and confirm contact pauses case-wide, including a newer linked thread, while the mapped manager receives a safe exception with the exact case link. Recovery must be an authenticated manager action that verifies the exact customer address and clears all linked pauses atomically; service, scheduler, ingest, replay, newest-only, and partial-clear attempts remain blocked.
- Confirm unrelated and unlabeled messages remain untouched, including label, archive, deletion, and read state. Confirm an incoming Luhn-valid test card number is stored/displayed only as redacted last four and does not appear in logs or workflow output.
- Confirm the pilot is attachment-free: the public form renders no file control, hosted intake rejects every non-empty attachment payload, and Gmail ingestion stores no attachment metadata or bytes. Do not enable quarantine or downloads until a separate scanner, retention, and privacy review is approved.
- Revoke the test refresh token. Gmail health must show authorization failure while hosted-form cases, queue access, and manual non-Gmail replies continue to work. Reauthorize before any scheduled pilot.
- Prove crash-safe retention with synthetic data: reserve a tokenized database upload intent before Storage; accept only the exact private bucket/canonical UUID path; settle deletion before metadata purge; hold corrupt, noncanonical, failed, or unknown objects for manual review; and still purge unrelated eligible storage-free content. Then revoke Gmail OAuth and prove the independently approved retention-only run can still clean local copies.
- Enable `REFUND_GMAIL_SYNC_ENABLED=true` only after every check above passes. Quick disable order is the GitHub variable first and Edge secret second; this must not disable form intake, existing case handling, or independently approved retention cleanup. Automatic customer contact remains behind its separate Edge and database gates.

Optional historical GPT lane (not a Refund Operations v1 pilot requirement):
- Apply both GPT triage migrations and deploy `refund-gpt-triage`, the updated refund message function, and the frontend while `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, `REFUND_GPT_TRIAGE_ENABLED=false`, and `refund_gpt_triage_settings.enabled=false`.
- Configure the production OpenAI key only as a Supabase server secret after `#635` approves that destination. The same issue must record the exact OpenAI project data-control mode and privacy/security approval; `store=false` prevents response application-state storage but does not by itself eliminate the provider's default abuse-monitoring retention. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists. Do not copy the local developer `.env.local` into GitHub Actions or a tracked file. Run `npm run refunds:preflight-gpt-triage -- --project-ref <project-ref>` to verify required secret names without printing values.
- Run `npm run refunds:validate-gpt-triage`, the full migration test suite, and Refund portal UAT. The provider suite is mocked and proves `store=false`, strict schema, no tools, key exclusion from request bodies, and fail-closed refusal/HTTP/timeout/schema/configuration paths without incurring an API call.
- Manually dispatch `failure_test` while the acknowledgement and Edge switch remain false and confirm aggregate-only failure output. Then, only with approved sanitized content and a recorded OpenAI project retention decision, set `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=true` plus the Edge and database switches true for a bounded manual evaluation. Confirm one latest-message job, no automatic retry, stale-suggestion superseding, editable manager review, rejection sends nothing, and policy-sensitive input exposes no GPT draft or send action.
- During the human-reviewed pilot, require the thresholds in `Docs/REFUND_GPT_TRIAGE.md`, retain reviewer outcomes, and stop immediately on any unsafe draft. Automatic sending remains structurally prohibited by the database.
- Quick disable: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then `refund_gpt_triage_settings.enabled=false`, and reset `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` when the approval window ends. Verify Gmail/form-created cases and deterministic missing-information replies still work; preserve job/audit rows and allow the bounded content purges to continue.

Normal Nayax refund operation (`#628`, `#990`):
- Deploy database changes before dependent functions while execution is disabled, dry-run is enabled, and the kill switch is active. Direct API execution remains additionally hard-disabled by the immutable `NAYAX_REFUND_EXTERNAL_PARTIAL_GUARD_SUPPORTED = false` code guard; no environment change can open it.
- Provision only the dedicated account-scoped request and approval credentials. Never use a reporting or generic Nayax token as a write fallback.
- The legacy `approve_pending_request` operation is retired fail-closed. Preserve its historical database rows for audit/rollback tests, but do not enable or invoke it; authoritative-unknown attempts use provider-free DTM/support reconciliation.
- Read-only lookup, exact evidence selection, and the reviewed manual Nayax portal approval/completion record remain usable. The direct Bloomjoy API must return `provider_remaining_value_unverified` before reservation or provider orchestration.
- Before any separate release enables direct execution, #990/#751 must ingest and bind original amount, cumulative refunded amount, remaining refundable amount, refund status, and evidence time to the exact provider transaction; atomically recheck it immediately before the request; and fail closed on missing, stale, inconsistent, or reduced remaining value. Provider rejection is a backstop, not the preflight.
- There is no $10 proof, $50 per-refund limit, daily count/value cap, case allowlist, canary, first-ten sample, or account-wide hold. Those retired rollout controls do not waive the immutable remaining-value guard.
- Require one explicit manager confirmation immediately before money moves, one immutable generation, at most one request and one approval per generation, one terminal settlement decision, and exactly-once reporting/customer completion. Repeat clicks, reloads, workers, and replays cannot create another provider send.
- A definitive rejection or other authoritative proof that no refund occurred permits a fresh, separately confirmed generation. An uncertain outcome holds only that exact transaction while Nayax is checked. Unrelated transactions and customers continue normally.
- A customer may receive refunds for multiple distinct purchases. The database must continue to prevent two Bloomjoy cases from using the same exact Nayax transaction; two cases with exact different transaction IDs are automatically distinct.
- The kill switch is for a genuine systemic incident, not routine volume management. Rollback order is kill switch first and execution off second. Preserve every attempt, resolution, journal, reporting, and message record; never delete or rewrite financial history.

Historical completed held-case outcome resolution (`#767`, `#427`; not a Refund Operations v1 pilot requirement):
- The steps below are retained only as audit history for the already closed held case. Do not reuse its TOTP/operator window for the current pilot; the normal signed-in mapped-manager session and current `Docs/DECISIONS.md` workflow govern new cases.
- The foundation remains default-off. For the exact support-confirmed held refund only, apply `20260820143000_refund_nayax_support_resolution_window.sql` by itself, prove the resolver true with zero operator/intent rows, then provision only the exact current mapped owner-manager. Do not call Nayax, enable broad official actions/execution, arm a machine, or use the pending-approval recovery.
- Open and verify the owner's refund-specific TOTP enrollment, prepare one `provider_confirmed_success` / `nayax_support_ticket` / `nayax_support_confirmed_success` intent using the exact `SUPPORT:NAYAX-CS#######` reference and authoritative UTC provider action time, and consume it once through the existing authenticated manager step-up. Confirm zero new provider attempts, one immutable support resolution, one reporting adjustment, one finalized case, and one sent original-thread customer completion.
- Apply `20260820150000_refund_nayax_support_resolution_close.sql` only after those checks pass. It must refuse a pending intent or unsent completed-resolution reply, revoke the temporary refund TOTP enrollment/operator, and restore `refund_nayax_outcome_resolution_enabled()` to immutable `false`. A final dry run must report zero pending migrations.
- Run `npm run refunds:validate-nayax-resolution`, `npm run db:validate-migrations`, and the focused desktop/mobile portal UAT. Require one winner under a genuine two-session race, one immutable outcome row, original provider outcome preserved, zero new provider attempt, exact function/database-owner write provenance, current manager/operator/enrollment version binding, and fresh exact-factor proof. Hold/retry-safe must create zero customer messages. Completed outcomes must create exactly one attempt-bound pending completion on the original Gmail thread, followed by one send attempt only.
- Before any later controlled activation, close `#430`'s account-specific contract questions, approve a named operator and supervised window, deploy/recheck exact release alignment, keep live provider execution/official actions/customer contact off, and use synthetic held attempts first. Enablement and operator provisioning require a separate reviewed database-owner change; there is intentionally no runtime or portal setter.
- Each operator review must use exactly one structured result/evidence/reason tuple and a prefixed non-sensitive reference. The UI/database reject card-, account-, contact-, and customer-like values; only the documented `SUPPORT:NAYAX-########` and 9- or 10-digit `DTM:NAYAX-...` numeric vendor shapes are exceptions, and durable evidence still stores only the reference digest. The portal may normalize a bare 9- or 10-digit DTM transaction identifier into that required prefix before submission. **Keep hold** changes no outcome. **Safe for fresh review** makes no provider call and advances one bounded attempt generation so a later separately authorized action has a fresh idempotency key. **Provider success** or **documented manual completion** requires the authoritative UTC payment-action time from the evidence, commits case/reporting and one pending original-thread completion atomically, then attempts only that customer reply. A safely failed reply may be retried once with the exact stored message/thread; delivery-unknown must be reconciled and no payment/provider operation may be retried. If the function or browser stops with that completion still pending, wait five minutes and use only **Recover interrupted completion**: it never sends, and atomically classifies the exact stored reply as sent from exact Gmail evidence, safely failed with one retry, or delivery-unknown with all sends blocked for reconciliation.
- Before entering the fresh code, the exact current case manager must see the frozen outcome, source, evidence result, reference, and payment-action time where applicable in the final dialog. If the operator is no longer the exact mapped manager or lacks an active durable authenticator enrollment, stop before intent creation.
- Stop on expired/changed intent, actor/mapping/operator/enrollment drift, ambiguous evidence, missing exact attempt, stale case version, or inability to prove zero provider side effects and the exact bounded message shape. Never repeat an uncertain resolution or uncertain Gmail delivery; inspect the immutable record and original thread first.

Integrated Refund UAT evidence:
- In one fresh workflow run, generate exactly 76 reviewed synthetic screenshots and exactly five sanitized JSON artifacts: `refund-portal-assertions.json`, `refund-database-counts.json`, `refund-gmail-mime-roles.json`, `refund-kill-switches.json`, and `refund-provider-outcomes.json`. The set covers the current form-only, card-network evidence, inventory/Snapcase, manual-portal-only machine state, branded-message/appeal, duplicate, source-aware queue, routine-manager isolation, Internal/test disposition/archive, and provider-free existing-refund states and contains no production data, provider identifier, QR, or TOTP.
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

Manager-aging-only rollback: set `REFUND_MANAGER_AGING_NOTICES_ENABLED=false`. If the whole scheduler must stop, first call `public.service_set_refund_automation_scheduler_enabled(false)`, then disable `REFUND_AUTOMATION_SWEEP_ENABLED` and `REFUND_AUTOMATION_ENABLED`. A disabled-lane proof must show zero fetch, claim, reservation, and send calls.

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

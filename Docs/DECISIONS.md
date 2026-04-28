# Decisions

## 2026-04-24 - Sales reporting foundation
Bloomjoy sales reporting will use account/location/machine entitlements that are separate from Plus and training access.

**Canonical reporting model**
- Reporting visibility is scoped by `customer_accounts`, `reporting_locations`, and specific `reporting_machines`.
- Users can gain report access through account membership or explicit reporting entitlements.
- Reporting access does not imply Plus membership, training access, support access, billing access, or member sugar pricing.
- Super-admins manage reporting machines, entitlements, imports, schedules, and export history from `/admin/reporting`.

**Canonical reporting data**
- Sunze sales rows are normalized into machine/date/payment facts.
- Refunds and complaints are stored separately as adjustment facts, sourced first from Google Sheets or CSV import.
- Until Sunze definitions are validated, Sunze totals are treated as net sales and gross sales is calculated as `net_sales + refund_amount`.
- Imports must be idempotent by source and stable source identifier: Sunze uses a salted source order hash, while row hashes remain available for change detection and for import types without a durable source order id.

**Automation and delivery**
- V1 uses Supabase Edge Functions for on-demand exports, scheduled partner report delivery, and locked ingest entrypoints.
- Daily Sunze extraction runs as a GitHub Actions Playwright worker because the task needs a full browser runtime. The worker receives Sunze credentials plus an ingest token, but never receives the Supabase service-role key.
- The Sunze worker uses the Orders page `Last 7 Days` preset for daily catch-up plus a monthly `Last Month` catch-up, validates the `.xlsx` workbook headers, deletes raw downloads after parsing, and sends normalized rows to `sunze-sales-ingest`.
- Sunze imports must reconcile the visible Orders UI record count and revenue against the downloaded workbook before ingesting, and must fail closed if the selected date window, payment/status mappings, or export integrity cannot be verified.
- Sunze machine discovery uses the top-level Machine Center list visible to the workflow account. `SUNZE_EXPECTED_MACHINE_COUNT` is optional and treated as an operations signal because new machines can appear before admins finish setting them up for reporting.
- GitHub dry-runs call `sunze-sales-ingest` in validation mode so Supabase row normalization and current machine setup state are checked without writing `machine_sales_facts`.
- Unconfigured Sunze machines are handled through an admin setup queue. Configured rows continue into `machine_sales_facts`; unconfigured rows are quarantined in normalized form using salted order hashes and no raw order numbers until an admin sets up the Sunze ID for a report or marks it ignored.
- The Sunze UI exposes date presets but not always concrete date endpoints; for approved presets such as `Last 7 Days`, `Last Month`, and `Last 3 Months`, the worker records the selected preset and derives an expected date window in `SUNZE_REPORTING_TIMEZONE`, then verifies all exported sale dates fall inside that window.
- Sunze order idempotency is based on a salted source order hash. The row hash remains available for change detection when a corrected export updates an already-seen order.
- Raw Sunze workbooks are not retained. Operational evidence is limited to normalized facts, salted order hashes, import-run metadata, GitHub run IDs, and admin-visible freshness/error status.
- Scheduled partner reports default to the previous Monday-Sunday week and email a private signed PDF link through the existing Resend pattern.
- The automation must not bypass CAPTCHA, MFA, or Sunze access controls, and must not open machine-level settings or `More` menus.

**Why this choice**
- Reporting needs machine-level partner visibility without granting broader customer portal or commerce permissions.
- Keeping sales facts and refund adjustments separate preserves source auditability while allowing gross/net calculations.
- This keeps browser automation separate from database authority while still allowing daily imports, idempotent writes, and clear failure auditing.

## 2026-04-25 - Admin access and reporting setup split
Admin permission work and partnership financial setup are separate concerns.

**Canonical admin surfaces**
- `/admin/access` is the single people-first admin console for account access, Plus grants, explicit machine reporting visibility, Technician grants, super-admin/scoped-admin roles, and audit history. Permission work should be grouped by the operator's goal and role scope, not exposed as redundant implementation tabs.
- `/admin/reporting` is for reporting operations: schedules, import/sync status, stale-data warnings, and export archive visibility.
- `/admin/partner-records` is for reusable external organizations and contacts that can become participants in one or more partnerships.
- `/admin/machines` is for machine identity, aliases, partner-report inclusion status, and current machine tax rates.
- `/admin/partnerships` is for guided agreement setup: partnership details, participants, assigned machines, payout rules, and weekly preview.
- Scoped Admin is a constrained internal admin role, not a reporting role workaround. Scoped admins inherit default admin capabilities for entitled machines only: machine metadata/tax edits, covered partnership setup, covered partner dashboard visibility, training access, and Technician grants. They cannot grant admin/scoped-admin roles, manage global access outside Technician grants, see global orders, or see/manage unentitled machines.

**Canonical partnership model**
- Reporting visibility remains machine-level only for V1. Partnerships do not grant inherited user access yet.
- Partnerships group machines for financial reporting, partner report setup, and payout calculations.
- Tax rates are configured on machines through effective-dated machine tax-rate records, not on partnerships.
- Partner report calculations resolve the active machine tax rate by machine and sale date before applying partnership financial rules.
- Admin setup should be task-based rather than forcing every reporting setup concern into Partnerships.
- Partnership participants are optional V1 metadata for multi-stakeholder agreements. The relationship is managed in the partnership flow, but reusable partner records have their own admin page.
- Partnership participant setup captures who is involved and their relationship role only. Report delivery recipients belong in Reporting Operations, and payout/share percentages are configured only in Payout Rules.
- Admins should see one partnership-level agreement timeline and one active/inactive partnership control. Payout-rule status and effective dates remain backend compatibility/audit fields, but normal V1 setup treats Payout Rules as the current terms for the partnership.
- Payout Rules should present allocation by actual participant name plus Bloomjoy, use whole-number percentages, show a live 100% allocation check, and map those values to the existing primary/partner/Bloomjoy backend fields for compatibility. V1 supports two payout participants plus Bloomjoy until the backend model expands.
- Partnership machine assignment is a current-state bulk alignment workflow. Assignment role, status, notes, and effective date windows remain backend compatibility fields but are defaulted/archived by the UI rather than exposed in normal setup.
- Machine tax-rate history stays effective-dated in the backend, but normal admin editing happens from the Machines page and focuses on current machine rates, with explicit no-tax machines distinguishable from missing tax configuration.
- Initial documented machine tax rates default to a hidden `2026-01-01` effective start for reporting history. Future tax changes stay effective-dated but are captured through a simple "new rate + applies from" workflow.
- Setup warnings should appear where an admin can act: machine tax and assignment readiness on Machines, assignment overlap in the partnership Machines step, financial-rule gaps in Payout Rules, and preview-specific issues in Weekly Preview.
- Weekly Preview must explain setup/data blockers in-page, especially when assignment coverage, payout-rule coverage, or imported sales do not cover the selected reporting week.
- Bubble Planet reporting parity uses Sunze `Order amount` as gross sales, subtracts machine-rate tax plus configured stick-level cost deductions before the split, counts no-pay orders as orders/items with `$0` sales and `$0` deductions, and supports a participant-named 60/40 split when configured that way.
- Admin UI should avoid example-specific partner names and avoid exposing abstract backend split labels when participant names can be shown directly.
- Weekly partner previews must use the partnership's configured week-ending day. Bubble Planet-style weekly reporting is Monday-Sunday with a Sunday week-ending date.

**Why this choice**
- Admins think about permissions person-first, while partnership setup is about financial reporting and contractual grouping.
- Keeping user access machine-level avoids hidden permission inheritance while the reporting feature is still new.
- Machine-level tax rates reflect real operating differences and keep tax changes auditable over time.
- Separating Partner Records and Machines reduces partnership setup friction while keeping the common create-new-record path available from the participant dropdown.

## 2026-04-25 - Reporting migration repair and schema-cache checks
Production reporting/admin RPC fixes must move forward through new migrations, not edits to migrations Supabase already marked applied.

**Canonical migration rule**
- Do not rely on editing an already-applied migration to repair production. Supabase will not replay it.
- Do not reuse migration timestamps across feature branches; if a collision reaches `main`, add a later forward-only repair migration that makes the intended schema explicit.
- If production is missing tables, RPCs, grants, or function definitions from an already-applied migration, add a later forward-only, idempotent repair migration.
- Frontend-facing RPC migrations should end with `select pg_notify('pgrst', 'reload schema');` so PostgREST refreshes function metadata.
- Production validation for admin/reporting RPC changes must include direct REST probes that confirm key RPCs do not return `404` or `PGRST202`.

**Why this choice**
- The reporting admin outage came from schema drift: production had an older migration version marked applied before the final admin/partnership RPCs existed.
- Forward repair migrations keep repo history and production history aligned without manual rollback or destructive database operations.

## 2026-04-25 - Corporate partner reporting first deliverable
The next P0 reporting milestone is a trusted corporate partner report that Bloomjoy can review before sending.

**Canonical V1 delivery**
- Super-admins generate corporate partner reports from `/admin/partnerships` after partnership setup, machine assignments, tax assumptions, and financial terms are configured.
- Manual super-admin review comes before scheduled auto-email. Scheduled delivery remains future automation after the report content and math are trusted.
- Corporate partners do not get inherited portal access from partnership setup in V1. Partner-facing value is delivered through reviewed PDFs first.
- Operator performance dashboards are deferred until the corporate partner review/download workflow is accepted.
- Partner dashboard UX/CX can be designed in parallel, but it is not required for the first reviewed-PDF milestone.

**Canonical partner report**
- The PDF should be a polished settlement artifact, not the current simple text-style sales export.
- Required report shape: executive summary, reporting period, gross sales, tax impact, net sales, unit/fee/cost assumptions, split calculation, amount owed, machine-level appendix, warning states, generated timestamp, and snapshot ID.
- Generated partner reports must have auditable snapshot/run records with period, rule version, assumptions, generated-by user, status, recipients/download metadata, storage path, and any warnings.

**Canonical dashboard direction**
- The reporting tab should default to an operator-style view for the user's assigned machines.
- A partner dashboard view should appear only when the access context grants partner-dashboard visibility.
- V1 partner dashboard visibility is available to super-admins and to scoped admins only when every active partnership machine is inside the scoped admin's entitled machine set. Partner Viewer remains a separate future persona.
- The browser dashboard should emphasize smooth period controls, summary KPIs, machine-level rollups, warning states, and calculation transparency; the PDF remains the formal settlement artifact.

**Canonical rule approach**
- Revenue-share rules should be typed and configurable: week-ending day, machine tax method, fee basis, cost basis, split base, and share percentages.
- Bubble Planet-style reporting is the first validation fixture, but the implementation must not hardcode Bubble Planet-specific names or terms into the calculation model.
- Do not introduce a new reporting platform, CMS, or headless reporting service for this milestone.

**Why this choice**
- The business risk is partner trust, so reviewed and explainable numbers matter more than early automation.
- A typed rule model supports multiple partnership patterns without building an unsafe open-ended formula engine.
- Keeping partner delivery PDF-first avoids expanding the permission model before the internal reporting process is stable.

## 2026-04-14 - Training-only operator access grants
Bloomjoy now supports a narrow operator access tier for staff who need training without becoming paid Bloomjoy Plus members.

**Canonical access model**
- `baseline`: authenticated customer basics only (`/portal`, orders, account).
- `training`: operator training access only (`/portal`, `/portal/training*`, training progress, and certificate flow).
- `plus`: full Bloomjoy Plus portal access (`training`, onboarding, support, customer account tools, and Plus commerce benefits).
- `super_admin`: internal operations access; treated as `plus` for portal gating.

**Grant model**
- Active Bloomjoy Plus members and super-admins can grant training-only operator access by email.
- Operator grants are stored separately from Stripe-backed `subscriptions` so they do not create Plus billing, sugar pricing, support, or onboarding entitlements.
- If a Plus sponsor loses active/trialing subscription status, their sponsored operator grants stop conferring training access until Plus is active again.

**Why this choice**
- Operators often need training materials but should not inherit account-owner commerce, billing, support, or onboarding workflows.
- Keeping operator training separate from free Plus grants avoids confusing unpaid training seats with customer membership benefits.
- Email-based grants let the operator sign in later with the same address without requiring a full invitation system in this slice.

## 2026-04-06 - Emergency commerce remediation: Plus-only sugar pricing, durable order capture, and customer confirmations
For sugar ordering, Bloomjoy Plus members receive the discounted rate and all other buyers pay the public rate.

**Canonical pricing**
- Bloomjoy Plus members (`subscriptions.status in ('active', 'trialing')`) pay **`$8/kg`**
- All other customers, including anonymous buyers, pay **`$10/kg`**
- Free shipping remains in effect for sugar orders for now

**Canonical order-processing choices**
- Sugar pricing is enforced **server-side** in `stripe-sugar-checkout`; the client may display pricing but does not decide the Stripe price ID.
- `orders` must persist the operational order snapshot before any email or WeCom notification is attempted.
- Order records must retain customer contact details, billing/shipping address snapshots, pricing tier, unit price, shipping total, receipt URL, and line-item order breakdown.
- Customer order confirmations are sent by the app via Resend in addition to the Stripe receipt.
- Notification channel failures must be recorded on the `orders` row and must not block order persistence.
- Production release verification for commerce must fail if required Stripe/Resend/WeCom secrets are missing.

**Why this choice**
- The April 6 incident showed that public sugar checkout was incorrectly charging the member rate to everyone.
- The webhook runtime bug prevented paid orders from being captured in Supabase at all.
- Internal visibility cannot depend on a single notification channel succeeding.
- Ops needs order data inside Bloomjoy Hub, not only inside Stripe.

## 2026-03-22 - Split the operator app from the public marketing site
Bloomjoy now uses three host roles:

- `www.bloomjoyusa.com` for public marketing, storefront, and legal pages
- `app.bloomjoyusa.com` for operator login, password reset, portal, and admin workflows
- `auth.bloomjoyusa.com` for Supabase/Auth callback infrastructure

**Why this choice**
- Logged-in operators should not stay inside the public sales navbar/footer shell.
- The operator experience should feel like an application, not a marketing site with gated tabs.
- This keeps the change incremental in the existing Vite SPA and Vercel deployment instead of introducing a second frontend codebase.

**Implementation notes**
- Public routes stay indexable only on `www`.
- App routes stay `noindex` and are excluded from the public sitemap.
- `www` requests for `/login`, `/reset-password`, `/portal*`, and `/admin*` redirect to `app`.
- `app` requests for public marketing/storefront routes redirect back to `www`.
- `/login/operator` remains a temporary alias that canonicalizes to `/login`.

Record decisions here so agents don’t “thrash” the stack.

## 2026-01-11 — Starting point and baseline stack (Loveable POC)
We are **not starting from scratch**. The current codebase started as a Loveable-generated proof-of-concept.

**Canonical baseline (keep unless a new decision says otherwise):**
- Frontend: **Vite + React + TypeScript**
- UI: **Tailwind CSS + shadcn/ui**
- Routing: reuse what the POC already uses; if missing, default to **react-router-dom (v6+)**
- Auth + DB (recommended): **Supabase (Auth + Postgres + Storage)**  
- Payments (recommended): **Stripe**
  - Important: Stripe secret keys must be used **server-side only** (never exposed as `VITE_` env vars)

Rationale:
- We already have a working POC in this stack → fastest path is incremental hardening + extension.
- Supabase + Stripe reduce custom backend surface area for MVP.

**Note:** `Docs/BUSINESS_CONTEXT.md` contains an older “suggested technical approach” (Next.js). That section is not canonical—this file is.

## 2026-01-11 — Server-side surface for Stripe
Because this is a Vite SPA, we still need a **server-side component** for:
- Creating Stripe Checkout Sessions
- Handling Stripe webhooks (subscription/order state sync)

Approved options (pick one early; record the final choice here):
1) **Vercel Functions** in `/api/*` (simple monorepo, good DX)
2) **Netlify Functions** in `/.netlify/functions/*`
3) **Supabase Edge Functions** (keeps infra in Supabase)

Until the option is chosen, keep integrations modular (thin client wrappers + clear boundaries).

## 2026-02-02 - Stripe server-side surface choice
We will use **Supabase Edge Functions** for Stripe Checkout and webhook handling.

**Why this choice**
- Hosting-agnostic: the Vite SPA can be hosted anywhere while functions live with Supabase.
- Tight integration with Postgres for webhook-driven state sync.
- Server-only secrets live in Supabase Function Secrets (no VITE_ exposure).
- Minimal, reversible changes: add edge functions and call them from the SPA.

## Open questions (resolve early)
- Hosting target: Vercel vs Netlify vs other (impacts serverless function layout)
- Machines purchase flow in MVP:
  - Quote-only for all machines? or “Buy now” for Micro?
- Membership perks in MVP:
  - Sugar discount vs shipping perk vs both vs neither
- Lead capture destination in MVP:
  - Supabase table vs email provider (Resend/Postmark) vs both

## 2026-01-22 — Training video hosting (MVP)
We will use **Vimeo (Starter/Standard)** for the training library MVP.

**Why this choice**
- Fastest embed path with a reliable player for a Vite React SPA.
- Domain-level embed restrictions provide basic protection.
- Works with Supabase RLS for gating catalog access.

**MVP implementation notes**
- Store training metadata and assets in Supabase tables (`trainings`, `training_assets`).
- Store `provider_video_id` + `provider_hash` (for unlisted embeds).
- Embed via iframe: `https://player.vimeo.com/video/{videoId}?h={hash}&dnt=1`.
- Restrict embeds to approved domains in Vimeo settings.

## 2026-01-22 — Membership gating source of truth (MVP)
We will use a **dedicated `subscriptions` table** synced from Stripe webhooks as the source of truth for membership status.

**Why this choice**
- Avoids relying on client-managed flags for access control.
- Enables accurate access decisions using Stripe subscription state.
- Supports future upgrades (multiple plans, seats, trials).

**MVP implementation notes**
- Use RLS policies that allow training data when the subscription status is `active` or `trialing`.
- Optional: keep a denormalized `profiles.is_member` flag as a cache, but derive it from `subscriptions` only.

## 2026-04-14 — Plus flat account pricing (supersedes 2026-02-21)
We will price Bloomjoy Plus at **$100 per month per customer account**.

**Pricing model**
- Single recurring Stripe price (`STRIPE_PLUS_PRICE_ID`) set to $100/month
- Checkout quantity is always `1`
- Monthly charge is a flat `$100`

**MVP scope choice**
- Keep webhook and `subscriptions` schema unchanged for membership gating compatibility
- Machine inventory stays in the admin portal for operational context only
- Existing live subscriptions with quantity greater than `1` will be adjusted manually in Stripe by the billing owner

## 2026-02-23 - Super-admin MVP role model and operations choices (`#37`)
For MVP admin operations, we will use a single internal role and keep workflow complexity minimal.

**Approved choices**
- Internal role model: `super_admin` only for MVP (no `ops_agent` in MVP)
- Support ticket statuses: `new`, `triaged`, `waiting_on_customer`, `resolved` (optional terminal `closed`)
- Machine count source of truth: app-managed machine count in admin portal is authoritative for operations
- Ticket notifications: defer email alerts for MVP; monitor via admin queue dashboard

**Why this choice**
- Minimizes authz/RLS complexity while landing core operations capability quickly.
- Keeps support workflow reportable without over-modeling states too early.
- Allows operations to maintain real-world machine inventory independent of billing timing.
- Avoids notification plumbing in MVP and keeps scope focused on secure admin workflows.

## 2026-02-26 - Temporary admin email allowlist for auth/training QA (`#75`)
To unblock local QA while role provisioning catches up, we temporarily allow two known owner emails to behave as admin in app auth and training-access checks:
- `etrifari@bloomjoysweets.com`
- `ethtri@gmail.com`

This is a temporary release aid, not the long-term authorization model.

Follow-up requirement:
- Remove static email allowlist before production and rely on `admin_roles` + RLS as the only source of admin access.

## 2026-02-26 - Training thumbnails strategy for Vimeo Module 1 (`#75`)
Training library cards use Vimeo-based thumbnails derived from `provider_video_id`:
- `https://vumbnail.com/{video_id}.jpg`

Rationale:
- Fast, no-backend thumbnail path for current MVP scope.

Follow-up requirement:
- Move to first-party thumbnail URLs stored in `training_assets.meta.thumbnail_url` (or Supabase Storage) for production durability.

## 2026-03-01 - First-party training thumbnail strategy (`#79`)
Training library cards now prefer first-party thumbnail values from `training_assets.meta.thumbnail_url`.

**Storage convention**
- `thumbnail_url` stores either:
  - a public URL (`https://...`) when provided by operations, or
  - a Supabase Storage object key in bucket `training-thumbnails` (example: `vimeo/<video_id>.jpg`).

**Why this choice**
- Removes runtime dependency on third-party thumbnail host availability.
- Keeps thumbnail source controlled by Bloomjoy infrastructure and data.
- Supports environment-specific Supabase hosts without hardcoded thumbnail domains.

**Implementation notes**
- Frontend resolves storage keys via `supabaseClient.storage.from('training-thumbnails').getPublicUrl(...)`.
- Default visual fallback remains first-party (`/placeholder.svg`) for rows missing a thumbnail value.

## 2026-03-02 - Internal quote/order notification email provider
We will use **Resend** from Supabase Edge Functions for internal operations notifications.

**Scope**
- Quote request notifications from `lead-submission-intake`.
- Sugar order notifications from `stripe-webhook` (`checkout.session.completed` payment mode).

**Why this choice**
- Keeps email API keys server-side only in function secrets.
- Minimal change surface: no client secret exposure and no new frontend provider SDK.
- Fast to implement with plain HTTPS calls from Deno edge functions.

## 2026-03-02 - Auth transactional email provider for launch hardening (`#77`)
For production auth email branding and deliverability, we will use **Resend** as the SMTP provider for Supabase Auth emails.

**Why this choice**
- Fastest path to branded sender setup for launch timelines.
- Clear domain authentication workflow (SPF/DKIM) with strong deliverability posture.
- Keeps implementation minimal by using Supabase Auth SMTP configuration (no app rewrite).

**Implementation notes**
- Configure and verify Bloomjoy sender domain in Resend.
- Use Resend SMTP credentials in Supabase Auth email settings for signup confirmation, magic link, and recovery templates.
- Record final test evidence in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.

## 2026-03-09 - Machine sales-sheet baseline (commercial/mini) + micro pricing correction
To keep sales copy and quote intake consistent with current sales materials, we will align machine pricing/wrap language to the latest internal sales-sheet inputs.

**Canonical updates**
- Micro machine target/list price for current sales messaging: **`$2,200`**.
- Commercial machine wrap options must show:
  - Standard Bloomjoy wrap.
  - Custom wrap, explicitly marked as **Commercial-only** and handled offline by the Bloomjoy design team.
- Mini and Micro should not advertise a custom wrap option in MVP copy/flows.

**Source documents reviewed (internal)**
- `Commercial Sales Sheet.pdf` - Quote `20260201B3` dated `2026-02-01` (price effective `2026-05-30`).
- `Mini Sales SHeet.pdf` - Quote `20260228Mini` dated `2026-02-28` (price effective `2026-05-31`).

**Implementation notes**
- Keep custom wrap handling as a manual design handoff (no self-serve design builder in MVP).
- Ensure public product copy, quote CTA language, and smoke checklist coverage stay aligned to these rules.

## 2026-03-10 - WeCom as the internal ops-alert POC channel
For current operations-event alerting, we will use **WeCom app messaging** from Supabase Edge Functions (quote, order, and support events).

**Scope**
- Quote submission alerts (`lead-submission-intake`)
- Sugar order alerts (`stripe-webhook`)
- Support request alerts (`support-request-intake`)

**Why this choice**
- Keeps WeCom credentials server-side only (`WECOM_*` function secrets).
- Aligns to actual ops communication channel without changing customer-facing auth flows.
- Adds non-blocking behavior so core quote/order/support flows continue if WeCom is unavailable.

**Implementation notes**
- Token lifecycle handled server-side with cached `access_token` fetch/refresh.
- Recipient fanout controlled by `WECOM_ALERT_TO_USERIDS` (comma-separated user IDs).
- WeCom dispatch failures are logged as warnings and do not fail core business transactions.

## 2026-03-10 - WeChat onboarding concierge intake model
To reduce WeChat onboarding friction, we will treat onboarding blockers as a first-class support request type.

**Canonical model**
- `support_requests.request_type` includes `wechat_onboarding`.
- Structured onboarding context is stored in `support_requests.intake_meta` (JSON), including:
  - `phone_region`
  - `phone_number`
  - `device_type`
  - `blocked_step`
  - `referral_needed`
  - optional `wechat_id`

**Why this choice**
- Keeps portal intake simple while giving ops consistent triage data.
- Avoids one-off DM triage by standardizing onboarding requests in existing support queue tooling.
- Preserves backward compatibility with existing support request status/priority/admin-audit flows.

## 2026-03-19 - Training tracks, progress, and lightweight completion certificate
To improve training findability without introducing a full LMS, we will expand the member training experience with curated tracks, server-backed progress, and one lightweight completion certificate.

**Canonical choices**
- Organize discovery around operator tasks first (`Start Here`, `Software & Payments`, `Daily Operation`, `Cleaning & Maintenance`, `Troubleshooting`) while keeping module tags available.
- Keep using the existing `trainings` and `training_assets` tables as the content foundation.
- Add `training_tracks`, `training_track_items`, `training_progress`, and `training_certifications` for curated paths, persisted completion, and certificate issuance.
- Keep full training documents member-only in a private Supabase Storage bucket (`training-documents`) when original PDFs are uploaded.
- Support exactly one v1 certificate: **Bloomjoy Operator Essentials**.

**Why this choice**
- Makes training easier to find by intent instead of forcing users to remember module numbers.
- Preserves the existing Vimeo + Supabase architecture and avoids an LMS rewrite.
- Gives Bloomjoy a completion signal and certificate path without adding quiz or manual-review complexity.
- Keeps protected training documents behind the same membership model as the rest of the portal.

**Implementation notes**
- Document-first guides can ship immediately from curated in-app content while original PDFs are uploaded separately through the operations helper script.
- Certificate issuance is validated server-side via Supabase RPC after all required track items are marked complete and the final acknowledgement is confirmed.
- This is intentionally a lightweight completion credential, not a quiz-based certification system.

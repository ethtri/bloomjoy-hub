# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.
- Write updates in plain language so non-technical readers can follow.

## Sales reporting foundation snapshot (2026-04-24)
- Production runtime hotfix branch `agent/fix-reporting-chart-runtime` removes the forced Recharts manual chunk split that caused the app shell to crash with `Cannot access 'P' before initialization` after the reporting deployment.
- Sales reporting is being added as a Supabase-backed extension to the existing operator app on branch `agent/sales-reporting-foundation`.
- This slice adds account/location/machine reporting entitlements, normalized sales facts, refund adjustment facts, import run audit records, export snapshots, partner schedules, and private PDF export storage.
- The portal now has `/portal/reports` for entitled users, with date/grain/location/machine/payment filters and on-demand PDF export.
- Admin access and reporting operations are being split into clearer surfaces:
  - `/admin/access` is the single admin place for users, Plus grants, global roles, audit history, and explicit machine-level reporting access.
  - `/admin/partnerships` is the setup area for partners, partnerships, machine assignments, machine-level tax rates, and financial rules.
  - `/admin/reporting` is focused on report schedules, import/sync status, freshness, and export archive visibility.
- Reporting visibility remains machine-level only for V1. Partnerships are for financial reporting and grouping, not permission inheritance.
- Tax rates are configured directly on machines with effective dates, not on partnerships.
- The Bubble Planet workbook baseline uses Sunze order amount as gross sales, subtracts machine tax plus a configured `$0.40` paid-order fee before the 60/40 split, counts no-pay orders as `$0`, and reports completed Monday-Sunday weeks.
- Manual CSV import helpers and sample files are available before production sync is enabled.
- Sunze browser automation is now implemented as a scheduled GitHub Actions Playwright worker that exports the Orders workbook with the safe `Last 3 Days` preset, deletes the raw workbook after parsing, and sends normalized rows to the locked `sunze-sales-ingest` Edge Function.
- `Docs/SUNZE_SALES_DISCOVERY.md` records the validated Sunze routes, export headers, payment/status mappings, and remaining open questions without storing credentials or raw order data.
- Google Sheets complaints/refunds ingestion is represented as a server-side adjustment sync stub plus a CSV import helper. Production Sheets API ingestion still depends on confirming the sheet columns and service-account setup.
- Open overlap to watch: issue `#150` and PR `#151` cover the broader account/entitlement roadmap, while open PR `#143` contains older partner/operator account schema work that may overlap the new `customer_accounts` foundation.

## Mini launch update (2026-04-09)
- Mini is now live on the public site as a sales-led machine offer at `$4,000`.
- Public Mini demand no longer goes to a waitlist form:
  - `/machines/mini` now routes into the standard quote/contact flow
  - Home and `/machines` now present Mini as available now instead of coming soon
  - historical `mini_waitlist_submissions` data remains for ops reference only

## Supplies ordering UX simplification (2026-04-14)
- `/supplies` now guides visitors into one ordering path at a time instead of showing sugar, branded sticks, and custom sticks workflows all at once.
- The page supports direct links for `/supplies?order=sugar`, `/supplies?order=sticks`, and `/supplies?order=custom`.
- Sugar still uses the 400 KG default equal split, with color-level adjustments tucked behind a "Customize Color Mix" control.
- Bloomjoy branded sticks keep the existing under-5-box confirmation path and 5+ box direct checkout path, while custom sticks now have their own focused request flow.

## Public CX polish audit (2026-04-16)
- A public-site CX/UX/UI audit confirmed the biggest polish issues were flow clarity and mobile resilience, not a need for a redesign.
- Micro Machine is now treated as quote-led for this remediation: `/machines/micro` should send visitors to `/contact?type=quote&interest=micro&source=/machines/micro`, keeping the shared cart sugar-only.
- Confirmed remediation targets:
  - Micro direct-cart behavior and cart empty-state copy
  - cart line-item mobile overflow resilience
  - excessive hero-to-content spacing on `/machines`, `/resources`, `/plus`, and `/contact`
  - associated labels and input semantics on the contact form
  - accessible names for mobile icon-only navigation controls and product-gallery thumbnails
- This is tracked as a P1 backlog item and should stay incremental: no CMS, schema, Stripe machine-checkout, or platform change is included.

## Emergency commerce remediation snapshot (2026-04-06)
- A production payments incident was confirmed on `2026-04-06`:
  - sugar checkout was publicly charging the Bloomjoy Plus member rate (`$8/kg`) instead of the public rate (`$10/kg`)
  - `stripe-webhook` was failing on every invocation because it used synchronous Stripe signature verification instead of `await constructEventAsync(...)`
  - paid orders were therefore not being persisted into `public.orders`
  - internal email / WeCom notifications and customer confirmations were not reliably sent
- Production remediation is now deployed on `main`:
  - server-enforced sugar pricing (`$8/kg` Plus, `$10/kg` everyone else)
  - repaired Stripe webhook parsing and durable order snapshot persistence
  - expanded order records for contact, address, pricing tier, shipping total, receipt URL, and channel-specific notification status
  - app-generated customer confirmation emails
  - admin order detail visibility for address, pricing tier, sugar color mix, receipt, and notification status
  - operational helpers: `npm run commerce:preflight` and `npm run orders:backfill`
- April 6 production follow-through completed:
  - production secrets were updated for tiered sugar pricing
  - the live `$10/kg` non-member Stripe sugar price was created and wired into checkout
  - the April 6 paid sugar orders were backfilled into `public.orders`
  - a follow-up live `$0` smoke order confirmed internal email and customer confirmation delivery through the repaired webhook
- Customer confirmation email redesign is also deployed on `main`:
  - replaces the raw plain-text confirmation body with a branded HTML order email
  - keeps the plain-text fallback for mailbox clients that do not render HTML
  - presents totals, shipping details, item breakdown, receipt access, and support next steps in a customer-friendly layout
- Remaining production issue:
  - WeCom token auth now succeeds, but live message sends are still blocked by WeCom IP policy (`60020: not allow to access from your ip`)
  - internal email and customer confirmation email are currently working in production
- Verified on `2026-04-06` by:
  - `node scripts/commerce-preflight.mjs --project-ref ygbzkgxktzqsiygjlqyg`
  - a live `$0` Stripe checkout smoke order after the webhook email redesign deployment

## Next P0 milestones
- Clear the remaining WeCom production blocker:
  - confirm whether the Bloomjoy Alerts app enforces an IP allowlist or trusted network restriction in WeCom
  - update the WeCom app policy so Supabase Edge Function traffic can send messages successfully
  - re-run the live `$0` order smoke test and confirm `wecom_alert_sent_at` populates in `public.orders`
- Unblock and complete issue `#99` (dedicated Resend account for `bloomjoysweets.com`) so production auth and transactional email ownership can move off the currently blocked setup.

## Operator app surface split (2026-03-22)
- Authenticated operator routes now have a dedicated application shell and canonical host instead of inheriting the public sales navbar/footer.
- Canonical host roles for this slice:
  - `https://www.bloomjoyusa.com` for public marketing/storefront pages
  - `https://app.bloomjoyusa.com` for `/login`, `/reset-password`, `/portal*`, and `/admin*`
  - `https://auth.bloomjoyusa.com` for Supabase/Auth callback infrastructure
- Host behavior now expected:
  - `www` redirects app-only routes to `app`
  - `app` redirects public marketing/storefront routes back to `www`
  - `/login/operator` stays available as a temporary alias to `/login`
- Operator UX changes delivered in this slice:
  - login and reset-password now render inside the app shell
  - portal and admin no longer render the public footer or sales-oriented top navigation
  - the public navbar now sends operators to the canonical app host
- This supersedes the narrower “operator login page only” follow-up if that branch/PR is still open.

## Training experience upgrade snapshot (2026-03-19)
- New training experience slice delivered on branch `codex/training-experience-upgrade`:
  - Task-first training discovery now sits on top of the existing Vimeo catalog (`Start Here`, `Software & Payments`, `Daily Operation`, `Cleaning & Maintenance`, `Troubleshooting`).
  - Added curated `Operator Essentials` track, server-backed `training_progress`, and lightweight `training_certifications` support.
  - Added document-first training guides based on `Software setup.pdf` and `Cotton Candy Maintenance Guide.pdf`, alongside the existing video library.
  - Dashboard training recommendations are now live and progress-aware instead of static placeholders.
  - Public `/plus` and `/resources` teasers now match the upgraded training promise, including the operator certificate path.
- Training hub findability follow-up delivered on branch `codex/training-hub-ux`:
  - Simplified `/portal/training` around one clear operator path (`Start Here`), task-based navigation, persistent search, and hidden advanced filters instead of a dense wall of equal-weight controls.
  - Moved certificate actions into a clearly secondary section so the main learning path stays focused on getting operators to the right video or guide quickly.
  - Added a shared training catalog manifest for curated track assignment, featured content, start-here flags, and stable fallback mapping when Vimeo titles change.
  - Added `scripts/sync-vimeo-training-catalog.mjs` to audit Vimeo uploads against Supabase, flag unmapped/duplicate/stale rows, and upsert missing catalog entries.
  - Follow-up catalog cleanup on `2026-03-20`: explicit MG320 Vimeo mappings now cover the full canonical 61-video library, duplicate Vimeo uploads are suppressed from the operator-facing portal library, and Supabase-backed guide rows match by title so they stay in the intended task tracks instead of collapsing into `Reference`.
  - Added `scripts/dedupe-training-catalog.mjs` on `2026-03-20` so duplicate Vimeo-backed Supabase rows can be marked `draft` without deleting the underlying Vimeo uploads.
  - UAT feedback hardening on `2026-03-20`: the `Explore the full library` CTA now scrolls operators directly into the searchable library, training detail routes accept fallback guide IDs so checklist/manual actions keep working during catalog hydration, and the timer / maintenance guide content now reflects the source PDFs with concrete schedules, cooldown guidance, cleaning hotspots, and debug-page checks.
  - Vimeo thumbnail metadata refreshed on `2026-03-20`: `scripts/sync-vimeo-training-catalog.mjs` now overwrites stale storage-path thumbnails with live Vimeo URLs and stores a dedicated `vimeo_thumbnail_url` fallback so operator cards stop rendering blank/gray media panels when old storage objects are missing.
  - Operator job-aid expansion on `2026-03-20`: added four new document-first assets (`Timer Control Reference`, `Safe Power Off and Cooldown`, `Daily Cleaning Hotspots`, `Consumables Loading Reference`) plus inline visual support for source-derived guide figures in training detail.
  - Added `scripts/sync-training-guides.mjs` on `2026-03-20` to keep the Supabase-backed guide/checklist rows aligned with the local portal content and attach the uploaded source PDFs as signed-download resources.
  - Source-document operations completed on `2026-03-20`: `Software setup.pdf` and `Cotton Candy Maintenance Guide.pdf` were uploaded to the private `training-documents` bucket and all 11 guide/checklist rows now have attached PDF storage paths in Supabase.
  - UX polish follow-up logged on `2026-03-20` as issue `#125` and added to the GitHub project board so the next slice stays focused on hierarchy, visual density, and authenticated operator QA instead of more catalog plumbing.
  - UX polish follow-up delivered on `2026-03-20`: `/portal/training` now centers one dominant CTA, folds the old featured layer into compact quick job aids near the library entry, sends task-path clicks directly into the filtered library view, tightens mobile spacing, and keeps certificate treatment visually secondary.
  - Training detail polish delivered on `2026-03-20`: document-first guides now separate companion `Use during this task` aids from true downstream `Recommended next task` links, with supporting resources grouped into a more scannable secondary section.
  - Training library reframe delivered on `2026-03-20`: the portal training library now browses canonical operator tasks instead of separate sibling video/checklist rows, absorbed legacy routes (`safe-power-off-and-cooldown`, `cleaning-and-hygiene-checklist`, `module-function-check-guide`, `sugar-loading-best-practices`) resolve to the unified task page, and quick aids/manuals now surface as secondary references instead of equal-weight library cards.
  - Source-manual content upgrade delivered on `2026-03-20`: shutdown, timer, cleaning, and consumables task pages now use the original `Software setup.pdf` and `Cotton Candy Maintenance Guide.pdf` as written/visual source material, including inline screenshots from the PDFs instead of text-only companion pages.
  - Authenticated QA blocker on `2026-03-20`: browser automation reached the login screen at `http://127.0.0.1:8082/portal/training`, but no Plus/admin test session was available in-session, so final authenticated hierarchy confirmation for the task-first library stopped at auth after local build/lint verification.
  - Authenticated agent QA completed on `2026-03-21`: a temporary Plus/super-admin test account is now available for browser automation, quick aids/manuals again resolve into the secondary reference surface instead of leaking into the main task library, and `provider_video_id=1167976486` was corrected in Vimeo + Supabase to `Unlock Machine Door (Physical Service Access)` under `Build / Assembly`.
  - Training card-thumbnail coverage delivered on `2026-03-22`: `/portal/training` now resolves guide/checklist/manual card art through shared thumbnail metadata plus existing source-manual visuals, non-video cards can render intentional images instead of blank gradient placeholders, and no new stock/AI assets were needed for the current visible gaps.
- Verification run on this branch:
  - `npm ci`
  - `npm run build`
  - `npm test --if-present` (no test script present)
  - `npm run lint` (passes with existing fast-refresh warnings only)

## Session closeout snapshot (2026-03-10)
- PR `#108` merged: WeCom internal-alert POC is now wired server-side for quote/order/support events with non-blocking failure handling.
- PR `#109` merged: portal + admin support now include WeChat onboarding concierge intake (`request_type=wechat_onboarding` + structured `intake_meta`) and queue filtering/metrics.
- New follow-up issue opened and added to project board: `#110` (operationalize WeCom alert reliability + WeChat onboarding concierge runbook/SLA).

## SEO production verification snapshot (2026-03-09)
- Verified live on `https://www.bloomjoyusa.com` after merge of PRs `#100` and `#101`:
  - Public routes direct-load with `200` (`/machines`, `/supplies`, `/plus`, `/resources`, `/contact`, legal routes).
  - Private/auth routes return `200` with `noindex` controls (`meta[name="robots"]` + `X-Robots-Tag` on `/portal`, `/admin`, `/login`).
  - `robots.txt` is reachable and includes sitemap reference.
  - `sitemap.xml` is reachable and lists public marketing/legal routes.
  - Legacy routes redirect permanently:
    - `/products` -> `/machines` (`308`)
    - `/products/mini` -> `/machines/mini` (`308`)
  - Public page source includes route-specific metadata + JSON-LD (`Organization`, `WebSite`, `WebPage`).
- Follow-up needed:
  - Apex domain still responds with `307` redirect to `https://www.bloomjoyusa.com/` (host canonicalization works, but permanent redirect expectation is not yet met at edge/domain level).

## Sales information alignment (2026-03-09)
- Source sales sheets reviewed:
  - `Commercial Sales Sheet.pdf` (Quote `20260201B3`, dated `2026-02-01`, price effective `2026-05-30`)
  - `Mini Sales SHeet.pdf` (Quote `20260228Mini`, dated `2026-02-28`, price effective `2026-05-31`)
- Canonical updates for this correction slice:
  - Micro machine target price is `$2,200` (legacy `$400` references should be removed).
  - Custom wrap is available **only** for the Commercial machine offering, with two wrap choices:
    - Standard Bloomjoy wrap option.
    - Custom wrap option with explicit note that final design/artwork is handled offline by the Bloomjoy design team.
- Implementation status on branch `agent/sales-doc-updates`:
  1) Completed: aligned machine pricing/copy sources and machine detail pages to the updated sales-sheet values.
  2) Completed: updated commercial quote/CTA copy to explain custom wrap handoff expectations.
  3) Completed: verification run (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`).

## UAT feedback intake (2026-03-02)
Execution order is based on launch risk and dependency overlap.

### Execution snapshot (2026-03-02)
- PR `#97` (UAT follow-up) is open into `main` and not merged yet; changes are not live on production `main` yet.
- PR `#96` is also open and overlaps `Docs/CURRENT_STATUS.md`; branch sync/re-verify is required after `#96` merges.
- PR checks currently passing for both open PRs:
  - GitHub `verify` workflow: pass
  - Vercel preview checks on `#97`: pass
- Supabase remote migrations were pushed successfully to project `ygbzkgxktzqsiygjlqyg`, including:
  - `202603020001_custom_sticks_artwork_intake.sql`
- Auth preflight status in this worktree:
  - `npm run auth:preflight`: pass with canonical operator-app values on `app.bloomjoyusa.com`
  - `npm run auth:preflight -- --require-custom-auth-domain`: expected fail until custom auth domain cutover is completed (`auth.bloomjoyusa.com`)

1) **P0 - Auth redirect/domain cutover recovery (Google login)**
- UAT signal: Google callback had been landing on `localhost:3000` (`ERR_CONNECTION_REFUSED`) instead of the live domain flow.
- Recovery evidence (2026-03-19):
  - User-captured live Google login initially returned to `http://localhost:3000/#access_token=...` with no `/portal` path.
  - Repo audit confirmed the app requests `${window.location.origin}/portal` for Google OAuth redirect, pointing to stale Supabase Site URL and/or missing allowlist entries for `https://www.bloomjoyusa.com`.
  - After owner dashboard updates, live Google login now completes successfully back to the site.
- Remaining follow-up:
  - Merge the auth-host guidance PR and keep `npm run auth:preflight` aligned to canonical `https://www.bloomjoyusa.com` plus apex alias redirects.
  - Capture final callback-host and consent-screen evidence in launch sign-off docs.
  - Keep the Supabase project-ref domain on the chooser as an expected temporary state until `auth.bloomjoyusa.com` is enabled and cut over.
- Owner dependency: Google Cloud + Supabase dashboard branding/custom-domain execution remain owner-controlled.

2) **P1 - Machine naming consistency**
- UAT signal: machine naming is asymmetric in wording length.
- Plan:
  - Create one canonical display-name set for list/detail/footer/FAQ usage (Commercial/Mini/Micro naming rules).
  - Apply consistently across machines listing, machine detail breadcrumbs/headers, Resources FAQ copy, and shared product metadata.
  - Add a smoke check that verifies naming consistency across these public routes.

3) **Completed - Supplies packaging alignment (2026-03-18)**
- UAT signal: sugar presets and sticks packaging/pricing needed to match current shipping realities.
- Delivered:
  - Sugar quick presets updated to `240 KG`, `400 KG`, and `800 KG` with `400 KG` as the default packaging-friendly target.
  - Bloomjoy branded paper sticks now use box-based pricing (`$130/box`, `2000 pieces/box`) with required machine-size and address-type selection.
  - Bloomjoy branded sticks orders under 5 boxes submit procurement requests with shipping estimate context (`$35/box` business, `$40/box` residential).
  - Bloomjoy branded sticks orders of 5+ boxes now use a dedicated Stripe checkout flow with free shipping.
  - Custom sticks remain request-based with artwork upload and a clearly stated `$750` first-order plate fee.

4) **P1 - Resources page Plus-content teasers**
- UAT signal: Resources page should preview content locked behind Bloomjoy Plus.
- Plan:
  - Add public teaser cards/sections for Plus-gated materials.
  - Include explicit mentions of downloadable procedure docs, daily checklists, and frequent updates.
  - Add clear CTA path to `/plus` and `/login` for upgrade/access.

5) **Verification and documentation updates (bundled with implementation PRs)**
- Update `Docs/QA_SMOKE_TEST_CHECKLIST.md` for any new user-facing flows (custom stick upload + Resources teasers + naming consistency checks + domain callback host checks on new domain).
- Run PR verification commands on branch:
  - `npm ci`
  - `npm run build`
  - `npm test --if-present`
  - `npm run lint --if-present`

## Owner next steps
- Execute production auth setup in `Docs/AUTH_OAUTH_BRANDING_RUNBOOK.md` (Google branding, custom auth domain, redirect/origin verification).
- Provision and configure Resend SMTP for production auth emails per decision `2026-03-02` in `Docs/DECISIONS.md` (`#77`).
- Complete launch evidence and approvals in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.
- Enable Supabase Custom Domain add-on for project `ygbzkgxktzqsiygjlqyg` to unblock `auth.bloomjoyusa.com` cutover (required for issue `#78`).
- Run `node scripts/sync-vimeo-training-catalog.mjs --dry-run` against the target environment, review unmapped/duplicate/stale output, then run without `--dry-run` to catalog uploaded Vimeo videos into Supabase.
- Add or normalize Vimeo module tags for Module 2/3 so the supportive module filter can be enabled consistently once taxonomy is complete.
- Validate signed-link delivery for the private `training-documents` assets on authenticated training detail pages once the target Supabase environment is ready.
- Execute issue `#110` to operationalize WeCom alert monitoring and WeChat onboarding concierge process ownership (referral buddy roster + SLA + weekly reliability snapshot).

## Upcoming scope clarification (next sprint)
- Super-admin requirements and role model are complete for MVP scope (`#37` with implementation slices `#44`-`#48` delivered in PR `#55`).

## Completed P0 milestones
1) POC intake + repo hygiene (build/lint/dev) + document findings in `Docs/POC_NOTES.md`
2) Public marketing site shell (Home, Machines, Supplies, Plus, Resources, Contact)
3) Auth + member portal shell (login, dashboard layout)
4) Routing + navigation skeleton aligned to MVP Machines paths (with legacy redirects)
5) Training library MVP (gated pages + embeds) + support request forms
6) Sugar checkout (Stripe Checkout via Supabase Edge Function + client redirect)
7) Plus subscription checkout + customer portal (Stripe via Supabase Edge Functions)
8) Stripe webhook sync (memberships + orders)
9) Environment + config hardening (`.env.example` coverage + typed client config helper)
10) Onboarding checklist with per-user completion tracking in portal
11) Non-Plus login baseline access with Plus-gated premium portal routes
12) Sugar bulk ordering flow (4 colors + equal split + high-volume quantity inputs)
13) Replace placeholder public-site imagery with real Bloomjoy assets (machines, supplies, and about page visuals)

## Recently completed (post-P0)
- Plus pricing model simplified to flat account pricing (`$100/month`) with Stripe checkout quantity fixed at `1`
- Supplies UX improvement: typed bulk quantity input for paper stick box ordering
- Public-site asset refresh: real machine/supplies/about photography, improved model image coverage, and homepage machine card visuals
- Machine detail UX upgrade: per-model image galleries with selectable thumbnails
- Commercial machine page content upgrade: native specs table/cards, operational details, and in-page full-size modal previews for pattern menu + certification snapshot
- Super-admin foundation (`#44`): Supabase session auth in `AuthContext`, `admin_roles` + `admin_audit_log` migration with `is_super_admin` RLS helper, and protected `/admin` route shell
- Support operations foundation (`#45`): persisted `support_requests` table + RLS, portal support form writes, `/admin/support` triage queue, and audit logging via admin RPC
- Orders operations foundation (`#46`): real `/portal/orders` Supabase data, `/admin/orders` workspace with search/date filters, and audited fulfillment updates via admin RPC
- Account operations foundation (`#48`): `customer_machine_inventory` source-of-truth table, admin account summary RPC, `/admin/accounts` workspace, and audited machine count updates with required reason
- Governance polish (`#47`): `/admin/audit` view with filters, super-admin grant/revoke role flows, and role/audit RPCs linked to `admin_audit_log`
- Go-live auth/session (`#56`): Supabase session auth + protected route redirect are now the active portal auth baseline
- Go-live hardening (`#57`): Plus checkout now requires authenticated session identity, writes durable `user_id` metadata to Stripe checkout/subscription objects, and webhook mapping treats metadata user ID as authoritative when present
- Go-live submission pipelines (`#62` scoped): Contact form persists to Supabase (`lead_submissions`) with clear success/error handling and honeypot anti-spam fields; historical Mini waitlist records remain in `mini_waitlist_submissions` for ops reference after the public site moved Mini to the live quote flow
- Go-live account data hardening (`#63`): portal account page now loads and saves persisted profile/shipping data (`customer_profiles`) and uses live membership period/status from `subscriptions`
- Go-live release operations runbook (`#64`): production env var matrix, deployment sequence, launch verification, and rollback checklist documented in `Docs/PRODUCTION_RUNBOOK.md`
- Legal/compliance launch hardening (`#59`): added Privacy Policy, Terms of Service, Billing & Cancellation pages, and global footer/legal links
- Mobile UX hardening (`#49`): fixed horizontal overflow on `/portal/account` for common mobile viewport sizes
- Frontend performance hardening (`#60`): route-level code splitting + chunk budgeting to reduce initial JS payload and remove oversized chunk warnings
- Security patch sprint (`#58`): patched production dependency audit findings; `npm audit --omit=dev` now reports zero vulnerabilities
- Auth UX hardening (`#75`): login now supports password + Google + magic-link with improved rate-limit/expired-link messaging and retry cooldown guidance
- Training data hardening (`#75`): fixed fallback behavior so empty Supabase responses do not silently render a blank library
- Vimeo integration (`#51` via `#75`): Module 1 videos now seeded in Supabase `trainings`/`training_assets` and rendered in portal library/detail pages
- Training catalog polish (`#75`): card thumbnails now render from Vimeo video IDs
- Admin access hardening (`#80`): static admin email allowlist removed from app auth; access now relies on DB-driven `admin_roles` + RLS helper migration (`202602270003_remove_static_admin_allowlist.sql`)
- OAuth/domain launch docs (`#78`): added step-by-step runbook for Google consent branding + Supabase custom auth domain setup (`Docs/AUTH_OAUTH_BRANDING_RUNBOOK.md`)
- Auth launch operations docs (`#77`): added production auth sign-off template and runbook integration (`Docs/AUTH_PRODUCTION_SIGNOFF.md`, `Docs/PRODUCTION_RUNBOOK.md`)
- Auth launch checklist hardening (`#77`, `#78`): added execution tracker, callback-host verification requirements, and production evidence minimums (`PR #86`)
- Auth recovery hardening (`PR #88`): added password reset request + `/reset-password` completion flow.
- Quote-intake clarity hardening (`PR #88`): machine quote CTA now carries machine-of-interest context into contact submissions.
- Local QA admin access helper (`PR #88`): optional `VITE_DEV_ADMIN_EMAILS` local-only override for internal Plus feature testing.
- UAT naming consistency hardening (`2026-03-02`): standardized public machine labels to `Commercial Machine`, `Mini Machine`, and `Micro Machine` across home, machines listing, contact, footer, and machine detail headers.
- UAT supplies packaging alignment (`2026-03-18`): sugar quick presets now align to `240/400/800 KG`, Bloomjoy branded paper sticks use box pricing (`$130/box`, `2000 pieces/box`) with size/address selection, 5+ box checkout ships free via dedicated Stripe flow, and custom sticks retain artwork upload with a `$750` first-order plate fee.
- UAT resources hardening (`2026-03-02`): `/resources` now includes Bloomjoy Plus teaser cards for downloadable procedure docs, daily checklists, and frequently updated member content.
- Auth launch alignment (`2026-03-22`): auth preflight defaults and auth runbooks now target canonical operator-app routes on `app.bloomjoyusa.com`, while the storefront stays on `www.bloomjoyusa.com` and the callback host remains `auth.bloomjoyusa.com`.
- Training performance hardening (`#89`): training detail now shows a clear Vimeo loading state, adds Vimeo preconnect hints, and emits iframe startup timing analytics.
- Training detail clarity hardening (`#91`): renamed and clarified post-video sections with helper copy plus explicit empty-state fallbacks for learning outcomes/checklist/resources.
- Training taxonomy hardening (`#90`): training catalog now supports module-specific filtering/grouping (for example `Module 1/2/3`) and includes an operations script to enforce Vimeo tags (`scripts/vimeo-ensure-tag.mjs`).
- Vimeo operations update (`#90`): current Vimeo library was normalized so all 17 uploaded videos are tagged `Module 1`.
- Training experience upgrade (`2026-03-19`): portal training is now task-first, includes document-first guides from the software setup and maintenance manuals, persists server-backed progress, replaces dashboard placeholders with live recommendations, and supports the lightweight `Bloomjoy Operator Essentials` completion certificate.
- Training hub findability hardening (`2026-03-19`): `/portal/training` now prioritizes start-here guidance, task-based wayfinding, persistent search, collapsed advanced filters, and secondary certificate treatment, with a new Vimeo-to-Supabase catalog sync script for uploaded videos.
- Training content audit hardening (`2026-03-21`): document-first training pages now pull additional source-manual visuals across software setup, pricing/payments, timer setup, troubleshooting, and consumables guidance; detail pages now separate `Use during this task` from `Recommended next task`; audit notes live in `Docs/TRAINING_VISUAL_AUDIT.md`.
- SEO hardening: added route-level page metadata management (title/description/canonical/OG) and private-route `noindex` handling plus robots disallows for auth/admin/portal paths.
- SEO crawlability hardening (`2026-03-09`): added Vercel SPA fallback routing (`vercel.json`) so direct loads for public routes do not 404 at the edge, added `public/sitemap.xml` for indexable public URLs, and linked sitemap in `public/robots.txt`.
- SEO prerender hardening (`2026-03-09`): build now generates static route HTML for public marketing/legal paths with route-specific title/description/canonical/OG metadata before JS executes; known auth/admin/portal paths are also emitted with static `noindex` metadata.
- SEO structured-data hardening (`2026-03-09`): public-route HTML now includes JSON-LD (`Organization`, `WebSite`, `WebPage`) in both prerendered output and client-side route SEO updates so crawlers receive machine-readable page context.
- SEO redirect/guard hardening (`2026-03-09`): added permanent host canonicalization redirect (`bloomjoyusa.com` -> `www.bloomjoyusa.com`) and permanent legacy path redirects (`/products*` -> `/machines*`) in `vercel.json`.
- SEO CI hardening (`2026-03-09`): added `npm run seo:check` plus CI workflow coverage to validate robots/sitemap, canonical/noindex route outputs, JSON-LD presence on public routes, and redirect guard rules.
- Submission notifications hardening: quote requests now flow through server-side `lead-submission-intake` and send internal summary emails; Stripe sugar order webhooks now send internal summary emails with duplicate-dispatch protection.
- Submission notification recovery (`PR #103`, `2026-03-09`): resolved the internal-notification migration version collision by applying `202603090001_internal_notifications_backfill.sql`, aligned `INTERNAL_NOTIFICATION_FROM_EMAIL` to a verified Resend sender on `bloomjoyusa.com`, and revalidated quote-notification dispatch end-to-end (`lead-submission-intake` returns `200`, `internal_notification_sent_at` and dispatch `sent_at` are populated).
- Session closeout smoke snapshot (`2026-03-09`): production-config API checks passed for quote notification dispatch, magic-link trigger, and password-reset trigger; remaining launch evidence is now limited to manual inbox/browser screenshots in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.
- WeCom alerting POC merged (`#107` via PR `#108`, `2026-03-10`): quote/order/support flows now attempt WeCom dispatch using server-only `WECOM_*` secrets with token cache + non-blocking failure logging.
- WeChat onboarding concierge merged (PR `#109`, `2026-03-10`): support flow now includes structured onboarding intake (`phone/device/blocked step/referral`) persisted in `support_requests.intake_meta` and surfaced in `/admin/support` triage filters/cards.

## Known risks / blockers
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Production credential execution remains owner-controlled (Google/Supabase/SMTP/DNS changes must be completed in dashboard tools before launch sign-off).
- Internal notification pipeline is restored for quote submissions, but ongoing reliability still depends on keeping Resend/Supabase function secrets valid (`RESEND_API_KEY`, verified sender, recipient list).
- WeCom alert dispatch reliability now depends on owner-managed app policy as well as valid secrets/recipient scope; current live failure is `60020: not allow to access from your ip`.
- WeChat onboarding concierge UX is live, but operational effectiveness still depends on documented referral-buddy process/SLA ownership (tracked in issue `#110`).
- `#78` currently blocked on Supabase side: Custom Domain add-on is not enabled yet for project `ygbzkgxktzqsiygjlqyg`, so domain create/activate commands cannot run.
- Additional Vimeo uploads may exist before the portal catalog is synced; uploaded videos are not discoverable until `trainings` and `training_assets` are populated in Supabase.
- Module taxonomy UX is implemented, but supportive module filtering remains hidden until cataloged training rows have complete module labels.
- Private `training-documents` assets are uploaded, but signed-link download behavior still needs authenticated QA confirmation in the task-first training detail pages.
- Lint passes but still shows fast-refresh warnings in generated UI files
- Apex host canonicalization currently returns `307` (`https://bloomjoyusa.com` -> `https://www.bloomjoyusa.com/`) instead of preferred permanent redirect behavior.

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: `main` deployed to `www.bloomjoyusa.com` / `app.bloomjoyusa.com`; remaining commerce follow-up is limited to WeCom alert delivery policy and dedicated Resend ownership

## How to test on localhost (simple steps)
1) In the project folder, run `npm ci`
2) Start the app with `npm run dev`
3) Open the URL shown in the terminal (usually http://localhost:8080)

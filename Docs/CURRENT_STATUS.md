# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.
- Write updates in plain language so non-technical readers can follow.

## Next P0 milestones
- Unblock and complete issue `#99` (dedicated Resend account for `bloomjoysweets.com`) so production auth and transactional email ownership can move off the currently blocked setup.

## Training experience upgrade snapshot (2026-03-19)
- New training experience slice delivered on branch `codex/training-experience-upgrade`:
  - Task-first training discovery now sits on top of the existing Vimeo catalog (`Start Here`, `Software & Payments`, `Daily Operation`, `Cleaning & Maintenance`, `Troubleshooting`).
  - Added curated `Operator Essentials` track, server-backed `training_progress`, and lightweight `training_certifications` support.
  - Added document-first training guides based on `Software setup.pdf` and `Cotton Candy Maintenance Guide.pdf`, alongside the existing video library.
  - Dashboard training recommendations are now live and progress-aware instead of static placeholders.
  - Public `/plus` and `/resources` teasers now match the upgraded training promise, including the operator certificate path.
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
  - `npm run auth:preflight`: pass with canonical `www.bloomjoyusa.com` plus apex redirect-allowlist values
  - `npm run auth:preflight -- --require-custom-auth-domain`: expected fail until custom auth domain cutover is completed (`auth.bloomjoyusa.com`)

1) **P0 - Auth redirect/domain cutover regression (Google login)**
- UAT signal: Google callback currently lands on `localhost:3000` (`ERR_CONNECTION_REFUSED`) instead of the live domain flow.
- Fresh evidence (2026-03-19):
  - User-captured live Google login returns to `http://localhost:3000/#access_token=...` with no `/portal` path.
  - Repo audit confirms the app requests `${window.location.origin}/portal` for Google OAuth redirect, so the bare localhost fallback points to stale Supabase Site URL and/or missing allowlist entries for `https://www.bloomjoyusa.com`.
- Likely cause: OAuth/Supabase redirect/origin settings are still on legacy host values while the production deployment is on canonical `https://www.bloomjoyusa.com`.
- Plan:
  - Update auth docs/checklists and auth preflight defaults from legacy Bloomjoy hostnames to canonical `https://www.bloomjoyusa.com`, while keeping apex `https://bloomjoyusa.com` allowlisted during cutover.
  - Validate Google OAuth origins + redirect URIs and Supabase Site URL + additional redirects for both local (`http://localhost:8080`) and production (`https://www.bloomjoyusa.com` + apex alias + auth host).
  - Re-run `npm run auth:preflight` with local env configured and capture callback-host evidence in launch sign-off docs.
- Owner dependency: Google Cloud + Supabase dashboard redirect/origin updates (credentials and DNS are owner-controlled).

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
  - Blank paper sticks now use box-based pricing (`$130/box`, `2000 pieces/box`) with required machine-size and address-type selection.
  - Blank sticks orders under 5 boxes submit procurement requests with shipping estimate context (`$35/box` business, `$40/box` residential).
  - Blank sticks orders of 5+ boxes now use a dedicated Stripe checkout flow with free shipping.
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
- Upload Module 2 and Module 3 Vimeo videos when ready and extend `trainings` + `training_assets` with the same seeded pattern used for Module 1.
- Add Vimeo tags for Module 2/3 as content is uploaded so the new module-filter UX can segment beyond Module 1.
- Upload the original training PDFs into the private `training-documents` bucket with `npm run training:upload-docs` once the target Supabase environment is ready.
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
- Plus pricing model by machine count (`$100 per machine/month`) with Stripe quantity-based checkout
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
- Go-live submission pipelines (`#62` scoped): Contact form + Mini waitlist now persist to Supabase (`lead_submissions`, `mini_waitlist_submissions`) with clear success/error handling and honeypot anti-spam fields
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
- UAT supplies packaging alignment (`2026-03-18`): sugar quick presets now align to `240/400/800 KG`, blank paper sticks use box pricing (`$130/box`, `2000 pieces/box`) with size/address selection, 5+ box checkout ships free via dedicated Stripe flow, and custom sticks retain artwork upload with a `$750` first-order plate fee.
- UAT resources hardening (`2026-03-02`): `/resources` now includes Bloomjoy Plus teaser cards for downloadable procedure docs, daily checklists, and frequently updated member content.
- Auth launch alignment (`2026-03-19`): auth preflight defaults and auth runbooks now target canonical `www.bloomjoyusa.com`, keep apex `bloomjoyusa.com` allowlisted during cutover, and document the `localhost:3000` fallback as stale Supabase URL configuration.
- Training performance hardening (`#89`): training detail now shows a clear Vimeo loading state, adds Vimeo preconnect hints, and emits iframe startup timing analytics.
- Training detail clarity hardening (`#91`): renamed and clarified post-video sections with helper copy plus explicit empty-state fallbacks for learning outcomes/checklist/resources.
- Training taxonomy hardening (`#90`): training catalog now supports module-specific filtering/grouping (for example `Module 1/2/3`) and includes an operations script to enforce Vimeo tags (`scripts/vimeo-ensure-tag.mjs`).
- Vimeo operations update (`#90`): current Vimeo library was normalized so all 17 uploaded videos are tagged `Module 1`.
- Training experience upgrade (`2026-03-19`): portal training is now task-first, includes document-first guides from the software setup and maintenance manuals, persists server-backed progress, replaces dashboard placeholders with live recommendations, and supports the lightweight `Bloomjoy Operator Essentials` completion certificate.
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
- Product photography availability (Mini may launch as waitlist/coming soon)
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Production credential execution remains owner-controlled (Google/Supabase/SMTP/DNS changes must be completed in dashboard tools before launch sign-off).
- Internal notification pipeline is restored for quote submissions, but ongoing reliability still depends on keeping Resend/Supabase function secrets valid (`RESEND_API_KEY`, verified sender, recipient list).
- WeCom alert dispatch reliability now depends on owner-managed function secrets and app visibility scope (`WECOM_CORP_ID`, `WECOM_AGENT_ID`, `WECOM_AGENT_SECRET`, `WECOM_ALERT_TO_USERIDS`).
- WeChat onboarding concierge UX is live, but operational effectiveness still depends on documented referral-buddy process/SLA ownership (tracked in issue `#110`).
- `#78` currently blocked on Supabase side: Custom Domain add-on is not enabled yet for project `ygbzkgxktzqsiygjlqyg`, so domain create/activate commands cannot run.
- Vimeo Module 1 is live; Modules 2/3 are pending upload/seed.
- Module taxonomy UX is implemented, but cross-module validation is pending until Module 2/3 videos are uploaded/tagged.
- Original PDF binaries still need to be uploaded to the private `training-documents` bucket for signed-link delivery in Supabase-backed environments.
- Lint passes but still shows fast-refresh warnings in generated UI files
- Apex host canonicalization currently returns `307` (`https://bloomjoyusa.com` -> `https://www.bloomjoyusa.com/`) instead of preferred permanent redirect behavior.

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: runbook ready in `Docs/PRODUCTION_RUNBOOK.md`; execution pending owner credentials

## How to test on localhost (simple steps)
1) In the project folder, run `npm ci`
2) Start the app with `npm run dev`
3) Open the URL shown in the terminal (usually http://localhost:8080)

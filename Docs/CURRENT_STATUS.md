# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.
- Write updates in plain language so non-technical readers can follow.

## Next P0 milestones
- No open P0 issues on the board; current focus is remaining P1 launch hardening.

## Owner next steps
- Execute production auth setup in `Docs/AUTH_OAUTH_BRANDING_RUNBOOK.md` (Google branding, custom auth domain, redirect/origin verification).
- Complete launch evidence and approvals in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.
- Enable Supabase Custom Domain add-on for project `ygbzkgxktzqsiygjlqyg` to unblock `auth.bloomjoysweets.com` cutover (required for issue `#78`).
- Upload Module 2 and Module 3 Vimeo videos when ready and extend `trainings` + `training_assets` with the same seeded pattern used for Module 1.

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
- Supplies UX improvement: typed bulk quantity input for cotton candy sticks ordering
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

## Known risks / blockers
- Product photography availability (Mini may launch as waitlist/coming soon)
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Production credential execution remains owner-controlled (Google/Supabase/SMTP/DNS changes must be completed in dashboard tools before launch sign-off).
- `#78` currently blocked on Supabase side: Custom Domain add-on is not enabled yet for project `ygbzkgxktzqsiygjlqyg`, so domain create/activate commands cannot run.
- Vimeo Module 1 is live; Modules 2/3 are pending upload/seed.
- Lint passes but still shows fast-refresh warnings in generated UI files

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: runbook ready in `Docs/PRODUCTION_RUNBOOK.md`; execution pending owner credentials

## How to test on localhost (simple steps)
1) In the project folder, run `npm ci`
2) Start the app with `npm run dev`
3) Open the URL shown in the terminal (usually http://localhost:8080)

# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.
- Write updates in plain language so non-technical readers can follow.

## Next P0 milestones
1) No open P0 issues at this time. Track any new blockers in GitHub Issues before next sprint.

## Owner next steps
- Set up Vimeo (Starter/Standard), restrict embeds to approved domains, and add video IDs + hashes into `training_assets`.

## Upcoming scope clarification (next sprint)
- Super-admin requirements and role model are now defined in `Docs/SUPER_ADMIN_PLAN_37.md`; implementation is split into issues `#44`, `#45`, `#46`, `#47`, and `#48`.

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

## Known risks / blockers
- Product photography availability (Mini may launch as waitlist/coming soon)
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Remaining super-admin implementation slice is pending (`#47`).
- Lint passes but still shows fast-refresh warnings in generated UI files

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: not set up yet

## How to test on localhost (simple steps)
1) In the project folder, run `npm ci`
2) Start the app with `npm run dev`
3) Open the URL shown in the terminal (usually http://localhost:5173)

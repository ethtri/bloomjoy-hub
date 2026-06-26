# Product

## Register

product

## Source Of Truth

This file gives Impeccable and frontend agents durable product context. It is not the active work queue.

- GitHub Issues and the Bloomjoy Project board are authoritative for active task state, priorities, blockers, and acceptance criteria.
- `Docs/DECISIONS.md` wins for durable product, platform, role, access, payment, reporting, refund, and routing decisions.
- `AGENTS.md`, `Docs/LOCAL_DEV.md`, and `Docs/QA_SMOKE_TEST_CHECKLIST.md` define the agent workflow and verification rules.
- Public marketing pages may override this default register when an issue explicitly asks for brand or buyer-facing storytelling.

## Product Purpose

Bloomjoy Hub is the operating system for Bloomjoy's robotic cotton candy business. It supports machine sales, supplies, Bloomjoy Plus membership, authenticated training, reporting, refunds, support, access management, partner operations, technician management, and operator payouts.

The authenticated app should help each signed-in user understand what they can do, what needs attention, and where to complete operational work without learning internal implementation details.

## Primary Users

- **Owner and Super Admins:** manage access, reporting, refunds, orders, support, machines, partnerships, payouts, launch evidence, and operational governance.
- **Scoped Admins:** manage the limited machine-scoped operations explicitly granted to them, especially Technician provisioning inside their current active machine scope.
- **Corporate Partners and account managers:** review permitted reporting, manage eligible Technicians, use training/support, and operate only inside active portal-enabled partner scope.
- **Plus Account Owners:** manage their account, billing-adjacent settings, orders, training, onboarding, support, reporting, and eligible Technician access.
- **Technicians and operators:** complete training and view only the assigned machine reporting or tasks they are allowed to access.
- **Baseline authenticated users:** access basic account and order flows without seeing paid Plus, admin, partner, or internal operations concepts they do not have.
- **Public buyers:** evaluate machines, supplies, Plus, resources, quote paths, and procurement requests on the public site.

## Product Principles

- **Operational clarity beats decoration.** Admin, portal, reporting, refund, access, payout, and training surfaces should be quiet, scannable, and suitable for repeated daily use.
- **One primary next action.** Each authenticated screen should make the user's current job or decision obvious without long explanatory text.
- **Role clarity over feature exposure.** Users should see destinations that match their authority and job. Do not show internal admin concepts to customers just because the underlying route exists.
- **Trust before automation.** Sensitive flows such as access, reporting, refunds, payouts, auth, payments, vendor syncs, and production data need reviewability, audit evidence, and rollback.
- **Incremental improvement over rewrites.** Keep the Vite, React, TypeScript, Tailwind, shadcn/ui, React Router, Supabase, and Stripe/Supabase Edge Function foundation unless a recorded decision says otherwise.

## Authenticated Portal Direction

Default design work for `/portal`, `/admin`, reporting, refunds, training, team, account, access, and payout surfaces should use the product register and the `impeccable` skill before visible UI implementation or polish.

The preferred authenticated hierarchy borrows the Bloomjoy Events portal pattern:

- one authenticated app shell
- sectioned desktop sidebar
- mobile drawer navigation
- role-aware destination filtering
- task-first dashboard content
- a clean Admin or Operations area instead of scattered duplicate navigation

Borrow the structure from Bloomjoy Events, not its domain labels. Do not copy Events terms such as Bookings, Leads, or Calendar unless a Hub workflow actually uses those concepts.

Keep existing `/portal` and `/admin` URLs unless a GitHub issue and `Docs/DECISIONS.md` entry explicitly approve route churn. Navigation can be reorganized without breaking direct links.

## Anti-References

Avoid:

- duplicate horizontal nav strips for Portal, Admin, page tabs, and local workflow tabs
- marketing-style heroes inside authenticated tools
- decorative card grids that turn dashboards into link catalogs
- fake metrics, vague status cards, or placeholder operational data
- candy whimsy that reduces trust in access, reporting, refunds, payouts, or support
- exposing admin-only, partner-only, or payment-sensitive language to users without that authority
- copying Bloomjoy Events domain labels into Hub without validating the user job

## Accessibility And Inclusion

- Design for keyboard navigation, visible focus, readable contrast, and practical touch targets.
- Authenticated mobile layouts must avoid horizontal overflow and clipped controls.
- Use clear text labels for unfamiliar icons and operational actions.
- Respect reduced-motion needs. Motion should communicate state, not decorate the product.
- Never expose secrets, raw customer data, payment IDs, raw vendor exports, real card digits, private artwork links, or free-text complaint content in UI, docs, issues, PRs, screenshots, or chat.

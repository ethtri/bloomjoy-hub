# Owner UAT Persona Playbook

## Purpose
This playbook helps the owner validate product behavior without reviewing code.

Agents should use it when a PR changes customer-facing, admin-facing, reporting, auth, payment, entitlement, or partner behavior. The owner should receive exact steps, expected results, and enough evidence to make a product-level go/no-go decision.

## What Agents Must Provide
Before asking for owner UAT, the agent must provide:

- PR link and branch name.
- Preview URL or localhost URL.
- Exact route list to test.
- Persona to use for each step.
- Exact steps and expected result for each step.
- Desktop and mobile screenshots for UI changes.
- Risk notes, especially for auth, Stripe/payments, reporting math, Supabase migrations, Edge Functions, production data, and entitlement boundaries.
- Any known limits or intentionally untested paths.
- Rollback plan for medium/high-risk work.

Do not put real passwords, secret keys, service-role tokens, Stripe secrets, sales-provider credentials, Google credentials, or Supabase secrets in the repo, PRs, issues, screenshots, or chat. If a test account is needed, identify the persona and email only; share passwords through the owner's approved secure channel.

## Owner UAT Versus AI Verification

| Change type | AI verification only | Owner UAT recommended | Owner go/no-go required |
| --- | --- | --- | --- |
| Docs-only, templates, labels, copy with no product decision | Yes | No, unless wording needs owner judgment | No |
| Small non-user-facing cleanup | Yes | No | No |
| Public site layout, copy, CTAs, SEO, cart UX, supplies UX | AI verifies build/lint and route behavior | Yes | Only when launch-critical |
| Portal dashboard, training, support, onboarding, account UX | AI verifies route behavior and screenshots | Yes | When it changes customer promises or access |
| Technician, Corporate Partner, reporting, admin access, or entitlement boundaries | AI verifies tests, RLS/RPC behavior, and screenshots | Yes | Yes for high-risk permission changes |
| Stripe/payments, auth, production redirects, Edge Functions, migrations, reporting math, production data paths | AI verifies locally and records evidence | Yes | Yes before production rollout |
| Pure implementation refactor with unchanged behavior | AI verifies regression tests and build | Optional | No, unless risk is high |

AI verification should prove the implementation works. Owner UAT should answer whether the behavior, wording, permissions, and operational flow are acceptable for the business.

## Persona Coverage

### Public Buyer
Use this persona for storefront, quote, and public SEO changes.

Key routes:

- `/`
- `/machines`
- `/machines/commercial-robotic-machine`
- `/machines/mini`
- `/machines/micro`
- `/supplies`
- `/supplies?order=sugar`
- `/supplies?order=sticks`
- `/supplies?order=custom`
- `/plus`
- `/contact`
- `/cart`
- `/privacy`, `/terms`, `/billing-cancellation`

Owner UAT focus:

- Product names, pricing, availability, CTAs, and quote/order flow make business sense.
- Public pages look professional on desktop and mobile.
- Cart and supplies flows are understandable without internal explanation.
- No private portal/admin language appears on public pages.

### Plus Account Owner
Use this persona for paying or granted Plus customers who own an account and machines.

Key routes:

- `/login`
- `/portal`
- `/portal/orders`
- `/portal/account`
- `/portal/onboarding`
- `/portal/support`
- `/portal/training`
- `/portal/reports`

Owner UAT focus:

- Plus benefits and limits are clear.
- Account, billing, order, support, onboarding, and training flows are usable.
- Reporting shows only machines the owner should control.
- Technician management, when present, only allows assigned machines the owner already controls.
- The default Technician cap is clear when reached.

### Technician
Use this persona for customer staff with training and assigned-machine reporting access.

Key routes:

- `/login`
- `/portal`
- `/portal/training`
- `/portal/training/*`
- `/portal/reports`

Owner UAT focus:

- Technician can see training.
- Technician can see reporting only for assigned machines.
- Technician cannot see unassigned machines.
- Technician cannot see Plus discounts, billing, account-owner tools, partner settlement, admin routes, or grant-management controls.
- Reassigning or revoking a Technician changes access as expected after refresh or re-login.

### Super Admin
Use this persona for internal Bloomjoy admin work.

Key routes:

- `/admin`
- `/admin/access`
- `/admin/orders`
- `/admin/support`
- `/admin/partner-records`
- `/admin/machines`
- `/admin/partnerships`
- `/admin/reporting`
- `/admin/audit`

Owner UAT focus:

- Admin tools expose the right operational controls without leaking them to customers.
- Required reasons, audit trails, and safety prompts appear for sensitive changes.
- Reporting setup, machine mapping, partner setup, and access management are understandable.
- Internal-only workflows stay under `/admin`.

### Corporate Partner
Use this persona for Merlin/Bubble Planet-style partner users with explicit Corporate Partner membership.

Expected route direction:

- `/portal/reports` for permissioned partner/reporting views.
- Approved report artifacts or dashboards only after the product flow supports them.

Owner UAT focus:

- Corporate Partner sees only active, portal-enabled partnership reporting and derived machine reporting.
- Corporate Partner can access training, support, supply discounts, and Technician management for their derived machines.
- Corporate Partner cannot access billing, imports, tax/rule editing, schedules, warning ledgers, machine metadata editing, or `/admin`.
- Partnership setup alone does not create partner portal access.

## UAT Packet Template
Agents can paste this into a PR comment or status update:

```md
## Owner UAT Packet
- PR:
- Branch:
- Preview or localhost URL:
- Risk level:
- Personas:
- Routes:

## Steps
1. Sign in as `<persona/email>`.
2. Open `<route>`.
3. Do `<action>`.
4. Expected result: `<plain English result>`.

## Screenshots
- Desktop:
- Mobile:

## Owner decision needed
- Confirm whether `<behavior/copy/flow>` is acceptable.

## Not in scope
- `<paths intentionally not changed>`
```

## Route-To-Persona Quick Reference

| Area | Personas to cover |
| --- | --- |
| Public marketing/storefront | Public Buyer |
| Quote/contact flow | Public Buyer |
| Cart/supplies/Stripe checkout | Public Buyer, Plus Account Owner when discounts apply |
| Login/reset/Google auth | Public Buyer for entry, Plus Account Owner, Technician, Super Admin as applicable |
| Portal dashboard/account/orders | Plus Account Owner |
| Training | Plus Account Owner, Corporate Partner, Technician |
| Technician management | Plus Account Owner, Corporate Partner, Technician, Super Admin when override exists |
| Customer reporting | Plus Account Owner, Technician |
| Partner reporting | Corporate Partner, Super Admin |
| Admin support/orders/access/audit | Super Admin |
| Partnership setup, machine mapping, partner PDFs | Super Admin, Corporate Partner only for approved output views |

## Final Check Before Asking The Owner
Before asking for UAT, confirm:

- The PR has passed the required verification commands.
- The branch is current enough with `main` for the changed area.
- Screenshots are attached for visible UI changes.
- The requested owner decision is plain English.
- Secrets and passwords are not included anywhere.
- The owner is not being asked to review code or infer expected behavior.

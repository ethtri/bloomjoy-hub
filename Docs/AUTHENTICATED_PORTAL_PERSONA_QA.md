# Authenticated Portal Persona QA

## Purpose

This is the owner-facing acceptance matrix for GitHub issue `#553`. GitHub Issues and Project #2 remain the source of truth for status; this document records the repeatable browser gate and its product expectations.

## Automated Gate

Start the local app, then run:

```powershell
npm run portal-personas:uat -- --app-url http://127.0.0.1:8081
```

The command uses deterministic, intercepted sessions and API responses. It writes review screenshots to `output/playwright/issue-553`.

## Exact Primary Navigation

| Persona and context | Expected destinations |
| --- | --- |
| Baseline Customer, Portal | `/portal`, `/portal/orders`, `/portal/account` |
| Generic Plus Member, Portal | Baseline plus `/portal/training`, `/portal/onboarding`, `/portal/support` |
| Technician Timekeeper, Portal | Baseline plus `/portal/time` |
| Training-only Technician, Portal | `/portal`, `/portal/training` |
| Reporting Technician, Portal | `/portal`, `/portal/reports`, `/portal/training` |
| Corporate Partner account manager, Portal | `/portal`, `/portal/orders`, `/portal/account`, `/portal/team`, `/portal/reports`, `/portal/training`, `/portal/support` |
| Canonical Scoped Admin, Admin Console | `/refunds`, `/admin`, `/admin/orders`, `/admin/support`, `/admin/accounts`, `/admin/machines`, `/admin/access`, `/admin/partnerships`, `/admin/audit` |
| Super Admin, Admin Console | Scoped destinations plus `/admin/partner-records`, `/admin/reporting`, `/admin/payouts` |

The test compares complete href sets, rejects duplicates, and separately verifies that each allowed direct load has exactly one correct `aria-current="page"` destination.

## Direct-load Boundary Matrix

| Persona | Allowed examples | Required denied examples |
| --- | --- | --- |
| Baseline Customer | `/portal`, `/portal/orders`, `/portal/account` | Time, Review Time, Reporting, Training, Support, Team, refunds, Admin Access |
| Generic Plus Member | Orders, Account, Training, Onboarding, Support | Time, Review Time, Reporting, Team, refunds, Admin Access |
| Technician Timekeeper | Orders, Account, Time | Review Time, Reporting, Training, Support, Team, refunds, Admin Access |
| Training-only Technician | Training | Orders, Account, Time, Review Time, Reporting, Support, Team, refunds, Admin Access |
| Reporting Technician | Reporting, Training | Orders, Account, Time, Review Time, Support, Team, refunds, Admin Access |
| Corporate Partner | Orders, Account, Team, Reporting, Training, Support | Time, Review Time, refunds, Admin Access |
| Canonical Scoped Admin | Admin overview, Access, Partnerships, refunds, Portal Orders/Account | global Admin Reporting and Technician Pay |
| Super Admin | all required Portal/Admin routes, Review Time, refunds | Technician Time is not implied without a worker profile/capability |
| Signed out | `/login` only | protected Portal, Admin, refunds, and Review Time routes redirect with the complete destination preserved in `next` |

The refund compatibility routes `/portal/refunds` and `/admin/refunds` must resolve to canonical `/refunds` without dropping query parameters or hashes.

## Mobile Acceptance

At `390x844`, the suite verifies:

- one primary navigation inside the open drawer;
- the exact same destination set as desktop for the persona;
- initial focus on the first permitted destination;
- a scrollable Super Admin drawer with utility actions reachable;
- Escape closes the drawer and restores focus to the menu trigger;
- choosing a destination closes the drawer;
- reopening shows exactly one correct active destination;
- both Super Admin and Baseline Customer drawers have no hidden persona destinations.

## Evidence and Limits

Minimum screenshots:

- `persona-super-admin-admin-console.png`
- `persona-scoped-admin-console.png`
- `persona-corporate-partner-portal.png`
- `persona-super-admin-mobile-drawer-scrolled.png`
- `persona-baseline-mobile-drawer.png`
- `persona-signed-out-protected-redirect.png`

The deterministic suite proves frontend behavior but does not prove live Supabase RLS/RPC policy, live JWT claims, email delivery, or production data. Live persona accounts/JWTs must be validated with the documented auth-boundary and workflow-specific commands when those owner-managed credentials and fixtures are available. Unavailable live credentials are a recorded limitation, never a silent pass.

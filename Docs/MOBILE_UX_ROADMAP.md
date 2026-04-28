# Mobile UX/CX Optimization Roadmap

Status: 2026-04-28 audit notes for issue #286.

## Scope audited

Automated browser audit covered 30 routes across:

- Common mobile widths: `360x800`, `390x844`, `414x896`
- Tablet/narrow desktop checks: `768x1024`, `1024x768`
- Public/storefront: `/`, `/machines`, machine detail pages, `/supplies`, `/plus`, `/resources`, `/contact`, `/cart`
- Auth: `/login`, `/reset-password`
- Portal: `/portal`, `/portal/orders`, `/portal/account`, `/portal/training`, `/portal/support`, `/portal/onboarding`, plus a spot check of `/portal/reports`
- Admin: `/admin`, `/admin/orders`, `/admin/support`, `/admin/access`, `/admin/partner-records`, `/admin/machines`, `/admin/partnerships`, `/admin/reporting`

Admin audit is currently surfaced through `/admin/access?tab=audit`; `/admin/audit` redirects there. No dedicated `/admin/leads` route exists in this checkout, so lead-related mobile work remains tied to the public contact/procurement flows and server-side submission pipeline rather than a separate admin leads surface.

Local audit used Vite with client-safe dummy Supabase env values and a mocked local Plus/super-admin session so protected shells could render without production data. Private-route implementation slices still need verification with real Supabase fixtures and role-specific sessions.

## Priority roadmap

### P2 - Buyer conversion and public storefront

Follow-up issue: #318.

Workflow: prospects comparing machines, supplies, Plus, resources, contact, and cart before quote/order.

Findings:

- `/machines` has confirmed horizontal page overflow at `360`, `390`, and `414` widths around the "Machine buyer comparison" table section.
- Public header desktop actions appear at the `md` breakpoint and overflow at `768px` tablet/narrow desktop widths on representative public routes.
- Supplies, Plus, Resources, Contact, and Cart did not show major page-level mobile overflow in the automated pass, but they should be regression-checked when the shared public shell changes.

Recommended slice:

- Fix `/machines` comparison behavior and public header breakpoints/actions together because both affect buyer navigation.
- Keep this as a small route/shell PR, not a public-site redesign.

### P2 - Authenticated portal, excluding reporting

Follow-up issue: #319.

Workflow: Plus account owners, baseline users, training-only operators, technicians, and reporting-entitled users moving through non-reporting portal tasks.

Findings:

- `/portal`, `/portal/orders`, `/portal/account`, `/portal/training`, `/portal/support`, and `/portal/onboarding` did not show broad page-level overflow in the mocked automated pass.
- Follow-up work should focus on real workflow ergonomics: stacked page actions, order/account card readability, support/onboarding forms, training navigation, checkbox/action hit areas, and locked-state clarity.
- `/portal/reports` was spot-checked only. Do not reopen detailed reporting mobile work here because #274 already handled that route.
- Portal home should not be reopened broadly unless a regression appears; #273 already handled the reporting-era portal-home UX/CX pass.

Recommended slice:

- Audit and polish the remaining non-reporting portal routes with real role sessions and fixtures.
- Keep reporting-specific implementation out of this issue.

### P2 - Admin operations, excluding Admin Machines

Follow-up issue: #320.

Related broader admin track: #227.

Workflow: internal users managing orders, support, access, partner records, partnerships, and reporting operations on mobile/tablet or narrow desktop.

Findings:

- Admin top-level shell renders, but the desktop admin tools row relies on horizontal scrolling at tablet/narrow desktop widths. That may be acceptable if intentional, but it needs clearer review in the #227 admin nav pass.
- `/admin/orders` and `/admin/support` still rely on dense tables on mobile-sized viewports. The overflow is contained, but touch workflow efficiency likely needs route-specific card/drawer/table treatment.
- `/admin/access` and `/admin/reporting` tab rows measured with small touch heights in tablet/narrow desktop metrics and should be reviewed for touch comfort.
- Admin audit mobile behavior should be covered through the `/admin/access` audit tab and `/admin/audit` redirect path.
- `/admin/partnerships` requires real fixture data for a reliable mobile wizard audit; the mocked-data pass was not enough for final conclusions.
- `/admin/machines` should only receive shared-shell regression checks here because #226 already handled the Machines UX work.

Recommended slice:

- Address admin non-machine mobile/tablet behavior in PR-sized route groups.
- Coordinate with #227 for navigation changes and avoid duplicating completed #226 work.

### P3 - Auth entry polish

Follow-up issue: #321.

Workflow: signed-out operators using login, operator-login alias, and password reset on mobile.

Findings:

- `/login` and `/reset-password` did not show major page-level mobile overflow.
- Secondary links and text buttons, including the app-shell "Main site" link and forgot-password action, measured below comfortable touch-target height in the automated pass.
- Existing QA requirement still applies: mobile `/login` should keep the sign-in form before operator-feature highlights.

Recommended slice:

- Polish secondary action hit areas and spacing without changing auth provider, domain, or email behavior.
- Keep production auth hardening in #77.

## Exclusions and existing work

- Do not redo `/portal/reports`; detailed reporting mobile UX/CX is tracked by completed #274.
- Do not touch Admin Machines UX except for shared-shell regression checks; completed #226 owns that surface.
- Do not create one massive implementation PR from this roadmap.
- Public, portal, auth, and admin implementation slices should each include screenshots or route-level audit notes before and after changes.

## Verification from this roadmap pass

- `npm ci` passed.
- Local Vite audit ran against `http://127.0.0.1:8082`.
- Audit produced route notes instead of committed screenshots because this PR is a roadmap/status deliverable.
- `npm run build` passed.
- `npm test --if-present` passed; no test script is configured, so npm exited without output.
- `npm run lint --if-present` passed with 8 existing `react-refresh/only-export-components` warnings in shared UI/auth files.

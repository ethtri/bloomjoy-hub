# Authenticated Portal IA Plan

Issue: #549
Parent epic: #547
Status: owner UAT required before implementation issues treat this as approved

## Feature Summary

Bloomjoy Hub needs one authenticated application shell for `/portal` and `/admin` work. The current route structure can stay in place, but the navigation should change from stacked horizontal strips into one role-aware, sectioned sidebar on desktop and one matching drawer on mobile.

This plan borrows the Bloomjoy Events shell pattern: sectioned navigation, role-gated admin items, persistent desktop orientation, and simple mobile drawer behavior. It does not copy Events domain labels such as Bookings, Leads, or Calendar.

## Primary User Action

The signed-in user should quickly answer three questions:

- What can I do?
- What needs attention?
- Where do I go next?

The shell should make those answers visible without making users scan separate Portal, Admin, and page-local navigation rows.

## Design Direction

- Register: product.
- Color strategy: restrained. Use the existing light Bloomjoy Hub tokens and reserve saturated pink/coral emphasis for active state, primary actions, and important status.
- Scene sentence: an owner, scoped admin, partner manager, or operator is using the app on a laptop or tablet during daily operations, often while resolving access, reporting, refunds, training, support, or payout work between other tasks.
- Anchor references:
  - Bloomjoy Events `DashboardLayout`: structural reference for sidebar sections and mobile drawer behavior.
  - Stripe Dashboard: clear operational grouping, restrained color, predictable controls.
  - Linear: fast orientation, strong active state, low decorative load.

No visual direction probes were generated for this issue because this is an IA plan for an existing product shell, not a net-new visual direction.

## Scope

- Fidelity: implementation-ready IA and interaction brief.
- Breadth: whole authenticated shell covering `/portal`, `/admin`, and authenticated utility routes.
- Interactivity: specification for implementation in #550, not a prototype.
- Time intent: production plan that future agents can implement incrementally.

## Non-Goals

- Do not change route URLs in the first shell implementation.
- Do not change RLS, migrations, auth roles, capabilities, or business permissions.
- Do not refactor large admin pages just because they are large.
- Do not redesign public marketing pages.
- Do not introduce a new framework, app router, design system, CMS, auth provider, or platform.
- Do not make Admin available to Plus Customer or Corporate Partner users just to expose Technician management.
- Do not move Refunds to a new URL until a separate decision approves route churn.

## Current Route Families

Public and auth routes stay outside this plan except for keeping `/login` and `/reset-password` inside the app host shell.

Authenticated portal routes:

| Current route | Current purpose | Target sidebar item |
| --- | --- | --- |
| `/portal` | Portal dashboard | Home -> Dashboard |
| `/portal/time` | Operator time entry list | Work -> Time |
| `/portal/time/new` | New time entry | Work -> Time, child route |
| `/portal/time/:entryId/edit` | Edit time entry | Work -> Time, child route |
| `/portal/orders` | Customer/member orders | Work -> My Orders |
| `/portal/reports` | Machine, operator, or partner reporting views | Work -> Reports |
| `/portal/refunds` | Refund operations workbench | Operations -> Refund Cases |
| `/portal/training` | Training hub | Learn & Support -> Training |
| `/portal/training/:id` | Training detail | Learn & Support -> Training, child route |
| `/portal/onboarding` | Plus onboarding checklist | Learn & Support -> Onboarding |
| `/portal/support` | Member support intake | Learn & Support -> Support |
| `/portal/team` | Technician management for eligible sponsors | Access & Setup -> Team |
| `/portal/account` | Profile, billing-adjacent account settings, shipping, language | Settings -> Account |

Authenticated admin routes:

| Current route | Current purpose | Target sidebar item |
| --- | --- | --- |
| `/admin` | Admin overview | Home -> Admin Overview |
| `/admin/orders` | Fulfillment and order operations | Operations -> Admin Orders |
| `/admin/support` | Support queue and concierge intake | Operations -> Support Queue |
| `/admin/payouts` | Operator payout review and finalization | Operations -> Payouts |
| `/admin/access` | Person-first access management | Access & Setup -> People & Permissions |
| `/admin/accounts` | Redirects to `/admin/access?tab=users` | Not a primary item |
| `/admin/audit` | Redirects to `/admin/access?tab=audit` | Not a primary item |
| `/admin/partner-records` | Reusable partner records | Access & Setup -> Partner Records |
| `/admin/machines` | Reporting machine setup and manager assignment | Access & Setup -> Machines |
| `/admin/partnerships` | Partnership setup wizard | Access & Setup -> Partnerships |
| `/admin/reporting` | Imports, exports, schedules, setup queues | Access & Setup -> Admin Reporting |
| `/admin/refunds` | Redirects to `/portal/refunds` | Not a primary item |

## Final Sidebar Sections

Hide any section that has no visible items for the signed-in persona.

### Home

Purpose: orientation and daily entry.

Items:

- Dashboard: `/portal`, visible to all authenticated users.
- Admin Overview: `/admin`, visible to Super Admins only.

### Work

Purpose: the user's own operational work.

Items:

- Time: `/portal/time`, visible while the route remains broadly accessible. Future implementation may narrow this only if an issue scopes the permission change.
- My Orders: `/portal/orders`, visible to baseline, Plus, and Corporate Partner users.
- Reports: `/portal/reports`, visible when `hasReportingAccess`, `reports.partner.view`, or the current route guard would allow reporting access.

### Learn & Support

Purpose: training, onboarding, and support help.

Items:

- Training: `/portal/training`, visible for training, Plus, Corporate Partner, Super Admin, and `training.view`.
- Onboarding: `/portal/onboarding`, visible for Plus only under current guards.
- Support: `/portal/support`, visible for Plus and `support.request`.

### Operations

Purpose: queues, cases, payout review, and internal execution.

Items:

- Refund Cases: `/portal/refunds`, visible when the current `RefundOperationsRoute` would allow access.
- Admin Orders: `/admin/orders`, Super Admin only.
- Support Queue: `/admin/support`, Super Admin only.
- Payouts: `/admin/payouts`, visible for Super Admins or `adminAccess.allowedSurfaces` containing `payouts` or `*`.

### Access & Setup

Purpose: people, machines, partners, and operational setup.

Items:

- Team: `/portal/team`, visible when `usePortalTechnicianManagement().canUsePortalTeam` is true.
- People & Permissions: `/admin/access`, visible for Super Admins, Scoped Admins with `access`, or allowed admin access surface.
- Machines: `/admin/machines`, Super Admin only.
- Partner Records: `/admin/partner-records`, Super Admin only.
- Partnerships: `/admin/partnerships`, Super Admin only.
- Admin Reporting: `/admin/reporting`, Super Admin only.

### Settings

Purpose: user account and utility controls.

Items:

- Account: `/portal/account`, visible when the current `showAccountLink` logic allows account settings.

Utility controls should live outside the main nav groups, ideally in the sidebar footer or profile menu:

- language preference
- main site link
- signed-in email/profile menu
- sign out

## Persona Visibility Matrix

This matrix describes target visibility. Implementation should use current source-of-truth helpers instead of hardcoded persona names.

| Persona | Expected visible sections |
| --- | --- |
| Baseline authenticated user | Home, Work with My Orders, Settings |
| Training-only Technician | Home, Work with Reports only when assigned, Learn & Support with Training, Settings only if current account rules allow |
| Plus Account Owner | Home, Work, Learn & Support, Access & Setup with Team when eligible, Settings |
| Corporate Partner | Home, Work with Reports, Learn & Support, Access & Setup with Team when eligible, Settings |
| Refund operations user | Home, Operations with Refund Cases, plus any normal portal sections granted by their portal tier |
| Scoped Admin | Home, Work with assigned Reports, Learn & Support with Training, Operations if allowed, Access & Setup with People & Permissions only for scoped surfaces |
| Payouts-only admin | Home, Operations with Payouts, no broad super-admin setup tools |
| Super Admin | All sections and all admin items |
| Signed-out user | No authenticated sidebar; protected routes redirect through existing auth behavior |

## Role Filtering Rules

The shell should keep authorization decisions centralized and derived from existing state:

- `portalAccessTier` controls baseline, training, Plus, and Corporate Partner portal access.
- `capabilities` controls `training.view`, `support.request`, `reports.partner.view`, `refunds.manage`, and `technicians.manage`.
- `hasReportingAccess` controls `/portal/reports` visibility.
- `canManageTechnicians` plus `usePortalTechnicianManagement()` controls `/portal/team`.
- `adminAccess.allowedSurfaces` controls scoped admin surfaces such as `access`, `refunds`, and `payouts`.
- `isSuperAdmin` unlocks global admin modules.
- `isScopedAdmin` must not become a broad admin shortcut.

Primary navigation should hide unauthorized destinations. Do not show locked global-nav items as upsell chips. If an upgrade or access explanation is needed, surface it on `/portal`, `/portal/account`, or the relevant blocked page.

## Desktop Behavior

Target desktop shell:

- persistent left sidebar at large widths
- section labels with compact vertical nav items
- one clear active route state
- content area scrolls independently of the sidebar when useful
- top bar is limited to page title/context and utility controls
- no Portal/Admin workspace pills as the primary navigation
- no Portal horizontal pill nav
- no Admin tools horizontal pill nav

Active route matching:

- exact match for `/portal`
- prefix match for route families such as `/portal/training/:id`, `/portal/time/new`, and `/admin/access?tab=audit`
- redirected routes should highlight their destination item, for example `/admin/refunds` should highlight Refund Cases after redirect to `/portal/refunds`

## Tablet And Mobile Behavior

Target tablet/mobile shell:

- top app bar with logo or app label, current page title, profile/account affordance, and one menu button
- menu opens a right-side drawer or full-height sheet, not a bottom sheet for global navigation
- drawer uses the same section order as desktop
- drawer closes after navigation
- focus returns to the menu button after close
- Escape closes the drawer where browser APIs allow
- section list scrolls inside the drawer when the user has many admin destinations
- no horizontal nav scrollers for primary portal/admin movement

Mobile content must avoid hidden actions, clipped text, and accidental horizontal overflow at 360px, 390px, and 414px widths.

## What To Remove, Replace, Or Retain

Remove or replace:

- `workspaceLinks` as top-level Portal/Admin primary navigation.
- `PortalLayout` desktop horizontal portal nav.
- `PortalLayout` mobile bottom-sheet section switcher.
- `AppLayout` desktop `Admin tools` horizontal nav row.
- `AppLayout` mobile admin-only nested list that appears only when already inside admin.
- Global-nav locked upsell pills for inaccessible destinations.

Retain:

- existing routes and route guards
- existing host split between public marketing and app surfaces
- existing profile/sign-out behavior
- existing language preference control
- current `portalDestinations` and `adminDestinations` as migration inputs
- page-local tabs, steppers, and wizards where they represent a real local workflow, such as Admin Access tabs and Admin Partnerships steps
- route-specific SEO/noindex handling for private paths

## Implementation Guidance For #550

Recommended implementation shape:

1. Create a shared authenticated navigation model, for example `src/components/layout/authenticatedNavigation.ts`.
2. Normalize portal and admin destinations into one `AuthenticatedNavItem` type:
   - `href`
   - `labelKey`
   - `descriptionKey`
   - `icon`
   - `section`
   - `match`
   - `visible`
   - `requiresSuperAdmin` or equivalent helper predicates
3. Move `adminDestinations` out of `AppLayout.tsx` if needed so the shell and tests can consume it.
4. Keep `portalDestinations` as the portal metadata source, but add or map section metadata instead of duplicating labels.
5. Implement an `AuthenticatedSidebar` that renders the filtered grouped model.
6. Update `AppLayout` to render the sidebar/drawer and utility controls.
7. Simplify `PortalLayout` so it provides portal page framing only, not global portal navigation.
8. Keep direct routes and route guards unchanged.

Avoid implementing dashboard content changes in #550 unless required to keep the shell coherent. `/portal` task-first dashboard work belongs in #551.

## Key States To Cover

- loading auth state
- signed-out protected route redirect
- baseline user with only Dashboard, My Orders, and Account
- training-only user
- Plus Account Owner
- Corporate Partner with reporting and Team access
- Technician with assigned reports but no billing/admin controls
- Scoped Admin with Access only
- Refund operations user
- Payouts-only admin
- Super Admin with all admin destinations
- unauthorized direct-load attempt
- long signed-in email in profile/menu
- small mobile viewport with many admin destinations

## Content Requirements

Recommended labels:

- Dashboard
- Time
- My Orders
- Reports
- Training
- Onboarding
- Support
- Refund Cases
- Admin Orders
- Support Queue
- Payouts
- Team
- People & Permissions
- Machines
- Partner Records
- Partnerships
- Admin Reporting
- Account

Avoid using `Admin` as a standalone destination label when a more specific item is available. `Admin Overview` is acceptable for `/admin` because it clarifies the route is an overview, not the entire admin mode.

## Open PR Overlap

The #550 implementation agent must call out overlap with these active PRs if they are still open:

- #503 `Simplify admin payout review workspace`: touches `src/pages/admin/Payouts.tsx`, payout UAT scripts, and smoke checklist.
- #527 `Fix admin partnership assignment UX`: touches Admin Machines, Partner Records, Partnerships, and reporting setup UI.
- Dependabot PRs #545, #544, and #489 touch package manifests and may affect verification timing, but they do not alter portal IA directly.

This #549 plan does not touch runtime files, so it has no direct code conflict with those PRs.

## UAT Questions For Owner

Owner UAT for this plan should answer:

- Are the section names acceptable: Home, Work, Learn & Support, Operations, Access & Setup, Settings?
- Is it acceptable that Refund Cases lives under Operations while the URL remains `/portal/refunds`?
- Is it acceptable to hide locked global-nav destinations and move upgrade/access education to dashboard/account/blocked states?
- Is it acceptable to remove the Portal/Admin workspace pills once the sidebar exists?

If the owner rejects any of these, revise this plan before #550 starts.

## Recommended Impeccable References For Implementation

- `product.md` for product UI defaults.
- `shape.md` only if the implementation agent needs to rescope the brief.
- `layout.md` for spacing, hierarchy, and sidebar rhythm.
- `adapt.md` for desktop/tablet/mobile shell behavior.
- `clarify.md` for navigation labels and blocked-state copy.
- `harden.md` for loading, empty, error, permission, and edge states.

## Acceptance Checklist For #550

The shell implementation should not be accepted until:

- desktop uses one sectioned sidebar
- mobile uses one matching drawer
- current routes direct-load
- active route state is correct for child routes and redirects
- unauthorized destinations are hidden
- protected direct-load attempts still fail safely
- no primary portal/admin horizontal nav remains
- screenshots cover super admin, non-admin/member, and mobile drawer states
- PR body calls out overlap with active payout, partnership, access, or admin PRs

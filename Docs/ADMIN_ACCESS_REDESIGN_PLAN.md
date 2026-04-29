# Admin Access Redesign Plan

## Purpose
`/admin/access` is functionally capable but still hard to use. The page grew by adding tabs for each access slice, which now makes common admin work feel redundant and unclear.

This plan makes issue `#227` the concrete UX/CX redesign brief for the next access-management slice.

## Current Problems
- The page is organized around implementation areas, not the admin's task.
- `Users`, `Presets`, `Reporting Access`, `Scoped Admins`, `Global Roles`, and `Audit` overlap in ways that make it unclear where to start.
- Admins must know which tab maps to which backend source before they can answer a simple question about a person.
- Effective access, grant actions, reporting machine scope, and revoke impact are not presented as one coherent workflow.
- Audit/activity is important, but it competes with primary access-management tasks.
- The page exposes too many controls at once for rare operations.

## Target Experience
The page should become a person-first console.

Primary admin workflow:
1. Search for a person by email or user ID.
2. See what access they have now.
3. See why they have it, where it applies, and when it expires.
4. Choose a clear action: grant, change scope, renew, revoke, or review activity.
5. Preview the effect before saving.
6. Save with a required reason.

The admin should not need to know the underlying table, RPC, or legacy grant name.

## Proposed Information Architecture

### Default View: Find A Person
- One prominent search field.
- Recent people or common operations may appear below search, but they should not compete with search.
- Empty state should explain that access is managed by person first.

### Selected Person Workspace
Once a person is selected, show one consolidated workspace:

- **Access Summary**
  - Presets: Super Admin, Scoped Admin, Plus Customer, Corporate Partner, Technician.
  - Plain-English capabilities.
  - Warning states such as no auth user, expiring soon, no machines assigned, no active portal-enabled partnership.

- **Active Access Cards**
  - Plus Customer access.
  - Corporate Partner access.
  - Technician access.
  - Scoped Admin access.
  - Super Admin access.
  - Manual reporting access.
  - Each card should show source, scope, expiry, grant reason, and available actions.

- **Machine And Partner Scope**
  - Total reporting machines.
  - Corporate Partner-derived machines.
  - Technician-assigned machines.
  - Scoped Admin machines.
  - Manual reporting machines.
  - Partner and partnership scope where relevant.

- **Grant Or Change Access**
  - A single action panel or drawer with preset choices.
  - Preset forms should appear only after a preset is selected.
  - Each save shows a preview: "This will give X capabilities across Y partnerships and Z machines."

- **Revoke Or Renew**
  - Revoke must show impact before save.
  - Renew should be a first-class action for expiring Technician access.
  - Required reason for every change.

- **Activity**
  - Audit/activity remains available but is secondary to managing the selected person.
  - Global audit search can remain reachable from a quieter secondary view.

## Tab Direction
Do not keep adding peer tabs for each access model.

Near-term target:
- Keep `/admin/access` as the route.
- Replace the current tab-heavy interaction with a person workspace.
- If tabs remain, use only broad task tabs such as `People`, `Reviews`, and `Activity`.
- Move `Users`, `Presets`, `Reporting Access`, `Scoped Admins`, and `Global Roles` into the selected-person workspace as cards/actions.

## Phase 1 Scope
Phase 1 should be primarily UX composition using the access sources already implemented.

Included:
- Redesign `/admin/access` default state around person search.
- Consolidate effective access and active grants into one selected-person workspace.
- Replace redundant tab navigation with one primary workflow.
- Provide grant/edit/revoke entry points from the relevant access card.
- Keep existing backend RPCs where possible.
- Add desktop and mobile screenshots to the PR.

Not included:
- Building a raw permission matrix.
- Building granular per-user overrides.
- Changing Corporate Partner, Technician, Plus Customer, or Scoped Admin authorization semantics.
- Moving customer-managed Technician workflows out of `/portal/account`.

## Phase 2 Scope
Issue `#331` should follow the redesign with:
- access review queue,
- expiry reminders,
- expiring Technician renewal workflow,
- broad admin-access review,
- inactive partner membership review,
- revoke-impact previews with richer audit context.

## Phase 3 Scope
Issue `#150` should own later entitlement-scale work:
- granular overrides,
- account-scope delegation,
- helper-schema cleanup,
- deeper capability model convergence,
- advanced admin controls hidden behind streamlined UX.

## Acceptance Criteria
- A non-technical admin can find a person and answer: who has access, what can they do, where does it apply, why do they have it, when does it expire, and what happens if it is revoked.
- The main path no longer requires choosing among overlapping tabs before searching for a person.
- Corporate Partner, Technician, Plus Customer, Scoped Admin, Super Admin, and manual reporting access are visible in one person workspace.
- Grant, renew, scope-change, and revoke actions have plain-English previews and required reasons.
- Rare or dangerous actions are available but not visually dominant.
- Screenshots cover desktop and mobile.
- Existing permission boundaries remain unchanged.

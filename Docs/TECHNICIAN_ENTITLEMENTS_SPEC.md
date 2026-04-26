# Technician Entitlements Spec

## Status
This is a docs-only implementation spec for GitHub issue `#183`: Define machine-scoped technician reporting entitlements.

Source and coordination notes:
- `Docs/ENTITLEMENTS_PERSONA_ROADMAP.md` is the source of truth for the broader Super Admin, Scoped Admin, Plus Account Owner, Technician, and Partner Viewer persona boundaries.
- This document is the detailed companion spec for the Technician portion of that roadmap.
- PR `#182` is actively changing `/portal/reports`, partner dashboard UI, `src/lib/partnerDashboardReporting.ts`, and reporting preview migrations. This spec does not edit or require changes in those files.

## Scope
Define how a future Technician persona should combine existing training-only operator access with machine-scoped reporting access.

This spec does not implement partner viewer UI, partner dashboard permissions, PDF export behavior, billing behavior, dependency upgrades, or any route/code changes.

## Current Foundations
Current access foundations should be preserved instead of replaced:

- Training-only operator grants are stored in `operator_training_grants`.
- Active Plus members and super-admins can grant training-only operator access by email.
- A training-only operator can access `/portal` and `/portal/training*`, including training progress and the certificate flow.
- Training-only access does not create Plus membership, billing access, sugar discounts, onboarding/support access, or account-owner tools.
- Training-only access currently depends on the sponsor retaining active Plus access. If the sponsor loses Plus access, the sponsored operator grant stops conferring training access.
- Reporting access is separate from Plus and training access.
- Machine reporting access is stored through `reporting_machine_entitlements` and evaluated by `has_reporting_machine_access`.
- Reporting visibility can currently be scoped by account, location, or machine, with `viewer` and `report_manager` access levels.
- V1 reporting visibility remains machine-level for customer and technician use. Partnerships must not create inherited portal access.

## Target Persona
Technician is customer staff responsible for operating or monitoring assigned machines.

Technician access is a composition of:

1. Training access, using the existing operator training grant model.
2. Reporting access, limited to explicitly assigned machines.

A Technician is not a Plus Account Owner, Partner Viewer, report manager, billing manager, scoped admin, or super-admin.

## Entitlement Composition Rules

### Training Relationship
Current training-only operator grants remain valid and should continue to mean training-only access.

Future Technician access should build on the training grant model rather than rename all existing operators into technicians automatically. The practical rule is:

- An active `operator_training_grants` row grants training access only.
- A Technician grant adds one or more assigned reporting machines to that training relationship.
- Existing training-only operators with no machine assignments stay training-only.
- If a Plus Account Owner assigns machines to an email that already has an active training grant from that owner/account, the later RPC should reuse/update that relationship instead of creating a duplicate seat.
- If a Plus Account Owner assigns machines to a new email, the later RPC should create or update the training grant and then create machine assignments.

### Reporting Relationship
Technician reporting should compose with the existing reporting entitlement model, but only at machine scope.

Rules:

- Technician reporting access should use `reporting_machine_entitlements` with `machine_id` populated.
- Technician grants should not create account-level or location-level reporting entitlements.
- Technician machine assignments should use `access_level = 'viewer'` by default.
- `report_manager` should stay reserved for super-admin-managed reporting users unless a later decision explicitly delegates management authority.
- Derived reporting entitlements should carry enough source metadata in a future schema slice to identify their Technician grant source, such as `source_type = 'technician_grant'` and `source_id = technician_grant_id`.
- Revoking a Technician grant or removing a Technician machine assignment must revoke or suspend the derived reporting entitlement for that machine.
- A manually granted super-admin reporting entitlement should remain independent. The Technician revoke flow should not remove unrelated manual reporting access from the same user.

Effective Technician report visibility should be the active assigned-machine set. If the user has other reporting access through a separate entitlement, that access is outside the Technician grant and must remain auditable as a separate source.

## Who Can Grant Or Revoke

V1 grant authority:

- Plus Account Owner: can grant, update, and revoke Technician access for their own Plus account.
- Super Admin: can grant, update, and revoke Technician access for any account with a required audit reason.

Not V1 grant authority:

- Technician.
- Partner Viewer.
- Training-only operator.
- Reporting `viewer`.
- Reporting `report_manager`, unless a later decision explicitly expands this role.
- Account admin or delegated team manager, unless a later decision adds delegated customer team management.

The customer-facing flow should live in `/portal/account` or a future `/portal/team`, not in `/admin`. Internal override and audit review can stay in `/admin/access`.

## Plus Account Owner Limits

Default V1 cap:

- 10 active Technician grants per Plus account.
- The cap counts unique active technician emails or user IDs for that Plus account.
- Revoked or expired grants do not count.
- Re-sending an invite or updating machine assignments for the same normalized email should not consume another seat.

Machine assignment limit:

- A Plus Account Owner can assign only machines they already control.
- Control means the owner has an active owner relationship to the customer account that owns the reporting machine and active Plus access for that account.
- The grant/revoke RPC must validate every requested machine against the owner's controlled machine set.
- If any requested machine is outside the owner's control, the RPC should fail before making partial changes unless the UI later supports explicit partial-save behavior.

Additional seats:

- Paid additional Technician seats are P2.
- V1 should reject cap-exceeding grants with clear copy and no billing side effects.
- Do not model paid seat purchase, Stripe quantity changes, or additional seat invoices in the P1 implementation slices.

## Technician Can See

Technician can see:

- `/portal`.
- `/portal/training*`.
- Training progress and Operator Essentials certificate flow.
- `/portal/reports` only when the account has reporting enabled and only for assigned machines.
- Reporting filters, charts, and rows that are backed only by assigned machines.

Technician reporting should be read-only in V1.

## Technician Cannot See

Technician cannot see or use:

- Plus sugar discounts or other Plus commerce discounts.
- Billing, Stripe customer portal, subscription status controls, or payment methods.
- Plus Account Owner tools.
- Technician/team grant management.
- Account-owner profile/shipping/account management beyond whatever baseline portal identity is required for sign-in.
- Partner settlement views.
- Partner dashboard controls.
- Partner PDF generation, review, download, schedules, or recipient management.
- Admin surfaces under `/admin`.
- Reporting import, mapping, schedule, freshness, warning, or export-admin surfaces.
- Machines that are not assigned to that Technician.
- Account-level or location-level reporting rollups unless every included machine is assigned to that Technician.

## Edge Cases

| Edge case | Expected behavior |
| --- | --- |
| Plus sponsor loses access | Training access already stops because active operator training grants depend on sponsor Plus access. Future Technician reporting must also suspend or revoke derived machine reporting entitlements when the Plus Account Owner no longer has active Plus access or active ownership of the account. Automated suspension should write audit metadata with the reason. |
| Machine removed from owner | The Technician's assignment for that machine must be revoked or suspended. The derived `reporting_machine_entitlements` row for that machine must no longer confer access. Other assigned machines remain active if still controlled by the owner. |
| Technician reassigned | Updating the assigned machine set should add newly assigned machine entitlements and revoke removed machine entitlements in one audited transaction. The training grant remains active unless the user is removed entirely. |
| Grant cap exceeded | The RPC rejects the new grant before creating an invite, training grant, machine assignment, or reporting entitlement. Existing active grants can still be updated without consuming an extra seat. |
| Duplicate invite/email in same account | Normalize email before comparison. If an active grant already exists for that account/email, update or resend rather than creating a duplicate grant or consuming another seat. |
| Duplicate email across accounts | Allow only when each Plus Account Owner independently controls their account and assigned machines. Reporting visibility is the union of separately valid machine assignments, with each assignment auditable to its source account. |
| Email belongs to an existing user | Link the grant to the existing `auth.users.id` when possible and keep normalized email for invite/display continuity. |
| Email has not signed in yet | Store the normalized email and machine assignment intent. When the user signs in with that email, the training grant and derived reporting entitlements should resolve to that user without manual admin repair. |
| Technician revokes own access | Not supported in V1. They can ask the Plus Account Owner or Bloomjoy to revoke. |
| Owner tries to assign unowned machine | Reject the request with no partial grant. Audit the denied attempt only if a future security logging slice adds denial logging. |
| Manual reporting access exists too | Do not remove unrelated manual reporting entitlements when revoking Technician access. Only revoke rows whose source is the Technician grant or assignment. |

## Audit Trail Requirements

Every grant, update, revoke, and machine-assignment change should be auditable.

Minimum audit fields:

- actor user ID and actor email when available.
- actor authority path: Plus Account Owner or Super Admin.
- target technician email and user ID when available.
- customer account ID.
- machine IDs added and removed.
- before and after assignment state.
- grant reason or revoke reason.
- source type and source ID for derived reporting entitlements.
- timestamp.
- invite send or resend status.
- automated suspension reason when caused by sponsor loss, owner loss, or machine removal.

Use `admin_audit_log` if it remains the canonical audit table. If a customer-facing audit table is added later, it should still be queryable by super-admins and tied back to the same source grant IDs.

## Proposed Implementation Slices

### 1. Data Model And RLS
Add a forward-only migration that introduces Technician source records and machine assignments without changing partner reporting behavior.

Recommended shape:

- `technician_grants`: account, owner/sponsor, technician email/user, status, invite metadata, starts/expires, grant/revoke fields, audit reason.
- `technician_machine_assignments`: technician grant ID, machine ID, active/revoked state, grant/revoke fields.
- Optional source columns on `reporting_machine_entitlements`, such as `source_type` and `source_id`, so derived entitlements can be safely revoked without touching manual grants.
- RLS/helper functions that validate the owner controls the account and machine before allowing grants.
- Helper that counts active unique Technician grants per Plus account and enforces the default cap of 10.

Do not add account/location broad reporting inheritance for Technician in this slice.

### 2. Grant And Revoke RPCs
Add customer-safe RPCs for the owner flow:

- `grant_technician_access(email, machine_ids, reason)`.
- `update_technician_machines(grant_id, machine_ids, reason)`.
- `revoke_technician_access(grant_id, reason)`.
- `get_my_technician_grants()`.

RPC requirements:

- Authenticate the actor.
- Confirm actor is a Plus Account Owner for the account.
- Confirm actor controls every requested machine.
- Enforce the 10-grant cap.
- Normalize duplicate emails.
- Reuse or create the underlying operator training grant.
- Create, update, or revoke derived machine-level reporting entitlements.
- Write audit rows.
- Send or queue invite email without blocking the database transaction on email delivery failure.

Add super-admin override RPCs only if the internal UI needs them in the same slice. Otherwise keep internal override as a later PR.

### 3. Customer UX
Add the customer flow under `/portal/account` or a future `/portal/team`.

V1 UX should show:

- Technician list with email, invite/status, assigned machine count, and last updated timestamp.
- Seat usage: `used / 10`.
- Add Technician form with email and machine selector.
- Edit assigned machines.
- Revoke access with required confirmation/reason.
- Clear message when the owner has no controlled machines.
- Clear cap-exceeded message with no Stripe or paid-seat flow.

Do not add partner dashboard UI, partner viewer UI, PDF/report export behavior, or `/admin` customer team management.

### 4. Portal Reporting Integration
Keep `/portal/reports` behavior machine-scoped.

The reporting route should continue to rely on effective machine access, but future Technician implementation should ensure effective access excludes unassigned machines and suspended source grants. If source-aware entitlement filtering requires a helper change, make that change in a narrow PR with targeted tests.

Do not edit partner dashboard behavior for this Technician slice.

### 5. QA And Smoke Tests
Add smoke checklist items when implementation begins, not in this docs-only PR.

Future checks:

- Plus Account Owner can add a Technician with one assigned machine.
- Technician can open `/portal/training*`.
- Technician can open `/portal/reports` and sees only the assigned machine.
- Technician cannot see unassigned machines in reporting filters or results.
- Technician cannot access billing, Plus discounts, account-owner tools, partner settlement, or `/admin`.
- Owner cannot assign a machine outside their controlled account.
- The 11th active Technician grant is rejected for a default-cap account.
- Revoking a Technician removes training/reporting access after session refresh or re-login.
- Removing a machine from the owner removes Technician access to that machine.
- Audit rows are written for grant, assignment update, revoke, and automated suspension.

### 6. Migration Or Backfill
Backfill should be conservative:

- Existing `operator_training_grants` remain training-only.
- Do not automatically assign reporting machines to existing training-only operators.
- If a future UX wants to surface existing training operators in the team list, mark them as training-only until an owner explicitly assigns machines.
- Existing manual `reporting_machine_entitlements` remain manual reporting grants.
- Do not reinterpret existing account/location reporting entitlements as Technician assignments.

## Acceptance Criteria For Later Implementation

- Current training-only access continues to work unchanged.
- A Technician with assigned machines has training plus reporting only for those machines.
- Revoking or suspending the Technician source removes only derived Technician reporting access.
- Plus Account Owner can grant only within their controlled machine set.
- Default cap of 10 active Technician grants per Plus account is enforced.
- Paid additional seats remain out of scope.
- All grant/revoke/assignment changes are audited.
- Partner viewer, partner settlement, PDF export, and admin reporting workflows are not expanded by the Technician implementation.

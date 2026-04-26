# Entitlements Persona Roadmap

## Purpose
This document turns the current Bloomjoy entitlement brainstorm into a planning artifact for product, UAT, and future implementation work. It is intentionally documentation-only: no code, schema, RLS, route, or UI changes are introduced by this plan.

The near-term goal is to make the current role and entitlement direction clear enough that agents can build the next slices without blurring customer, technician, partner, and internal-admin access.

## Product Guardrails
- Corporate partner reviewed-PDF reporting remains the P0 reporting milestone.
- `/admin` stays internal-only for now.
- Customer account and team management should live under `/portal/account` or a future `/portal/team`.
- Partner Viewer surfaces should live under `/portal/reports` once enabled, not under `/admin`.
- Partnership setup must not grant portal access by itself.
- Full super-admin role and entitlement builder UI remains P2.

## Current Foundations
- `super_admin` exists through `admin_roles` and is the current internal owner/admin mechanism.
- Bloomjoy Plus access exists through paid subscriptions and free Plus grants.
- Training-only operator grants exist and are separate from paid Plus membership.
- Machine-level reporting entitlements exist with `viewer` and `report_manager` access levels.
- `customer_account_memberships` already includes `partner_viewer`, but it is not yet a live customer-facing flow.
- Current partner-dashboard planning keeps V1 partner-dashboard access super-admin-only until explicit partner-viewer permissions exist.

## Gap Assessment
- Scoped internal admins are not implemented yet.
- Plus Account Owners cannot yet manage machine-scoped technician reporting access.
- Technicians are not yet modeled as users with both training and machine-scoped reporting visibility.
- Partner Viewer needs a first-class definition as external, non-paying, partner/reporting-only access.
- A full role and entitlement management page for super-admins is still a lower-priority roadmap item.

## Persona Matrix
| Persona | Who | Can See | Can Manage Or Grant | Explicit Exclusions | Status |
| --- | --- | --- | --- | --- | --- |
| Super Admin | Ethan and Ian as Bloomjoy co-owners | All Bloomjoy admin, portal, reporting, partnership, partner PDF, and audit surfaces | Roles, grants, machines, machine metadata, reporting access, partnerships, partner PDF generation/review/download, and audit review | None beyond normal production safeguards and auditability | Current owner role through `admin_roles`; continue as P0/P1 operating model |
| Scoped Admin | Internal Bloomjoy admin such as Adam, limited to granted machines/accounts | Only machines, accounts, reports, and metadata explicitly granted by a super-admin | Future ability to manage machine metadata, reporting, and operational workflows only for entitled machines/accounts | Cannot view or manage ungranted machines, accounts, reports, partnerships, or users | Future implementation; keep in P2 umbrella until P0 reporting is trusted |
| Plus Account Owner | Paying Bloomjoy Plus customer account owner | Their own machines, machine reporting, training, onboarding, support, account tools, and Plus benefits | Invite technicians and assign only machines the owner already controls; default V1 cap is 10 technician grants per Plus account | No internal admin setup, no unrelated customer accounts, no partner settlement access unless separately granted Partner Viewer, no global role management | P1 customer/team-management direction |
| Technician | Customer staff member responsible for assigned machines | Training and reporting only for machines assigned by a Plus Account Owner or super-admin | No grant authority by default | No Plus discounts, billing, account-owner tools, partner settlement, admin operations, machine setup, or global reporting | P1 gap: define machine-scoped technician reporting entitlements |
| Partner Viewer | External corporate partner or venue contact | Approved partner dashboards, report snapshots, and PDFs for granted partnerships or machines | No setup changes; may download approved artifacts only when the final product flow allows it | No Bloomjoy Plus benefits, commerce discounts, billing, technician management, admin setup, imports, tax/rule edits, schedules, or internal warning ledgers | Planned after reviewed corporate PDFs are trusted |

## Permissioning Rules For Near-Term Work
- Super Admin remains the only role that can configure partnerships, revenue-share rules, tax assumptions, partner report generation, and manual PDF review in V1.
- Scoped Admin should be implemented only when the business is ready to support internal users with restricted machine/account visibility.
- Plus Account Owner can grant technician access only within the machine/account boundary already granted to that owner.
- Technician grants should compose training access with machine-scoped reporting visibility, without creating Plus benefits or account-owner permissions.
- Partner Viewer access must be explicit and partner/reporting-only; it must not be inherited from partnership setup or Plus membership.
- Reporting visibility remains scoped and auditable. Do not add hidden global access paths for customer, technician, or partner personas.
- Paid additional technician seats are a P2 commercial option; the near-term default is a 10 technician grant cap per Plus account.

## Recommended UX
- Internal user and entitlement administration stays in `/admin/access`.
- Partnership setup, revenue-share rules, machine assignment, tax assumptions, and partner PDF generation stay in `/admin/partnerships`.
- Customer team and technician management should live under `/portal/account` or future `/portal/team`.
- Operator and Plus Account Owner reporting should continue under `/portal/reports`.
- Partner Viewer reporting should eventually appear under `/portal/reports` as a permissioned partner-dashboard/report-artifact view.
- Users without partner-dashboard visibility should not see disabled partner tabs or upsell-style placeholders.

## GitHub Issue Roadmap
- `#150` remains the P2 umbrella for scalable roles, entitlements, and a future super-admin role-management UI.
- `#123` should carry the Plus Account Owner technician-management scope, including the 10 technician grant cap, grant-only-owned-machines rule, and paid additional seats as P2.
- `#128` should define Partner Viewer as explicit partner/reporting-only access with no inherited Plus benefits or admin powers.
- `#183` is the P1 issue for machine-scoped technician reporting entitlements, connecting current training-only grants with machine-specific reporting visibility. See `Docs/TECHNICIAN_ENTITLEMENTS_SPEC.md` for the detailed implementation spec.

## Acceptance Criteria
- The roadmap clearly answers who can see what, who can grant what, and what is deferred.
- Partner Viewer is first-class in the matrix and issue roadmap.
- No persona receives implicit access through partnership setup alone.
- Plus Account Owner, Technician, and Partner Viewer boundaries are distinct and non-overlapping.
- Existing GitHub issues are updated instead of duplicated where possible.

## Assumptions
- Partner Viewer is planned now, but implementation waits until corporate partner reviewed-PDF reporting is trusted.
- `/admin` remains internal-only.
- Partner Viewer receives reporting and partner artifacts only, not Bloomjoy Plus.
- Full custom role and entitlement editing remains P2.

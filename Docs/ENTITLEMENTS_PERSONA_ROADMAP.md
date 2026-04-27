# Entitlements Persona Roadmap

## Purpose
This document is the current product source of truth for Bloomjoy entitlement personas. It separates:

- implemented repo-side roles and entitlement mechanisms,
- schema/planning vocabulary that exists but is not fully productized,
- planned roles and customer-facing flows that are not live yet.

This roadmap is intentionally documentation-only: no code, schema, RLS, route, or UI changes are introduced by this plan.

The near-term goal is to keep customer, technician, partner, reporting, and internal-admin access boundaries clear enough that agents do not re-open already implemented work or accidentally ship planned roles early.

## Product Guardrails
- Corporate partner reviewed-PDF reporting remains the P0 reporting milestone.
- `/admin` stays internal-only for now.
- Customer account and team management should live under `/portal/account` or a future `/portal/team`.
- Partner Viewer surfaces should live under `/portal/reports` once enabled, not under `/admin`.
- Partnership setup must not grant portal access by itself.
- Scoped Admin is not implemented in this repo yet.
- Partner Viewer is not a live customer-facing flow yet.
- Full custom role and entitlement builder UI is not implemented and remains under the P2 umbrella unless reprioritized.

## Implemented Today
- Super Admin is implemented through `admin_roles.role = 'super_admin'` and remains the current internal owner/admin mechanism.
- Baseline signed-in user access is implemented as basic portal access for authenticated users without Plus, training, reporting, or admin entitlements.
- Plus access is implemented through paid `subscriptions`, free `plus_access_grants`, and admin-derived Plus access.
- Training-only operator access is implemented through `operator_training_grants`; it grants training access without Plus benefits, billing, account-owner tools, or commerce discounts.
- Plus Account Owner is implemented for Technician management through Plus access plus `customer_account_memberships.role = 'owner'`; owners can manage Technician grants only for controlled machines.
- Technician is implemented repo-side through `technician_grants`, `technician_machine_assignments`, and Technician-sourced `reporting_machine_entitlements`; Technicians get training plus reporting for assigned machines only.
- Machine reporting entitlement levels are implemented as `viewer` and `report_manager` on `reporting_machine_entitlements.access_level`.
- Production caveat: repo-side Technician is implemented, but issue `#214` remains open to verify/restore `resolve_my_technician_entitlements` in production. Do not describe production Technician as fully verified until `#214` is resolved.

## Schema And Planning Vocabulary
- `customer_account_memberships.role` includes role vocabulary that is not fully productized as live customer/admin flows: `account_admin`, `billing_manager`, `operator`, `support_contact`, `report_viewer`, `report_manager`, and `partner_viewer`.
- The legacy `partner` membership role exists in the older partner/operator account migration and should be treated as legacy vocabulary, not the current Partner Viewer product flow.
- `report_manager` as a customer account membership role is planning vocabulary; `reporting_machine_entitlements.access_level = 'report_manager'` is the implemented machine reporting entitlement level.

## Planned Or Not Live
- Scoped Admin is not implemented.
- Partner Viewer is not a live customer-facing flow. Issue `#128` remains open unless it is explicitly superseded.
- Full custom entitlement-builder UI is not implemented. Issue `#150` remains the umbrella/P2 item unless reprioritized.

## Persona Matrix
| Persona | Who | Can See | Can Manage Or Grant | Explicit Exclusions | Status |
| --- | --- | --- | --- | --- | --- |
| Super Admin | Ethan and Ian as Bloomjoy co-owners | All Bloomjoy admin, portal, reporting, partnership, partner PDF, and audit surfaces | Roles, grants, machines, machine metadata, reporting access, partnerships, partner PDF generation/review/download, and audit review | None beyond normal production safeguards and auditability | Implemented through `admin_roles.role = 'super_admin'` |
| Baseline signed-in user | Authenticated customer/contact without Plus, training, reporting, or admin entitlement | Basic portal shell and baseline account/order surfaces | Own profile basics only | No Plus-gated training/onboarding/support, reporting, billing management, Technician management, partner settlement, or admin surfaces | Implemented as basic portal access |
| Plus access holder | Paid Plus subscriber, free Plus grant recipient, or super-admin-derived Plus user | Plus-gated portal features, training, onboarding/support, and Plus benefits where applicable | Training-only operator access when allowed by access context | No unrelated customer accounts, partner settlement, global reporting, admin setup, or custom role management | Implemented through paid `subscriptions`, `plus_access_grants`, and admin-derived Plus access |
| Training-only operator | Staff invited for operator training only | `/portal` and `/portal/training*` | No grant authority | No Plus discounts, billing, onboarding/support beyond the implemented training boundary, account-owner tools, reporting, partner settlement, or `/admin` | Implemented through `operator_training_grants` |
| Plus Account Owner | Bloomjoy Plus customer account owner with an owner membership | Their controlled machines, training, onboarding, support, account tools, Plus benefits, and Technician management context | Invite/revoke Technicians and assign only controlled machines; default V1 cap is 10 Technician grants per Plus account | No internal admin setup, unrelated customer accounts, partner settlement access unless separately granted Partner Viewer, or global role management | Implemented for Technician management through Plus access plus `customer_account_memberships.role = 'owner'` |
| Technician | Customer staff member responsible for assigned machines | Training and reporting only for machines assigned by a Plus Account Owner or super-admin | No grant authority by default | No Plus discounts, billing, account-owner tools, partner settlement, admin operations, machine setup, or global reporting | Implemented repo-side through Technician grants, machine assignments, and Technician-sourced machine reporting entitlements; production verification caveat remains `#214` |
| Scoped Admin | Internal Bloomjoy admin limited to granted machines/accounts | Future: only machines, accounts, reports, and metadata explicitly granted by a super-admin | Future ability to manage machine metadata, reporting, and operational workflows only for entitled machines/accounts | Cannot view or manage ungranted machines, accounts, reports, partnerships, or users | Planned; not implemented |
| Partner Viewer | External corporate partner or venue contact | Future: approved partner dashboards, report snapshots, and PDFs for granted partnerships or machines | No setup changes; may download approved artifacts only when the final product flow allows it | No Bloomjoy Plus benefits, commerce discounts, billing, Technician management, admin setup, imports, tax/rule edits, schedules, or internal warning ledgers | Planned; not live customer-facing flow (`#128`) |

## Permissioning Rules For Near-Term Work
- Super Admin remains the only role that can configure partnerships, revenue-share rules, tax assumptions, partner report generation, and manual PDF review in V1.
- Scoped Admin should be implemented only when the business is ready to support internal users with restricted machine/account visibility.
- Plus Account Owner can grant Technician access only within the machine/account boundary already controlled by that owner.
- Technician grants compose training access with machine-scoped reporting visibility, without creating Plus benefits or account-owner permissions.
- Partner Viewer access must be explicit and partner/reporting-only; it must not be inherited from partnership setup or Plus membership.
- Reporting visibility remains scoped and auditable. Do not add hidden global access paths for customer, technician, or partner personas.
- Paid additional Technician seats are a P2 commercial option; the current default is a 10 Technician grant cap per Plus account.
- Do not use this roadmap to imply production Technician invite resolution is fully verified until `#214` is closed.

## Recommended UX
- Internal user and entitlement administration stays in `/admin/access`.
- Partnership setup, revenue-share rules, machine assignment, tax assumptions, and partner PDF generation stay in `/admin/partnerships`.
- Current Technician management lives under `/portal/account`; broader customer team management may later move to a future `/portal/team`.
- Operator and Plus Account Owner reporting should continue under `/portal/reports`.
- Partner Viewer reporting should eventually appear under `/portal/reports` as a permissioned partner-dashboard/report-artifact view.
- Users without partner-dashboard visibility should not see disabled partner tabs or upsell-style placeholders.

## GitHub Issue Roadmap
- `#266` tracks this P0 documentation/source-of-truth alignment.
- `#214` remains open for production verification/restoration of `resolve_my_technician_entitlements`.
- `#150` remains the P2 umbrella for scalable roles, entitlements, and the future custom role/entitlement builder UI unless reprioritized.
- `#128` remains open for Partner Viewer as explicit partner/reporting-only access with no inherited Plus benefits or admin powers unless superseded.
- `#123` and `#183` are closed definition/spec issues that informed the implemented Plus Account Owner and Technician flows.
- See `Docs/TECHNICIAN_ENTITLEMENTS_SPEC.md` for the detailed Technician implementation reference.

## Acceptance Criteria
- The roadmap clearly distinguishes implemented roles from schema/planning vocabulary and planned/not-live roles.
- Partner Viewer remains first-class in the matrix and issue roadmap without being described as live.
- No persona receives implicit access through partnership setup alone.
- Plus Account Owner, Technician, Training-only operator, and Partner Viewer boundaries are distinct and non-overlapping.
- Existing GitHub issues are updated instead of duplicated where possible.

## Assumptions
- Partner Viewer is planned, but implementation waits until corporate partner reviewed-PDF reporting is trusted.
- `/admin` remains internal-only.
- Partner Viewer receives reporting and partner artifacts only, not Bloomjoy Plus.
- Scoped Admin and full custom role/entitlement editing remain planned work, not current repo functionality.

# Entitlements Persona Roadmap

## Purpose
This document is the current product source of truth for Bloomjoy entitlement planning. It keeps the MVP persona names that are useful for operations, but the planning model should follow a capability shape:

`subject + action + resource + scope + source`

This roadmap is the product alignment document for the implemented capability direction. Code should continue moving toward named capabilities plus default role templates instead of one-off broad role checks.

The near-term goal is to let super-admins make fast, auditable access decisions without turning every one-off need into a new role. The long-term goal is to keep customer, Technician, partner, reporting, and internal-admin boundaries clear as the product scales.

## Product Guardrails
- Corporate partner reviewed-PDF reporting remains the P0 milestone (`#169`).
- `/admin` stays internal-only; Scoped Admin is an internal role with machine-bounded admin capabilities.
- `/admin/access` is the near-term management surface for internal grants, Technician grants, reporting access, Plus grants, and audit review.
- Customer account-owner Technician management stays under `/portal/account`; internal Technician management is also available from `/admin/access`.
- Partner Viewer surfaces should live under `/portal/reports` once enabled, not under `/admin`.
- Partnership setup must not grant portal access by itself.
- `report_manager` is reporting-only. It must not be used as a Scoped Admin workaround.
- Manual short-term fixes must be explicit, scoped, auditable, and tied to a GitHub issue.

## Capability Model
Use this model for new entitlement design, issue writing, and implementation review.

| Dimension | Current Vocabulary | Rule |
| --- | --- | --- |
| Subject | Super Admin, Scoped Admin, Plus Account Owner, Technician, Partner Viewer, Reporting User | Persona names remain useful for MVP operations, but implementation should check capabilities, not infer broad power from the label. |
| Action | `view`, `manage`, `grant`, `revoke`, `export`, `approve`, `configure` | Prefer specific action helpers such as `can_manage_machine` or `can_view_partner_report` over broad role checks. |
| Resource | account, machine, partnership, report snapshot, technician grant, admin surface | Scope access to the smallest resource that matches the workflow. |
| Scope | global, account, machine, partnership, report snapshot | Global scope should remain limited to Super Admin. |
| Source | manual admin grant, subscription, Plus grant, training grant, Technician grant, Partner Viewer grant | Source-aware entitlements make revoke/suspension safe without removing unrelated access. |

### Capability Defaults
- Super Admin is the only global subject.
- Reporting access should be explicit and machine-scoped unless a later decision approves broader account/location inheritance for a specific persona.
- Technician-derived reporting access must remain source-aware and machine-scoped.
- Partner Viewer access must be explicit partner/reporting access and must not be inherited from partnership setup or Plus membership.
- Scoped Admin should be a first-class internal capability, not a repurposed reporting entitlement.

## Current Foundations
- `super_admin` exists through `admin_roles` and remains the current internal owner/admin mechanism.
- Bloomjoy Plus access exists through paid subscriptions, free Plus grants, and super-admin-derived access.
- Training-only operator access exists through `operator_training_grants` and remains separate from paid Plus membership.
- Technician access is partially implemented through `technician_grants`, `technician_machine_assignments`, source-aware reporting entitlements, RPCs, and `/portal/account` UI. Production verification/restoration remains tracked in `#214`.
- Machine-level reporting entitlements exist with `viewer` and `report_manager` access levels.
- `customer_account_memberships` includes planning vocabulary such as `account_admin`, `billing_manager`, `report_viewer`, `report_manager`, and `partner_viewer`, but those are not all productized flows.
- Partner-dashboard access is available to super-admins and scoped admins only when the partnership is fully covered by the scoped admin's entitled machines. Partner Viewer remains a future explicit persona.

## Gaps
- Scoped Admin has moved beyond the minimal reporting-access-only path in `#259`: explicit machine-scoped internal admin grants now map to default capabilities for entitled machines, covered partnerships, covered partner dashboards, training access, and Technician grants. Broader account-scope delegation and a custom entitlement-builder UI remain future work.
- Partner Viewer is not a live customer-facing flow. Issue `#128` tracks explicit partner/reporting-only access.
- The scalable entitlement model remains an umbrella concern in `#150`.
- A full custom entitlement-builder UI is not planned for the near term.

## Persona-To-Capability Traceability
| MVP Persona | Subject / Source | Current Scope | Can Do Now | Must Not Do | Status / Issue |
| --- | --- | --- | --- | --- | --- |
| Super Admin | `admin_roles.role = 'super_admin'` | Global | View, configure, grant, revoke, approve, export, and audit all current admin/reporting surfaces | Bypass production safeguards or audit requirements | Implemented; keep as the only global role |
| Scoped Admin | Manual scoped-admin grant | Explicit entitled machines; account scope remains future | View/edit entitled machines, manage machine tax/metadata, manage partnerships fully covered by entitled machines, view covered partner dashboards, access training, and grant Technician access for entitled machines | No global orders, unrelated machines, global support/reporting/import/audit surfaces, super-admin/scoped-admin assignment, or access management outside Technician grants | Implemented capability expansion; `#259` |
| Plus Account Owner | Active Plus access plus owner account membership | Owned customer account and controlled machines | Manage Technician grants for controlled machines; access Plus portal benefits and assigned reporting | No internal admin setup, unrelated customer accounts, partner settlement, global reporting, or role management | Partially implemented; customer/team direction from `#123` |
| Technician | Technician grant plus Technician-sourced reporting entitlement | Explicit assigned machines | Access training and read-only reports for assigned machines | No Plus discounts, billing, account-owner tools, partner settlement, admin operations, machine setup, or global reporting | Partially implemented; production caveat `#214`; spec reference `#183` |
| Partner Viewer | Future Partner Viewer grant | Future partnership/report artifact scope | Future: view approved partner dashboards, snapshots, and PDFs | No Plus benefits, billing, Technician management, admin setup, imports, tax/rule edits, schedules, or warning ledgers | Planned; `#128` |
| Reporting User | Manual reporting entitlement or account membership | Machine; account/location only when explicitly allowed | View assigned machine reporting; `report_manager` may manage reporting-only workflows only when explicitly supported | No `/admin`, no partner settlement setup, no global import/schedule/config authority unless separately granted | Implemented for machine reporting; keep distinct from Scoped Admin |
| Training-only Operator | `operator_training_grants` | Training access only | Access `/portal/training*` and training progress/certificate flows | No reporting, Plus benefits, billing, support/onboarding owner tools, Technician management, partner settlement, or `/admin` | Implemented |

## Short-Term Entitlement Operations
- Use Super Admin for global setup, partner PDF review, machine mapping/imports, access grants, role assignment, global orders, and audit review.
- Use Scoped Admin for machine-bounded operations where the person should manage entitled machines, covered partnerships, training, partner dashboard data, and Technician grants without global access.
- Use explicit machine reporting grants for temporary reporting access. Prefer `viewer`; use `report_manager` only when the user needs reporting-management behavior, not internal admin behavior.
- Use Technician grants for customer staff who need training plus assigned-machine reporting.
- Use training-only grants for staff who need training but no reporting or Plus benefits.
- Do not grant Super Admin to solve a narrow operational need unless the person truly needs global owner/admin power.
- If a short-term grant is needed before the proper persona is implemented, record the issue link, reason, scope, source, and expected cleanup path.

## Recommended UX
- `/admin/access` remains the near-term person-first place for internal entitlement administration. Super admins see one consolidated console for account access, machine reporting visibility, Technician grants, admin role scope, and audit history; scoped admins see only Technician management and their own scope summary.
- `/portal/account` remains the current customer place for Technician management.
- `/portal/reports` remains the operator/reporting surface for assigned machines.
- Partner Viewer reporting should eventually appear in `/portal/reports` as a permissioned partner-dashboard/report-artifact view.
- Users without partner-dashboard visibility should not see disabled partner tabs or upsell-style placeholders.

## Issue Traceability
| Issue | Entitlement Area | Roadmap Role |
| --- | --- | --- |
| `#266` | Entitlement roadmap alignment | P0 docs alignment issue for keeping this roadmap consistent with the implemented role model. |
| `#169` | Corporate partner reviewed PDF reporting | P0 milestone that keeps partner delivery super-admin-reviewed before Partner Viewer is live. |
| `#150` | Scalable account roles and entitlement model | Umbrella for capability-model hardening and future entitlement-builder work. |
| `#259` | Admin UI access management for scoped admin roles | P0 minimal Scoped Admin implementation and `/admin/access` improvements. |
| `#128` | Partner Viewer reporting access | Explicit partner/reporting-only access with no inherited Plus or admin powers. |
| `#214` | Technician entitlement resolution in production | Production verification/restoration for Technician invite resolution. |
| `#123` | Plus operator access and invite flow | Closed definition issue that informed customer/owner team-management direction. |
| `#183` | Machine-scoped Technician reporting entitlements | Closed definition/spec issue; `Docs/TECHNICIAN_ENTITLEMENTS_SPEC.md` remains the detailed implementation reference. |

## Acceptance Criteria
- The roadmap maps MVP personas to capability dimensions and linked issues.
- Current implementation status is accurate for Super Admin, Plus, training-only, Technician, reporting, expanded Scoped Admin, and Partner Viewer.
- Short-term operational grants can be chosen quickly without confusing `report_manager`, Scoped Admin, Technician, and Partner Viewer.
- No persona receives implicit access through partnership setup alone.
- Future implementations can add scoped capabilities incrementally without introducing a broad entitlement-engine rewrite.

## Assumptions
- The roadmap should optimize near-term ops speed while avoiding permission shortcuts.
- No generic entitlement engine is planned now; use named capabilities, default role templates, and scoped helper functions as the incremental path.
- Partner Viewer implementation waits until corporate partner reviewed-PDF reporting is trusted.
- Broader account-scope delegation and a custom entitlement-builder UI remain planned work beyond the current machine-scoped implementation.

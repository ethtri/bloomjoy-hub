# Entitlements Persona Roadmap

## Purpose
This document is the current product source of truth for Bloomjoy entitlement planning. It keeps the MVP persona names that are useful for operations, but the planning model should follow a capability shape:

`subject + action + resource + scope + source`

This roadmap is the product/design source of truth for the implemented access model. Code and schema should follow the preset + capability + scope model here.

The near-term goal is to let super-admins make fast, auditable access decisions without turning every one-off need into a new role. The long-term goal is to keep customer, Technician, partner, reporting, and internal-admin boundaries clear as the product scales.

## Product Guardrails
- Corporate Partner portal access is explicit and does not come from payout/legal participant metadata alone.
- `/admin` stays internal-only until Scoped Admin is explicitly implemented.
- `/admin/access` is the near-term person-first management surface for presets, effective-access previews, internal grants, Corporate Partner access, Plus Customer access, reporting access, and audit review.
- Customer account and Technician management stays under `/portal/account` for now; a future `/portal/team` can replace it when customer team management grows.
- Corporate Partner reporting surfaces live under `/portal/reports`, not under `/admin`.
- Partnership setup must not grant portal access by itself.
- `report_manager` is reporting-only. It must not be used as a Scoped Admin workaround.
- Manual short-term fixes must be explicit, scoped, auditable, and tied to a GitHub issue.

## Capability Model
Use this model for new entitlement design, issue writing, and implementation review.

| Dimension | Current Vocabulary | Rule |
| --- | --- | --- |
| Subject | Super Admin, Scoped Admin, Plus Customer, Corporate Partner, Technician, Reporting User | Persona names remain useful for MVP operations, but implementation should check capabilities, not infer broad power from the label. |
| Action | `view`, `manage`, `grant`, `revoke`, `export`, `approve`, `configure` | Prefer specific action helpers such as `can_manage_machine` or `can_view_partner_report` over broad role checks. |
| Resource | account, machine, partnership, report snapshot, technician grant, admin surface | Scope access to the smallest resource that matches the workflow. |
| Scope | global, account, machine, partnership, report snapshot | Global scope should remain limited to Super Admin. |
| Source | manual admin grant, subscription, Plus Customer access, corporate partner membership, training grant, Technician grant | Source-aware entitlements make revoke/suspension safe without removing unrelated access. |

### Capability Defaults
- Super Admin is the only global subject.
- Reporting access should be explicit and machine-scoped unless a later decision approves broader account/location inheritance for a specific persona.
- Technician-derived reporting access must remain source-aware and machine-scoped.
- Corporate Partner access must be explicit partner/reporting access and must not be inherited from partnership setup, payout metadata, or Plus membership.
- Scoped Admin should be a first-class internal capability, not a repurposed reporting entitlement.

## Current Foundations
- `super_admin` exists through `admin_roles` and remains the current internal owner/admin mechanism.
- Bloomjoy Plus Customer access exists through paid subscriptions, admin-managed Plus Customer access, and super-admin-derived access.
- Training-only access is now represented as a Technician with no machines assigned. Existing `operator_training_grants` remain the underlying training source.
- Technician access is partially implemented through `technician_grants`, `technician_machine_assignments`, source-aware reporting entitlements, RPCs, and `/portal/account` UI. Production verification/restoration remains tracked in `#214`.
- Machine-level reporting entitlements exist with `viewer` and `report_manager` access levels.
- `customer_account_memberships` includes planning vocabulary such as `account_admin`, `billing_manager`, `report_viewer`, `report_manager`, and `partner_viewer`, but those are not all productized flows.
- Corporate Partner access is implemented through `corporate_partner_memberships`, portal-enabled `reporting_partnership_parties`, server capability helpers, and `/admin/access?tab=presets`.

## Gaps
- Scoped Admin has a minimal P0 implementation path in `#259`: explicit machine-scoped internal admin grants managed from `/admin/access`. Broader account-scope delegation and a custom entitlement-builder UI remain future work.
- Reporting User remains a future/internal capability and should not be exposed as a primary admin preset yet.
- The scalable entitlement model remains an umbrella concern in `#150`.
- A full custom entitlement-builder UI is deferred until presets and effective-access previews are stable.

## Persona-To-Capability Traceability
| MVP Persona | Subject / Source | Current Scope | Can Do Now | Must Not Do | Status / Issue |
| --- | --- | --- | --- | --- | --- |
| Super Admin | `admin_roles.role = 'super_admin'` | Global | View, configure, grant, revoke, approve, export, and audit all current admin/reporting surfaces | Bypass production safeguards or audit requirements | Implemented; keep as the only global role |
| Scoped Admin | Manual scoped-admin grant | Machine scope in the P0 implementation; account scope remains future | Manage manual reporting access inside assigned machine scope from `/admin/access` | No global admin, unrelated accounts, partnership setup, user/global role management, ungranted reports, or Technician-derived grant revocation | P0 minimal implementation; `#259` |
| Plus Customer | Active Plus access plus owner account membership | Owned customer account and controlled machines | Manage Technician grants for controlled machines; access Plus portal benefits, member supply pricing, support, and assigned reporting | No internal admin setup, unrelated customer accounts, partner settlement, global reporting, or role management | Implemented; customer/team direction from `#123` |
| Corporate Partner | `corporate_partner_memberships` plus portal-enabled partnership participation | Partner record, active portal-enabled partnerships, derived machines | Access training, support, member supply pricing, partner reporting, machine reporting, and Technician management for derived machines | No `/admin`, tax/rule editing, machine metadata editing, imports, schedules, internal warning ledgers, billing, or global reporting | P0; `#128`, `#328`, `#329`, `#330` |
| Technician | Technician grant plus optional Technician-sourced reporting entitlement | Explicit assigned machines; no-machine grant means training only | Access training and read-only reports for assigned machines; expires after one year unless renewed | No Plus/Corporate Partner supply discounts, billing, account-owner tools, partner settlement, admin operations, machine setup, or global reporting | Implemented; production caveat `#214`; spec reference `#183` |
| Reporting User | Manual reporting entitlement or account membership | Machine; account/location only when explicitly allowed | View assigned machine reporting; `report_manager` may manage reporting-only workflows only when explicitly supported | No `/admin`, no partner settlement setup, no global import/schedule/config authority unless separately granted | Implemented for machine reporting; not a primary preset |

## Short-Term Entitlement Operations
- Use Super Admin for current internal setup, partner PDF review, machine mapping, access grants, and audit review.
- Use explicit machine reporting grants for temporary reporting access. Prefer `viewer`; use `report_manager` only when the user needs reporting-management behavior, not internal admin behavior.
- Use Corporate Partner membership for Merlin/Bubble Planet-style partner users who need partner reporting, member supply pricing, support, training, and Technician management for machines in active portal-enabled partnerships.
- Use Technician grants for staff who need training plus optional assigned-machine reporting. A Technician with no machines is the training-only case.
- Do not grant Super Admin to solve a narrow operational need unless the person truly needs global owner/admin power.
- If a short-term grant is needed before the proper persona is implemented, record the issue link, reason, scope, source, and expected cleanup path.

## Recommended UX
- `/admin/access` remains the near-term person-first place for internal entitlement administration.
- `/portal/account` remains the current customer place for Technician management.
- `/portal/reports` remains the operator/reporting surface for assigned machines.
- Corporate Partner reporting appears in `/portal/reports` as a permissioned partner-dashboard view.
- Users without partner-dashboard visibility should not see disabled partner tabs or upsell-style placeholders.

## Issue Traceability
| Issue | Entitlement Area | Roadmap Role |
| --- | --- | --- |
| `#266` | Entitlement roadmap alignment | P0 docs alignment issue for keeping this roadmap consistent with the implemented role model. |
| `#128` | Corporate Partner access preset and portal permissions | P0 explicit Corporate Partner access with no inherited Plus or admin powers. |
| `#150` | Scalable account roles and entitlement model | Umbrella for capability-model hardening and future entitlement-builder work. |
| `#227` | Person-first Admin Access console | Admin UX for effective-access previews and preset grants. |
| `#328` | Corporate Partner data model and effective access context | Corporate Partner membership source, portal access flag, and capability context. |
| `#329` | Corporate Partner Technician management | Corporate Partner-sponsored Technician grants, machine scoping, and one-year expiry. |
| `#330` | Server-side support and supply entitlement enforcement | Capability-backed support and supply discount checks. |
| `#331` | Access review, renewal, and expiry reminders | P1 renewal/review automation. |
| `#259` | Admin UI access management for scoped admin roles | Minimal Scoped Admin implementation and `/admin/access` improvements. |
| `#214` | Technician entitlement resolution in production | Production verification/restoration for Technician invite resolution. |
| `#123` | Plus operator access and invite flow | Closed definition issue that informed customer/owner team-management direction. |
| `#183` | Machine-scoped Technician reporting entitlements | Closed definition/spec issue; `Docs/TECHNICIAN_ENTITLEMENTS_SPEC.md` remains the detailed implementation reference. |

## Acceptance Criteria
- The roadmap maps MVP personas to capability dimensions and linked issues.
- Current implementation status is accurate for Super Admin, Plus Customer, Corporate Partner, Technician, reporting, and Scoped Admin.
- Short-term operational grants can be chosen quickly without confusing `report_manager`, Scoped Admin, Technician, and Corporate Partner.
- No persona receives implicit access through partnership setup alone.
- Future implementations can add scoped capabilities incrementally without introducing a broad entitlement-engine rewrite.

## Assumptions
- The roadmap should optimize near-term ops speed while avoiding permission shortcuts.
- No generic entitlement engine is planned now; use capability conventions and scoped helper functions as the incremental path.
- Corporate Partner is the partner-facing preset; reviewed partner PDFs remain important but are no longer the blocker for explicit portal permissions.
- Broader Scoped Admin delegation and custom entitlement-builder UI remain planned work beyond the minimal P0 machine-scoped implementation.

# Access Management Recovery UAT

## Status
P0 issue `#368` is the source of truth for access-management recovery acceptance until the core rescue lands and passes this matrix. Recovery is in progress; this document does not claim implementation is complete.

Issue `#367` is secondary for now: treat it as a review-reminder follow-up only, not as the acceptance source for the core rescue.

Grounding docs:
- `Docs/ADMIN_ACCESS_REDESIGN_PLAN.md`
- `Docs/ENTITLEMENTS_PERSONA_ROADMAP.md`
- `Docs/TECHNICIAN_ENTITLEMENTS_SPEC.md`
- `Docs/QA_SMOKE_TEST_CHECKLIST.md`

## Acceptance Standard
Implementation is acceptable only when an end user or admin can complete the workflows below without needing to understand backend tables, RPC names, or legacy grant sources.

For every grant, renewal, scope change, and revoke flow:
- The actor sees who is being changed, what access they have now, where it applies, why it exists, when it expires, and what will happen after save.
- The save preview is plain English.
- A reason is required before save.
- Audit evidence is created for successful changes.
- Unrelated access sources are preserved when one source is revoked.

## Key URLs
Use the localhost URL printed by `npm run dev`, usually `http://localhost:8080`.

| Flow | URL |
| --- | --- |
| Login | `/login` |
| Portal home | `/portal` |
| Portal account / Technician Access | `/portal/account` |
| Portal training | `/portal/training` |
| Portal reports | `/portal/reports` |
| Admin home | `/admin` |
| Admin Access person console | `/admin/access` |
| Scoped Admin reporting-access view | `/admin/access?tab=reporting-access` |
| Global roles blocked check | `/admin/access?tab=global-roles` |
| Admin partnerships blocked check | `/admin/partnerships` |
| Admin reporting blocked check | `/admin/reporting` |

## Persona Matrix
Use seeded or temporary QA users for each persona. Record the email, source grant, scoped machines/partnerships, and cleanup status in PR notes or local UAT notes. Do not commit credentials or secrets.

| Persona | Must succeed | Must be blocked or absent | Evidence required |
| --- | --- | --- | --- |
| Super Admin | Open `/admin/access`; search by email/user ID; see one selected-person workspace with Plus Customer, Corporate Partner, Technician, Scoped Admin, Super Admin, and manual reporting source cards; grant/update/renew/revoke eligible sources, including Technician access, with preview and reason. | Technician controls cannot grant broader than training-only or one reporting machine in this recovery. Technician controls cannot grant Plus, Corporate Partner, billing, supply, admin, or global reporting privileges. Rare global actions are visually de-emphasized and require a reason. | Desktop and mobile screenshots of search, selected-person workspace, preview/reason state, and Activity/audit entry. |
| Plus Customer | Open `/portal/account`; see Technician Access with seat usage, owned machines, and active grants; add/update/revoke a Technician only for owned machines; access Plus training/support/supply benefits and assigned reporting. | Cannot open `/admin`; cannot manage unrelated customer accounts or machines; cannot access partner settlement/setup or global reporting. | Screenshots of Technician Access on desktop/mobile, owned-machine selector, cap/error state if applicable, and blocked `/admin` route. |
| Corporate Partner | Open partner-facing `/portal/reports` for active portal-enabled partnership machines; use partner-authorized Technician management for derived machines; access training/support/member supply tier where capability checks allow it. | Cannot open `/admin`; cannot see inactive or non-portal-enabled partnerships; cannot edit tax, payout rules, imports, schedules, billing, or unrelated machines. | Screenshots of partner dashboard scope, Technician management scope, and blocked admin/setup routes. |
| Technician | Open `/portal` and `/portal/training`; if assigned machines exist, open `/portal/reports` and see only assigned machines; if no machines are assigned, remain training-only. | Cannot open `/admin`; cannot see Plus discounts, billing, account-owner tools, Technician management, partner dashboard, or unassigned machines. | Screenshots of training access, assigned-machine reporting filters/results, training-only no-reporting state, and blocked admin/account-owner paths. |
| Scoped Admin | Open `/admin/access?tab=reporting-access`; see only Access in admin navigation; manage manual reporting grants only inside assigned machine scope; open `/portal/reports` for scoped machines; open training; see partner dashboard only when a partnership is fully covered by scoped machines. | Cannot open global-only admin routes, global roles, partnerships, reporting operations, unrelated machines, Plus billing/commerce benefits, or revoke Technician-derived reporting grants. | Screenshots of scoped reporting-access view, machine-scope limits, blocked global admin URLs, and audit entry for scoped-admin action. |
| Reporting User | Open `/portal/reports` for explicitly assigned reporting machines; `report_manager` remains reporting-only where supported. | Cannot open `/admin` or `/admin/access`; cannot manage Technician grants; cannot access partner setup/settlement, Plus benefits, billing, or unrelated reports. | Screenshots of assigned reporting view and blocked admin/Technician management controls. |
| Non-admin / Baseline | Open baseline authenticated portal pages such as `/portal`, `/portal/orders`, and `/portal/account` if allowed by baseline account state. | Cannot open `/admin`, `/portal/training` unless separately granted, `/portal/reports` unless reporting access exists, Plus benefits, partner dashboard, or Technician management. | Screenshots of baseline portal state and clear blocked/locked states for admin, training, reporting, and Technician controls. |

## Core UAT Scenarios

### Admin Access Recovery
- `/admin/access` defaults to finding a person, not requiring admins to choose among grant-type tabs first.
- Person search works for an existing Supabase Auth user by email even when the user has no orders.
- Selecting a person shows Who/What/Where/Why/When, effective presets, capabilities, warnings, source cards, and machine/partner scope in one workspace.
- The workspace distinguishes paid Plus subscription, admin-granted Plus Customer access, Corporate Partner membership, Technician-derived access, Scoped Admin scope, Super Admin, and manual reporting access.
- The manual reporting card edits machine-scoped reporting access with one save and does not remove other users or Technician-derived grants.
- The Technician card exposes Super Admin mutation controls in Admin Access while customer/partner self-service mutation work remains in Portal > Settings > Technician Access.

### Grant And Revoke Safety
- Granting or extending Plus Customer access requires a future expiry date and reason, and does not override an active paid Stripe subscription.
- Revoking Plus Customer access removes Plus-only portal access after refresh/re-login but preserves unrelated reporting access.
- Granting Corporate Partner access requires a partner record, previews active portal-enabled partnerships and derived machines, and requires a reason.
- Revoking Corporate Partner access removes partner capabilities and derived reporting without removing unrelated manual reporting access.
- Granting/updating Scoped Admin requires selected machine scopes, preview, and reason.
- Scoped Admin reporting-access saves affect only manual reporting grants inside assigned scope.
- Super Admin grant/revoke is available as a rare global-risk action only with preview and reason.

### Negative And Boundary Checks
- `report_manager` is never accepted as a Scoped Admin workaround.
- Partnership setup, payout recipient status, or legal participation does not grant portal access by itself.
- Technician revoke removes only Technician-derived reporting access.
- Corporate Partner access is explicit and does not come from Plus Customer membership.
- Reporting visibility remains machine-level unless a later decision explicitly expands scope.

## Screenshot Expectations
Every access-management implementation PR should include screenshots or screen recordings for the affected personas.

Required viewports:
- Desktop: 1440x900 or comparable.
- Mobile: 390x844, plus another common width when layout risk is high (`360x800` or `414x896`).

Minimum screenshot set for `#368` recovery:
- `/admin/access` default person search.
- Selected-person workspace with all relevant source cards visible or reachable without horizontal scrolling.
- One grant/update preview with required reason.
- One revoke preview with required reason.
- Scoped Admin limited admin navigation and blocked global admin route.
- Portal account Technician Access on desktop and mobile.
- Portal reports showing assigned-machine scope for Technician, Corporate Partner, Scoped Admin, or Reporting User as applicable.
- Clear blocked state for non-admin access to `/admin`.

## PR Verification Requirements
All access-management PRs should report these commands and results:
- `npm ci`
- `npm run build`
- `npm test --if-present`
- `npm run lint --if-present`

Additional requirement for DB-touching work:
- `npm run db:validate-migrations`
- `supabase db push --dry-run` when linked to the target project
- Direct REST/RPC validation for changed frontend-facing RPCs, confirming no `404` or `PGRST202`

Localhost flow checks:
- Start with `npm run dev`.
- Test the key URLs above with the relevant persona sessions.
- Refresh or re-login after revoke/expiry changes before deciding a blocked state failed.
- Capture browser console/network evidence for missing RPCs, authorization errors, and blocked routes.


# Admin Permission Boundary QA - Issue #376

## Scope
This QA pass covers Super Admin, Scoped Admin, Corporate Partner, Technician, Reporting User, and Baseline authenticated users across UI workflows and direct RPC/API boundaries.

Do not commit passwords, session JWTs, service-role keys, private sales rows, or raw customer data. Store live-test credentials and JWTs only in local `.env` or the approved secure channel.

## Persona Matrix

| Persona | UI/workflow checks | Direct RPC/API negative checks |
| --- | --- | --- |
| Super Admin | Open `/admin/access`; search a person; verify Plus Customer, Corporate Partner, Technician, Scoped Admin, Super Admin, manual reporting, and Activity cards are visible; grant/update/revoke only after a reason and preview. | Super Admin can call intended `admin_*` wrappers. Technician admin wrappers stay limited to training-only or one reporting machine. |
| Scoped Admin | Open `/admin` and confirm redirect to `/admin/access?tab=reporting-access`; admin navigation shows only Access; manual reporting matrix lists only assigned scoped machines; in-scope reporting save requires reason and shows success. | `admin_grant_super_admin_by_email`, `admin_revoke_super_admin`, `admin_grant_scoped_admin_by_email`, `admin_revoke_scoped_admin`, Corporate Partner admin RPCs, and admin Technician wrappers fail. `admin_set_user_machine_reporting_access` fails when any requested machine is outside scoped machines and touches only manual grants inside scope. |
| Corporate Partner | Open `/portal/reports` for active portal-enabled partnership machines; open training/support/supply where capabilities allow; Technician Access shows only current partner-derived machines. | Admin RPCs fail. `grant_technician_access`, `update_technician_machines`, and `revoke_technician_access` fail for out-of-scope machines or stale partner scope. `get_my_technician_grants` does not expose stale Corporate Partner grants outside current portal-enabled account/machine scope. |
| Technician | Open `/portal` and `/portal/training`; if machine-assigned, `/portal/reports` filters/results are limited to assigned machines; no Technician management controls. | Admin RPCs fail. Technician management mutation RPCs fail unless the user is also an eligible sponsor. |
| Reporting User | Open `/portal/reports` for explicit reporting machines only; no admin nav or Technician management controls. | Admin RPCs fail. Reporting RPCs return only the signed-in user's machine access. |
| Baseline | Open baseline portal routes such as `/portal`, `/portal/orders`, and `/portal/account` when allowed by account state; gated training/reporting/admin routes show clear locked or blocked states. | Admin RPCs fail. Reporting and training access RPCs return no elevated access unless another source is granted. |

## Required Routes

- `/login`
- `/portal`
- `/portal/account`
- `/portal/training`
- `/portal/reports`
- `/admin`
- `/admin/access`
- `/admin/access?tab=reporting-access`
- `/admin/access?tab=global-roles`
- `/admin/partnerships`
- `/admin/reporting`

## Repeatable Checks

Run static/source checks:

```bash
npm run auth:validate-admin-boundaries
```

Run optional live negative RPC checks from a local environment with role session JWTs:

```bash
ADMIN_BOUNDARY_RUN_LIVE=true npm run auth:validate-admin-boundaries
```

Optional live variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` or `VITE_SUPABASE_URL` | Supabase REST base URL. |
| `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY` | Browser anon key for REST RPC calls. |
| `ADMIN_BOUNDARY_SCOPED_ADMIN_JWT` | Scoped Admin session JWT. |
| `ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT` | Corporate Partner session JWT. |
| `ADMIN_BOUNDARY_TECHNICIAN_JWT` | Technician session JWT. |
| `ADMIN_BOUNDARY_REPORTING_USER_JWT` | Reporting User session JWT. |
| `ADMIN_BOUNDARY_BASELINE_JWT` | Baseline authenticated session JWT. |
| `ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_EMAIL` | Existing Super Admin email for blocked grant attempts. |
| `ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID` | Existing Super Admin user ID for blocked revoke attempts. |
| `ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL` | Existing user email for reporting grant negative checks. |
| `ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL` | Target Technician email for negative checks. |
| `ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID` | Machine outside the Scoped Admin or Corporate Partner test persona scope. |
| `ADMIN_BOUNDARY_CORPORATE_PARTNER_ACCOUNT_ID` | Optional account context for Corporate Partner Technician negative checks. |
| `ADMIN_BOUNDARY_CORPORATE_PARTNER_ID` | Optional partner context for Corporate Partner Technician negative checks. |

## Evidence To Capture

- Desktop and mobile screenshots for blocked `/admin` states, Scoped Admin limited Access view, Super Admin person workspace, Portal Technician Access, and Portal Reports scope.
- Network evidence for expected failed direct RPCs, recording only status/error class and not session tokens.
- Audit log evidence for successful Super Admin or Scoped Admin in-scope changes.
- Refresh or re-login after revoke checks before deciding a route still leaks access.

## Current Branch Notes

- Source review found a narrow direct-RPC gap: Corporate Partner Technician grant listing/management could key off active partner membership alone after partner machine scope changed.
- Migration `202605020002_corporate_partner_technician_scope_repair.sql` repairs that by requiring current portal-enabled account/machine scope for Corporate Partner Technician grant visibility and mutation authority.
- Live browser/RPC execution still requires local Supabase env vars and separate persona sessions.

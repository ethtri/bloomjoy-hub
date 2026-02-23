# Super-Admin Discovery and Technical Plan (`#37`)

Last updated: 2026-02-23

## Goal
Define and de-risk MVP super-admin capabilities for Bloomjoy operations, then split implementation into PR-sized issues.

## Scope for this plan
- Requirements draft (what admin can do in MVP)
- Role model draft (how admin access is granted/revoked)
- Technical design draft (schema, authz, RLS, routes)
- Follow-up implementation slices

## Current state (repo constraints)
- Customer portal auth is currently mock/local (`src/contexts/AuthContext.tsx`).
- Stripe webhooks already sync `public.orders` and `public.subscriptions` (`supabase/functions/stripe-webhook/index.ts`).
- Current RLS supports customer self-service access only (`orders_select_own`, `subscriptions_select_own`).
- Support requests are still mock form submissions and are not persisted.

Implication:
- Super-admin cannot be secure with client-side checks alone.
- MVP admin must be built around Supabase Auth identity + RLS + server-side admin checks.

## MVP super-admin requirements (draft)
1) Orders operations
- View/search all orders
- Filter by status, customer email, date range
- Update internal fulfillment fields/status (non-payment state only)

2) Support operations
- View/search all support requests (concierge + parts)
- Triage and update workflow status
- Add internal notes and assignment

3) Account/machine operations
- View customer account summary (membership + recent orders + support tickets)
- Track machine count per account for operational context and pricing alignment
- Manually correct machine count with reason logging

4) Admin governance
- Assign/revoke super-admin role for Bloomjoy staff
- Maintain audit trail for admin role changes and sensitive updates

## Role model (approved)
- Role table: `public.admin_roles`
  - `user_id` (auth user), `role` (`super_admin` only in MVP), `active`, `granted_by`, `granted_at`, `revoked_by`, `revoked_at`
- Assignment path (MVP):
  - Initial bootstrap by direct SQL/service-role operation
  - Then in-app super-admin management UI
- Revocation:
  - Soft-revoke via `active = false` and metadata fields
- Audit:
  - All role grants/revokes and admin mutations recorded in `public.admin_audit_log`

## Security boundaries (draft)
- Super-admin can view:
  - All orders, support requests, machine counts, membership status metadata
- Super-admin cannot:
  - Access Stripe secrets, raw payment methods, or perform direct Stripe billing mutations from DB
  - Read/write unrelated auth provider internals beyond what is required for identity mapping
- Customer users can still only access their own records through existing RLS patterns.
- Sensitive writes should run through server-side functions/RPC with explicit admin checks and audit logging.

## Data model additions (draft)
- `public.admin_roles`
- `public.admin_audit_log`
- `public.support_requests`
  - `request_type`, `status`, `priority`, `customer_user_id`, `customer_email`, `subject`, `message`, `assigned_to`, `internal_notes`, timestamps
- `public.customer_machine_inventory`
  - per customer/account machine counts by type
  - includes `source` and `updated_reason`
- Optional helper view:
  - `public.admin_account_summary_v` (aggregates membership/orders/open support/machine count)

## Authorization model (draft)
1) Utility function
- `public.is_super_admin(uid uuid) returns boolean`

2) RLS policy pattern
- Customer policies unchanged (`auth.uid() = user_id` pattern)
- Add super-admin override for admin-managed tables:
  - `using (public.is_super_admin(auth.uid()))`
  - `with check (public.is_super_admin(auth.uid()))`

3) Server-side enforcement
- Add admin RPC/functions for high-risk mutations (role management, machine count corrections, support status transitions)
- Each mutation writes to `admin_audit_log`

## Admin IA and route map (draft)
- `/admin` dashboard
  - KPIs: open support tickets, unfulfilled orders, active memberships, accounts with machine-count mismatches
- `/admin/orders`
  - table + filters + detail drawer
- `/admin/support`
  - queue + status updates + assignee + notes
- `/admin/accounts`
  - account search + membership + machine inventory + recent activity
- `/admin/audit`
  - immutable audit log list/filter
- Route guard:
  - `AdminRoute` requires authenticated user + admin role from Supabase

## Implementation slices (PR-sized)
1) `P2` Foundation: auth + role plumbing
- Replace mock auth context with Supabase session + user
- Add `admin_roles`, `is_super_admin`, `admin_audit_log` migration + baseline RLS
- Add `AdminRoute` and empty `/admin` shell

2) `P2` Support workflow backend + UI
- Add `support_requests` table + RLS + submit pipeline from portal forms
- Add `/admin/support` queue UI with status transitions and notes
- Add smoke tests for support submission and admin triage

3) `P2` Orders operations view
- Wire `/portal/orders` to real `orders` table
- Add `/admin/orders` with search/filter and internal fulfillment status updates
- Keep payment status Stripe-driven; internal status tracked separately

4) `P2` Account machine counts
- Add `customer_machine_inventory` table + audit logging
- Add `/admin/accounts` summary and machine-count edit flow

5) `P3` Admin governance polish
- Admin role management UI (grant/revoke)
- `/admin/audit` log view
- Harden analytics events for admin actions

## Verification plan
- `npm ci`
- `npm run build`
- `npm test --if-present`
- `npm run lint --if-present`
- Manual smoke:
  - Non-admin user cannot access `/admin/*`
  - Super-admin can access all admin routes
  - Customer portal RLS unchanged (only own data)
  - Support request submitted from portal appears in admin queue
  - Machine count edits require admin role and write audit entries

## Resolved decisions (2026-02-23)
1) Roles in MVP
- Use `super_admin` only for MVP.
- Revisit scoped roles (such as `ops_agent`) after core workflows stabilize.

2) Support statuses in MVP
- Use minimal workflow states: `new`, `triaged`, `waiting_on_customer`, `resolved` (optional terminal `closed` if needed by reporting).

3) Machine count source of truth
- App-managed machine count in admin portal is the source of truth for operations.
- Stripe quantity remains billing context; mismatches should be visible to admins.

4) Ticket notifications
- Defer email notifications for new support tickets in MVP.
- Operations team will use the admin queue dashboard for monitoring in MVP.

## Acceptance mapping to issue `#37`
- Requirements documented: this doc (pending approval)
- Technical design proposed: schema/authz/routes above
- Follow-up slices defined: implementation slices section (convert to linked GitHub issues)

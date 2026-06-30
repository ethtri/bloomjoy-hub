# Operator Payouts Production Monitoring

Purpose: give the first-cycle support owner a lightweight monitoring checklist for Operator Payouts after rollout.

This document covers what to inspect, where to record evidence, how to identify common failures, and what support should do without exposing employee PII, private pay data, raw payroll exports, tax identifiers, bank data, or invite links.

## 1. Scope

Monitor these surfaces during the first payroll cycle:
- operator timekeeping: `/portal/time`, `/portal/time/new`, `/portal/time/:entryId/edit`;
- admin payout review: `/admin/payouts`;
- operator invite/provisioning flow from PR `#560`, once merged;
- payout register export from PR `#559`, once merged;
- Supabase RPC readiness for payout functions;
- Supabase Edge Function health for `access-invite` and `operator-payout-provision`, once deployed;
- access-boundary failures for operator, scoped payout manager, and super-admin personas.

This monitoring plan does not approve live payroll execution. Issue `#507` remains the owner/accounting gate for payroll scope, worker classification, payment execution, and compliance ownership.

## 2. Evidence Rules

Record rollout evidence in GitHub issues, not in static docs:
- `#506`: first-cycle pilot/cutover evidence, exceptions, and post-pilot monitoring review.
- `#513`: monitoring checklist changes and follow-up defects found while rehearsing the monitoring plan.
- `#504`: live migration/RPC readiness evidence.
- `#505`: provisioning/invite evidence from PR `#560`.
- `#509`: payout register export evidence from PR `#559`.
- `#507`: owner/accounting go-no-go and payroll boundary.

Allowed evidence in GitHub:
- route names;
- RPC/function names;
- status counts;
- redacted error classes;
- screenshots with synthetic data or private details blurred;
- issue/PR links;
- owner signoff statements.

Do not post:
- employee names, personal emails, SSNs, bank data, tax identifiers, private pay statement contents, raw payout registers, raw payroll exports, invite links, direct login links, or raw provider payloads.

## 3. First-Cycle Monitoring Cadence

| Time | Owner | Check |
|---|---|---|
| T-2 business days | Technical owner | Confirm production RPC readiness for all payout RPCs and no `404`/`PGRST202` responses. |
| T-2 business days | Support owner | Confirm support has access to this document and the pilot roster in a private owner-approved place. |
| First operator invite day | Support owner | Check `access-invite` and `operator-payout-provision` failures, invite evidence, and activation exceptions. |
| Daily during open period | Support owner | Check failed time saves, missing operator profiles, and missing assigned machines. |
| Time due date | Payout admin owner | Check submitted time coverage and obvious missing shifts before lock/review. |
| Lock/review day | Payout admin owner | Check payout calculation, warnings, adjustments, and access-denied errors on `/admin/payouts`. |
| Statement issue day | Payout admin owner | Check `operator_pay_statements.issued`, failed statement previews/issues, and operator download failures. |
| External payment handoff | Payroll/compliance owner | Confirm external payroll/payment execution source and keep private payout artifacts out of GitHub. |
| T+2 business days | Support owner | Post the redacted post-pilot monitoring review comment to `#506`. |

## 4. Route And RPC Checklist

| Surface | Exact route/RPC/function | Failure indicators | First response |
|---|---|---|---|
| Operator time hub | `/portal/time` | Empty state says "No operator payout profile yet"; network error on `get_my_operator_timekeeping_context`; operator sees another person's data | Confirm profile/assignment privately; stop rollout immediately if cross-user data appears. |
| Add/edit time | `/portal/time/new`, `/portal/time/:entryId/edit` | `Unable to submit time entry`, `Unable to update time entry`, `Locked time entries cannot be deleted`, `Assigned machine not found`, non-2xx on `submit_operator_time_entry`, `update_operator_time_entry`, or `void_operator_time_entry` | Validate assigned machine, current period status, and entered times; record correction path if period is locked. |
| Pay statements | `/portal/time` pay statements panel | `Unable to load pay statements`, `Unable to load pay statement`, no latest issued statement after issue, non-2xx on `get_my_operator_pay_statement_context` or `get_pay_statement_artifact` | Confirm statement status is issued/revised and belongs to the operator; reissue only with revision reason. |
| Admin payout review | `/admin/payouts` | Admin access-required state for expected admin, `Unable to load payouts`, non-2xx on `get_payout_review_context` | Confirm admin/scoped payout-manager grant; do not broaden access without reason. |
| Calculation/review | `admin_calculate_payout_run`, `admin_add_payout_adjustment`, `admin_mark_payout_run_reviewed`, `admin_finalize_payout_run`, `admin_reopen_payout_run`, `admin_void_payout_run` | Critical warnings, missing audit reason, access errors, unexpected total changes | Resolve source data first; override only with explicit manager reason and owner acceptance. |
| Statement issue | `admin_preview_pay_statements`, `admin_issue_pay_statements` | `Unable to preview pay statements`, `Unable to issue pay statements`, missing revision reason, duplicate statement concerns | Confirm run finalized, audit reason present, revision reason present when reissuing. |
| Invite delivery | `access-invite`, `access_invite_deliveries` with `invite_type='operator_payout'` after PR `#560` | `delivery_status='failed'`, `error_message` present, provider rejection, no evidence row after send | Check email spelling, provider health, and private activation path; use resend/copy link only through approved private channel. |
| Provisioning | `operator-payout-provision`, `admin_provision_operator_payout_for_user`, `admin_deactivate_operator_payout_profile_for_user` after PR `#560` | Edge Function error, service-role config error, out-of-scope machine error, missing audit record | Confirm function secrets/deploy, scoped machine authority, and audit reason; stop if service-role calls are reachable from the browser. |
| Register export | `admin_get_payout_register_export` after PR `#559` | Export unavailable for finalized/issued run, out-of-scope rows, CSV includes prohibited fields | Use owner-approved manual fallback; stop if export includes SSN, bank, direct-deposit, tax filing, or raw provider fields. |

## 5. Supabase API Log Checks

Use Supabase API/PostgREST logs to spot RPC readiness and production errors. Filter by route/path or request body where the dashboard supports it.

Check for `404`, `PGRST202`, `401`, `403`, and repeated `400` responses on:
- `/rest/v1/rpc/get_my_operator_timekeeping_context`
- `/rest/v1/rpc/submit_operator_time_entry`
- `/rest/v1/rpc/update_operator_time_entry`
- `/rest/v1/rpc/void_operator_time_entry`
- `/rest/v1/rpc/get_payout_review_context`
- `/rest/v1/rpc/admin_calculate_payout_run`
- `/rest/v1/rpc/admin_add_payout_adjustment`
- `/rest/v1/rpc/admin_mark_payout_run_reviewed`
- `/rest/v1/rpc/admin_finalize_payout_run`
- `/rest/v1/rpc/admin_preview_pay_statements`
- `/rest/v1/rpc/admin_issue_pay_statements`
- `/rest/v1/rpc/get_my_operator_pay_statement_context`
- `/rest/v1/rpc/get_pay_statement_artifact`
- `/rest/v1/rpc/admin_get_payout_register_export` after PR `#559`
- `/rest/v1/rpc/get_operator_payout_setup_context` after PR `#560`
- `/rest/v1/rpc/admin_provision_operator_payout_for_user` after PR `#560`
- `/rest/v1/rpc/admin_deactivate_operator_payout_profile_for_user` after PR `#560`

Response guidance:
- `404` or `PGRST202`: treat as production RPC deployment/schema-cache issue; route to `#504` and reload PostgREST schema after repair.
- `401`: confirm the user is signed in on `app.bloomjoyusa.com` or the approved preview host.
- `403` or access-required copy: verify role/scope; do not grant broader access until the scope issue is understood.
- Repeated `400`: review the UI support message, input validation, and required audit/revision reason.

## 6. SQL Audit Queries

Run these only from an approved admin SQL context. Keep output private and post only counts or redacted summaries to GitHub.

Recent payout audit events:

```sql
select
  created_at,
  action,
  entity_type,
  entity_id,
  target_user_id
from public.admin_audit_log
where created_at >= now() - interval '7 days'
  and action in (
    'operator_payout_profile.created',
    'operator_payout_profile.updated',
    'operator_payout_revenue_snapshot.created',
    'operator_payout_revenue_snapshot.regenerated',
    'operator_payout_revenue_snapshot.manual_override',
    'operator_payout_run.calculated',
    'operator_payout_run.marked_reviewed',
    'operator_payout_run.finalized',
    'operator_payout_run.reopened',
    'operator_payout_run.voided',
    'operator_pay_statements.issued',
    'operator_time_entry.voided'
  )
order by created_at desc;
```

Failed operator payout invites after PR `#560`:

```sql
select
  sent_at,
  invite_type,
  source_type,
  source_id,
  delivery_status,
  left(coalesce(error_message, ''), 160) as error_summary
from public.access_invite_deliveries
where sent_at >= now() - interval '7 days'
  and invite_type = 'operator_payout'
  and source_type = 'operator_payout_profile'
  and delivery_status = 'failed'
order by sent_at desc;
```

Statement issuance count by day:

```sql
select
  date_trunc('day', created_at) as day,
  count(*) as issued_events
from public.admin_audit_log
where created_at >= now() - interval '14 days'
  and action = 'operator_pay_statements.issued'
group by 1
order by 1 desc;
```

Potential access-boundary events:

```sql
select
  created_at,
  action,
  entity_type,
  entity_id
from public.admin_audit_log
where created_at >= now() - interval '7 days'
  and (
    action like 'operator_payout_%'
    or action like 'operator_pay_%'
    or action like 'operator_time_%'
  )
order by created_at desc;
```

The access-boundary query is not proof that authorization passed or failed by itself. Use it with Supabase API logs and persona testing.

## 7. Edge Function Checks

Monitor these Supabase Edge Function logs after PR `#560` is deployed:
- `access-invite`
- `operator-payout-provision`

Filter for:
- `access-invite error`
- `access-invite evidence write failed`
- `access-invite sent evidence unavailable`
- `access-invite authorization check failed`
- `operator-payout-provision` errors or non-2xx responses
- missing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or email provider configuration

Response guidance:
- If the invite email sent but evidence write failed, verify provider delivery privately and avoid repeated sends until evidence is repaired.
- If provisioning fails before Auth user/profile creation, confirm service-role function configuration and retry only after the technical owner clears the error.
- If provisioning writes profile data but invite delivery fails, use the documented resend/copy-link recovery path.

## 8. Support Triage

| Failure | How support identifies it | Operator/admin-facing response | Escalation |
|---|---|---|---|
| Failed invite | Operator did not receive email; `access_invite_deliveries.delivery_status='failed'`; Edge Function error | "We found an invite delivery issue and are resending through the approved channel." | Technical owner if provider or evidence write fails twice. |
| Failed time save | Operator sees unable-to-save copy; API log shows non-2xx on time-entry RPC | "Check the assigned machine, work date, and start/end time. If the period is locked, we will record the correction through manager review." | Payout admin if locked period; technical owner for `404`/`PGRST202` or unexpected access error. |
| Failed statement issue | Admin sees unable-to-preview/issue copy; audit event is missing | "Confirm the payout run is finalized and the audit/revision reason is present before retrying." | Technical owner if `admin_issue_pay_statements` returns non-validation error. |
| Failed statement download | Operator sees unable-to-load/download copy; API log shows non-2xx on statement RPC | "We are checking that the latest issued statement belongs to your operator profile." | Payout admin for reissue/revision; technical owner for storage/RPC errors. |
| Out-of-scope access attempt | User sees access-required state; API log shows `403`; persona test reveals extra data | "Access is blocked or being reviewed because it does not match the approved machine/account scope." | Stop rollout for that persona if extra data appears; open P0 auth/RLS issue. |

## 9. Telemetry Decision

Do not add browser analytics events for employee payout actions in this monitoring slice. The existing analytics stub is client-side and better suited to public/product engagement. For payroll-adjacent workflows, use server-side audit trails and operational logs first.

Approved monitoring events for this slice are existing server-side records:
- `admin_audit_log.action`
- `access_invite_deliveries.delivery_status`
- Supabase API status/error class by RPC path
- Supabase Edge Function status/error class by function name

If future app telemetry is added, it must be aggregate-only and must not include employee email, name, pay amount, machine identifier, statement number, tax status, bank data, invite link, or raw error payload.

## 10. Post-Pilot Review Template For `#506`

Post a redacted comment to issue `#506` after the first payroll cycle:

```md
Operator Payouts first-cycle monitoring review

Period:
Pilot cohort size:
External payroll/payment handoff source:
Owner/accounting boundary confirmed in #507: yes/no

Monitoring summary:
- RPC readiness: pass/fail, notes
- Invite delivery: pass/fail, failed count, recovery used
- Timekeeping saves: pass/fail, failed count, common cause
- Payout review/finalization: pass/fail, blocker warnings resolved or accepted
- Statement issue/download: pass/fail, failed count, recovery used
- Register export or manual fallback: pass/fail, notes
- Access-boundary checks: pass/fail, affected persona if any

Exceptions:
- <redacted issue summary and follow-up link>

Decision:
- Continue rollout / extend pilot / pause and repair
```

The comment must not include employee PII, private pay data, raw payout registers, statement contents, tax identifiers, bank data, raw provider payloads, or invite links.

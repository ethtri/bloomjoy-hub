# Operator Payouts Go-Live Runbook

Purpose: give Bloomjoy a first-cycle operating procedure for Operator Payouts before any employee- or contractor-facing rollout.

This runbook covers timekeeping, payout review, pay statement issuance, payout register handoff, support, correction, revocation, incident response, and rollback. It does not approve live rollout by itself. Owner/accounting signoff in issue `#507` remains the go-live gate for payroll scope, worker classification, payment execution, and compliance ownership.

## 1. V1 Boundary

Bloomjoy Hub V1 is a payout operations system, not a payroll provider.

Bloomjoy Hub does:
- collect assigned-machine operator time at `/portal/time` and `/portal/time/new`;
- calculate rounded paid time, eligible revenue basis, commission, manual adjustments, and payout run totals;
- support manager review, finalization, and pay statement issuance at `/admin/payouts`;
- publish versioned pay statements for operators to download from `/portal/time`;
- after issue `#509`/PR `#559` is merged, export a payout register for external payroll or payment execution;
- preserve audit records, review snapshots, issued statement versions, and scoped access boundaries.

Bloomjoy Hub V1 does not:
- calculate payroll tax withholding;
- execute direct deposit;
- file W-2s, 1099s, payroll tax returns, or other regulated forms;
- store SSNs, bank account details, raw payroll-provider payloads, or private payroll exports;
- replace owner/accounting review for worker classification, pay cadence, payment method, payroll compliance, or dispute handling.

If direct deposit, payroll taxes, W-2 filing, 1099 filing, or provider-backed payroll execution are required for go-live, stop this V1 runbook and resolve issue `#450` before rollout.

## 2. Go-Live Gates

Do not start a live first payroll cycle until each gate is complete or explicitly accepted as a manual fallback by the owner.

| Gate | Required evidence |
|---|---|
| Payroll scope | Issue `#507` has an owner/accounting go/no-go comment naming the V1 external payroll/payment process. |
| Production RPC readiness | Issue `#504` confirms payout migrations/RPCs are deployed and live PostgREST does not return `404` or `PGRST202` for payout RPCs. |
| Operator provisioning | Issue `#505` / PR `#560` is merged, or the owner accepts a controlled manual setup fallback for the first cycle. |
| Payout register export | Issue `#509` / PR `#559` is merged, or the owner accepts manual payout-register reconciliation from pay statements for the first cycle. |
| Pilot/cutover | Issue `#506` records first-cycle pilot scope, owner signoff, and fallback process. |
| Support monitoring | Issue `#513` records first-cycle monitoring owner, checks, and post-pilot review comment. |
| Smoke coverage | `Docs/QA_SMOKE_TEST_CHECKLIST.md` Operator Payouts go-live checks are run with synthetic or approved test data before live use. |

## 3. Owners

- Release owner: final go/no-go, launch window, pilot cohort, fallback decision, issue comments.
- Payroll/compliance owner: worker classification, payment method, tax/filing boundary, external payroll execution, correction policy.
- Payout admin owner: operator setup, machine assignments, compensation rules, payout review, statement issuance.
- Support owner: invite failures, operator time-entry questions, statement-download problems, access-boundary incidents.
- Technical owner: migrations, Edge Functions, RPC health, auth/email provider checks, rollback support.

One person may hold more than one role during the pilot, but the owner/accounting approval in `#507` must be explicit.

## 4. First-Cycle Calendar

Bloomjoy defaults from the Operator Payouts decision are:
- monthly calendar periods;
- time due 2 days after period end;
- lock on day 3 after period end;
- target payout day 5 after period end;
- shift-level `round_up_60_minutes`;
- final manager review only.

Example for a calendar month ending April 30:

| Date | Action |
|---|---|
| April 1-30 | Operators enter shifts at `/portal/time/new` as work occurs. |
| May 1 | Payout admin/support owner checks missing operator profiles, missing assignments, and obvious missing time. |
| May 2 | Time due. Operators confirm submitted shifts on `/portal/time`. |
| May 3 | Period locks. Payout admin starts final review from `/admin/payouts`. |
| May 3-4 | Payout admin resolves missing time, revenue snapshot warnings, compensation-rule gaps, and manual adjustments. |
| May 4 | Payout admin finalizes the payout run and previews pay statements. |
| May 4-5 | Payout admin issues pay statements and exports the payout register, if available. |
| May 5 | Payroll/compliance owner executes external payroll/payment outside Bloomjoy Hub and records go-live evidence. |
| May 6-7 | Support owner reviews invite/time/statement/download/access issues and posts first-cycle findings to `#506` or `#513`. |

If a deadline lands on a weekend or holiday, the payroll/compliance owner must record the adjusted due/lock/target payout dates before the cycle starts.

## 5. Routes, RPCs, And Functions To Know

Operator routes:
- `/portal/time`: operator time hub, current period, submitted shifts, issued pay statements.
- `/portal/time/new`: focused add-time flow.
- `/portal/time/:entryId/edit`: edit unlocked draft/submitted shifts.

Admin route:
- `/admin/payouts`: payout review, calculation, manual adjustments, finalization, pay statement preview/issue, and, after PR `#559`, payout register export.

Core operator RPCs:
- `get_my_operator_timekeeping_context(date)`
- `submit_operator_time_entry(uuid, uuid, date, time, time, text, text)`
- `update_operator_time_entry(uuid, uuid, date, time, time, text, text)`
- `void_operator_time_entry(uuid, text)`
- `get_my_operator_pay_statement_context()`
- `get_pay_statement_artifact(uuid)`

Core admin payout RPCs:
- `get_payout_review_context()`
- `admin_calculate_payout_run(uuid, boolean, text)`
- `admin_add_payout_adjustment(uuid, uuid, integer, text, text, boolean, text)`
- `admin_mark_payout_run_reviewed(uuid, text)`
- `admin_finalize_payout_run(uuid, text, boolean, text)`
- `admin_preview_pay_statements(uuid)`
- `admin_issue_pay_statements(uuid, text, text)`
- `admin_reopen_payout_run(uuid, text)`
- `admin_void_payout_run(uuid, text)`

Provisioning and export gates:
- PR `#560` adds operator employee provisioning, invite recovery, copy-link, resend, and deactivation workflow.
- PR `#559` adds `admin_get_payout_register_export(uuid)` and an `Export Register` action.

## 6. Pre-Go-Live Setup

1. Confirm payroll boundary:
   - record the `#507` owner/accounting go-no-go;
   - name the external payroll/payment process;
   - confirm worker-type labels and approved pay statement language;
   - confirm that V1 is not direct deposit, withholding, W-2, or 1099 filing automation.

2. Confirm production readiness:
   - migrations are deployed;
   - Edge Functions needed for invites are deployed, if PR `#560` is part of rollout;
   - `access-invite` email provider settings are valid;
   - payout RPCs are visible through PostgREST;
   - `npm run db:validate-rpc-surface` passes on the release branch.

3. Prepare operator cohort:
   - use only approved employee/contractor emails;
   - create or confirm each operator payout profile;
   - assign only active, manageable reporting machines;
   - record an audit reason for each setup action;
   - confirm each operator can sign in and reach `/portal/time`;
   - confirm no operator sees another operator's time or statements.

4. Prepare compensation:
   - verify hourly rate and/or commission rules for each operator/machine/date window;
   - verify revenue snapshot coverage for each assigned machine;
   - confirm manual adjustments policy before the cycle starts;
   - keep worker type as descriptive only.

5. Prepare fallback:
   - keep the current manual payroll process available through the pilot;
   - identify who can pause Hub-driven finalization;
   - define how payroll will be executed if payout register export is unavailable.

## 7. Operator Instructions

Give operators these instructions before the period starts.

1. Sign in to the Bloomjoy operator app using the approved email address.
2. Open `/portal/time`.
3. Confirm the Current Period dates, due date, lock date, and target payout date.
4. Use `Add Time` or open `/portal/time/new`.
5. Enter one shift at a time:
   - work date;
   - assigned machine;
   - start time;
   - end time;
   - optional notes only when they help the manager understand the shift.
6. Review the "Actual time" and "You'll be paid for" values before saving.
7. Correct mistakes before the lock date using edit/delete controls on unlocked draft/submitted entries.
8. After statements are issued, return to `/portal/time` and download the latest issued pay statement.

Operator support copy:
- If no machines are available, ask support to confirm your operator payout profile and assigned machines.
- If the period is locked, ask support to record a correction instead of trying to edit the old shift.
- Do not send SSNs, bank details, tax forms, or private payroll information through the portal support path.

## 8. Admin Review And Issuance

Run these steps after the submission deadline and before external payroll/payment.

1. Open `/admin/payouts`.
2. Select the target payout period.
3. Confirm the period card shows the expected account, period dates, status, operator count, warnings, and total payout.
4. Generate or recalculate the payout run:
   - existing runs require an audit reason;
   - investigate missing revenue snapshots, missing compensation rules, duplicate time, or other warnings before finalization.
5. Review operator totals:
   - raw time;
   - rounded paid time;
   - machine-level revenue basis;
   - commission basis;
   - hourly pay;
   - adjustments;
   - total payout.
6. Add manual adjustments only with:
   - operator;
   - non-zero amount;
   - adjustment type;
   - operator-visible description when it belongs on the statement;
   - manager audit reason.
7. Mark reviewed with an audit reason.
8. Finalize the payout run:
   - blocker warnings require an explicit override reason;
   - finalization must remain blocked when issued/revised statements already exist for the run.
9. Preview pay statements.
10. Issue pay statements with an audit reason.
11. If statements already exist, reissue only with a revision reason.
12. Confirm operators see only their latest issued statement on `/portal/time`.
13. If PR `#559` is merged, export the payout register from `/admin/payouts`.
14. Hand the issued statements and payout register to the payroll/compliance owner for external payment execution.

## 9. External Payroll Or Payment Handoff

This step happens outside Bloomjoy Hub.

Before external execution:
- confirm payout run status is finalized, issued, or closed;
- confirm pay statements were issued;
- confirm payout register export is available, or record the manual fallback source;
- compare operator totals against the run totals in `/admin/payouts`;
- confirm no blockers or unresolved disputes remain;
- confirm the payroll/compliance owner accepts the worker classification and payment method.

Record in `#506`:
- period covered;
- operator count;
- total payout amount;
- whether the payout register was used;
- who executed external payroll/payment;
- confirmation that Bloomjoy Hub did not execute direct deposit, withholding, W-2 filing, or 1099 filing;
- exceptions and follow-ups, without employee PII or private pay data.

Never paste the payout register, private statement contents, bank data, tax identifiers, or raw payroll-provider output into GitHub, docs, screenshots, chat, or logs.

## 10. Corrections And Reissues

Before pay statements are issued:
- correct missing or wrong time while entries are still editable, or record a manager adjustment;
- recalculate the payout run with an audit reason;
- reopen or void only unissued runs when the workflow allows it;
- finalize again after review.

After pay statements are issued:
- do not silently overwrite the old statement;
- use a revision reason for any reissue;
- preserve previous statement versions as revised;
- record operator-visible correction language when the change affects the operator statement;
- execute any external payment correction outside Bloomjoy Hub and record only redacted evidence.

If the mistake affects worker classification, tax treatment, direct deposit, or legal payroll obligations, stop and escalate to the payroll/compliance owner. Do not use a Hub adjustment as a substitute for legal/accounting correction.

## 11. Revoking Or Deactivating Operator Access

After PR `#560` is merged:

1. Open `/admin/payouts`.
2. Use Operator Setup / Operator Access.
3. Choose the operator.
4. Deactivate with an audit reason.
5. Confirm active machine assignments are revoked.
6. Confirm future `/portal/time` entry is blocked for that operator.
7. Confirm historical payout records and issued statements remain preserved.

Manual fallback before PR `#560`:
- only a technical owner or approved admin should run the audited operator profile/assignment revocation path;
- record the reason and impacted operator profile ID privately;
- do not hard-delete historical payout rows;
- post a redacted issue comment that access was revoked and historical records were preserved.

## 12. Invite And Email Recovery

After PR `#560` is merged, operator payout invites use `operator_payout` invite evidence.

For a failed invite:
1. Confirm the operator email is correct.
2. Check the Operator Access invite status.
3. Check `access_invite_deliveries` for `invite_type=operator_payout`.
4. Check Resend/provider logs using redacted evidence only.
5. Use Resend invite.
6. If email delivery still fails, use Copy Link only through a private owner-approved channel.
7. Confirm the operator activates with the intended email and reaches `/portal/time`.

Never paste invite links into public GitHub comments, PR descriptions, docs, screenshots, or chat.

## 13. Support And Incident Response

| Symptom | First check | Recovery |
|---|---|---|
| Operator cannot sign in | Auth user exists, invite status, email spelling, preview/production redirect host | Resend invite or issue private copy link after owner-approved identity check. |
| Operator sees "No operator payout profile yet" | Active operator profile and machine assignments | Create or repair profile/assignments with audit reason; ask operator to refresh. |
| Operator cannot choose a machine | Active machine assignment, effective dates, machine/account scope | Repair assignment or explain that the machine is out of scope. |
| Time save fails | Period status, assigned machine, start/end time, RPC error | Fix input, wait for RPC readiness if `404`/`PGRST202`, or record correction manually after lock. |
| Duplicate/overlap warning appears | Existing submitted shifts in current period | Have operator confirm whether the new entry is truly separate before save. |
| Period is locked | Current period lock date/status | Use manager correction/adjustment; do not unlock casually after payroll review starts. |
| Admin cannot open `/admin/payouts` | Admin surface access and scoped payout-manager grant | Repair access through approved admin flow; do not broaden to super admin without reason. |
| Run has blocker warnings | Missing revenue snapshots, compensation rules, assigned time, or critical warning details | Resolve source data first; override only with manager reason and owner acceptance. |
| Statement download fails | Statement status, profile owner, `get_pay_statement_artifact(uuid)` response | Confirm statement is issued/latest for that operator; reissue only with revision reason when needed. |
| Payout register export unavailable | PR `#559` merge/deploy status, run status finalized/issued/closed, `admin_get_payout_register_export(uuid)` response | Use manual statement/register fallback only if owner accepted it for the first cycle. |
| Out-of-scope data appears | Operator/admin persona, scoped machine/account grants, direct RPC response | Stop rollout for that persona, capture redacted evidence, and open a P0 auth/RLS issue. |

Incident rules:
- pause external payroll/payment when totals, access, or statement visibility are in doubt;
- preserve current data before repair;
- never fix a production payroll issue with destructive deletes;
- use follow-up migrations for schema/RLS repairs after deployment;
- record only redacted evidence in GitHub.

## 14. Rollback And Fallback

Trigger rollback/fallback if:
- operators can see another operator's time or statement;
- scoped payout managers can access out-of-scope machines/operators;
- payout totals are materially wrong and cannot be corrected before payment;
- statement issuance creates duplicate or conflicting latest statements;
- invite or login failures prevent the approved pilot cohort from participating;
- payroll scope is not approved in `#507`.

Rollback order:
1. Pause external payroll/payment for the affected cycle.
2. Keep or return to the pre-existing manual payroll process.
3. Stop issuing new pay statements from Bloomjoy Hub.
4. For unissued runs, reopen or void with an audit reason when supported.
5. For issued runs, use revision/correction flow rather than deleting statements.
6. Disable or hide rollout communications until the technical owner confirms repair.
7. Create or update the blocking GitHub issue with redacted evidence and owner-visible impact.

Do not remove historical time, payout, statement, or audit records as a rollback shortcut.

## 15. Evidence Packet

Before owner UAT/go-live, collect:
- verification command results from the release PR;
- screenshots or browser UAT evidence for `/portal/time`, `/portal/time/new`, and `/admin/payouts`;
- operator persona evidence for time add/edit/delete and statement download;
- admin persona evidence for review/finalize/issue/register export;
- support evidence for failed invite recovery and revoked/deactivated operator access when PR `#560` is in scope;
- access-boundary evidence for out-of-scope operator/admin denial;
- owner/accounting signoff from `#507`;
- first-cycle completion or exception summary in `#506` and monitoring follow-up in `#513`.

Keep screenshots synthetic or redacted. Do not include real employee PII, private pay details, raw provider payloads, or invite links.

## 16. Change Control

Use the `impeccable` skill for any visible frontend design work that changes `/portal/time`, `/portal/time/new`, `/admin/payouts`, operator setup, payout register export, or authenticated portal hierarchy.

Update `Docs/QA_SMOKE_TEST_CHECKLIST.md` whenever:
- a route, button, role boundary, or support path changes;
- a new failure state becomes user-visible;
- payout register export, invite recovery, statement delivery, or revocation behavior changes;
- the V1 payroll boundary changes after owner/accounting approval.

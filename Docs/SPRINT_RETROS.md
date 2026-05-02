# Sprint Retros

Use this file for short sprint retros that help the next agent or owner understand what changed, what risk remains, and what should happen next.

Keep entries plain-language and brief. Link to issues and PRs instead of copying long implementation notes.

## Reusable Template

### Sprint: `<name>`
- Dates:
- Goal:
- Lead issues:
- PRs:
- Verification:
- UAT evidence:
- What worked:
- What was confusing:
- Open risks:
- Follow-up issues:
- Owner decisions needed:
- Rollback notes:

## Entries

### Sprint: P0 risk burn-down
- Dates: `2026-05-02`
- Goal: Reduce launch-blocking risk around admin permission boundaries, refund settlement data quality, and UAT packaging.
- Lead issues:
  - `#376` - QA Super Admin and Scoped Admin permission boundaries.
  - `#264` - Require calculation fields before approved refunds reach settlement; remains open/blocked-external for source-data cleanup.
- PRs:
  - `#377` - docs-only closeout packet for sprint retro/UAT status; keep narrow.
  - `#378` - refund settlement calculation guardrails; merged to `main`, pending paired DB migration plus `refund-adjustment-sync` function deploy before production rollout.
  - `#379` - admin permission boundary QA; draft with a code-change blocker under remediation before live UAT/production rollout.
- Verification:
  - `#378`: CI, Supabase migration validation, and Vercel checks passed before merge.
  - `#378`: production rollout still needs the paired migration/function deploy and aggregate post-deploy audit.
  - `#379`: automated checks were green before independent review found a code-change blocker; treat as not release-ready until remediation plus live persona/RPC UAT are captured.
  - `#377`: docs-only verification should stay lightweight (`git diff --check` plus PR diff review).
- UAT evidence:
  - Independent review findings are now part of sprint closeout status, not just optional notes.
  - `#379` still needs credentialed live checks for Super Admin, Scoped Admin, Corporate Partner, Technician, and non-admin boundaries.
  - Required evidence: persona used, key URL/RPC exercised, expected allow/deny result, and any cleanup performed.
- What worked:
  - Parallel worktrees kept implementation, database, QA, and docs lanes separated.
  - Keeping UAT-gated work in draft made the automated-check status visible without implying live readiness.
  - Challenge/fix loops on `#379` improved independent coverage before credentialed UAT.
- What was confusing:
  - Migration timestamp collisions remain easy to create during multi-agent work; use later forward-only repair migrations instead of editing already-applied files.
  - `#264` is not fully closed by settlement guardrails alone because invalid or unmatched source rows may still remain outside settlement-ready data.
  - Environment setup must use each agent's own local `.env`; do not copy secrets or another agent's env file.
- Open risks:
  - `#379` remains draft/blocker-remediation/UAT-required until the code-change blocker is fixed and credentialed live persona/RPC verification proves the permission boundaries.
  - `#378` should not roll out to production until the DB migration and `refund-adjustment-sync` function are deployed together and the aggregate post-deploy audit passes.
  - `#264` remains open/blocked-external for invalid or unmatched rows that guardrails cannot classify automatically.
- Follow-up issues:
  - Keep `#264` scoped to source-data cleanup and reconciliation after settlement guardrails and post-deploy audit evidence.
  - Use the `#379` UAT packet to decide whether any additional access-boundary repair PR is needed.
- Owner decisions needed:
  - Confirm the live UAT credential/persona set and cleanup expectations for `#379`.
  - Decide who owns invalid/unmatched refund source rows that remain after guardrails block incomplete settlement records.
- Rollback notes:
  - `#377` is docs-only and has no app rollback.
  - `#378` includes database guardrails; rollback should be treated as a controlled production decision, not a docs-lane change.

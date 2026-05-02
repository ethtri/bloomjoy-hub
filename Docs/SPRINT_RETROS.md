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
  - `#264` - Require calculation fields before approved refunds reach settlement.
- PRs:
  - `#377` - docs-only closeout packet for sprint retro/UAT status; keep narrow.
  - `#378` - refund settlement calculation guardrails; merged to `main`.
  - `#379` - admin permission boundary QA; draft with green automated checks, pending credentialed live UAT.
- Verification:
  - `#378`: CI, Supabase migration validation, and Vercel checks passed before merge.
  - `#379`: CI, Supabase migration validation, and Vercel checks are green, but this is not release-ready until live persona/RPC UAT is captured.
  - `#377`: docs-only verification should stay lightweight (`git diff --check` plus PR diff review).
- UAT evidence:
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
  - `#379` remains draft/UAT-required until credentialed live persona/RPC verification proves the permission boundaries in the target environment.
  - `#264` still needs external/source-data cleanup for invalid or unmatched rows that guardrails cannot classify automatically.
- Follow-up issues:
  - Keep `#264` scoped to source-data cleanup and reconciliation after settlement guardrails.
  - Use the `#379` UAT packet to decide whether any additional access-boundary repair PR is needed.
- Owner decisions needed:
  - Confirm the live UAT credential/persona set and cleanup expectations for `#379`.
  - Decide who owns invalid/unmatched refund source rows that remain after guardrails block incomplete settlement records.
- Rollback notes:
  - `#377` is docs-only and has no app rollback.
  - `#378` includes database guardrails; rollback should be treated as a controlled production decision, not a docs-lane change.

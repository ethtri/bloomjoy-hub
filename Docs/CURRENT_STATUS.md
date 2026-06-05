# Current Status

Last compacted: 2026-05-30

GitHub Issues and the Bloomjoy Project board are the operational source of truth for active work, priority, blockers, acceptance criteria, and closeout evidence.

## Live Work

- Run `npm run agent:github-hygiene` before planning sprint work, branch syncs, or broad closeout.
- Use issue labels, project status, PR checks, and latest issue/PR comments instead of static docs for task state.
- Keep active blockers, UAT evidence, and closeout notes on the issue or PR where the work is happening.
- Do not add running task chronology, stale PR lists, old branch names, or historical completed-work ledgers here.

## Durable References

- Product and decisions: `Docs/DECISIONS.md`; use `PRODUCT.md` or `DESIGN.md` only when they exist in the repo
- Local setup and verification: `Docs/LOCAL_DEV.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`
- Production operations: `Docs/PRODUCTION_RUNBOOK.md`
- Architecture and scope: `Docs/ARCHITECTURE.md`, `Docs/MVP_SCOPE.md`

## Current Themes

- Refund operations and customer-refund pilot readiness remain high-sensitivity operational surfaces.
- Access grants that create user-facing Corporate Partner or Technician access must prove both the saved grant and the invite-email attempt; rollout signoff also needs provider/inbox/activation evidence in the linked issue or PR.
- Operator payouts, partner reporting, and scheduled exports are active shared foundations.
- Operator payouts foundation sprint: the foundation is on `main`; active follow-on PRs add timekeeping, revenue snapshots, calculation, review, and pay statement slices.
- Manager review/finalization slice `#448` adds the admin review gate before operator pay statements are issued.
- Operator pay statements slice `#449` publishes versioned operator-visible pay statements from finalized payout runs.
- Frontend work should use existing app patterns plus `PRODUCT.md`, `DESIGN.md`, and `impeccable` when the visible experience matters.

## Safety

- Never paste secrets, raw customer data, payment IDs, vendor exports, or free-text complaint content into docs, issues, PRs, or chat.

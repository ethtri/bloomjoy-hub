# Agent Sprint Workflow

Repeatable PM/PO orchestration for Bloomjoy Hub agent sprints.

## 1. Sprint Intake
- Start from GitHub Issues labeled `P0`-`P3` and the project board: https://github.com/users/ethtri/projects/2.
- Read the issue body, issue comments, linked PRs, and project-board state before planning.
- Read durable docs only as needed: `Docs/DECISIONS.md`, `Docs/LOCAL_DEV.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`, `Docs/ARCHITECTURE.md`, and `PRODUCT.md`/`DESIGN.md` for visible UI.
- Use `Docs/CURRENT_STATUS.md` only as a compact launch snapshot and `Docs/BACKLOG.md` only as a historical pointer.
- If docs conflict on active work state, GitHub wins. If docs conflict on durable product/platform decisions, `Docs/DECISIONS.md` wins.
- Convert vague asks into small PR-sized lanes: one implementation slice, research spike, QA pass, or docs closeout per lane.
- Classify each lane as low, medium, or high risk using `Docs/AI_WORKFLOW.md`.

## 2. Worktree Setup
- Never edit `C:\Repos\Bloomjoy_hub` directly.
- Use one worktree per lane: `C:\Repos\wt-<short-task-slug>`.
- Use one branch per lane: `agent/<short-task-slug>`.
- Create worktrees from current `origin/main` unless the lane explicitly depends on another PR branch.
- Before edits, run the preflight in `Docs/LOCAL_DEV.md`: confirm worktree path, confirm `agent/` branch, `git fetch origin`, `npm run agent:preflight`, and review `git status -sb`.
- Do not switch branches inside another agent's worktree. Do not touch implementation PR worktrees unless explicitly assigned.

## 3. Lane Patterns
- PM/PO planning lane: inventory open P0/P1 items, decide sequencing, split work, identify blockers, and open/refresh issues.
- Implementation lane: make the smallest code/doc change that satisfies one issue or acceptance slice.
- Research/QC lane: inspect risky areas, verify assumptions, compare docs/issues/PRs, and produce specific implementation guidance or blocker evidence.
- QA challenge lane: independently test the implementation against acceptance criteria, smoke checklist, risk model, and privacy/evidence rules.
- Design review lane: for UX-sensitive visible UI, use `PRODUCT.md`, `DESIGN.md`, and `impeccable` guidance to challenge hierarchy, responsiveness, accessibility, and polish.
- Closeout lane: reconcile docs, PR descriptions, labels, issue status, merge order, and follow-up items.
- Keep small single-lane fixes with the primary agent. Use subagents only when they reduce real risk or parallelize meaningful lanes.

## 4. Sequencing
- PM/PO plan first, then implementation and research/QC in parallel only when they do not write the same files.
- Run QA challenge after implementation verification is available. QA may request a fix lane or approve with residual risks.
- For high-risk work, require an independent AI review or a clearly separated challenge pass before merge.
- If a shared foundation PR merges, sync dependent branches from `main` and rerun verification before marking them ready.
- Merge in dependency order: foundations first, then feature slices, then QA/docs closeout.

## 5. Blockers
- Treat external-account work, production credentials, owner product decisions, missing secrets, and ambiguous go/no-go calls as blockers.
- Record blockers in the issue or PR. Update `Docs/CURRENT_STATUS.md` only for compact launch-level blockers or cross-cutting context that should outlive one issue.
- Park stale or blocked branches as issues instead of leaving broad draft PRs open.
- Do not invent new platforms, CMS, commerce providers, or workflow infrastructure without a `Docs/DECISIONS.md` entry.

## 6. Evidence and Privacy
- Keep evidence actionable: exact commands, PR numbers, URLs, screenshots, sanitized logs, and dates.
- Do not paste secrets, `.env` values, service-role keys, customer PII, raw Sunze workbooks, raw refund exports, payment identifiers, or private artwork links into docs, issues, PRs, or chat.
- Use environment variables for secrets and remember that `VITE_*` values are browser-exposed.
- Keep personal scratch notes local and uncommitted.

## 7. PR Requirements
Every repo change gets a PR into `main`, usually draft until verification is complete.

PR body must include:
- Summary: 1-3 bullets.
- Files changed: high-level paths and purpose.
- Verification commands and exact results: `npm ci`, `npm run agent:preflight`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`, and `git diff --check`; include route-specific checks when relevant.
- How to test: localhost steps, key URLs, and any non-secret test credentials or persona notes.
- Risk/overlap notes: open PRs, shared files, blockers, rollback if high risk.
- UI/design evidence for visible UI changes.

## 8. Sprint Closeout
- Confirm all implementation, QA challenge, and docs closeout PRs are merged or intentionally parked.
- Update issues and project board status.
- Close superseded PRs only when the replacement evidence is clear.
- Update `Docs/CURRENT_STATUS.md` only for compact launch-level changes or blockers that should survive beyond one issue.
- Update `Docs/QA_SMOKE_TEST_CHECKLIST.md` when a new user-facing flow exists.
- Run a short retro with `Docs/SPRINT_RETRO_TEMPLATE.md` when useful and turn follow-ups into GitHub issues.

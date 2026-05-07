# Agent Sprint Workflow

Repeatable PM/PO orchestration for Bloomjoy Hub agent sprints.

## 1. Sprint Intake
- Start from GitHub Issues labeled `P0`-`P3` and the project board: https://github.com/users/ethtri/projects/2.
- Read repo docs in this order before planning: `Docs/CURRENT_STATUS.md`, `Docs/POC_NOTES.md`, `Docs/MVP_SCOPE.md`, `Docs/DECISIONS.md`, `Docs/BACKLOG.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`, `Docs/LOCAL_DEV.md`, `Docs/ARCHITECTURE.md`.
- If docs conflict, `Docs/DECISIONS.md` wins.
- Convert vague asks into small PR-sized lanes: one implementation slice, research spike, QA pass, or docs closeout per lane.
- Classify each lane as low, medium, or high risk using `Docs/AI_WORKFLOW.md`.

## 2. Worktree Setup
- Never edit `C:\Repos\Bloomjoy_hub` directly.
- Use one worktree per lane: `C:\Repos\wt-<short-task-slug>`.
- Use one branch per lane: `agent/<short-task-slug>`.
- Create worktrees from current `origin/main` unless the lane explicitly depends on another PR branch.
- Before edits, run the preflight in `Docs/LOCAL_DEV.md`: confirm worktree path, confirm `agent/` branch, `git fetch origin`, and clean `git status -sb`.
- Do not switch branches inside another agent's worktree. Do not touch implementation PR worktrees unless explicitly assigned.

## 3. Lane Patterns
- PM/PO planning lane: inventory open P0/P1 items, decide sequencing, split work, identify blockers, and open/refresh issues.
- Implementation lane: make the smallest code/doc change that satisfies one issue or acceptance slice.
- Research/QC lane: inspect risky areas, verify assumptions, compare docs/issues/PRs, and produce specific implementation guidance or blocker evidence.
- QA challenge lane: independently test the implementation against acceptance criteria, smoke checklist, risk model, and privacy/evidence rules.
- Closeout lane: reconcile docs, PR descriptions, labels, issue status, merge order, and follow-up items.

## 4. Sequencing
- PM/PO plan first, then implementation and research/QC in parallel only when they do not write the same files.
- Run QA challenge after implementation verification is available. QA may request a fix lane or approve with residual risks.
- For high-risk work, require an independent AI review or a clearly separated challenge pass before merge.
- If a shared foundation PR merges, sync dependent branches from `main` and rerun verification before marking them ready.
- Merge in dependency order: foundations first, then feature slices, then QA/docs closeout.

## 5. Blockers
- Treat external-account work, production credentials, owner product decisions, missing secrets, and ambiguous go/no-go calls as blockers.
- Record blockers in the PR and, when they affect current priorities, in `Docs/CURRENT_STATUS.md`.
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
- Verification commands and exact results: `npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`; include `npm run seo:check` when relevant or reasonable.
- How to test: localhost steps, key URLs, and any non-secret test credentials or persona notes.
- Risk/overlap notes: open PRs, shared files, blockers, rollback if high risk.

## 8. Sprint Closeout
- Confirm all implementation, QA challenge, and docs closeout PRs are merged or intentionally parked.
- Update issues and project board status.
- Close superseded PRs only when the replacement evidence is clear.
- Update `Docs/CURRENT_STATUS.md` for completed P0 work or newly discovered blockers.
- Update `Docs/QA_SMOKE_TEST_CHECKLIST.md` when a new user-facing flow exists.
- Run a short retro with `Docs/SPRINT_RETRO_TEMPLATE.md` and turn follow-ups into issues.

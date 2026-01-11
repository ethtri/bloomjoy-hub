# AGENTS — Bloomjoy Sweets Website (Vibe Coding Guardrails)

## Scope and precedence (keep context small)
Prefer docs in this order (highest wins):
1. `Docs/CURRENT_STATUS.md`
2. `Docs/POC_NOTES.md`
3. `Docs/MVP_SCOPE.md`
4. `Docs/DECISIONS.md`
5. `Docs/BACKLOG.md`
6. `Docs/QA_SMOKE_TEST_CHECKLIST.md`
7. `Docs/LOCAL_DEV.md`
8. `Docs/ARCHITECTURE.md`

Notes:
- Canonical docs folder is `Docs/` (case-sensitive on some systems).
- If docs disagree, `Docs/DECISIONS.md` wins.
- This file is guardrails only; use the relevant doc for details.

## Starting point (important)
- This project started as a **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- Prefer **incremental improvements** over rewrites.
- If you believe a rewrite is necessary, propose it in a plan and record the decision in `Docs/DECISIONS.md` before doing it.

## Do
- Focus on P0 items first.
- Prefer small, reviewable PRs (one feature or one slice per PR).
- Keep changes minimal and reversible.
- Update `Docs/CURRENT_STATUS.md` when you complete a P0 item (and when you discover new blockers).
- Add/adjust smoke tests in `Docs/QA_SMOKE_TEST_CHECKLIST.md` when a new user-facing flow is added.
- Use environment variables for all secrets. Never commit secrets.
- If this touches the same files as another open PR, say so.

## Do Not
- Do not do large refactors “for cleanliness” unless explicitly requested.
- Do not reformat or rewrite docs unless asked.
- Do not reference or copy from bloomjoysweets.com unless explicitly asked (the business model changed).
- Do not introduce a new platform (CMS, headless commerce, etc.) without a decision entry in `Docs/DECISIONS.md`.
- Never put secret keys into client-exposed Vite env vars (anything starting with `VITE_` is exposed to the browser).

## Definition of Done (task)
A task is done when:
1) code change is complete,
2) verification run is complete,
3) PR is opened,
4) PR contains a “How to test” section (localhost steps + key URLs)

## Version control protocol (must follow)

### Never
- Never commit or push directly to `main`.

### Unified workflow (all agents)
- Always create a new branch for the task.
- Branch naming: `agent/<short-task-slug>`.
- Open a PR into `main` for every change, even for local work.
- Run verification on the PR branch; local testing happens by checking out that branch.

### PR requirements (always)
PR description includes:
- Summary (1–3 bullets)
- Files changed (high level)
- Verification commands + results:
  - `npm ci`
  - `npm run build`
  - `npm test --if-present`
  - `npm run lint --if-present`
- How to test (localhost steps + key URLs + test credentials if using a dev email flow)

### Multi-agent branch safety
- If another PR that touches shared foundations merges, update your branch from `main` before final verification.
- Re-run verification after syncing.
- Call out conflicts or risky overlaps in the PR description or status update.

### Multi-agent worktree safety (recommended)
- Each agent must work in its own Git worktree directory (not the same repo folder).
- One worktree = one checked-out branch. Do not run two agents in the same worktree.
- Worktree naming convention:
  - Directory: `../wt-<short-task-slug>`
  - Branch: `agent/<short-task-slug>`
- If you must run without worktrees, run only one agent at a time to avoid branch switching.

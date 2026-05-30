# AGENTS - Bloomjoy Hub Agent Guardrails

## Source of Truth and Precedence

Use the smallest context that can safely answer the task.

1. GitHub Issues and the Bloomjoy Project board are authoritative for active work: priority, status, blockers, acceptance criteria, and closeout evidence.
2. `Docs/DECISIONS.md` is authoritative for durable product, platform, and architectural decisions.
3. Durable runbooks and setup docs: `Docs/LOCAL_DEV.md`, `Docs/PRODUCTION_RUNBOOK.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`, and `Docs/ARCHITECTURE.md`.
4. Durable product/design context: `PRODUCT.md`, `DESIGN.md`, `Docs/MVP_SCOPE.md`, and `Docs/POC_NOTES.md`.
5. Snapshot/history docs: `Docs/CURRENT_STATUS.md` and `Docs/BACKLOG.md`.

If docs and the GitHub board disagree on active task state, the board wins. If durable docs disagree on product or platform decisions, `Docs/DECISIONS.md` wins.

## Starting Point

- This project started as a Loveable-generated POC using Vite, React, TypeScript, Tailwind, and shadcn/ui.
- Prefer incremental, reviewable improvements over rewrites.
- If a rewrite or new platform is necessary, propose it in the issue/plan and record the decision in `Docs/DECISIONS.md` before implementation.

## Do

- Start active work from a GitHub issue and the project-board state, not from static markdown backlog files.
- Use `/goal` for multi-step, multi-PR, high-risk, or ambiguous work. Use `/plan` first when acceptance criteria are still fuzzy.
- Work only in a dedicated worktree such as `C:\Repos\wt-<short-task-slug>`.
- Use branch names in the form `agent/<short-task-slug>`.
- Run `npm run agent:preflight` before edits and again before PR closeout.
- Run `npm run agent:context -- --issue <number>` at kickoff when an issue number is available.
- Run `npm run agent:github-hygiene` for weekly or as-requested issue board hygiene sweeps.
- Run `npm run agent:merge-gate -- --pr <number>` before agent-merging a PR.
- Run `npm run agent:validate-workflow` when changing agent docs, templates, Codex config, skills, or workflow scripts.
- Keep PRs small and focused: one feature, fix, workflow upgrade, or vertical slice per PR.
- Keep changes minimal and reversible.
- Update issue comments and PR comments with status, blockers, verification, and closeout evidence.
- Update `Docs/CURRENT_STATUS.md` only for compact launch/current-blocker snapshots, not as a running task log.
- Update `Docs/QA_SMOKE_TEST_CHECKLIST.md` when a user-facing flow adds or changes reusable smoke coverage.
- Use environment variables for all secrets. Never commit secrets.
- If another open PR touches the same files or shared foundations, call out the overlap in the PR.

## Do Not

- Do not edit `C:\Repos\Bloomjoy_hub` directly.
- Do not use `Docs/BACKLOG.md` or long status docs as the active backlog.
- Do not do large refactors for cleanliness unless explicitly requested.
- Do not reformat or rewrite docs unless the issue asks for it.
- Do not reference or copy from bloomjoysweets.com unless explicitly asked; the business model changed.
- Do not introduce a new platform such as a CMS or headless commerce system without a decision entry in `Docs/DECISIONS.md`.
- Never put secret keys into client-exposed Vite env vars. Anything starting with `VITE_` is exposed to the browser.

## Frontend and Design Workflow

- For net-new app/site/tool work, redesigns, production UI surfaces, or visually important pages, use `build-web-apps:frontend-app-builder`.
- For visible UI work, also use `impeccable` to shape, audit, or polish the experience when the change is UX-sensitive or design quality matters.
- Use `PRODUCT.md` and `DESIGN.md` as the default `impeccable` context.
- Default register is `product` for operator, admin, portal, reporting, refunds, and internal tools. Public marketing pages may override to a warmer brand register.
- Prefer existing repo patterns, Tailwind tokens, shadcn/ui components, Radix primitives, and lucide icons.
- Verify rendered UI in a browser for visible changes. Responsive and accessibility regressions count as incomplete work.

## Subagents, Plugins, and Skills

- `.codex/config.toml` defines conservative project subagent limits.
- `.codex/agents/*.toml` defines read-only helper agents for repo mapping, QA challenge, design review, docs research, and security/risk review.
- `.agents/skills/bloomjoy-agent-workflow/SKILL.md` holds the repo-local workflow skill so detailed workflow guidance loads only when relevant.
- Use subagents only when they reduce real risk or parallelize meaningful lanes: repo mapping, QA challenge, design review, docs research, or security/risk review.
- Keep small single-lane fixes local to the primary agent to reduce overhead and context confusion.
- Subagents are advisory. The primary agent remains responsible for final code, verification, and PR quality.
- Prefer repo skills and plugin guidance when the task clearly matches them.

## Definition of Done

A task is done when:

1. Code, docs, or config changes are complete.
2. Verification has been run and results are recorded.
3. A PR is opened into `main`.
4. The PR includes linked issue, summary, high-level files changed, verification results, risk/overlap, and localhost "How to test" steps.
5. The GitHub issue/project-board state is updated or the PR explains what remains.

## Merge Autonomy

Agents should not make Ethan the default merge bottleneck. Use the PR labels, issue labels, PR evidence, and `npm run agent:merge-gate -- --pr <number>` to classify the merge lane.

### Green Lane - Agent May Merge

Agent merge is allowed when all of these are true:

- PR targets `main`, is not draft, has no merge conflicts, and all required checks are green.
- PR links a GitHub issue and includes verification, risk/overlap, rollback, and board closeout notes.
- No red-lane labels are present on the PR or linked issue.
- The change is low-risk: docs, workflow tooling, lint/build cleanup, safe dependency updates, small tests, or narrow non-sensitive code cleanup.

### Yellow Lane - Agent May Merge With Extra Evidence

Agent merge is allowed after extra evidence is recorded in the PR:

- Visible UI changes: include browser evidence at relevant desktop/mobile widths and `impeccable` or design-review notes when design quality matters.
- Shared code or workflow changes: call out open-PR overlap and rollback.
- Performance/build changes: include before/after evidence.
- P0/P1 priority without red-lane labels: confirm the work is not launch-critical, owner-blocked, or externally dependent.

### Red Lane - Owner Approval Required

Agents must not merge without explicit owner direction when the PR or linked issue has any of these labels:

- `needs-owner-decision`
- `uat-required`
- `blocked`
- `blocked-external`
- `risky-db-change`
- `risky-auth-payment`

Also treat production deploys, secrets, auth/permission changes, payments, refunds, RLS, migrations, destructive data changes, vendor/account setup, legal/terms changes, and brand commitments as red lane unless the issue explicitly scopes them as safe and non-production.

## Version Control Protocol

### Never

- Never commit or push directly to `main`.
- Never run two agents in the same worktree.

### Unified Workflow

- Always create a new branch for the task.
- Always open a PR into `main`, even for local workflow or docs changes.
- Run verification on the PR branch.
- If another PR that touches shared foundations merges, update your branch from `main` before final verification.
- Re-run verification after syncing.

### Worktree Safety

- Worktree directory: `..\wt-<short-task-slug>`.
- Branch: `agent/<short-task-slug>`.
- One worktree equals one checked-out branch.
- If you must run without worktrees, run only one agent at a time.

## Operational Safeguards

- Run the preflight check in `Docs/LOCAL_DEV.md` before making edits.
- Track priorities in GitHub Issues labeled `P0` through `P3` and use the Bloomjoy Project board.
- Keep personal notes local. Do not commit them.
- Keep repo docs durable and compact; use issue and PR comments for task-level chronology.

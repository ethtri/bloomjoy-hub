# Bloomjoy Docs

This folder holds durable project context, not the active task tracker.

## Operational Source of Truth

Active work lives in GitHub:

- GitHub Issues define goals, scope, acceptance criteria, blockers, and priority labels.
- The Bloomjoy Project board defines current status and sequencing.
- PR comments hold implementation evidence, verification results, and closeout notes.

If a static doc disagrees with the board about active status or priority, use the board.

## Durable Docs

- `Docs/DECISIONS.md` - durable product, platform, architecture, and launch decisions.
- `Docs/LOCAL_DEV.md` - local setup, preflight checks, env guidance, and operational helper commands.
- `Docs/PRODUCTION_RUNBOOK.md` - production deploy, rollback, and operations guidance.
- `Docs/QA_SMOKE_TEST_CHECKLIST.md` - reusable smoke coverage for user-facing flows.
- `Docs/ARCHITECTURE.md` - system shape and ownership boundaries.
- `Docs/MVP_SCOPE.md` and `Docs/POC_NOTES.md` - historical product and POC context.
- `Docs/CURRENT_STATUS.md` - compact snapshot only; not a running changelog.
- `Docs/BACKLOG.md` - historical pointer to GitHub Issues and the project board.
- `Docs/TASK_TEMPLATE.md` - reusable `/goal` and task kickoff prompts for agents.

## When to Update Docs

Update durable docs when the repo gains lasting knowledge: a decision, runbook change, reusable QA path, architecture boundary, or compact launch blocker snapshot.

Use issue and PR comments for task status, handoff notes, blocker threads, test evidence, and day-to-day chronology.

## Agent Kickoff

1. Start from the GitHub issue and project-board item.
2. Use `/plan` if the success criteria are unclear.
3. Use the `/goal` template in `Docs/TASK_TEMPLATE.md` for multi-step work.
4. Create a dedicated worktree and `agent/<short-task-slug>` branch.
5. Run `npm run agent:context -- --issue <number>`.
6. Run `npm run agent:preflight -- --issue <number>`.
7. Keep evidence in the PR and update the issue/project board at closeout.

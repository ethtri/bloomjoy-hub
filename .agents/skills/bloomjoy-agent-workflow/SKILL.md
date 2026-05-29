---
name: bloomjoy-agent-workflow
description: Use for Bloomjoy Hub GitHub issue or PR work, agent workflow upgrades, worktree setup, source-of-truth context gathering, goal planning, subagent coordination, verification, PR closeout, and board hygiene.
---

# Bloomjoy Agent Workflow

## Quick Start

1. Start from the GitHub issue and Bloomjoy Project board item.
2. Run `npm run agent:context -- --issue <number>` to get compact issue, board, branch, docs, and verification context.
3. Use `/plan` if the outcome or acceptance is unclear. Use `/goal` for multi-step, multi-PR, high-risk, or ambiguous work.
4. Work in `C:\Repos\wt-<short-task-slug>` on `agent/<short-task-slug>`.
5. Run `npm run agent:preflight -- --issue <number>` before edits and before closeout.

## Source of Truth

- Use GitHub Issues and the Bloomjoy Project board for active work state, priority, blockers, acceptance, and closeout evidence.
- Use `Docs/DECISIONS.md` for durable product/platform decisions.
- Use `Docs/LOCAL_DEV.md`, `Docs/PRODUCTION_RUNBOOK.md`, `Docs/QA_SMOKE_TEST_CHECKLIST.md`, and `Docs/ARCHITECTURE.md` only when relevant to the task.
- Treat `Docs/BACKLOG.md` as historical and `Docs/CURRENT_STATUS.md` as a compact launch snapshot.

## Implementation

- Keep PRs small and reversible.
- Prefer repo patterns and existing framework choices.
- Do not edit `C:\Repos\Bloomjoy_hub` directly.
- Do not commit secrets, raw customer data, payment IDs, vendor exports, or free-text complaint content.
- For visible UI work, use `PRODUCT.md`, `DESIGN.md`, and `impeccable` guidance when design quality matters.

## Subagents

- Keep small single-lane fixes local to the primary agent.
- Use project custom agents only when they reduce real risk: `repo_mapper`, `qa_challenger`, `design_reviewer`, `docs_researcher`, or `security_risk_reviewer`.
- Keep subagents read-only unless a task explicitly needs delegated implementation.
- The primary agent owns final edits, verification, PR quality, and GitHub closeout.

## Verification and Closeout

- Use the verification profile from `npm run agent:context -- --issue <number>`.
- For workflow/template changes, also run `npm run agent:validate-workflow`.
- Every repo change gets a PR into `main` with linked issue, summary, files changed, verification results, risk/overlap, and how-to-test steps.
- Put task chronology and closeout evidence in the issue or PR, not static markdown docs.

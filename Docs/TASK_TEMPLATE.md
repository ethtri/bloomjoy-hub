# Agent Task Template

Use GitHub Issues and the Bloomjoy Project board as the operational source of truth. For new work, prefer `.github/ISSUE_TEMPLATE/feature_task.yml` or `.github/ISSUE_TEMPLATE/bug.yml`.

Use `/plan` first when the goal, scope, or acceptance criteria are still fuzzy.

## Reusable `/goal` Template

```text
/goal
Issue: #___
Outcome:
- What should be true when this work is complete?

Acceptance criteria:
- [ ] User-visible or operational requirement
- [ ] Edge case or non-goal made explicit
- [ ] Required evidence or artifact

Worktree and branch:
- Worktree: C:\Repos\wt-<short-task-slug>
- Branch: agent/<short-task-slug>

Kickoff:
- npm run agent:context -- --issue ___
- npm run agent:preflight -- --issue ___

Constraints:
- Use GitHub issue/project state as the active source of truth.
- Do not edit C:\Repos\Bloomjoy_hub directly.
- Do not commit secrets or paste sensitive customer/vendor data into docs, issues, PRs, or chat.
- Keep the change scoped and reversible.

Context to read:
- Issue body, comments, linked PRs, and project-board state
- Docs/DECISIONS.md for durable decisions
- Docs/LOCAL_DEV.md for setup and verification
- PRODUCT.md and DESIGN.md for visible UI work
- Relevant source files and tests

Verification:
- npm ci
- npm run agent:preflight -- --issue ___
- npm run agent:merge-gate -- --pr ___ before agent merge
- npm run agent:validate-workflow when agent workflow docs/templates/config/scripts/skills changed
- npm run build
- npm test --if-present
- npm run lint --if-present
- git diff --check
- Browser/UI evidence when visible UI changes

PR requirements:
- Link the issue
- Summarize the change in 1-3 bullets
- List high-level files changed
- Include verification commands and results
- Include localhost how-to-test steps
- Call out risk, overlap, and rollback notes
- Classify merge autonomy as Green, Yellow, or Red
- Record owner approval status and merge-gate result before agent merge
- Include UI/design evidence when applicable

Board closeout:
- Move/update the project-board item
- Add closeout evidence to the issue or PR
- Run `npm run agent:github-hygiene` when the task is board, stale PR, or issue hygiene work
- Note remaining follow-ups as GitHub issues, not static backlog entries
```

## Quick Local Prompt

```text
Start from issue #___ and the Bloomjoy Project board item. Create or use worktree C:\Repos\wt-<short-task-slug> on branch agent/<short-task-slug>. Run npm run agent:context -- --issue ___ and npm run agent:preflight -- --issue ___. Implement only the accepted scope, run verification, open a PR into main, and update the issue/project board with closeout evidence.
```

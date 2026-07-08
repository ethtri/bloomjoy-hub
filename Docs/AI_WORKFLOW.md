# AI Workflow

This repo is operated primarily through AI coding agents. The owner is not expected to do code review. Agents should do the implementation, review hygiene, GitHub cleanup, labeling, verification, and UAT preparation wherever possible.

## Operating model
- Keep PRs small, scoped, and reversible.
- Start meaningful work from a GitHub issue and Bloomjoy Project board item.
- Use `npm run agent:context -- --issue <number>` to gather compact issue, board, PR, docs, and verification context.
- Convert vague ideas, parked work, or exploratory branches into issues instead of leaving long-lived draft PRs.
- Use the GitHub issue and PR templates as the source of truth for active scope, risk, verification, UAT steps, screenshots, rollback, and closeout evidence.
- Ask the owner only for executive decision work: product judgment, external-account actions, legal/brand/account commitments, secrets, production go/no-go, or genuinely ambiguous acceptance.
- For repeatable PM/PO sprint orchestration with subagent execution and QA challenge lanes, use `Docs/AGENT_SPRINT_WORKFLOW.md`.

## Risk levels
- Low risk: docs-only, copy-only, small cleanup, or non-runtime guardrails.
- Medium risk: UI changes, admin UX, non-critical scripts, or user-facing copy/layout.
- High risk: Supabase migrations, Edge Functions, auth, Stripe/payments, reporting math, GitHub Actions, production data paths, or server-side secrets.

## Agent responsibilities
- Classify every PR as low, medium, or high risk.
- Apply useful labels such as `docs-only`, `ui-change`, `risky-db-change`, `risky-auth-payment`, `ready-for-uat`, `uat-required`, `ai-reviewed`, `needs-owner-decision`, `blocked-external`, `parked`, or `superseded`.
- Run the repo verification expected by the PR template and report exact results.
- Run `npm run agent:validate-workflow` when changing workflow docs, GitHub templates, Codex config, repo skills, or agent scripts.
- For UI changes, provide preview/localhost links and desktop/mobile screenshots.
- For UX-sensitive visible UI changes, use `PRODUCT.md`, `DESIGN.md`, and `impeccable` guidance for shape, audit, or polish.
- For user-facing changes, provide exact UAT steps and expected results.
- Use `Docs/UAT_PERSONA_PLAYBOOK.md` when preparing owner UAT steps for public, portal, admin, reporting, Technician, or Corporate Partner changes.
- For high-risk changes, include an explicit rollback plan and independent AI review evidence.

Use an independent AI reviewer or delegated subagent for high-risk review when the current agent environment allows it. If not available, perform a separate review pass and record what was checked.
When a PR already exists, proactively drive it through testing, review, merge, and cleanup instead of waiting for Ethan approval. Owner approval is reserved for executive decision blockers, not routine code review or technical confidence.

## Owner involvement
- Green lane: no owner involvement unless wording or product direction is unclear.
- Yellow lane: owner UAT is optional; agents provide the extra preview, browser, overlap, independent-review, or performance evidence that matches the change.
- Red lane: only executive decision labels or unresolved external blockers require owner direction before merge or production rollout.

The owner should not need to inspect code diffs to make routine decisions. PRs should present enough evidence for a product-level go/no-go.

See `Docs/UAT_PERSONA_PLAYBOOK.md` for the persona-based checklist agents should use before asking the owner for UAT.

Before any agent-initiated merge, run `npm run agent:merge-gate -- --pr <number>`. The gate blocks executive-decision labels, unresolved blockers, and unready PRs; it is evidence for merge readiness, not a replacement for required owner direction when a true executive decision exists.

## Weekly hygiene
Agents should periodically:
- run `npm run agent:github-hygiene` and use the report as the starting point;
- run `npm run agent:worktree-hygiene` before local cleanup sweeps;
- list stale PRs and proactively close, merge, park, or rebuild according to merge-gate evidence;
- close/supersede stale PRs without owner approval when replacement evidence is clear and no executive decision is needed;
- prune branches and worktrees after confirming no uncommitted work remains;
- ensure GitHub issues, labels, and the project board reflect the actual work queue;
- keep `Docs/CURRENT_STATUS.md` limited to compact launch-level snapshots and cross-cutting blockers.

## Avoid
- Do not bundle unrelated product, database, and docs changes in one PR.
- Do not leave broad exploratory draft PRs open as planning artifacts.
- Do not use `Docs/BACKLOG.md` or long status docs as the active backlog.
- Do not make the owner maintain labels, stale PRs, or branch cleanup manually.
- Do not add heavier process, new CI jobs, CODEOWNERS, or required human code review unless explicitly requested.

# AI Workflow

This repo is operated primarily through AI coding agents. The owner is not expected to do code review. Agents should do the implementation, review hygiene, GitHub cleanup, labeling, verification, and UAT preparation wherever possible.

## Operating model
- Keep PRs small, scoped, and reversible.
- Start meaningful work from a GitHub issue when possible.
- Convert vague ideas, parked work, or exploratory branches into issues instead of leaving long-lived draft PRs.
- Use the GitHub PR template as the source of truth for risk, verification, UAT steps, screenshots, and rollback.
- Ask the owner only for product judgment, external-account actions, final high-risk UAT, or ambiguous go/no-go decisions.

## Risk levels
- Low risk: docs-only, copy-only, small cleanup, or non-runtime guardrails.
- Medium risk: UI changes, admin UX, non-critical scripts, or user-facing copy/layout.
- High risk: Supabase migrations, Edge Functions, auth, Stripe/payments, reporting math, GitHub Actions, production data paths, or server-side secrets.

## Agent responsibilities
- Classify every PR as low, medium, or high risk.
- Apply useful labels such as `docs-only`, `ui-change`, `risky-db-change`, `risky-auth-payment`, `ready-for-uat`, `uat-required`, `ai-reviewed`, `needs-owner-decision`, `blocked-external`, `parked`, or `superseded`.
- Run the repo verification expected by the PR template and report exact results.
- For UI changes, provide preview/localhost links and desktop/mobile screenshots.
- For user-facing changes, provide exact UAT steps and expected results.
- Use `Docs/UAT_PERSONA_PLAYBOOK.md` when preparing owner UAT steps for public, portal, admin, reporting, Technician, or Corporate Partner changes.
- For high-risk changes, include an explicit rollback plan and independent AI review evidence.

Use an independent AI reviewer or delegated subagent for high-risk review when the current agent environment allows it. If not available, perform a separate review pass and record what was checked.

## Owner involvement
- Low risk: no owner involvement unless wording or product direction is unclear.
- Medium risk: owner UAT is optional; agents still provide a preview checklist.
- High risk: owner UAT or go/no-go confirmation is required before merge or production rollout.

The owner should not need to inspect code diffs to make routine decisions. PRs should present enough evidence for a product-level go/no-go.

See `Docs/UAT_PERSONA_PLAYBOOK.md` for the persona-based checklist agents should use before asking the owner for UAT.

## Weekly hygiene
Agents should periodically:
- list stale PRs and recommend close, merge, park, or rebuild;
- close/supersede stale PRs after owner approval when needed;
- prune branches and worktrees only after confirming no uncommitted work remains;
- keep `Docs/CURRENT_STATUS.md` aligned with current P0/P1 reality;
- ensure GitHub issues and labels reflect the actual work queue.

## Avoid
- Do not bundle unrelated product, database, and docs changes in one PR.
- Do not leave broad exploratory draft PRs open as planning artifacts.
- Do not make the owner maintain labels, stale PRs, or branch cleanup manually.
- Do not add heavier process, new CI jobs, CODEOWNERS, or required human code review unless explicitly requested.

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

- Refund Operations issue `#630` now has a deterministic, versioned Nayax recommendation slice with explicit high-confidence/ambiguous/no-safe-match/manual-exception states, canonical location-timezone resolution, manager alternate-selection evidence, and fail-closed execution eligibility. Merge and manager UAT remain pending; live Nayax execution is still disabled and sponsor-gated. Before one-click execution can leave manual review, the Nayax contract/evidence captured in `#430` must confirm a stable provider site identifier and an explicit approved-sale status (or document an approved server-side substitute), because the last verified `lastSales` field inventory does not list either field.
- Refund Operations issue `#631` now has a recommendation-first card workbench in implementation: side-by-side request/transaction evidence, one dominant refund-and-notify action, explicit payment confirmation, double-submit protection, success/recovery receipts, and desktop/mobile state-matrix screenshots. PR review, manager UAT, and dependency sync after `#636`/`#637` remain pending; live Nayax execution is still disabled.
- Refund Operations issue `#633` now has a cash-only manager workflow in implementation: one recommended action, explicit amount/time/payment confirmation, sensitive-reference rejection, service-role-only idempotent completion, redacted actor/time audit history, post-save customer email, and desktop/mobile browser proof. PR review, manager UAT, and dependency sync after `#636`-`#638` remain pending; cash/Zelle payment itself remains manual and live Nayax execution is still disabled.
- Refund Operations issue `#632` now has a production scheduler/health slice in implementation: versioned sweep and independent health schedules, default-off switches, local contact-hour policy, sanitized run metadata, once-only action claims, manager-visible health, PII-free alerting, and manual run/disable procedures. PR review, manager UAT, deployment smoke evidence, and dependency sync remain pending; the core refund queue stays independent from scheduler health.
- Refund operations and customer-refund pilot readiness remain high-sensitivity operational surfaces.
- Access grants that create user-facing Corporate Partner or Technician access must prove both the saved grant and the invite-email attempt; rollout signoff also needs provider/inbox/activation evidence in the linked issue or PR.
- Partner activation uses manual Email Codes and a temporary non-persisting auth session; password creation must succeed before portal sign-in. Hosted signup-confirmation, invite, Email Code, and recovery templates must pass `npm run auth:templates:validate` so email-security prefetch cannot consume credentials. Production Auth delivery uses Bloomjoy's Resend custom SMTP; Supabase's two-email/hour demonstration sender is not an acceptable production fallback.
- Technician management IA uses `/portal/team` for Plus Customer and Corporate Partner self-service, while `/admin/access` remains the Super Admin override surface and the Scoped Admin machine-scoped Technician grant surface. Plus/partner users should not receive `/admin` just to manage Technicians.
- Admin Console IA uses `/admin` as the single internal workspace. The sidebar is the only primary admin navigation map, `/admin` is an exception dashboard rather than a duplicate route launcher, Refunds is one shared core `/refunds` workflow, and Scoped Admins can enter with zero machine grants while machine records/actions remain limited to explicitly granted `reporting_machines`.
- Scoped Admin Technician provisioning is tracked by P0 issues `#536`-`#542`; local executable implementation/UAT belongs in `#537`-`#541`, while `#542` requires post-deploy live invite/account verification.
- Operator Pay, partner reporting, and scheduled exports are active shared foundations.
- Operator report PDF exports depend on the deployed `sales-report-export` Edge Function matching the repo's polished generator; stale deployments can still produce legacy monospaced PDFs and should be redeployed before partner-facing report sharing.
- Timekeeping V1 is a distinct worker-entry and machine-manager-review workflow: monthly completed shifts, per-shift whole-hour rounding, worker-visible correction notes, and issued-statement self-service. Shift review does not execute or alter payments.
- Operator Pay calculation, finalization, payment execution, tax/compliance handling, and provider integration remain separate from the Timekeeping V1 replacement for Sheets/AppSheet.
- Operator pay statements slice `#449` remains the versioned foundation for issued-statement self-service; drafts and manager previews are not worker-visible.
- Authenticated portal bootstrap is shell-first and permission-neutral: Technician entitlement resolution remains authoritative before access reads, access-sensitive navigation waits for hydration, and session-to-shell/dashboard timing contains no account or identity data.
- Frontend work should use existing app patterns plus `PRODUCT.md`, `DESIGN.md`, and `impeccable` when the visible experience matters.

## Safety

- Never paste secrets, raw customer data, payment IDs, vendor exports, or free-text complaint content into docs, issues, PRs, or chat.

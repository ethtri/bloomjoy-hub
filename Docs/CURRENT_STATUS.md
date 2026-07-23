# Current Status

Last compacted: 2026-07-22

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

- Refund Operations PR `#644` merged and the sponsor-authorized safe core deployed on 2026-07-22. Production now includes all 23 required refund migrations, eight reviewed Edge Functions, deterministic Nayax recommendation, the simplified manager card/cash workbench, automation health, Gmail thread linkage, and the human-review-only GPT triage runner. Live Nayax execution, automation schedules, Gmail, and GPT remain disabled; the legacy Google Form/Sheet/AppSheet workflow remains the fallback.
- The merged release is green across 115 disposable-project migrations and 209 database tests, including 54 GPT runner safety assertions, plus deterministic matcher, payment-safety, mocked OpenAI failure-path, full Refund portal browser UAT, Machine Manager UAT, and release/rollback validation. The production route and location smokes pass, all eight deployed source bundles match the reviewed manifest, and the live customer form renders without browser errors on desktop and mobile for both card and cash/Zelle states. The guarded synthetic email smoke was not executed because an owner-controlled test inbox and privately approved machine were not supplied.
- Production has six non-duplicate public options, no internal `Unmapped`/`Unknown` labels, and at least one Atlanta, DC, and Seattle option. The aggregate access audit still finds 25 active Machine Manager assignments across three identities but no clean manager-only identity; existing identities overlap with broader access. Clean-account setup, manager-only production UAT, controlled provider pilots, and the named shadow pilot remain pending.
- Live Nayax execution remains disabled and sponsor-gated. Nayax's public documentation confirms a two-step refund request/approval flow and documents `SiteID` in Last Sales, but Bloomjoy's captured production response omitted that field and the existing token was obtained for reporting. Before one-click execution can leave manual review, `#430` must confirm production endpoint/token write authority, amount and response semantics, idempotency/reconciliation behavior, a production `SiteID` source, and explicit approved-sale evidence (or approved substitutes), then record caps, allowlist, and controlled low-value smoke approval.
- Gmail remains disabled and unconfigured in production. The sponsor designated `info@bloomjoysweets.com` for `#634`, but the currently connected Gmail account is not that mailbox. Designated-mailbox OAuth/authorization, label/filter ownership, secure server-only credentials, retention/quarantine approval, and synthetic smoke evidence remain required. Hosted-form intake and manual case handling remain independent.
- GPT triage remains default-off and human-review-only. The server runner, strict schema, content-free job ledger, and local developer credential destination are implemented; no production OpenAI secret is configured. A new fail-closed server acknowledgement prevents provider execution until `#635` records the exact OpenAI project retention/data-control mode and privacy/security approval; `store=false` is not treated as zero-retention proof. The database structurally prevents automatic sending.
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

# Refund Operations Production Cutover Packet

Last updated: 2026-08-09

## Outcome

Use this packet to move epic `#628` from individually verified PRs to one tested production release. A green PR is necessary but is not deployment, live-payment, Gmail, GPT, or legacy-retirement approval.

## Evidence ledger

| Gate | Required evidence | Authority to close |
|---|---|---|
| `#629` production alignment | Final integrated release manifest, reviewed migration dry run, deployed function parity, redacted intake/email smoke, distinct location mappings, restore source | Release and technical owners |
| `#630` Nayax recommendation | Deterministic fixture suite, documented thresholds/exclusions, sanitized production lookup evidence, manager agreement/disagreement sample | Technical and QA owners |
| `#631` manager workbench | Desktop/mobile/keyboard evidence for every major state plus clean manager completion without coaching | QA owner and pilot manager |
| `#633` cash workflow | Amount cap, sensitive-reference rejection, idempotent completion, customer email ordering, reporting proof | QA and operations owners |
| `#632` automation | One due action, replay suppression, PII-free alert, visible health, and quick disable | Operations and release owners |
| `#430` live Nayax execution | Provider contract, machine allowlist, caps, kill switch, idempotency, success/failure/unknown proof | Executive sponsor and technical owner |
| `#435` clean manager account | Aggregate-only role audit, privately selected manager-only identity, assigned-only visibility, and Admin denial using an account with no broader role | Access owner and QA owner |
| `#634` Gmail | Approved OAuth/mailbox/retention/quarantine policy plus synthetic thread, replay, reply, attachment, revocation evidence | Operations, auth, and privacy/security owners |
| `#635` GPT triage | Secure server-side key destination, sanitized evaluation metrics, strict schema, human-review proof, rollback control | Technical, support, privacy/security, and sponsor owners |
| `#427` shadow pilot | Complete lane evidence, manager friction, timing/decision comparison, defects, and recommendation | Pilot owner and QA owner |
| `#409` legacy cutover | All required evidence above, staffed rollback window, and explicit fallback-retirement decision | Executive sponsor |

## Merge and integrated-verification sequence

1. Freeze unrelated Refund Operations changes for the release window.
2. Review the current integrated release candidate. PR `#644` superseded draft PRs `#636` through `#643`; the narrow `#629/#716` bridge is now the only exception described below.
3. If `main` changed after final verification, sync the release branch with current `main`, resolve overlap, run `npm run refunds:release:write-local`, review and commit any valid manifest update, and rerun the full verification profile.
4. Confirm the reviewed manifest covers all eight approved refund functions and all 26 current required refund/Nayax migrations, including `refund-gmail-sync`, `refund-gpt-triage`, and `202607220001_refund_gpt_triage_runner.sql`.
5. Deploy only an immutable, pushed, independently reviewed release commit. Under the `#629/#716` bridge, use the approved PR `#716` head from its isolated worktree before merge because merging `main` triggers frontend production deployment; do not merge until every commerce release gate passes. This bridge rule supersedes the original `#644` main-only deployment step.
6. After an eventual merge, use the resulting integrated `main` commit for post-deployment evidence and any later deploy. Never deploy from an unreviewed or local-only commit.
7. On that immutable release commit, require:

```bash
npm ci
npm run agent:preflight -- --issue 628
npm run agent:validate-workflow
npm run refunds:validate-release-tooling
npm run refunds:release:check
npm run refunds:validate-nayax-matching
npm run refunds:validate-nayax-execution
npm run refunds:validate-automation
npm run refunds:validate-gmail
npm run refunds:validate-gpt-triage
npm run db:validate-migrations
npm run build
npm test --if-present
npm run lint --if-present
git diff --check
```

8. Review `supabase db push --dry-run`; it must list exactly the expected pending migrations and no surprise.
   The historical 2026-07-22 read-only baseline listed exactly `202607210001` through `202607220001`; the `#629/#716` bridge instead requires its pinned five-migration list below.
9. Capture the production pre-deployment baseline and confirm the approved restore source without including secrets or downloaded bundles in Git.
10. Attach the final commit, manifest ID, aggregate test totals, migration list, and restore-source reference to `#629` and the active release issue/PR. The `#716` release-candidate baseline is 120 migrations and 278 database assertions; reconcile any changed total before proceeding.

If any merge changes an in-scope migration or refund function after the manifest was generated, the manifest is stale and the release must repeat steps 7-10.

### Narrow pre-migration compatibility bridge

For the #629 blocker on PR #716, the normal production drift check cannot become green before schema deployment because the reviewed QR/wallet functions depend on the first three pending migrations. The only approved bridge is the pinned five-migration procedure in `Docs/PRODUCTION_RUNBOOK.md` and `scripts/refunds/refund-production-release.json`.

- Require the standard local manifest check, the exact expected standard production mismatch (five unpaired reviewed sources plus eight version-only differences, and no other failure), and a passing `refunds:release:check-pre-migration` source-download comparison.
- Require the dry run to contain exactly the pinned five migrations in order and a current completed physical backup.
- Apply the five migrations once, require zero pending, then deploy all eight Refund Operations functions in documented order before any commerce deployment.
- Keep Nayax, automation, Gmail, and GPT execution off; run only the no-auth route and aggregate public-options health checks.
- Capture the deployment, update the manifest production metadata, obtain fresh independent review of that manifest-only update, and require the normal production drift check to pass.
- During `#716`, stop after the no-auth route and aggregate public-options checks. The general production-smoke rows that create cases, send emails, exercise providers, or enable automation/Gmail/GPT/Nayax remain out of scope and must not be run.

Any different source, bundle, migration checksum/order, switch state, or health result invalidates the bridge and stops the release.

## Deploy with all optional execution switches off

Deploy the approved migrations, functions, and frontend following `Docs/PRODUCTION_RUNBOOK.md`. During initial smoke testing, and before any separately approved optional-lane pilot:

- Nayax execution enabled: `false`
- Nayax dry run: `true`
- Nayax kill switch: `true`
- Nayax sponsor flag: unset
- Refund automation GitHub switch: `false`
- Refund automation Edge switch: `false`
- Gmail GitHub switch: `false`
- Gmail Edge switch: `false`
- GPT triage GitHub switch: `false`
- GPT triage Edge switch: `false`
- GPT triage database switch: `false`

Check switch values without printing secrets. A code deploy must not silently enable any lane.

## Production smoke order

For the `#629/#716` bridge, use this exact post-deployment order:

1. Run the no-auth route smoke in the next list's step 2.
2. Run the aggregate public-options smoke in the next list's step 3.
3. Capture production metadata, update and independently review the manifest-only change.
4. Verify the standard production drift check passes against that final manifest.
5. Return to the commerce release only after step 4 is green.

Do not use the general list's drift-first ordering for the bridge, because its manifest cannot be paired until after deployment and capture. The general list's steps 4-12 require their own explicit approvals and are not part of the payment-first release; do not create a refund case, send any communication, exercise a provider, or enable an optional lane.

For a normal Refund Operations release with an already paired manifest, use this general order:

1. Verify the production drift check against the final manifest.
2. Run `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; all eight no-auth, no-body `OPTIONS` probes must return their exact safe status and the manual/retry email route must not return `404`.
3. Run `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; require zero internal labels/duplicates and at least one Atlanta, DC, and Seattle option before sharing the form.
4. Run `npm run refunds:smoke-intake-email` first in read-only preflight mode for the privately approved machine, then—with explicit production-email authorization and an owner-controlled test inbox—run its guarded synthetic card submission. Require sanitized PASS rows for the customer acknowledgement and assigned-manager/operations-fallback notification. Submit the separate cash case through the hosted form and verify its acknowledgement; do not reuse the card smoke as cash-correlation evidence.
5. Run the aggregate-only manager readiness command with the exact project ref and approved pilot machine IDs, then use the privately selected eligible account to prove assigned-only queue access and Admin denial.
6. Prove high-confidence, ambiguous, no-match, wallet/manual, failed/unknown, and duplicate card states with live execution still off.
7. Prove cash approve/deny/missing-info/completion and idempotency with a sponsor-approved test payout or a non-paying shadow fixture.
8. Prove one reporting write-through and the negative controls.
9. Enable and test automation only after its manual-run evidence passes; keep the quick-disable sequence ready.
10. Enable Gmail only after `#634` approvals and synthetic thread evidence pass.
11. Start GPT human-review evaluation only after the production Supabase secret destination and the exact OpenAI project retention/data-control mode in `#635` are approved. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists, then set it only for the approved evaluation window. `store=false` is not zero-retention approval, and the local developer key is not production approval.
12. Start live Nayax execution only after the separate `#430` decision. Use the approved low-value case, cohort, allowlist, and caps.

## Rollback and stop order

For an incident, disable the affected optional lane first:

1. live Nayax: activate kill switch and disable execution
2. automation: disable the GitHub schedule, then the Edge switch
3. Gmail: disable the GitHub schedule, then the Edge switch
4. GPT: disable the GitHub schedule, then the Edge switch, then the database setting; Gmail/form-created cases remain available

If the core release must be rolled back, redeploy the approved frontend and function restore source from the release manifest. Use forward-only database repair; do not delete audit evidence or run destructive rollback SQL during incident response. Keep the legacy workflow available until recovery is verified.

## Final sponsor decision

Post this exact decision record in `#409`:

```markdown
## Refund Operations production decision
- Final release commit / manifest ID:
- Core shadow pilot: PASS / FAIL
- Clean manager boundary: PASS / FAIL
- Controlled Nayax execution: APPROVED / NOT APPROVED / NOT RUN
- Automation: ENABLED / DISABLED
- Gmail: ENABLED / DISABLED / DEFERRED
- GPT human-review lane: ENABLED / DISABLED / DEFERRED
- Open P0/P1 defects:
- Rollback owner and staffed window:
- Legacy Google Form/Sheet/AppSheet: KEEP / RETIRE
- Sponsor decision and date:
```

Do not interpret silence, a merged PR, or a successful shadow test as approval to enable live payments or retire the legacy workflow.

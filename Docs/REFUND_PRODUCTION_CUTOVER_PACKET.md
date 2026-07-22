# Refund Operations Production Cutover Packet

Last updated: 2026-07-22

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
2. Review the single integrated release candidate in `#644`. Draft PRs `#636` through `#643` are superseded and must not be merged separately.
3. If `main` changed after the final `#644` verification, sync the branch with current `main`, resolve overlap, run `npm run refunds:release:write-local`, review and commit any valid manifest update, and rerun the full verification profile.
4. Confirm the reviewed manifest covers all eight approved refund functions and all 23 required migrations, including `refund-gmail-sync`, `refund-gpt-triage`, and `202607220001_refund_gpt_triage_runner.sql`.
5. Merge only the approved `#644` head. Do not deploy from a superseded PR, an unreviewed branch head, or a local-only commit.
6. Use the final integrated `main` commit for every deployment and evidence record.
7. On that final commit, require:

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
   The 2026-07-22 read-only baseline lists exactly `202607210001` through `202607220001`.
9. Capture the production pre-deployment baseline and confirm the approved restore source without including secrets or downloaded bundles in Git.
10. Attach the final commit, manifest ID, aggregate test totals, migration list, and restore-source reference to `#629` and `#409`. The release-candidate baseline is 115 migrations and 209 database tests; reconcile any changed total before proceeding.

If any merge changes an in-scope migration or refund function after the manifest was generated, the manifest is stale and the release must repeat steps 7-10.

## Deploy with all optional execution switches off

Deploy the approved migrations, functions, and frontend following `Docs/PRODUCTION_RUNBOOK.md`. During initial smoke testing:

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

1. Verify the production drift check against the final manifest.
2. Run `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; all eight no-auth, no-body `OPTIONS` probes must return their exact safe status and the manual/retry email route must not return `404`.
3. Submit one sanitized hosted-form card case and one cash case; verify acknowledgement and assigned-manager notification.
4. Run the aggregate-only manager readiness command with the exact project ref and approved pilot machine IDs, then use the privately selected eligible account to prove assigned-only queue access and Admin denial.
5. Prove high-confidence, ambiguous, no-match, wallet/manual, failed/unknown, and duplicate card states with live execution still off.
6. Prove cash approve/deny/missing-info/completion and idempotency with a sponsor-approved test payout or a non-paying shadow fixture.
7. Prove one reporting write-through and the negative controls.
8. Enable and test automation only after its manual-run evidence passes; keep the quick-disable sequence ready.
9. Enable Gmail only after `#634` approvals and synthetic thread evidence pass.
10. Start GPT human-review evaluation only after the production Supabase secret destination and the exact OpenAI project retention/data-control mode in `#635` are approved. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists, then set it only for the approved evaluation window. `store=false` is not zero-retention approval, and the local developer key is not production approval.
11. Start live Nayax execution only after the separate `#430` decision. Use the approved low-value case, cohort, allowlist, and caps.

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

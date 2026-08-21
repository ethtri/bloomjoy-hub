# Refund Operations Production Cutover Packet

Last updated: 2026-08-20

## Outcome

Use this packet to move epic `#628` from individually verified PRs to one tested production release. A green PR is necessary but is not deployment, live-payment, Gmail, GPT, or legacy-retirement approval.

**Current operational truth:** the default-off Refund Operations foundation and the pending-approval recovery are deployed at 10 functions / 59 migrations. Nayax support has confirmed the held transaction refunded, so `#427` adds two reviewed provider-free migrations for one structured resolution window and its fail-closed teardown. The one-case Gmail proof passed with exactly one case message and one Gmail outbound, zero unresolved delivery, and all gates restored off. Broad provider execution remains closed.

## Evidence ledger

| Gate | Required evidence | Authority to close |
|---|---|---|
| `#629` production alignment | Final integrated release manifest, reviewed migration dry run, deployed function parity, redacted intake/email smoke, distinct location mappings, restore source | Release and technical owners |
| `#630` Nayax recommendation | Deterministic fixture suite, documented thresholds/exclusions, sanitized production lookup evidence, manager agreement/disagreement sample | Technical and QA owners |
| `#631` manager workbench | Desktop/mobile/keyboard evidence for every major state plus clean manager completion without coaching | QA owner and pilot manager |
| `#633` cash workflow | Amount cap, sensitive-reference rejection, idempotent completion, customer email ordering, reporting proof | QA and operations owners |
| `#632` automation | One due action, replay suppression, PII-free alert, visible health, and quick disable | Operations and release owners |
| `#430` live Nayax execution | Provider contract, machine allowlist, caps, kill switch, idempotency, success/failure/unknown proof | Executive sponsor and technical owner |
| `#767` provider resolution | Audited payment-support resolution for rejected/unknown outcomes, with no blind retry or premature customer message | Payment-support, QA, and release owners |
| `#692` / `#782` human step-up | Owner-only short enrollment window, private personal enrollment/recovery, fresh action-bound TOTP, and negative-path UAT | Owner-operator, auth/security, and QA owners |
| `#435` assigned-scope persona | Aggregate-only role audit, privately selected clean manager-only identity, assigned-only visibility, and Admin denial; this is separate from official-action proof, where an exact current mapped manager may also hold Admin access | Access owner and QA owner |
| `#634` Gmail | Approved OAuth/mailbox/retention/visible-CC and attachment-off pilot policy plus synthetic thread, replay, reply, and revocation evidence | Operations, auth, and privacy/security owners |
| `#768` production drift | Bloomjoy-project-only Edge Functions Read credential, write-denial proof, protected-environment storage, and successful `main` run | Release and security owners |
| `#635` GPT triage | Secure server-side key destination, sanitized evaluation metrics, strict schema, human-review proof, rollback control | Technical, support, privacy/security, and sponsor owners |
| `#427` shadow pilot | Complete lane evidence, manager friction, timing/decision comparison, defects, and recommendation | Pilot owner and QA owner |
| `#409` legacy cutover | All required evidence above, staffed rollback window, and explicit fallback-retirement decision | Executive sponsor |

## Merge and integrated-verification sequence

1. Freeze unrelated Refund Operations changes for the release window.
2. Review the current integrated `main` release and its canonical release metadata; do not treat the historical PR `#760` head as the active deploy source.
3. If `main` changed after final verification, sync the release branch with current `main`, resolve overlap, run `npm run refunds:release:write-local`, review and commit any valid manifest update, and rerun the full verification profile.
4. Confirm the reviewed target manifest covers all ten manifest-tracked Refund Operations functions and all 66 required refund/Nayax migrations, with the immutable exact canonical 51-migration predeployment bridge preserved as historical evidence.
5. Deploy only an immutable, pushed, independently reviewed release commit. Follow the migration-before-function order in `Docs/PRODUCTION_RUNBOOK.md`; never allow the frontend to expose a workflow whose required database and Edge Function foundations are not already present.
6. After merge, use the resulting integrated `main` commit for deployment evidence and any later deploy. Never deploy from an unreviewed or local-only commit.
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

8. Review `supabase db push --dry-run`; it must list exactly the migrations in the reviewed manifest that production does not yet have and no surprise.
9. Capture the production pre-deployment baseline and confirm the approved restore source without including secrets or downloaded bundles in Git.
10. Attach the final commit, manifest ID, aggregate test totals, migration list, and restore-source reference to `#629` and the active release issue/PR. Generate every total from the final tree; do not copy counts from an older release.

If any merge changes an in-scope migration or refund function after the manifest was generated, the manifest is stale and the release must repeat steps 7-10.

### No provisional compatibility bridge

The historical `#629/#716` five-migration bridge does not apply to the current release. The migration-52 release must use its own target manifest plus the exact immutable canonical 51-migration predeployment bridge, reviewed dry run, backup, migration-before-function order, source capture, and post-deployment drift proof. Until `#768` has a project-scoped read-only credential and a successful protected `main` run, execute the production comparison from the owner-controlled authenticated workstation before and after every refund deployment; never put a broad owner PAT in GitHub. Any unexpected migration, source digest, function version, switch state, or health result stops the release.

## Deploy with all optional execution switches off

Deploy the approved migrations, functions, and frontend following `Docs/PRODUCTION_RUNBOOK.md`. During initial smoke testing, and before any separately approved optional-lane pilot:

- Nayax execution enabled: `false`
- Nayax dry run: `true`
- Nayax kill switch: `true`
- Nayax provider contract confirmed: `false`
- Nayax sponsor flag: unset
- Refund automation GitHub switch: `false`
- Refund automation Edge switch: `false`
- Gmail GitHub switch: `false`
- Gmail Edge switch: `false`
- Automatic customer contact Edge and database switches: `false`
- Manager-aging notice Edge switch: `false`
- Gmail retention database policy: armed for the approved 180-day sanitized-copy period; GitHub and Edge runtime switches: `false` (recurring cleanup is dormant)
- GPT triage GitHub switch: `false`
- GPT triage Edge switch: `false`
- GPT triage database switch: `false`

Check switch values without printing secrets. A code deploy must not silently enable any lane.

## Production smoke order

Use this exact post-deployment order:

1. Run `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; all eight no-auth, no-body `OPTIONS` probes must return their exact safe status and the manual/retry email route must not return `404`.
2. Run `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; require zero internal labels/duplicates and at least one Atlanta, DC, and Seattle option before sharing the form.
3. Run the aggregate-only Nayax mapping smoke and manager-readiness audit. Require one non-duplicate mapping and one to three active managers per pilot machine. Admin access alone must never grant official-action authority; a person who is also the exact current mapped manager remains valid only through that mapping. Use the separate clean manager-only persona for assigned-scope visibility UAT.
4. Run `npm run refunds:smoke-intake-email` first in read-only preflight mode for the privately approved machine. Do not create a case or send mail yet.
5. Capture production function metadata, update and independently review the manifest-only change, then require the standard production drift check to pass for all ten functions.
6. With all optional execution switches still off, prove high-confidence, ambiguous, no-match, wallet/manual, failed/unknown, duplicate, completed, and communication-failure manager states using synthetic data.
7. Preserve the completed isolated evidence: one original-thread first-contact acknowledgement, replay/later-reply suppression, private form continuation without a duplicate case, exact sole-manager assignment, and the bounded `#800`/`#810` owner-runner proof of exactly one case-specific message/outbound with the complete manager route and disabled teardown. Do not repeat that one-case proof as a required production-cutover step. Rerun it only under separate explicit authorization through the reviewed owner runner if its evidence becomes stale. The next required Gmail proof is one post-boundary synthetic first-contact after the staffed production-label/legacy-responder no-overlap handoff; this is not approval to process a real customer case or enable broad polling.
8. Prove cash approve/deny/missing-info/completion and idempotency with a sponsor-approved test payout or a non-paying shadow fixture.
9. Prove one reporting write-through and the negative controls.
10. Keep automation off while preserving the completed PII-free alert, exact-key replay, and disabled-lane proofs. In one staffed synthetic-only window, prove one due reminder/escalation, manager-visible healthy state, replay, and teardown before considering scheduling.
11. The case-specific mapped-manager-CC evidence is complete. Enable Gmail only after the production-label/legacy-responder no-overlap cutover proof passes; the legacy responder remains authoritative for normal mail until then.
12. Start GPT human-review evaluation only after the production Supabase secret destination and the exact OpenAI project retention/data-control mode in `#635` are approved. Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists, then set it only for the approved evaluation window. `store=false` is not zero-retention approval, and the local developer key is not production approval.
13. Start live Nayax execution only after the separate `#430` provider-contract decision, `#767` provider-outcome resolution path, private owner TOTP enrollment/UAT, and a controlled low-value test. Use the approved cohort, allowlist, per-refund cap, and UTC daily count/amount caps.

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

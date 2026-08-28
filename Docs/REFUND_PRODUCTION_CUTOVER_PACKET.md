# Refund Operations v1 Production Cutover Packet

> **Historical cutover record.** The 2026-08-27 operating decision in `Docs/DECISIONS.md` supersedes this packet anywhere it requires a controlled non-customer canary, staffed pilot, cohort, recruited UAT, first-ten review, or repeated approval ceremony. Current activation uses an eligible unresolved customer refund of $10 or less and follows `Docs/PRODUCTION_RUNBOOK.md` plus issues `#628`, `#990`, and `#427`.

Last updated: 2026-08-24

## Outcome

Use this packet to move epic `#628` from the fully integrated release on `main` to a simple, monitored production pilot. A green PR is necessary but is not production deployment, customer-contact activation, live-payment approval, schedule enablement, or legacy-responder retirement.

**Historical release snapshot:** the reviewed repository target covered all ten manifest-tracked Refund Operations functions and all 92 required refund/Nayax migrations at the time of this packet. Its implementation inventory remains useful evidence, but its final sentence and later ceremony gates are superseded by the 2026-08-27 decision above.

## Pilot scope boundary

Refund Operations v1 uses the existing customer-service email and text-response population, the Bloomjoy hosted refund form, the existing Gmail assistant, the normal signed-in mapped-manager session, and the existing Nayax refund path.

- Customer contact alone creates zero cases. A Bloomjoy form submission creates exactly one case.
- A verified reply supplies missing facts to the same case and reruns matching only when material facts change.
- The manager confirms the transaction separately from approving or denying the refund.
- Every active Nayax machine is **Published**, **Needs setup**, or **Explicitly excluded**. Snapcase is in scope.
- Customer messages are warm and branded. A denial supports a reply appeal that reopens the same case without payment authority.
- Duplicate case, message, provider-attempt, reporting, and payment protections remain mandatory.
- Refund-specific TOTP/operator ceremony, GPT, QR rollout, Kexiazhan reporting, cash fallback, and a new SMS platform are not pilot requirements.

## Evidence ledger

| Gate | Required evidence | Authority to close |
|---|---|---|
| Integrated release | Immutable `main` commit, 10-function/89-migration manifest, full verification, reviewed migration dry run, restore source, and clean postdeploy drift | Release and technical owners |
| `#889` form-only intake | Contact-only zero cases, one Email-linked form case, one direct Website form case, one-time context/replay proof, missing-information reply on the same case, and matching rerun | QA and operations owners |
| `#890` complete Nayax inventory | One controlled all-account sync; every active row explicitly published, needs setup, or excluded; zero unaccounted rows; setup rows have a specific customer-safe reason and cannot appear as mapped; cotton-candy and Snapcase mappings | Operations, release, and QA owners |
| `#891` messages and appeals | Warm branded first contact, missing-information, denial, appeal receipt, retry, and confirmed completion in the original thread; reply appeal reopens the same case without payment | QA and operations owners |
| `#703` duplicate protection | Source replay, concurrency, cross-source possible-duplicate review, canonical-case action blocking, and zero duplicate message/provider/reporting effects | Technical and QA owners |
| `#706` unified queue | Email/Website source labels and the same state/next-action behavior at desktop and mobile widths without changing manager visibility | QA and pilot manager |
| Mapped-manager refund path | Exact machine manager, selected transaction and amount, separate confirmation and approve/deny, caps, idempotency, success/failure/unknown handling, and no blind retry | Executive sponsor and technical owner |
| `#427` monitored pilot | Controlled cotton-candy and Snapcase journeys, no-overlap responder cutover, staffed rollback, stop conditions, 72-hour observations, and final recommendation | Executive sponsor, pilot owner, and QA owner |

## Current predeployment evidence

The owner-authenticated read-only checks on 2026-08-21, combined with the current reviewed local target, produce this sanitized release view:

- Target local release alignment: ten manifest-tracked functions and 90 required refund/Nayax migrations.
- Production baseline: ten deployed refund functions captured to a gitignored artifact.
- Production drift: seven changed repository functions are not yet paired with production, so the release correctly remains undeployed.
- The integrated set includes `20260821090000_refund_form_only_case_creation.sql`, `20260821091000_refund_nayax_inventory.sql`, `20260821100000_refund_branded_appeals.sql`, `20260822190000_refund_portfolio_intake_inventory_correction.sql`, the later portfolio mapping/selection repairs, and `20260823221537_refund_nc_manual_nayax_portal.sql`. Before this change is deployed, `supabase db push --dry-run --linked` must show the exact reviewed pending set, including `20260824160609_refund_confirmation_readiness.sql` and `20260824190000_refund_machine_truthful_readiness.sql`, and no unrelated migration. A dry run must make no database write.

This evidence expires if `main`, any listed migration, or any manifest-tracked function changes before deployment.

## Integrated release verification

1. Freeze unrelated Refund Operations changes for the release window.
2. Use the current integrated `main` commit as the only deploy source. Never deploy a historical PR head, local-only commit, or unreviewed merge.
3. If `main` changes, refresh the manifest with `npm run refunds:release:write-local`, review and commit the manifest-only update, and rerun this entire verification profile.
4. Confirm the manifest covers all ten manifest-tracked Refund Operations functions and all 90 required refund/Nayax migrations, with the exact canonical 51-migration predeployment bridge preserved only as historical restore evidence.
5. Run on the immutable release commit:

```bash
npm ci
npm run agent:preflight -- --issue 628
npm run agent:validate-workflow
npm run refunds:validate-release-tooling
npm run refunds:release:check
npm run refunds:validate-email-pilot
npm run refunds:validate-nayax-inventory
npm run refunds:validate-public-options-smoke
npm run refunds:validate-machine-readiness-audit
npm run refunds:validate-branded-appeals
npm run refunds:validate-nayax-matching
npm run refunds:validate-nayax-execution
npm run refunds:validate-gmail
npm run refunds:validate-uat-evidence
npm run db:validate-migrations
npm run build
npm test --if-present
npm run lint --if-present
git diff --check
```

6. Review `supabase db push --dry-run`. It must list exactly the target-manifest migrations production lacks and no surprise.
7. Capture the production predeployment baseline and confirm the approved restore source without committing secrets or downloaded bundles.
8. Attach the immutable commit, manifest ID, generated test totals, migration delta, and restore-source reference to `#427` and `#628`.

If any merge changes an in-scope migration or Refund Operations function after the manifest was generated, the manifest is stale and steps 3-8 must be repeated.

### No provisional compatibility bridge

The historical `#629/#716` five-migration bridge does not apply. The 75-migration target uses its reviewed manifest plus the exact canonical 51-migration predeployment bridge only for historical compatibility evidence. Any unexpected migration, source digest, function-version regression, switch state, or health result stops the release. A higher live function counter is acceptable only when the approved bundle/source/security pairing remains exact; the receipt identifies that condition as a same-bundle later revision.

## Default-off production deployment

Production deployment requires explicit owner authority. Deploy migrations before functions and the frontend from the same immutable `main` release. Deployment authority does not authorize customer contact, a provider call, legacy-responder retirement, or schedule enablement.

Keep these controls closed throughout deployment and initial smoke testing:

- Nayax execution enabled: `false`
- Nayax dry run: `true`
- Nayax kill switch: `true`
- Nayax provider contract confirmed: `false`
- Refund Nayax inventory schedule: disabled
- Refund Nayax inventory Edge switch: `false`
- Refund automation schedule and Edge switch: `false`
- Gmail schedule and shared Edge switch: `false`
- First-contact mode: `disabled`
- Legacy-responder cutover approval: `false`
- Automatic customer contact and appeal acknowledgement: disabled
- Manager-aging notices: disabled
- Unrelated optional GPT lane: disabled; it is not a pilot gate

Check switch values without printing secrets. A deploy must not silently enable any lane.

## Exact postdeployment readiness order

1. Run `npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; every no-auth, no-body `OPTIONS` probe must return its exact safe status.
2. Capture and independently review the timestamped production function receipt. Update the manifest through a reviewed manifest-only change only for a `new_bundle_candidate`; retain the sealed manifest for a `same_bundle_later_revision`. Then require the standard production drift check to pass for all ten functions.
3. Run one controlled inventory sync with the schedule still disabled. Confirm the run is complete and nonempty before accepting any inventory result.
4. Reconcile every active Nayax row. Each must be **Published**, **Needs setup**, or **Explicitly excluded**. Do not launch with an unaccounted row, a stale published row, or a setup row exposed as mapped. Confirm every published cotton-candy/Snapcase machine has an exact identity, customer-safe label, active location, and one to four current managers.
5. Run `npm run refunds:smoke-public-options -- --project-ref <project-ref> --confirm-project-ref <project-ref>`; require zero internal labels, duplicate public options, or unaccounted active machines. For this reviewed inventory, require exactly 33 Published, 2 Needs setup, 4 Excluded, 46 public choices, and 33 lookup-ready mappings.
6. Run the aggregate mapped-manager readiness audit. Admin access alone never grants refund authority; authority comes from the exact current machine mapping.
7. Run the aggregate machine/Tulsa/confirmed-case audit from `Docs/REFUND_SIMPLE_JOURNEY_RELEASE_RUNBOOK.md`. Before activation, record every ready-to-activate/setup/exception count. After reviewed activation, require zero unactivated eligible, unexplained-disabled, over-cap, Tulsa-unexplained, or confirmed-case-unknown rows.
8. Run `npm run refunds:smoke-intake-email` in read-only preflight mode for the privately approved test machine and inbox. Do not create a case or send mail yet.
9. With every external-action switch still off, prove the complete synthetic state set and the desktop/mobile manager journey from the final release evidence manifest.
10. Under the separately approved staffed UAT window, prove these controlled journeys in order:
   - one customer contact produces zero cases and one warm Bloomjoy form response;
   - the Email-linked form creates exactly one Email case and direct submission creates exactly one Website case;
   - missing information and no-safe-match replies update the same case and rerun matching only on changed facts;
   - replay, refresh, concurrent submission, and cross-source duplicate review cannot create a competing actionable case, second message, or second provider attempt;
   - a mapped manager confirms the exact transaction, then separately approves or denies;
   - one cotton-candy and one Snapcase case preserve the exact amount, transaction, reporting, and provider-result boundaries;
   - confirmed success records one reporting adjustment and sends one branded completion; denial sends one customer-safe reason; a reply appeal reopens the same case and cannot pay.
11. Cut over responders without overlap: disable and verify the legacy Google Form response first, reconcile transition-interval mail, then enable the Bloomjoy response population. Rollback disables and verifies Bloomjoy before restoring the legacy response.
12. Enable only the explicitly approved schedules during a staffed window. Monitor for 72 hours and stop on any missing active machine, wrong transaction or amount, duplicate case/message/provider attempt/reporting adjustment, unexplained provider result, delivery uncertainty, or responder overlap.

## Rollback and stop order

1. Stop new customer work: disable the Bloomjoy responder and Gmail/automation schedules, then verify they are off.
2. Stop payment execution: enable the Nayax kill switch and disable execution. Never retry an uncertain provider result.
3. Stop inventory scheduling while retaining the last complete inventory and all reconciliation/audit records.
4. Restore the legacy responder only after Bloomjoy is verified off for the same population.
5. Redeploy only the approved function/frontend restore source. Use forward-only database repair; never delete audit evidence or run destructive rollback SQL during an incident.

## Executive decisions

Two separate decisions are required:

1. **Default-off deployment authority:** permits the reviewed dry run, baseline, migration-before-function deploy, drift proof, controlled inventory sync, reconciliation, and read-only/synthetic smoke. It does not permit customer contact or payment.
2. **Pilot activation go/no-go:** after default-off readiness passes, permits only the named staffed customer-contact population, cotton-candy/Snapcase UAT, provider caps, responder cutover, schedules, and 72-hour monitor recorded below.

Post this decision record in `#427`:

```markdown
## Refund Operations v1 production decision
- Final release commit / manifest ID:
- Default-off deployment and production drift: PASS / FAIL / NOT RUN
- Active Nayax inventory: total / published / explicitly excluded / needs setup / unaccounted
- Cotton-candy and Snapcase readiness: PASS / FAIL / NOT RUN
- Contact-zero-case and form-one-case journeys: PASS / FAIL / NOT RUN
- Missing-information reply and matching rerun: PASS / FAIL / NOT RUN
- Duplicate replay and cross-source review: PASS / FAIL / NOT RUN
- Separate transaction confirmation and approve/deny: PASS / FAIL / NOT RUN
- Branded completion, denial, and same-case appeal: PASS / FAIL / NOT RUN
- Bloomjoy responder / legacy responder: OFF-OFF / ON-OFF / OFF-ON / INVALID OVERLAP
- Live Nayax execution: APPROVED / NOT APPROVED / NOT RUN
- Staffed rollback owner and 72-hour window:
- Open P0/P1 defects:
- Sponsor decision and date:
```

Do not interpret silence, a merge, a deployment, a synthetic test, or inventory reconciliation as approval to contact customers, issue a live refund, overlap responders, or retire the fallback.

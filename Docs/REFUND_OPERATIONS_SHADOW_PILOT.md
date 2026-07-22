# Refund Operations Shadow Pilot Runbook

Last updated: 2026-07-21

## Purpose

Prove the Refund Operations workflow in a narrow production shadow pilot before Bloomjoy enables live Nayax execution or retires the Google Form, Google Sheet, and AppSheet fallback.

Epic `#628` owns the production-ready outcome. Issue `#427` owns the pilot evidence, issue `#409` owns the final cutover decision, and `Docs/MACHINE_MANAGER_SHADOW_UAT_SCRIPT.md` is the manager-facing test script.

## Non-negotiable rules

- Keep the legacy Google Form/Sheet/AppSheet workflow live until the sponsor explicitly approves retirement in `#409`.
- Use a clean Machine Manager-only account from `#435`. Broader scoped-admin or super-admin access is not valid evidence for the manager boundary.
- Keep live Nayax execution fail-closed until the provider contract and sponsor gate in `#430` are approved. Shadow mode may exercise the complete UI and a blocked execution response without making a live provider call.
- The manager, not GPT or the matching score, makes the final decision.
- Gmail and GPT are separate human-reviewed pilot lanes. Keep both Gmail enable switches off until `#634` approvals pass, and send no GPT draft without human approval during the pilot.
- Do not place customer names, email addresses, phone numbers, card digits, payout contacts, complaint text, raw provider identifiers/payloads, Gmail content, or secrets in GitHub, screenshots, logs, or this packet.
- Demo mode proves layout only. It does not prove persistence, permissions, provider behavior, email delivery, automation, or reporting write-through.

## Release gates before the pilot

### Integrated release

- [ ] Merge the approved PR train in dependency order, starting with production alignment `#636`, then `#637` through `#641`.
- [ ] After each merge, sync the next branch with current `main` and rerun its full verification profile.
- [ ] On the final integrated `main` commit, regenerate and review the Refund Operations release manifest. It must include every in-scope migration and the final transitive source digest for each approved refund function.
- [ ] Run the repository verification suite, migration validation, release-tooling checks, and the relevant refund validators on that same final commit.
- [ ] Confirm production migrations and Edge Functions match the final reviewed release; a sanitized dry run must show no unexpected migration.
- [ ] Confirm Bubble Planet and every other pilot option has a distinct customer-facing label and an unambiguous canonical machine/location mapping.
- [ ] Capture a restore source and dry-run the documented rollback path before changing production.

### Safety and access

- [ ] `#430` records the approved Nayax provider fields and semantics for a stable machine/site identity and a confirmed successful sale, or explicitly approves a safe substitute contract.
- [ ] The global kill switch, execution-enabled flag, dry-run flag, sponsor flag, caps, machine allowlist, and idempotency controls are checked by name and expected state without printing values.
- [ ] A clean authenticated manager from `#435` sees only assigned machines/cases and cannot reach Admin setup, unrelated cases, provider secrets, or raw payloads.
- [ ] The selected machines and named managers are recorded in `#427`; broader fleet access remains off.
- [ ] Google Form/Sheet/AppSheet fallback ownership and the same-day stop/go contact are named in `#409`.

### Communications and automation

- [ ] Customer acknowledgement, missing-information, approval, denial, completion, and retry paths pass with synthetic evidence.
- [ ] Manager notification reaches the assigned managers and operations fallback without customer PII in logs.
- [ ] Automation is deployed with both controls off, then proves one synthetic action, duplicate suppression, PII-free failure alerting, visible health, and quick disable before scheduled enablement.
- [ ] Gmail retention, attachment quarantine, OAuth scope, mailbox ownership, and security review are approved before either Gmail switch is enabled.
- [ ] GPT evaluation uses only the approved schema and sanitized test set; it cannot match a transaction, decide a refund, send mail, or execute payment.

## Proposed pilot cohort

The previously reviewed six-machine cohort is a proposal, not standing approval:

- Bubble Planet - Atlanta
- Bubble Planet DC
- Bubble Planet Seattle
- Merlin Chicago
- Merlin Dallas / Grapevine Mills
- Merlin Minneapolis / Mall of America

Before the pilot starts, the sponsor must confirm the exact machines, the named manager for each machine, fallback ownership, and the stop/go contact. Do not add PREIT, Snapcase, or the broader fleet by inference.

## Minimum evidence set

This is a release-safety sample, not a statistical accuracy claim.

| Lane | Minimum proof | Pass condition |
|---|---|---|
| Ordinary card | Five high-confidence cases across at least two approved locations | Intended sale ranks first; manager agrees or records a structured disagreement; one primary action is shown; no manual status editing is required |
| Card safety | One each for ambiguous, no-safe-match, wallet/manual, provider anomaly, duplicate/already-refunded, and provider-outcome-unknown | No unsafe case exposes an enabled refund action or sends a completion email |
| Controlled Nayax execution | One approved low-value test only after `#430` sponsor approval | Exactly one provider attempt; provider-confirmed success precedes completion and customer email; retry/double-click creates no second attempt |
| Cash/manual payout | Two matched cases plus one missing-information or denied case | One primary next action; amount cannot exceed recorded payment; non-sensitive reference only; double-submit creates no duplicate event/email/adjustment |
| Customer email | Acknowledgement, more-info, approval/denial, completion, and one simulated failure/retry | Correct thread/reference, empathetic copy, no premature success message, and no duplicate send |
| Automation | One due action, replay of the same window, one forced failure, and quick disable | One action only, duplicate suppressed, PII-free alert delivered, and core manual workflow remains available when disabled |
| Access | Clean manager-only account plus super-admin comparison | Manager sees assigned scope only; super-admin sees authorized global scope; Admin controls remain hidden from the manager |
| Reporting | One completed correlated case plus denied/waiting/duplicate controls | Exactly one safe adjustment for the completed case and none for the controls |
| Gmail | One labeled synthetic thread, replay, customer reply, approved reply, attachment controls, and revoked authorization | One linked case/thread; unrelated mail untouched; no duplicate; safe health failure; form cases still work |
| GPT | Approved sanitized evaluation set from `#635` | No unsafe action; strict schema only; sensitive/uncertain cases route to a person; every outbound draft is reviewed |

## Manager-experience measurements

Record these in aggregate only:

- time from opening a normal card case to a final manager decision
- number of manager decisions/clicks on the normal card path
- whether the recommended transaction was accepted
- structured reason when it was not accepted
- match state and sanitized factor labels
- email sent, failed, uncertain, or retried
- whether the manager needed PM/backchannel help
- manager feedback on what was slower or clearer than the legacy process

The core experience passes only when a manager who did not build the feature completes three consecutive ordinary cases without coaching and with fewer manual decisions than the legacy workflow.

## Stop conditions

Pause the affected lane immediately if any of these occur:

- an unauthorized machine, case, Admin control, or inbox thread is visible
- customer PII, card data, payout details, raw Gmail content, raw Nayax identifiers/payloads, or secrets appear in evidence or logs
- an ambiguous/manual/duplicate/failed case becomes one-click eligible
- a customer completion email sends before confirmed payment success
- a duplicate provider attempt, customer message, audit event, or reporting adjustment is created
- a cash payout can exceed the recorded customer payment or store account/routing/card-like data
- an unknown provider outcome is presented as success or encourages an immediate retry
- a manager cannot finish the workflow without PM/manual backchannel help
- the legacy fallback becomes unavailable before cutover approval

Use the relevant quick-disable control first, preserve sanitized audit evidence, and open a P0 issue for any payment, access, privacy, or duplicate-settlement failure.

## Go/no-go sequence

1. **Core shadow pilot:** form intake, matching, manager workbench, cash workflow, email, automation health, permissions, and reporting. Nayax execution stays off.
2. **Controlled Nayax execution:** starts only after `#430` records the provider contract, caps, allowlist, kill-switch proof, and sponsor approval.
3. **Gmail/GPT lane:** starts only after `#634` data/OAuth approvals and a secure server-side OpenAI key destination for `#635`. All drafts remain human-reviewed.
4. **Cutover:** `#409` receives the complete packet and explicit sponsor approval. Only then may the legacy workflow be retired; rollback and a staffed support window must remain ready.

## Evidence template

Post one sanitized checkpoint in `#427` for each lane and one final summary in `#409`.

```markdown
## Refund pilot checkpoint
- Date/time and environment:
- Release commit / manifest ID:
- Lane and scenarios:
- Approved machines/managers covered (aggregate only):
- Sample count:
- Result: PASS / PARTIAL / FAIL
- Timing and interaction summary:
- Safety/duplicate summary:
- Manager feedback summary:
- Defects opened:
- Stop condition triggered: yes/no
- Go/no-go impact:
```

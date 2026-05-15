# Refund Operations Shadow Pilot Runbook

Last updated: 2026-05-12

## Purpose
Run the merged Refund Operations MVP through production rollout readiness checks and a selected Commercial/Mini shadow pilot before cutting over from the Google Form/AppSheet fallback.

This runbook is the PM/PO control artifact for issues `#402`-`#409`.
Use `Docs/MACHINE_MANAGER_SHADOW_UAT_SCRIPT.md` for the manager-facing shadow pilot script.
Use `Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md` for PR `#432` production setup and merge-readiness gates.

## Operating Rules
- Codex acts as Bloomjoy PM/PO using the `bloomjoy-sprint-orchestrator` workflow.
- No human planning session is required. Use this runbook, PR comments, issue comments, and owner go/no-go checkpoints.
- Executive sponsor review is proof review, not first-pass UAT. Agents must validate seeded functional UAT or post-production shadow-mode flows and produce a pass/fail evidence packet before asking the sponsor to touch the feature.
- Pilot scope is selected authenticated Machine Managers assigned to configured Bloomjoy Commercial/Mini pilot machines, still in shadow mode. Broader manager-wide rollout follows only after this selected pilot produces clean evidence.
- Keep the Google Form/AppSheet process live until cutover criteria pass.
- PR `#410` is merged. Merge is not cutover; production rollout, manager feedback, customer communication review, and shadow-pilot results remain cutover gates.
- Do not paste secrets, customer PII, raw refund exports, card digits, raw Nayax payloads, or complaint free text into docs, issues, PRs, screenshots, or chat.
- Nayax refund execution remains fail-closed until the separate full-automation gates pass; managers continue manual card refunds in Nayax and manual cash/Zelle handling during shadow mode.

## Lane Checklist
Use one GitHub issue or PR comment per checkpoint. Defects become PR-sized GitHub issues under epic `#402`.

### PM/PO Control Lane
- [x] Confirm PR `#410` merged with green GitHub CI, Vercel, and Supabase migration checks.
- [x] Confirm issues `#402`-`#409` have current PM status comments through the merge checkpoint.
- [ ] Track one go/no-go summary covering Nayax lookup, manager access, customer communications, reporting write-through, and shadow-pilot results.
- [ ] Confirm Google Form/AppSheet fallback remains live during pilot.
- [ ] Run `npm run refunds:validate-portal-uat -- --app-url <local-or-preview-url>` before manager shadow UAT when the app is reachable.
- [ ] Confirm demo mode is labeled `DEMO DATA - visual review only` and is never used as evidence that saves, access boundaries, Nayax lookup, or reporting write-through work.
- [ ] Prepare an executive proof packet only after agent QA has passed or documented blockers.
- [ ] Confirm production migrations, Edge Functions, and server-only secret names are deployed through the production runbook before public QR/direct-link promotion.

### Nayax Validation Lane
- [ ] Verify target environment has server-only `NAYAX_LYNX_BASE_URL=https://lynx.nayax.com/operational/v1`.
- [ ] Verify target environment has server-only `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` or fallback `NAYAX_LYNX_API_TOKEN` by name only, never by value.
- [ ] Confirm refund-ready machines are mapped to server-side Nayax machine IDs before managers use `/portal/refunds` for card lookup.
- [ ] Validate at least one real card case against `GET /machines/{MachineID}/lastSales`.
- [ ] Confirm manager workbench and automation sweep use the approved +/- 6 hour Nayax lookup window and only expose tokenized candidate evidence.
- [ ] Validate Apple Pay/wallet last-four mismatch behavior with real or owner-approved test evidence.
- [ ] Confirm lookup responses show only sanitized candidate evidence in Bloomjoy Hub.

### Manager Workflow Lane
- [ ] Enable selected authenticated Machine Managers through assigned-machine access for configured Commercial/Mini pilot machines.
- [ ] Confirm each manager sees only assigned-machine cases.
- [ ] Confirm super-admins see all refund cases.
- [ ] Validate approve, deny, waiting-on-customer, card-refund-pending, cash/Zelle-pending, and completed states.
- [ ] Validate the guided manager workbench sections: case summary, suggested transaction match, next action, customer message, refund completion/reference, and collapsed timeline/history.
- [ ] Capture manager friction as GitHub issues, not private notes.

### Customer Communication Lane
- [ ] Review confirmation email tone.
- [ ] Review more-info email tone.
- [ ] Confirm approval, denial, completion, reminder, and escalation automation sends only after agent QA validates message rows and redacted logs.
- [ ] Review denial decision reasons before managers send manual replies.
- [ ] Confirm automated messages and manual-reply reasons are empathetic, clear, and do not overpromise timing or approval.
- [ ] Confirm portal-sent customer messages use editable Bloomjoy-approved templates, include the case reference, and reply to `info@bloomjoysweets.com` during pilot.

### Full Automation Lane
- [ ] Confirm `refund-case-admin-update` wraps manager updates and logs customer messages.
- [ ] Confirm `refund-case-automation-sweep` sends reminders/escalations with redacted evidence only.
- [ ] Confirm `nayax-card-refund` fails closed with default env and records only sanitized attempt metadata.
- [ ] Confirm cross-workflow duplicate fingerprints block likely duplicate settlement write-through between hosted cases and Google/AppSheet rows.
- [ ] Do not enable live Nayax refund execution until sponsor go/no-go, provider-contract validation, amount caps, per-machine allowlist, and kill-switch tests pass.

### Reporting And Settlement Lane
- [ ] Confirm only manager-approved, fully correlated, completed cases write through with `source='refund_case'`.
- [ ] Confirm denied, waiting-on-customer, uncorrelated, and review-only cases do not write settlement adjustments.
- [ ] Confirm partner-facing reporting excludes customer PII, card digits, raw complaint text, and raw Nayax payloads.

## Required UAT Scenarios
- [ ] Card exact match.
- [ ] Apple Pay/wallet last-four mismatch.
- [ ] Cash single match.
- [ ] No match sends more-info workflow.
- [ ] Multiple candidates require manager decision.
- [ ] Denied request.
- [ ] Approved manual card refund.
- [ ] Approved Zelle refund.
- [ ] Photo upload.
- [ ] Manager access boundary.
- [ ] Super-admin access.
- [ ] Reporting write-through.
- [ ] Automated approval/denial/completion customer messages.
- [ ] Reminder/escalation sweep.
- [ ] Nayax execution preflight blocked by default flags.
- [ ] Legacy Google/AppSheet duplicate reconciliation.

## Merged PR `#410` Evidence
PR `#410` merged on 2026-05-12 after these gates passed:
- GitHub CI, Vercel, and Supabase migration checks were green.
- A real Nayax Edge lookup succeeded for a mapped UAT machine with sanitized evidence only.
- Assigned-machine access boundaries and max-3 Machine Manager enforcement were validated with synthetic authenticated users.
- Customer communication copy was approved for MVP scope.
- Reporting write-through was validated with no private data leakage.

## Cutover Gate
Cut over from the Google Form/AppSheet fallback only when all are true:
- Shadow-mode cases complete end to end with fewer manual steps than the old process.
- Managers can process cases without PM intervention.
- Nayax lookup is reliable enough for ordinary card correlation.
- Google Form/AppSheet remains available as fallback until pilot evidence is clean.

## Evidence Template
Use this template in issue `#409` or follow-up issues after each checkpoint.

```markdown
## Refund shadow pilot checkpoint
- Date:
- Lane:
- Environment:
- Machines/managers covered:
- Scenarios tested:
- Result: PASS / PARTIAL / BLOCKED
- Evidence summary:
- Defects opened:
- Go/no-go impact:
```

# Refund Operations Shadow Pilot Runbook

Last updated: 2026-05-11

## Purpose
Run the Refund Operations MVP through AI-orchestrated UAT and a manager-wide shadow pilot before merging PR `#410` or cutting over from the Google Form/AppSheet fallback.

This runbook is the PM/PO control artifact for issues `#402`-`#409`.

## Operating Rules
- Codex acts as Bloomjoy PM/PO using the `bloomjoy-sprint-orchestrator` workflow.
- No human planning session is required. Use this runbook, PR comments, issue comments, and owner go/no-go checkpoints.
- Pilot scope is all current authenticated refund managers, still in shadow mode.
- Keep the Google Form/AppSheet process live until cutover criteria pass.
- Keep PR `#410` draft until live UAT, Nayax matching validation, manager feedback, customer communication review, and reporting guardrails pass.
- Do not paste secrets, customer PII, raw refund exports, card digits, raw Nayax payloads, or complaint free text into docs, issues, PRs, screenshots, or chat.
- Nayax refund execution remains out of MVP; managers continue manual card refunds in Nayax and manual cash/Zelle handling.

## Lane Checklist
Use one GitHub issue or PR comment per checkpoint. Defects become PR-sized GitHub issues under epic `#402`.

### PM/PO Control Lane
- [ ] Confirm PR `#410` is draft, merge-clean, and has green GitHub CI, Vercel, and Supabase migration checks.
- [ ] Confirm issues `#402`-`#409` have current PM status comments.
- [ ] Track one go/no-go summary covering Nayax lookup, manager access, customer communications, reporting write-through, and shadow-pilot results.
- [ ] Confirm Google Form/AppSheet fallback remains live during pilot.

### Nayax Validation Lane
- [ ] Verify target environment has server-only `NAYAX_LYNX_BASE_URL=https://lynx.nayax.com/operational/v1`.
- [ ] Verify target environment has server-only `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB` or fallback `NAYAX_LYNX_API_TOKEN` by name only, never by value.
- [ ] Confirm refund-ready machines are mapped to server-side Nayax machine IDs before managers use `/portal/refunds` for card lookup.
- [ ] Validate at least one real card case against `GET /machines/{MachineID}/lastSales`.
- [ ] Validate Apple Pay/wallet last-four mismatch behavior with real or owner-approved test evidence.
- [ ] Confirm lookup responses show only sanitized candidate evidence in Bloomjoy Hub.

### Manager Workflow Lane
- [ ] Enable all current authenticated refund managers through assigned-machine access.
- [ ] Confirm each manager sees only assigned-machine cases.
- [ ] Confirm super-admins see all refund cases.
- [ ] Validate approve, deny, waiting-on-customer, card-refund-pending, cash/Zelle-pending, and completed states.
- [ ] Capture manager friction as GitHub issues, not private notes.

### Customer Communication Lane
- [ ] Review confirmation email tone.
- [ ] Review more-info email tone.
- [ ] Confirm approval and completion replies remain manual in MVP until a later email-automation phase.
- [ ] Review denial decision reasons before managers send manual replies.
- [ ] Confirm automated messages and manual-reply reasons are empathetic, clear, and do not overpromise timing or approval.

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

## Merge Gate For PR `#410`
Merge only when all are true:
- GitHub CI, Vercel, and Supabase migration checks are green.
- At least one real Nayax card lookup succeeds for mapped machines.
- Manager-wide access boundaries are validated.
- Customer communication copy is approved.
- Reporting write-through is validated with no private data leakage.

## Cutover Gate
Cut over from the Google Form/AppSheet fallback only when all are true:
- Shadow-mode cases complete end to end with fewer manual steps than the old process.
- Managers can process cases without PM intervention.
- Nayax lookup is reliable enough for ordinary card correlation.
- Google Form/AppSheet remains available as fallback until pilot evidence is clean.

## Evidence Template
Use this template in PR `#410` and issue `#409` after each checkpoint.

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

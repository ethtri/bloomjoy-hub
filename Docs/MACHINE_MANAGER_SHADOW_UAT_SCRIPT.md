# Machine Manager Shadow UAT Script

Last updated: 2026-08-03

## Purpose

Use this script with a current Machine Manager mapped to every selected pilot machine to prove that Refund Operations is simple and safe before cutover. A separately tested clean Machine Manager-only persona remains useful for proving assigned-scope visibility, but it is not required for official-action authority: an exact current mapping remains authoritative when the operator also has separate Admin access. Keep the Google Form/Sheet/AppSheet fallback live throughout UAT.

This is a manager-experience test, not an Admin setup test. Use synthetic or sponsor-approved pilot cases and record sanitized aggregate evidence only.

## Before the session

- Run the aggregate-only account audit against the exact linked production project. It prints and writes no names, emails, user IDs, machine IDs, or case data:

  ```bash
  npm run refunds:manager-uat-readiness -- --project-ref <project-ref> --confirm-project-ref <project-ref>
  ```

- If the owner has selected the pilot cohort, repeat `--pilot-machine-id <uuid>` for each approved machine. The stricter result must report at least one exact-pilot eligible identity; otherwise account or assignment setup is still required.
- For the separate assigned-scope visibility check, confirm the privately selected clean persona has Machine Manager assignments only and no scoped-admin, super-admin, corporate-partner, or unrelated access; record aggregate counts only in `#435`. The official-action tester is a distinct role in this matrix: that person must have an exact current mapping to every selected pilot machine and may also hold separate Admin access, which neither grants nor revokes refund authority.
- Confirm the selected machines and manager are approved in `#427`.
- Confirm the tested release commit and Refund Operations release manifest match the deployed environment.
- Confirm live Nayax execution state:
  - **Current candidate/shadow mode:** the production adapter is statically disabled before attempt reservation or provider access. Keep execution disabled, dry run on, kill switch on, provider-contract confirmation false, and sponsor flag unset; these historical controls are defense in depth and cannot activate a live call.
  - **Future controlled execution:** only after `#430` adds and reviews the real adapter and account contract, the controlled low-value smoke/caps/allowlist are approved, and a separate owner-approved gate-on change passes.
- Confirm the official-action database gate is still statically false for current shadow UAT. Any later official-action UAT requires the current active mapped Machine Manager to use the owner-approved personal account and personally complete the fresh action-bound TOTP step-up. Admin access alone, an unrelated manager, agent, shared session, email, scheduler, or GPT identity is invalid evidence; separate Super Admin or Scoped Admin access neither grants nor revokes an exact current machine mapping.
- Confirm customer-email and automation tests use synthetic addresses unless the sponsor approved a real pilot case.
- Do not capture customer names, contact details, card digits, payout contacts, complaint text, raw provider identifiers/payloads, Gmail content, or secrets in screenshots or notes.
- Do not use `?demo=on` as functional evidence. Demo mode is for visual review only.

## A. Access boundary

1. Sign in with the owner-approved current mapped-manager account. For the separate assigned-scope boundary check, repeat with the clean Machine Manager-only persona from `#435`.
2. Open `/refunds` directly.
3. Confirm the queue contains only cases for assigned pilot machines.
4. Confirm unrelated machines and cases are absent from search, filters, counts, and direct links.
5. Confirm `/admin`, `/admin/refunds`, and machine setup controls are unavailable or redirect safely.
6. Confirm the manager cannot see machine mapping identifiers, provider secrets, raw Nayax payloads, Gmail provider identifiers, or internal policy tables.

Pass only if every boundary holds. Any access leak stops the pilot.

## B. Ordinary matched card case

1. Open a prepared high-confidence card case through its canonical `/refunds?case=<case-id>` link. Confirm opening the link, selecting the row, changing filters, and the initial render cause zero Nayax lookup, official-action, case-update, customer-message, or provider calls.
2. Choose **Check Nayax transaction**. Confirm this explicit control starts exactly one lookup and **Refresh** was not available before the first result.
3. Without coaching, ask the manager what they believe the next action is.
4. Confirm the screen shows the customer request beside the **Recommended card sale** on a typical laptop viewport.
5. Confirm the explanation includes the mapped location/machine, amount, local time difference, card-last-four evidence when available, and any wallet warning without exposing raw provider IDs or internal score points.
6. Confirm alternate candidates, timeline, internal notes, and retry tools are not competing with the normal path.
7. Confirm exactly one dominant evidence action is visible: **Confirm this transaction**. No approval, payment, manual card-success status, or editable approval/completion email selector is available from candidate selection.
8. Clear the selected sale. Confirm the old refund action disappears immediately and an unsaved candidate cannot expose final refund execution.
9. Re-select the recommended sale and use **Confirm this transaction**. Confirm the dialog says it records the selection for review only and explicitly says **No refund has been issued**. The case remains in review with no decision or customer email.
10. In the current containment build, confirm saving evidence alone exposes no refund action. In the future approved lifecycle, the separate manager decision must freeze the exact reviewed transaction and amount.
11. In the synthetic official-action harness, freeze that separate action and personally complete the fresh challenge for the owner-approved TOTP factor. Confirm stale, same-second, replayed, shared/agent-session, mapping/case/evidence-drift, and concurrent attempts fail closed.
12. Submit the separate approved refund action once:
    - In current shadow mode, confirm the statically disabled provider result keeps the case open and sends no success or fallback email.
    - In a future approved `#430` execution pilot, confirm the button disables while processing and only token-bound confirmed provider success atomically records one provider outcome, one completed case, and one reporting adjustment before one customer completion becomes claimable in the verified original Gmail thread with the full send-time current active mapped-manager set visibly CC'd. No separate manager completion email is created.
13. Refresh the page and confirm the durable state is correct. Replays and repeated clicks create no second provider attempt, transition, adjustment, or email.

Record time-to-decision, click/decision count, recommendation accepted yes/no, structured disagreement reason if no, and whether coaching was needed.

## C. Card exception cases

Run one prepared case for each state:

- ambiguous candidates
- no safe match
- wallet/manual exception
- setup or lookup failure
- duplicate or already-refunded transaction
- provider outcome unknown

For each case, confirm there is one plain-language recovery action, alternate evidence stays secondary, and no enabled refund action or completion email is available. Rejection, timeout, and unknown outcomes leave the case open and send no success or fallback message. Timeout/unknown requires reconciliation and never offers a blind retry.

## D. Cash/manual payout case

1. Open a matched cash/Zelle case.
2. Confirm no Nayax or card-refund action appears in the primary workflow.
3. Confirm the current state has one dominant next action and denial/missing-information choices are behind **Other decisions**.
4. In the synthetic official-action harness, approve the cash/manual path only as the current mapped Machine Manager after the fresh action-bound TOTP step-up. If a human-reviewed non-success status message is deliberately sent, confirm it is humble, stays in the original Gmail thread with the full current mapped-manager CC set, and does not claim that the external payout was sent.
5. After the approved manual payout is actually sent, enter:
   - refund amount no greater than the recorded customer payment
   - payment sent date/time
   - a short non-sensitive confirmation/reference
   - the explicit **payment was sent** confirmation
6. Confirm account/routing/card/contact/credential-like values are rejected.
7. Open the final confirmation and verify the amount, time, reference summary, and customer-email preview.
8. Submit once and confirm one completion, one redacted audit event, one reporting adjustment when eligible, and one customer email in the original Gmail thread with the full send-time current active mapped-manager set visibly CC'd.
9. Repeat/double-submit and confirm no duplicate state change, audit event, adjustment, or email.
10. Run one denied or missing-information cash case and confirm no reporting adjustment is created.

## E. Communications and recovery

1. Verify exactly-once acknowledgement and deterministic more-information/follow-up message state from the case.
2. Preview human-reviewed denial copy only after a valid official denial, and preview the DB-owned provider-success completion separately. Confirm the copy is humble, includes the case reference, does not overpromise, and never treats card approval as customer success.
3. Simulate a known failed send and confirm the case remains accurate with one deliberate recovery path.
4. Simulate an uncertain send and confirm the manager is told to reconcile the mailbox; no blind retry is offered.
5. Confirm deliberate recovery after a known failure produces no duplicate customer message, and provider completion never creates a duplicate manager-only notice.
6. Confirm automation health is understandable to the manager without exposing run ledgers or customer data.

## F. Mobile and keyboard check

1. Repeat queue selection and one card or cash action at `390x844`.
2. Confirm there is no horizontal page overflow, clipped action, hidden confirmation detail, or unreadable table.
3. Navigate the primary action and confirmation using the keyboard.
4. Confirm focus is visible, the dialog traps focus, **Go back** works, and loading disables repeat submission.

## Expected result

- The manager immediately understands the case and next action.
- A normal card case needs one transaction confirmation and one refund confirmation, not manual status editing.
- Unsafe card states fail closed.
- Cash completion records a manual payout without storing sensitive payment data.
- Token-bound confirmed provider success plus atomic case/reporting completion is required before the one original-thread customer success email with the full current active mapped-manager CC set.
- Access, emails, audit history, reporting, and duplicate controls behave consistently after refresh.
- The manager completes three consecutive ordinary cases without PM/backchannel help and with fewer manual decisions than the legacy workflow.

## Feedback template

```markdown
## Machine Manager UAT checkpoint
- Date/environment/release commit:
- Tester role (no name/email):
- Assigned machine count:
- Device: Desktop / Mobile
- Scenarios and sample count:
- Result: PASS / PARTIAL / FAIL
- Median time to decision:
- Median manager decisions/clicks:
- Recommendation accepted count:
- Coaching needed: yes/no
- What was confusing:
- What was faster/slower than the legacy process:
- Safety or access concern:
- Defects opened:
- Go/no-go impact:
```

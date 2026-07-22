# Machine Manager Shadow UAT Script

Last updated: 2026-07-21

## Purpose

Use this script with a clean Machine Manager-only account to prove that Refund Operations is simple, safe, and correctly scoped before cutover. Keep the Google Form/Sheet/AppSheet fallback live throughout UAT.

This is a manager-experience test, not an Admin setup test. Use synthetic or sponsor-approved pilot cases and record sanitized aggregate evidence only.

## Before the session

- Confirm the tester has Machine Manager assignments only and no scoped-admin, super-admin, corporate-partner, or unrelated machine access. Record this setup in `#435`.
- Confirm the selected machines and manager are approved in `#427`.
- Confirm the tested release commit and Refund Operations release manifest match the deployed environment.
- Confirm live Nayax execution state:
  - **Shadow mode:** execution disabled, dry run on, kill switch on, and sponsor flag unset.
  - **Controlled execution:** only after the explicit `#430` sponsor gate; use the approved low-value case, allowlist, and caps.
- Confirm customer-email and automation tests use synthetic addresses unless the sponsor approved a real pilot case.
- Do not capture customer names, contact details, card digits, payout contacts, complaint text, raw provider identifiers/payloads, Gmail content, or secrets in screenshots or notes.
- Do not use `?demo=on` as functional evidence. Demo mode is for visual review only.

## A. Access boundary

1. Sign in with the clean manager-only account.
2. Open `/refunds` directly.
3. Confirm the queue contains only cases for assigned pilot machines.
4. Confirm unrelated machines and cases are absent from search, filters, counts, and direct links.
5. Confirm `/admin`, `/admin/refunds`, and machine setup controls are unavailable or redirect safely.
6. Confirm the manager cannot see machine mapping identifiers, provider secrets, raw Nayax payloads, Gmail provider identifiers, or internal policy tables.

Pass only if every boundary holds. Any access leak stops the pilot.

## B. Ordinary matched card case

1. Open a prepared high-confidence card case.
2. Without coaching, ask the manager what they believe the next action is.
3. Confirm the screen shows the customer request beside the **Recommended card sale** on a typical laptop viewport.
4. Confirm the explanation includes the mapped location/machine, amount, local time difference, card-last-four evidence when available, and any wallet warning without exposing raw provider IDs or internal score points.
5. Confirm alternate candidates, timeline, internal notes, and retry tools are not competing with the normal path.
6. Confirm exactly one dominant action is visible: **Refund $X and notify customer**. No manual status or decision selector should be required on this path.
7. Clear the selected sale. Confirm the old refund action disappears immediately and an unsaved candidate cannot expose final refund execution.
8. Re-select the recommended sale and use **Confirm this card sale**. Confirm execution eligibility appears only after the server saves the manager confirmation.
9. Open the refund confirmation. Confirm it restates location, machine, transaction time, amount, card last four, and the completion-email preview.
10. Choose **Go back**. Confirm no provider call, case completion, or email occurs.
11. Reopen the confirmation and submit once:
    - In shadow mode, confirm the safe blocked result keeps the case open and sends no completion email.
    - In an approved `#430` execution pilot, confirm the button disables while processing and provider-confirmed success produces one receipt, one completed case, and one customer email.
12. Refresh the page and confirm the durable state is correct.

Record time-to-decision, click/decision count, recommendation accepted yes/no, structured disagreement reason if no, and whether coaching was needed.

## C. Card exception cases

Run one prepared case for each state:

- ambiguous candidates
- no safe match
- wallet/manual exception
- setup or lookup failure
- duplicate or already-refunded transaction
- provider outcome unknown

For each case, confirm there is one plain-language recovery action, alternate evidence stays secondary, and no enabled refund action or completion email is available. An unknown outcome must tell the manager to reconcile Nayax before retrying.

## D. Cash/manual payout case

1. Open a matched cash/Zelle case.
2. Confirm no Nayax or card-refund action appears in the primary workflow.
3. Confirm the current state has one dominant next action and denial/missing-information choices are behind **Other decisions**.
4. Approve the cash refund. Confirm the approval email and next step are clear; Bloomjoy Hub must not claim it sent the external payout.
5. After the approved manual payout is actually sent, enter:
   - refund amount no greater than the recorded customer payment
   - payment sent date/time
   - a short non-sensitive confirmation/reference
   - the explicit **payment was sent** confirmation
6. Confirm account/routing/card/contact/credential-like values are rejected.
7. Open the final confirmation and verify the amount, time, reference summary, and customer-email preview.
8. Submit once and confirm one completion, one redacted audit event, one reporting adjustment when eligible, and one customer email.
9. Repeat/double-submit and confirm no duplicate state change, audit event, adjustment, or email.
10. Run one denied or missing-information cash case and confirm no reporting adjustment is created.

## E. Communications and recovery

1. Verify acknowledgement and more-information message state from the case.
2. Preview approval, denial, and completion copy. Confirm it is empathetic, includes the case reference, and does not overpromise timing or approval.
3. Simulate a failed send and confirm the case remains accurate with one clear retry path.
4. Simulate an uncertain send and confirm the manager is told to reconcile the mailbox before retrying.
5. Confirm a retry produces no duplicate customer message.
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
- Provider success is required before case completion and customer success email.
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

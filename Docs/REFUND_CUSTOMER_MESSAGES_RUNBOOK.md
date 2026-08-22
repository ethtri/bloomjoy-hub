# Refund Customer Messages and Appeals

This runbook defines the customer communication boundary for Refund Operations v1. It is a launch checklist, not authorization to activate production.

## Case creation and ownership

- Customer contact alone does not create an operational refund case. The first reply directs the customer to the Bloomjoy hosted form.
- Form submission creates the case. If the form was opened from the private email link, it completes that one draft context rather than creating a second case.
- Form submission creates the case exactly once; subsequent customer replies update the same case.
- The email assistant may collect only explicit missing purchase facts and rerun the existing read-only transaction match. It cannot choose a transaction, decide a refund, or issue a payment.
- A manager confirms the transaction first. Approval or denial is a separate manager decision. Confirmed payment success is separate again and is the only event that permits success copy.

## Customer message matrix

| Moment | Customer message | Required boundary |
| --- | --- | --- |
| Contact before form | Warm first response with one Bloomjoy form link | No case decision and no Google Form link |
| Form submitted | Request received | Receipt only; no approval promise |
| Missing facts | More information / one reminder | Ask only for named safe fields; never request full card or wallet secrets |
| Facts received | Information received | Rerun read-only matching; no decision promise |
| No safe match | Correction-focused update | Keep manager review open; do not blame the customer |
| Denied | Warm denial with a customer-safe reason | Invite a reply in the same conversation |
| Reply-based denial appeal | Appeal received | Reopen the same case for manager review; no second form and no payment authority |
| Refund confirmed | Completion receipt | Begin: “Good news—your refund request was approved, and your refund is on its way.” |

Every message uses the canonical Bloomjoy cream, plum, blush, and orange email system, includes the public reference, closes as the Bloomjoy Sweets Team, and supports replies. Plain-text content remains complete for customers whose email clients do not display HTML.

## Reply-based denial appeal

Only a verified direct reply from the case customer after a sent denial is an appeal. Forwarded, automated, spoof-suspected, manager, or unrelated messages cannot reopen a case.

The appeal preserves the prior customer-safe denial reason, reopens the same case as **Appeal needs review**, clears the prior decision, and disables refund execution eligibility until a manager rechecks the transaction and makes a new decision. It creates no second case, provider attempt, reporting adjustment, approval, or payment.

The automatic appeal receipt is deterministic. Automatic contact remains off by default and requires both the Edge environment switch and the database switch. A confirmed failure may be retried through the controlled path. An uncertain delivery is never blindly retried; reconcile the original Gmail conversation first.

## Safety boundaries

- Duplicate-payment protections remain mandatory: provider idempotency, one-attempt settlement, case/reconciliation guards, and existing reporting adjustment uniqueness are unchanged.
- All Gmail and transactional sends still require the current mapped Machine Manager route in visible CC where that existing policy applies.
- GPT is not required for any pilot customer message. TOTP, operator ceremony, QR codes, Kexiazhan reporting, cash fallback, and a new SMS platform are not pilot launch requirements.
- Internal notes, risk scores, provider/API errors, credentials, database details, raw identifiers, and internal case links never enter customer copy.
- No production activation occurs from merging this slice. First run isolated local/preview checks, database tests, email screenshots, manager UAT, and the owner-approved monitored cutover checklist.

## Pilot verification

1. Run `npm run refunds:validate-branded-appeals`.
2. Run `npm run db:validate-migrations` and confirm `refund_branded_appeals.sql` passes in the disposable database.
3. Render first-contact, denial, appeal-received, and completion emails at desktop and 390px mobile widths; also review their plain-text versions.
4. In synthetic UAT, prove contact-before-form creates no operational case, one form submission creates one case, and a verified reply supplies only missing facts before a read-only recheck.
5. Deny a synthetic case with a customer-safe reason, reply in the original thread, and prove the same case becomes **Appeal needs review** with zero provider attempts.
6. Repeat the Gmail delivery and appeal calls. Confirm one appeal receipt and no duplicate customer email. Simulate uncertain delivery and confirm the send remains reconciliation-only.
7. Confirm transaction selection creates no decision, payment, reporting adjustment, or customer email. Then approve/deny separately.
8. Simulate confirmed provider success and confirm exactly one completion message starts with the required sentence. Replay the action and confirm no second provider attempt, adjustment, or email.
9. Keep all production gates closed and attach sanitized results to the issue/PR. Activation requires a separate owner-approved monitored launch step.

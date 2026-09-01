# Refund Customer Messages and Appeals

This runbook defines the customer communication boundary for Refund Operations v1. It is a launch checklist, not authorization to activate production.

## Case creation and ownership

- Customer contact alone does not create an operational refund case. The first reply directs the customer to the Bloomjoy hosted form.
- Form submission creates the case. If the form was opened from the private email link, it completes that one draft context rather than creating a second case.
- Form submission creates the case exactly once; subsequent customer replies update the same case.
- The email assistant may collect only an explicit missing or disputed purchase fact and rerun the existing read-only transaction match. A Nayax mismatch asks for only the one conflicting fact (last four, amount, or time); it never asks the customer to reconfirm fields already present and agreed by the case evidence. It cannot choose a transaction, decide a refund, or issue a payment.
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
| Refund confirmed | Completion receipt | Begin: “Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.” Include the secure read-only status capability when issuance is enabled. |

Every message uses the canonical Bloomjoy cream, plum, blush, and orange email system, includes the public reference, closes as the Bloomjoy Sweets Team, and supports replies. Plain-text content remains complete for customers whose email clients do not display HTML.

## Sender and transport matrix

The monitored customer-reply route is always `info@bloomjoysweets.com`.

- A Gmail-linked case sends as **Bloomjoy Refunds <info@bloomjoysweets.com>** in the existing provider thread. A Gmail failure or uncertain result never falls back to transactional mail or a second conversation.
- A direct Website case sends as **Bloomjoy Refunds** from the already-verified transactional address and uses `Reply-To: info@bloomjoysweets.com`. The currently verified address may remain `info@bloomjoyusa.com` for DKIM-signed transactional delivery; it is not treated as a Gmail send-as or inbound assistant route.
- Every case-specific customer message re-resolves the current mapped-manager CC route before delivery. The first pre-form acknowledgement is the only no-CC exception because no machine is known yet.
- Manager-only notices use the internal notice transport and recipients. They never reuse customer copy, start a customer conversation, or replace the required customer-message CC route.

| Message type | Transport and visible sender | Reply, thread, and CC | Failure / fallback |
| --- | --- | --- | --- |
| Initial form link (`refund_first_contact_v1`) | Original Gmail thread; Bloomjoy Refunds from the monitored Info mailbox | Reply stays in that thread; no manager CC before machine mapping | No transactional fallback; uncertain Gmail delivery blocks and reconciles |
| Request acknowledgement (`confirmation`) | Gmail thread when linked; otherwise verified transactional sender | Original thread when linked; otherwise monitored Reply-To; mapped managers CC'd | Source route is fixed before send; no second conversation |
| Missing information (`more_info`) | Gmail thread when linked; otherwise verified transactional sender | Same case and original thread when linked; monitored Reply-To; mapped managers CC'd | Exactly-once claim; failure records manager work; uncertainty blocks retry |
| No safe match (`no_safe_match`) | Gmail thread when linked; otherwise verified transactional sender | Same case; monitored Reply-To; mapped managers CC'd | No fallback and no payment action |
| Wallet correction / reminder | Gmail thread when linked; otherwise verified transactional sender | Secure correction link; replies still reach the monitored mailbox; mapped managers CC'd | One correction plus one bounded reminder; no blind retry |
| Information received | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | Receipt only; failure cannot create a decision or second case |
| Reminder / status update | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | Deterministic action key; failed or uncertain delivery is not resent blindly |
| Approval notice | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | Separate manager decision only; never claims provider completion |
| Completion receipt | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | Claimed only from confirmed settlement; exactly once and no second transport |
| Denial | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | One approved customer-safe reason; zero provider/reporting effect |
| Appeal receipt | Original Gmail thread for a verified reply; transactional only for an already-direct case | Reopens the same case; monitored Reply-To; mapped managers CC'd | No new case, approval, or payment; uncertain receipt remains blocked |
| Manual portal message | Gmail thread when linked; otherwise verified transactional sender | Same case/thread; monitored Reply-To; mapped managers CC'd | Manager-reviewed, exactly once; Gmail uncertainty never falls through |
| Manager notice | Internal notice transport and internal recipients only | No customer Reply-To/thread; customer is never a recipient | Separate internal exception lane; cannot substitute for customer delivery |

## Reply-based denial appeal

Only a verified direct reply from the case customer after a sent denial is an appeal. Forwarded, automated, spoof-suspected, manager, or unrelated messages cannot reopen a case.

The appeal preserves the prior customer-safe denial reason, reopens the same case as **Appeal needs review**, clears the prior decision, and disables refund execution eligibility until a manager rechecks the transaction and makes a new decision. It creates no second case, provider attempt, reporting adjustment, approval, or payment.

The automatic appeal receipt is deterministic. Automatic contact remains off by default and requires both the Edge environment switch and the database switch. A confirmed failure may be retried through the controlled path. An uncertain delivery is never blindly retried; reconcile the original Gmail conversation first.

## Internal/test archive disposition

Use **Internal/test — no customer refund** only for a reviewed employee/technician test, machine setup or commissioning run, payment-provider test, duplicate synthetic record, or other genuine internal test. Only Refund Operations can apply it. Select one fixed reason; never choose a customer denial reason and never paste customer or provider content into repository or issue notes.

Before confirming, verify the record has no completed refund, reporting adjustment, manual refund reference, successful provider outcome, or unresolved provider attempt. If any of those exist, stop and reconcile the authoritative payment evidence through the existing provider/result workflow. The Internal/test action must not erase or reinterpret payment history.

After confirmation:

- the record disappears from every customer queue count and appears only in the Refund Operations **Internal/test archive**;
- any unsent queued customer message is skipped, active reminder work becomes non-runnable, and active customer status links are revoked;
- stale official actions fail by case version, while new customer messages, reminders, status links, and refund attempts are rejected at the database boundary;
- existing messages, events, attachments, and transaction evidence remain readable for audit; and
- the classification event must show no customer message, provider call, or reporting adjustment.

The initial disposition is one-way. If a record was classified incorrectly, do not edit database fields or send denial copy. Record the sanitized case reference and reason on `#1048` for a separately reviewed reclassification design.

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

# Refund workflow

Last updated: 2026-09-30. Owner decisions: #1364, #628, #1361, #666 and #1639.

This is the single product requirements source for refunds. The form-first and
gift-card requirements below govern new work; implementation gaps are tracked in
GitHub and summarized in `CURRENT_STATUS.md`, not assumed complete by this doc.
Gift-card implementation is tracked in #1637–#1640. Until activated, the existing
card and manual cash processes remain in use; this document does not issue a
gift card or change an existing payment commitment.

## What we are doing

Bloomjoy makes a customer whole with the least work consistent with identifying
the purchase and preserving one replay-safe attempt per case. Nayax owns the
authoritative limit that refund totals cannot exceed the original purchase.

The ordinary flow is:

1. The customer reports the problem once through the intake form and receives a
   prompt, friendly acknowledgement. A genuine new refund or product-problem
   inquiry to `info@bloomjoysweets.com` receives one reply in its original thread
   linking to `https://app.bloomjoyusa.com/refunds/request`; the case is created
   only when that form is submitted. Unrelated, vendor and marketing mail gets no
   refund response. An existing-case email stays with that case, with no new intake.
2. Reuse the form's cash/card selection. Cash customers receive a gift-card
   offer; card customers can choose the recommended gift card or a refund to
   their original payment method. Show card details only for a card refund.
3. On acceptance, an eligible gift-card request issues automatically from valid
   code inventory, targeting an email within 1–2 minutes. Repeat requests need
   one Manager decision under the rule below, on the same case.
4. For an original-payment card refund, the System searches Bloomjoy and provider
   records and explains the best transaction match. The Manager makes one final
   decision and may choose a different reviewed transaction when the System's
   recommendation is weak or wrong. Approval refunds it through the Nayax API.
5. Bloomjoy shows and emails the accurate outcome, keeping the same request and
   conversation. No new form or customer account is needed.

The System should resolve at least 95% of ordinary valid cases without asking
the customer for more information. This is a product-quality target and a signal
to fix matching defects. It is not a confidence requirement or payment gate.

## Why

Customers often estimate the amount or time, taxes change the final charge, and
contactless payment numbers can differ from the physical card. Those ordinary
differences should not turn a clear purchase into customer homework. Managers
also may learn facts the System missed, so the recommendation must help their
decision rather than prevent it.

Bloomjoy needs only the controls that address real harm: the correct Manager,
the exact transaction the Manager selected, private handling of customer/payment
data, same-case idempotency, and reconciliation before retrying an unknown payment
result. Gift cards also use the owner-approved email allowance below. For card
refunds, a separate case's reference to the same purchase does not add another
Bloomjoy approval or payment block; Nayax enforces the purchase-total limit.

## How transaction matching works

The System searches before asking the customer a question. Original-payment card
refunds retain the matching rules below; a gift card does not require Nayax
matching or routine Manager review. Reuse available case and machine context,
and keep provider/mapping defects internal. Matching uses all available evidence
together:

- exact machine and location;
- purchase date and time after resolving the customer's, venue's, stored, and
  provider's timestamps into comparable instants;
- card type and last four when their provenance shows they are comparable;
- whether the customer used a physical card, Apple Pay, Google Wallet, or
  another contactless method;
- customer-reported amount and the provider's charged total;
- product or selection details when available;
- earlier customer messages and corrected facts; and
- whether the provider transaction is approved, already used, refunded, or
  otherwise unavailable.

### Timezones

Use the location's canonical IANA timezone to interpret local wall-clock values.
Label customer, venue, provider, and stored times in the UI. Handle daylight-
saving gaps and repeated times explicitly. Never compare an unlabeled local time
with UTC or another venue's time as if they were the same clock.

A timezone or timestamp-format defect is a System problem. It is not a reason to
ask the customer to repeat information the case already contains.

### Amounts

The customer's amount is an estimate and ranking clue, not an exact-match
requirement. Sales tax, rounding, memory, or an entry mistake can explain a
difference. An amount difference alone must not eliminate an otherwise obvious
purchase or trigger a customer question.

The default card refund is the full amount actually charged on the transaction the
Manager selects, including sales tax. If the customer reports **$10.00** and the
selected transaction charged **$10.90**, the default refund is **$10.90**.

Allowing the Manager to edit the final refund amount is a lower-priority UI
improvement. It must not delay the default full-refund path.

### Cards and contactless payments

A physical-card last-four match is strong evidence when the source fields are
known to be comparable. Apple Pay, Google Wallet, and other contactless payments
may expose a tokenized device number that differs from the physical card number.
A digit mismatch with unknown or tokenized provenance is context, not a veto.

### Recommendations and Manager override

Rank candidates and explain the supporting and conflicting facts. Do not present
a heuristic score as a statistical probability.

The recommendation is advisory. The Manager can select any reviewed candidate,
including one the System does not call high confidence, when customer
clarification or additional investigation identifies it. Execution still binds
to that exact selected provider transaction. Nayax decides whether the requested
refund fits within the original purchase total.

If several purchases remain genuinely plausible, show them rather than guessing.
That is an appropriate clarification case; a single imperfect field is not.

## Card refund

The Manager reviews the selected transaction and makes one decision. Approval
authorizes the System to submit the refund through the Nayax API for the exact
selected transaction and its provider total.

“Assigned Machine Manager or Super-admin” is the complete approval rule. There
is no separate approval-access enrollment, temporary manager grant, or second
session check to complete after that decision.

Confirmed provider success completes the payment and supports the customer
completion message and reporting. A timeout or unknown provider outcome pauses
only that payment while the System reconciles it. It never permits a blind retry
and never blocks unrelated refunds.

When a case worker records an exact Nayax result, the portal uses the machine or
location timezone by default and shows it beside the evidence time. A different
timezone is used only when the Nayax record clearly shows one. The saved evidence
includes both the exact time and the source timezone, so the reviewer’s computer
timezone cannot change the result.

The exact request and response contract is in
[NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md). That
technical reference cannot add another business approval or customer step.

## Gift cards for cash or card purchases

Extend the existing form and branded status/email experience with one clear
resolution choice. Keep it short, warm and usable on mobile. Gift-card cases do
not collect Zelle or card-refund details, run wallet corrections, or wait for a
routine Manager decision. Cash customers see the gift-card resolution clearly
up front; card customers retain the original-payment refund option.

**One automatic issuance per normalized email in a rolling 12 months.** Every
additional issuance in that window needs one assigned Machine Manager or
Super-admin approval, including same-quarter repeats. There is no separate
quarterly quota or automatic denial. Count actual issuances across machines,
providers and original cash/card tenders, including Manager-approved issuances.
Declined offers and card refunds do not use the allowance; duplicate submissions
and resending the same code do not count again. Review stays on the existing case.

Treat the gift card as one use with no surviving balance. Before acceptance,
show its actual value, eligible locations, expiration and these simple terms.
The value covers the purchase plus approved goodwill; rounding remains deferred.
The email includes the code and verified redemption instructions. Target 1–2
minutes for ordinary eligible, in-stock requests; an email transport acceptance
is not proof that it reached the inbox. Show review or delivery delays truthfully.

Maintain a small inventory of unused Sunzee and KeMore/Kexiaozhan codes, imported
in batches. Assign the earliest-expiring compatible code once; keep provider,
account, device scope and value aligned with the offer. A named operator handles
low-stock/expiry alerts and batch replenishment in the existing admin workspace.
An issuance API is not required. Stockout stays internal: retain the request and
resume safely after refill, rechecking the email allowance before allocation.

Use the existing outbox with prompt delivery and recovery. Email retries reuse
the same code; issuance, delivery and redemption are separate facts. Prevent
concurrent requests from spending the automatic allowance twice or sharing a
code, and prevent both a gift card and money refund settling the same case.
Keep codes private and reconcile unknown outcomes before another issuance.
Keep purchase value, gift-card value and goodwill separate in reporting; do not
label a gift card as cash paid or deduct issuance and redemption twice. Financial
and commission treatment is tracked in #1640, not invented by this workflow.

## Manual cash refund (until gift-card activation and existing commitments)

The System investigates cash claims against Sunze sales using the machine,
timezone-corrected date and time, amount, and any other available evidence. It
presents the relevant match evidence and verified Zelle destination to the
Manager.

The Manager sends the money through Zelle before using the Bloomjoy action. The
action must say **Confirm refund sent via Zelle** or equally clear language.
Selecting it records that the payment was already sent and completes the cash
refund. There is no separate `approved for payout`, `waiting for manual payment`,
or equivalent status.

Gift-card cases use the flow above and must not trigger Zelle requests. Preserve
completed cash payments and reconcile any sent or unknown payment before moving
an existing case to a gift card; never automatically rewrite payment history.

## Customer forms and notifications

Structured updates to the same case are the normal correction path. After
internal research establishes that a customer fact is needed, the email names
exactly which human-readable field or fields to check or update, briefly says
why, and provides an **Update your request** link. Use the same field labels in
the email and form; highlight those requested fields and retain prior answers.
A generic "more information needed" alert does not satisfy this requirement.

Illustrative notification text (not a sent email): "Please check **Approximate
purchase time** and **How you found the time** so we can distinguish the possible
purchases at this machine. Your earlier answers are saved. **Update your request**."
The link opens only those targeted checks on the existing request, with other
saved details available for review, rather than a blank new request.

Validate structured values and their dependencies, preserve uncertainty and the
original facts not changed by the customer, then save atomically to the current
case and trigger the existing automatic purchase recheck. Retire recommendations
or selections made stale by changed purchase-matching facts before that recheck;
unrelated contact or payout-destination changes do not discard valid purchase
evidence. Preserve existing approved-payment and unknown-outcome protections.
Saving is not a refund
decision or payment. Derive local purchase time from the venue's canonical IANA
timezone; customers need not select a technical timezone. Correct bad machine,
location, provider, or timezone mappings internally.

If the old link is submitted, expired, or superseded, provide fresh targeted
update access for that same case when a genuine correction is needed. Preserve
prior answers and request history; do not create another case, reopen an old
capability blindly, or build an endless cycle of requests. A useful reply or
saved update is not treated as silence for the follow-up or 30-day rule.

Routine free-text email fact extraction and LLM interpretation are not part of
the normal correction path. Preserve emails as case history and support assisted
exceptions for customers who cannot use the form. Review already-supplied facts
before handling such an exception; the backlog must not make customers repeat
them. Assisted handling does not authorize guessing, a Manager decision, payment,
or another routine customer question.

## Customer clarification and closure

Ask the customer only after useful case history, portal, Nayax, Sunze, and
existing-conversation research is exhausted.

- Ask one targeted question through the field-specific notification and
  same-case update form for the fact needed to distinguish the purchase or obtain
  the Zelle destination for an existing manual cash refund, not a gift-card case.
- Do not make the customer restart the request, repeat settled information, or
  troubleshoot Bloomjoy's systems.
- If there is no useful reply or saved update, send one follow-up in the same
  conversation.
- Do not create repeated reminder loops.
- A validated form update saves to the same case and restarts matching
  automatically. An email reply is retained for assisted handling, not silently
  interpreted as a routine structured correction.
- After 30 days without useful input, prepare a reject recommendation for the
  Manager. The Manager makes the final decision; the unattended case worker
  does not close or deny the request automatically.

## Acceptance criteria

- A genuine new refund/product-problem inquiry to Info gets one original-thread
  reply with the intake link and no case before submission. Unrelated/vendor/
  marketing mail gets no refund response; replay and existing-case replies create
  no duplicate case or new intake.
- A notification names the exact fields and brief reason, and its **Update your
  request** link opens the same labels, highlighted checks and saved prior answers.
- Invalid or stale updates do not overwrite current facts. A valid update saves
  once on the original case, preserves approximation/date context and triggers
  automatic recheck without another question, decision or payment. Changed
  matching facts retire only the purchase evidence they make stale; unrelated
  contact changes and existing approved/unknown-payment boundaries are preserved.
- A submitted/expired link has a supported fresh same-case update path; supplied
  facts and useful replies are not lost or counted as non-response. No routine
  email parser or LLM is required, and assisted exceptions retain their history.
- System/provider/mapping defects stay internal. One targeted question, at most
  one non-response follow-up, and a 30-day Manager reject recommendation remain.
- The existing form supports cash gift card, card gift card and original-payment
  card refund without another account or form. Gift-card cases receive no Zelle
  or card-detail requests; value, one-use terms, expiry and locations are clear.
- First eligible gift-card issuance is automatic; additional issuances within
  rolling 12 months receive one Manager decision. Concurrent requests and retries
  cannot duplicate an allowance, code, payment or financial deduction. Measure
  the ordinary 1–2 minute email target and distinguish issuance from delivery.
- The four customer-case views remain **Decision needed**, **Waiting on customer**,
  **All active**, and **All closed**. The assigned Machine Manager or Super-admin
  decides card refunds and gift-card exceptions. Selected card totals, historical
  cash sent confirmation, timezone handling and unknown-result reconciliation
  retain the rules above.

## What not to add

Do not add any of the following to the ordinary workflow without a new explicit
owner decision:

- exact customer-amount matching;
- a high-confidence requirement for Manager selection or approval;
- TOTP or another routine step-up ceremony;
- a second approver or separate business approval for request and completion;
- an ordinary manual-Nayax step after Manager approval;
- a dollar cap, daily quota, case allowlist, pilot cohort, observer, or staffed
  ceremony;
- a provider-report, optional-research, or unrelated-issue prerequisite;
- repeated customer clarification requests; or
- an intermediate cash-payout status.

Security, privacy, current Manager authority, exact selected-transaction binding,
same-case idempotency, and unknown-result reconciliation are implementation
properties. They should normally be invisible to the customer and require no
extra Manager decision. Cross-case card duplicate detection is audit context,
not an execution gate.

## Sources of truth

- This file owns the durable product workflow.
- [REFUND_AGENT_OPERATIONS.md](REFUND_AGENT_OPERATIONS.md) is the concise live
  case procedure and cannot change this workflow.
- [NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md) owns the
  current Nayax request/response details and cannot add product policy.
- Current priorities and implementation acceptance live in GitHub Issues and
  the Bloomjoy Project board. Closed issues and Git history are evidence, not
  current operating instructions.
- Historical migrations, tests, inert compatibility routes, and internal symbol
  names may retain the vocabulary of an older implementation. They are evidence
  for diagnosing that code only and never add a live case step or policy.
- `Docs/DECISIONS.md` records the owner decision. If another refund document
  conflicts, this workflow and the newest decision entry win.

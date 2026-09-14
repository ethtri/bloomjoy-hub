# Refund workflow

Last updated: 2026-09-14. Owner decision: #1364.

## What we are doing

Bloomjoy makes a customer whole with the least work consistent with identifying
the purchase and avoiding a duplicate payment.

The ordinary flow is:

1. The customer reports the problem once and receives a prompt, friendly
   acknowledgement.
2. The System searches Bloomjoy and provider records and explains the best
   transaction match.
3. The Manager makes one final decision. The Manager may choose a different
   reviewed transaction when the System's recommendation is weak or wrong.
4. For a card purchase, approval refunds the selected transaction through the
   Nayax API.
5. For a cash purchase, the Manager sends the refund through Zelle and then
   confirms in Bloomjoy that it was sent.
6. Bloomjoy tells the customer the outcome.

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
the exact transaction the Manager selected, protection against paying it twice,
private handling of customer/payment data, and reconciliation before retrying an
unknown payment result. Everything else should keep the case moving.

## How transaction matching works

The System searches before asking the customer a question. It uses all available
evidence together:

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

The default refund is the full amount actually charged on the transaction the
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
to that exact selected provider transaction and checks whether it was already
used or refunded.

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

## Cash refund

The System investigates cash claims against Sunze sales using the machine,
timezone-corrected date and time, amount, and any other available evidence. It
presents the relevant match evidence and verified Zelle destination to the
Manager.

The Manager sends the money through Zelle before using the Bloomjoy action. The
action must say **Confirm refund sent via Zelle** or equally clear language.
Selecting it records that the payment was already sent and completes the cash
refund. There is no separate `approved for payout`, `waiting for manual payment`,
or equivalent status.

Future payout automation may replace the manual Zelle step without changing the
one-decision experience.

## Customer clarification and closure

Ask the customer only after useful case history, portal, Nayax, Sunze, and
existing-conversation research is exhausted.

- Ask one targeted question for the specific fact needed to distinguish the
  purchase or obtain the Zelle destination.
- Do not make the customer restart the request, repeat settled information, or
  troubleshoot Bloomjoy's systems.
- If the customer does not respond, send one follow-up in the same conversation.
- Do not create repeated reminder loops.
- A reply updates the same case and restarts matching automatically.
- Close the case after 30 days without a useful response.

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
duplicate prevention, idempotency, and unknown-result reconciliation are
implementation properties. They should normally be invisible to the customer
and require no extra Manager decision.

## Sources of truth

- This file owns the durable product workflow.
- [REFUND_AGENT_OPERATIONS.md](REFUND_AGENT_OPERATIONS.md) is the concise live
  case procedure and cannot change this workflow.
- [NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md) owns the
  current Nayax request/response details and cannot add product policy.
- Current priorities and implementation acceptance live in GitHub Issues and
  the Bloomjoy Project board. Closed issues and Git history are evidence, not
  current operating instructions.
- `Docs/DECISIONS.md` records the owner decision. If another refund document
  conflicts, this workflow and the newest decision entry win.

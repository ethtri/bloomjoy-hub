# Refund Production Policy

Bloomjoy is in production. Refund handling should make the customer whole with
the fewest safe steps. Customer identity is not a duplicate-control boundary;
the original payment transaction is.

The [MVP delivery plan](./REFUND_MVP_PLAN.md) defines the simple manager/customer experience and the remaining API/report/completion work. Current progress belongs to #628 and its linked issues.

Start with [the agent operating procedure](./REFUND_AGENT_OPERATIONS.md) and the
current #628/#990 issue bodies. The September 3 API release is deployed and
enabled; one attributable request → approval → independently confirmed real
refund remains to be proved through ordinary approved customer operations.

## Normal card-refund path

1. Bloomjoy searches its own records and Nayax before asking the customer for
   more information.
2. A manager confirms one exact settled Nayax transaction. The refund amount is
   the full amount of that selected transaction; the customer does not specify
   an execution amount, and the normal manager UI has no editable amount.
3. Bloomjoy binds the exact selected purchase and original amount to the
   manager's action. Nayax enforces the original transaction total; no separate
   remaining-balance attestation or portal check is required.
4. The authorized manager receives one final confirmation and Bloomjoy may submit one request
   and at most one approval for that attempt generation, with a
   transaction-bound idempotency key and immutable audit evidence.
5. Bloomjoy sends success copy and creates reporting adjustments only after the
   provider result is confirmed.

Confirmed payment, customer-message delivery and accounting metadata are separate facts. The MVP target is automatic receipt-backed completion and one standard notice using existing authority. An unknown accounting date must not require another manager payment action or block the customer update; preserve it as internal follow-up without inventing settlement time. Current manual receipt tools remain usable while #971 finishes this automation.

There is no first-proof case, $10/$50 refund ceiling, daily customer-service
quota, exact-case allowlist, pilot cohort, observer, or account-wide hold.
Read-only search and exact evidence selection remain available. The September 3
owner decision on #990 supersedes the former blanket balance gate. Direct API
execution requires configured credentials, active manager and machine authority,
the selected original identity, duplicate protection and a durable attempt journal.
The global kill switch remains incident control. Unknown outcomes require
reconciliation and cannot authorize another request.

Refund Operations may approve one reviewed portal fallback for the legacy
manual-evidence cohort or an ordinary exact match with original-bound definitive
rejection or an audited no-refund release. That approval
creates one provider-free unknown-result hold; it does not move money, change
reporting, or contact the customer. The fallback is not shown for a kill
switch, duplicate, reconciliation, authority, or other block reason. After the
portal action, Refund Operations must verify that Nayax shows a completed
refund equal to the full selected transaction amount. A smaller or partial
refund stays on hold and is escalated; it cannot be recorded as completed.

## Duplicate and retry rules

- One customer may receive refunds for multiple legitimate purchases.
- One Nayax transaction may be attached to only one Bloomjoy refund case.
- A confirmed successful or already-refunded transaction is complete and must
  not be submitted again.
- A pending request remains one active request; Bloomjoy resolves it instead of
  opening another.
- A confirmed rejection or authoritative proof that no refund occurred permits
  supported correction/fallback with a new journaled generation where needed.
  The exact purchase/amount/purpose approval survives unchanged continuation and
  agent handoffs; a new generation is not a second business approval.
- A timeout or unknown result pauses only that transaction. Bloomjoy checks
  Nayax before another attempt; unrelated cases continue.

Nayax rejects a refund greater than the original transaction and removes the
refund action after a full refund. Bloomjoy still retains local transaction
uniqueness and idempotency because those controls also protect reporting,
customer messages, concurrency, and partial-refund edge cases.

## Customer-experience rule

Bloomjoy owns the investigation. Customer-supplied time, amount, card type, and
last four are matching clues, not reasons to send the customer back for work
that Bloomjoy can perform in Nayax. Manual portal evidence is authoritative
when a manager confirms the exact machine, transaction reference, provider
time, amount, currency, and card evidence.

## Controls that remain

- Exact transaction and machine/account binding.
- Positive full provider-transaction amount and supported currency.
- A first approved API attempt does not require independent remaining-balance
  proof. Nayax enforces the original transaction total; a known prior partial
  refund or an uncertain existing attempt still requires review.
- Partial/custom or reduced-remaining-value cases stay on a reviewed hold; they
  cannot silently enter the normal direct action or be recorded as a completed
  full-transaction portal refund.
- Current mapped-manager authority and one exact-refund decision, preserved
  across unchanged execution stages and supported fallback.
- Case-version checks, row locking, idempotency, and one live attempt.
- Server-only provider credentials and an immutable provider journal.
- Transaction-scoped reconciliation for unknown outcomes.
- No customer success message or reporting adjustment before confirmed success.
- A global kill switch for a demonstrated systemic incident.

## Nayax references

- [Nayax Core refund troubleshooting](https://nayax-u.nayax.com/article/mo-ma-faq-troubleshooting-78230): a refund cannot exceed the original transaction amount, and the refund action is unavailable after a full refund.
- [Nayax refund request and approval flow](https://nayax-u.nayax.com/scenario/how-to-process-decline-and-approve-a-refund-17551): documents the provider states used to distinguish a pending request, approval, and decline.
- [Nayax decline reasons](https://devzone.nayax.com/docs/cortina/credit-card/credit-card-decline-reasons): codes 205 and 206 mean already refunded and refund amount greater than the original transaction, respectively.
- [Nayax Lynx request-refund API](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds) and [approve/decline API](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund): confirm that request and approval are separate provider operations.

The retry policy above is Bloomjoy's operational inference from these provider
states: retry only after authoritative evidence shows the prior attempt did not
refund the transaction. The public Nayax material does not promise concurrency
or cumulative-partial-refund idempotency, so Bloomjoy retains transaction-level
locking and reconciliation.

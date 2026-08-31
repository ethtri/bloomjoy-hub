# Refund Production Policy

Bloomjoy is in production. Refund handling should make the customer whole with
the fewest safe steps. Customer identity is not a duplicate-control boundary;
the original payment transaction is.

## Normal card-refund path

1. Bloomjoy searches its own records and Nayax before asking the customer for
   more information.
2. A manager confirms one exact settled Nayax transaction. The refund amount is
   the full amount of that selected transaction; the customer does not specify
   an execution amount, and the normal manager UI has no editable amount.
3. Bloomjoy verifies the transaction's authoritative remaining refundable
   value before presenting a direct money-moving action.
4. After that provider readback is implemented and reviewed, the authorized
   manager receives one final confirmation and Bloomjoy may submit one request
   and at most one approval for that attempt generation, with a
   transaction-bound idempotency key and immutable audit evidence.
5. Bloomjoy sends success copy and creates reporting adjustments only after the
   provider result is confirmed.

There is no first-proof case, $10/$50 refund ceiling, daily customer-service
quota, exact-case allowlist, pilot cohort, observer, or account-wide hold.
Read-only search, exact evidence selection, and the reviewed manual Nayax portal
fallback remain available. Direct API execution is currently hard-disabled in
code by `NAYAX_REFUND_EXTERNAL_PARTIAL_GUARD_SUPPORTED = false`; environment
flags cannot open it. #990/#751 must ingest, bind, display, and atomically
recheck authoritative cumulative-refunded and remaining-refundable state before
that constant can be changed through a separate reviewed release. The global
kill switch remains additional incident control, not a substitute for this
guard.

## Duplicate and retry rules

- One customer may receive refunds for multiple legitimate purchases.
- One Nayax transaction may be attached to only one Bloomjoy refund case.
- A confirmed successful or already-refunded transaction is complete and must
  not be submitted again.
- A pending request remains one active request; Bloomjoy resolves it instead of
  opening another.
- A confirmed rejection or authoritative proof that no refund occurred permits
  a new manager-confirmed attempt generation.
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
- An immutable direct-API block until authoritative remaining-refundable state
  is available. The original sale amount cannot be used to infer that no prior
  external partial refund exists.
- Partial/custom or reduced-remaining-value cases stay in the reviewed manual
  exception path; they cannot silently enter the normal direct action.
- Current mapped-manager authority and one money-moving confirmation.
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

# Refund Production Policy

Bloomjoy is in production. Refund handling should make the customer whole with
the fewest safe steps. Customer identity is not a duplicate-control boundary;
the original payment transaction is.

The [MVP delivery plan](./REFUND_MVP_PLAN.md) defines the simple manager/customer experience and the remaining API/report/completion work. Current progress belongs to #628 and its linked issues.

Start with [the agent operating procedure](./REFUND_AGENT_OPERATIONS.md) and
[CURRENT_STATUS.md](./CURRENT_STATUS.md). The working request → approval contract
and attributable real refunds were proved on September 8. Current remaining
acceptance concerns reliable automatic completion and ordinary queue operation;
do not replay a completed payment to produce more evidence. Use #628/#990 issue
bodies only for case-specific release history.

## Normal card-refund path

1. Bloomjoy searches its own records and Nayax before asking the customer for
   more information.
2. A case worker saves one exact settled Nayax transaction. The refund amount is
   the full amount of that selected transaction; the customer does not specify
   an execution amount, and the normal manager UI has no editable amount.
3. Bloomjoy binds the exact selected purchase and original amount to the
   manager's action. Nayax enforces the original transaction total; no separate
   remaining-balance attestation or portal check is required.
4. The assigned Machine Manager or Super-admin confirms Refund once. That atomic
   action consumes one approval authorization and queues one System-owned attempt.
5. The System alone claims, executes, and settles that attempt. Bloomjoy sends
   success copy and creates one reporting adjustment only after confirmed success.

Confirmed payment, customer-message delivery and accounting metadata are separate facts. An unknown provider outcome permanently holds the same attempt. Evidence may later confirm its success or leave it held, but cannot release it for another provider call, create a retry generation, or require another manager payment action.

There is no first-proof case, $10/$50 refund ceiling, daily customer-service
quota, exact-case allowlist, pilot cohort, observer, or account-wide hold.
Read-only search and exact evidence selection remain available. The September 3
owner decision on #990 supersedes the former blanket balance gate. Direct API
execution requires configured credentials and machine authority at approval,
the selected original identity, duplicate protection and a durable attempt journal.
The global kill switch remains incident control. Unknown outcomes require
reconciliation and cannot authorize another request. When API search cannot find
a match, authorized staff may use the Nayax portal for read-only transaction
research only; they must never issue or record a refund there.

## Duplicate and retry rules

- One customer may receive refunds for multiple legitimate purchases.
- One Nayax transaction may be attached to only one Bloomjoy refund case.
- A confirmed successful or already-refunded transaction is complete and must
  not be submitted again.
- A pending request remains one active request; Bloomjoy resolves it instead of
  opening another.
- A confirmed rejection, timeout, or unknown result permanently holds the same
  attempt. Bloomjoy may research the transaction read-only in Nayax and record
  safe evidence, but never issues another provider request for that attempt.

Nayax rejects a refund greater than the original transaction and removes the
refund action after a full refund. Bloomjoy still retains local transaction
uniqueness and idempotency because those controls also protect reporting,
customer messages, concurrency, and partial-refund edge cases.

## Customer-experience rule

Bloomjoy owns the investigation. Customer-supplied time, amount, card type, and
last four are matching clues, not reasons to send the customer back for work
that Bloomjoy can research. Nayax portal access is read-only transaction research
only; never issue or record a refund there.

## Controls that remain

- Exact transaction and machine/account binding.
- Positive full provider-transaction amount and supported currency.
- A first approved API attempt does not require independent remaining-balance
  proof. Nayax enforces the original transaction total; a known prior partial
  refund or an uncertain existing attempt still requires review.
- Partial/custom or reduced-remaining-value cases stay on a permanent hold.
- Current mapped-manager or Super-admin authority for the single approval only.
- Case-version checks, row locking, idempotency, and one System-owned attempt.
- Server-only provider credentials and an immutable provider journal.
- Transaction-scoped reconciliation for unknown outcomes.
- No customer success message or reporting adjustment before confirmed success.
- A global kill switch for a demonstrated systemic incident.

## Nayax references

- [Nayax Core refund troubleshooting](https://nayax-u.nayax.com/article/mo-ma-faq-troubleshooting-78230): a refund cannot exceed the original transaction amount, and the refund action is unavailable after a full refund.
- [Nayax refund request and approval flow](https://nayax-u.nayax.com/scenario/how-to-process-decline-and-approve-a-refund-17551): documents the provider states used to distinguish a pending request, approval, and decline.
- [Nayax decline reasons](https://devzone.nayax.com/docs/cortina/credit-card/credit-card-decline-reasons): codes 205 and 206 mean already refunded and refund amount greater than the original transaction, respectively.
- [Nayax Lynx request-refund API](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds) and [approve/decline API](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund): confirm that request and approval are separate provider operations.

The public Nayax material does not promise concurrency or cumulative-partial-
refund idempotency, so Bloomjoy retains transaction-level locking, a single
attempt, and permanent-hold reconciliation.

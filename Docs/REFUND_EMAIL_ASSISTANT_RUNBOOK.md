# Refund email integration reference

This technical reference is subordinate to
[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) and the live case procedure in
[REFUND_AGENT_OPERATIONS.md](REFUND_AGENT_OPERATIONS.md). Email transport cannot
add a matching requirement, customer question, approval, or rollout ceremony.

## Purpose

Refund email keeps the customer informed in one conversation while the System
does the investigation and the Manager makes one final decision.

## Current message flow

Use existing-case-first Gmail linking: attach a verified reply to the current
case before considering any new request record.

1. A new request receives one prompt, friendly acknowledgement.
2. Existing replies attach to the same case before any new form is requested.
3. The System researches Bloomjoy and provider records before requesting details.
4. If one fact is still required, send one targeted clarification request.
5. If the customer does not respond, send one follow-up in the same conversation.
6. A useful reply updates the same case and restarts matching.
7. Close after 30 days without a useful response.
8. Send the outcome after the final Manager decision and confirmed payment state.

Do not send repeated reminders, ask the customer to restart, request information
already held internally, or describe an internal System failure as customer work.

When card identity is the one unresolved fact, the structured reply may ask for
Card type and last-four provenance, including whether the digits came from the
physical card or a wallet/device token. Ask only the fields that can distinguish
the remaining candidates.

## Sender and recipients

- Customer refund messages use **Bloomjoy Refunds
  <refunds@bloomjoysweets.com>**.
- The automation may authenticate to the shared Info Gmail account, but that
  login address is not the customer-visible sender and does not make ordinary
  Info or Support mail a refund request. New refund intake must be addressed to
  `refunds@bloomjoysweets.com`; existing linked refund threads remain eligible.
- The customer is the sole **To** recipient.
- Current assigned Managers are visibly copied when the established route
  requires it.
- Gmail-linked messages stay in the original Gmail thread. Form-origin messages
  use the established transactional channel.
- Never use a personal mailbox or expose the internal Manager URL to a customer.

The send record must preserve the final sender, recipients, message type, case,
and delivery state without logging customer or payment content.

## Message types

- **Acknowledgement:** confirms receipt and sets the expectation that Bloomjoy is
  checking its records.
- **Clarification:** asks only for the one specific unresolved fact.
- **Follow-up:** repeats that same unresolved fact once when there is no reply.
- **Card completion:** sent only after confirmed Nayax success; uses the provider
  total and does not promise a bank-posting date Bloomjoy cannot prove.
- **Cash completion:** sent only after the Manager confirms Zelle was already
  sent; it does not imply a card or Nayax refund.
- **Closure:** clearly explains a no-refund decision or the 30-day no-useful-
  response closure without blaming the customer.

## Delivery truth and replay

Queued, provider-accepted, delivered, failed, and unknown are different facts.
Never claim a send before the authoritative record confirms it. Use the stable
message identity to reconcile an unknown result; do not compose or send a
replacement merely because the first response was lost.

A failed completion message never reopens or repeats a successful payment. A
customer reply never authorizes a payment. Email identities cannot select a
transaction or make the Manager decision.

## GPT boundary

GPT assistance is optional and never required for the refund workflow. If used,
it may summarize or prepare a draft under `Docs/REFUND_GPT_TRIAGE.md`. It does not
choose a transaction, make the Manager decision, issue a refund, or create a new
customer-information loop.

## Verification

Run the relevant current checks:

```text
npm run refunds:validate-customer-comms
npm run refunds:validate-transactional-delivery
npm run refunds:validate-manual-message-outbox
npm run refunds:validate-deterministic-followup
npm run refunds:validate-gmail
```

Use synthetic data and verify exactly one message per intent, original-thread
continuity, current recipient routing, delivery reconciliation, one clarification
plus one non-response follow-up, and no payment side effects.

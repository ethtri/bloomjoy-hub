# Nayax matching implementation reference

This Engineering reference is subordinate to
[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md). It describes how to implement and test
card recommendations; it is not a second agent procedure or a source of customer
questions, Manager approvals, or payment policy.

The executable implementation is `NAYAX_RECOMMENDATION_POLICY` in
`supabase/functions/_shared/nayax-recommendation.mjs` and its tests. If the code
conflicts with the product workflow, treat that as an implementation defect. Do
not rewrite the product workflow to match a stale threshold.

## Required behavior

- Search the exact provider account and machine.
- Normalize customer, location, provider, and stored times using the location's
  canonical IANA timezone before comparing them.
- Use all available evidence together: time, comparable card details,
  physical-card or wallet provenance, amount, product details, prior corrections,
  and provider transaction state.
- Keep the customer amount advisory. A difference by itself cannot eliminate an
  otherwise obvious transaction or trigger a customer correction.
- Treat contactless/device last four as potentially different from the physical
  card. A mismatch is negative evidence only when provenance establishes that the
  two values should be the same.
- Return and explain every plausible candidate. Do not hide alternatives merely
  because one ranks first.
- Use deterministic reason codes and ordering. Do not describe heuristic output
  as a statistical probability.
- Never automatically make the refund decision.

## Manager behavior

The recommendation is advisory. The Manager may select a reviewed candidate that
is not ranked first or labeled high confidence when customer clarification or
additional investigation identifies it. The server must preserve the exact
candidate the Manager chose and use its provider total by default.

Confidence or rank may change presentation and the amount of explanation. It may
not be a universal permission gate for Manager selection or approval.

## Execution boundary

Matching never proves a vend failed and never proves a refund succeeded. Before
execution, the server rechecks current Manager authority, the exact account,
machine, selected transaction, currency, provider total, duplicate allocation,
case version, and unresolved prior attempts.

These checks protect the selected payment. They do not create another business
approval. A timeout or unknown provider result remains bound to that transaction
until reconciliation and never permits a blind retry.

## Time handling

Prefer an authoritative provider UTC instant when available. Resolve zone-less
machine timestamps with the location timezone and keep the original source value.
Daylight-saving gaps and repeated times must remain explicitly labeled rather
than silently shifted.

A timezone parsing defect is an internal defect. The customer is not asked to
re-enter a time already present in the case just to compensate for it.

## Amount handling

The customer estimate can help rank nearby candidates, but exact equality and a
fixed difference threshold are not product requirements. The default refund is
the full charged amount on the Manager-selected provider transaction, including
sales tax.

Example: a reported **$10.00** and selected **$10.90** transaction remain
separate visible facts; approval defaults to **$10.90**.

## Verification

Run:

```text
npm run refunds:validate-nayax-matching
npm run refunds:validate-nayax-execution
npm run refunds:validate-manager-workbench
```

Cover at least:

- same machine and correctly normalized time with exact and different estimates;
- sales-tax and materially wrong customer amounts;
- physical-card and tokenized contactless identifiers;
- a Manager selecting a lower-ranked candidate;
- multiple genuinely plausible purchases;
- wrong machine/account, declined, used, already-refunded, and duplicate rows;
- daylight-saving gaps and repeated local times; and
- unknown provider outcomes and replay prevention.

Use `Docs/QA_SMOKE_TEST_CHECKLIST.md` for the visible workflow checks. Tests must
assert the current product rule rather than freeze an obsolete numeric threshold.

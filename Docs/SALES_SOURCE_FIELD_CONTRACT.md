# Sales source and refund calculation contract

Date: 2026-09-28  
Issue: [#1568](https://github.com/ethtri/bloomjoy-hub/issues/1568)  
Status: bounded source decision and implementation handoff for #1571

## Decision

Keep the current financial authority until a later recorded decision has stronger
provider evidence:

- Nayax supplies card sale amounts, settled state and paid card-refund evidence.
- Sunze and Kexiaozhan supply cash sale observations. Cash intentionally omitted
  from a finance spreadsheet is still part of Hub's all-payments data.
- Hub owns canonical refund-case identity and the once-only requested/paid
  deduction. Provider refund flags corroborate that lineage; they do not create a
  second deduction.
- Never add a vendor card amount to the corresponding Nayax card amount.

The preferred future direction, vendor cash plus card, is not verified. This
review found no safe source-switch date. Any later switch needs a per-machine
effective local date, comparable successful-payment coverage on both sides and a
recorded replacement decision. It must not reinterpret history silently.

## Field and authority matrix

| Source/surface | Imported fields | Amount and tax basis | Status and time basis | Current use |
| --- | --- | --- | --- | --- |
| Sunze Orders UI/export | `Order amount`, `Tax`, `Payment method`, `Payment time`, `Status`, `Machine code`, order ID | The exported `Order amount` is stored as `net_sales_cents`; `Tax` is stored separately as `tax_cents`. Finance reports that the online app view is tax-exclusive, but the existing sanitized evidence does not prove that every exported `Order amount` has that same basis. Blank/zero `Tax` is not proof of exemption. | Only `Payment success` publishes. Explicit offsets preserve their instant; timezone-less/Excel cells remain `unvalidated_utc_compatibility` until the account-wide clock is proved. Late rows arrive through overlapping exports. | Cash authority. Existing Sunze/Nayax prospective boundaries retain legacy Sunze card history but make Nayax authoritative for new card facts. Do not apply another tax subtraction to a value proved tax-exclusive. |
| Kexiaozhan merchant payment/API | payment `outTradeNo`, `orderNos`, `paymentAmount`, `refundAmount`, `paymentMethod`, `paymentInstrument`, `status`, `paymentTime`, `currency`; order fields are context | For the tested cash shape, the UI renders `paymentAmount` directly and it equals the API payment value and linked order value. Treat it as gross customer cash collected. Sampled order tax fields were empty, which means unknown, not zero; reporting currently derives tax downstream from the effective Hub machine rule. | Payment status: 0 pending, 1 success, 2 failed, 3 refunding, 4 refund success, 5 refund failed. Publish status 1 only. Use the machine IANA timezone confirmed by the owner and half-open `[start,end)` payment windows. Payment is the unit even when `orderNos` has multiple entries. | Cash authority. Card rows remain comparison context only. A later refund mutation must preserve the original gross sale for review instead of erasing it. |
| Nayax scheduled report / DTM | provider transaction identity, settled amount/time, authorization amount/time where retained, currency, status and refund receipt/event | Finance uses Nayax tax-inclusive card charges for Livermore/Great Mall and Enterprise Merlin removes tax downstream. The current card fact is therefore a gross customer charge; normalize tax exactly once using the applicable report/contract rule. Authorization alone is not a sale. | Admit only the existing settled USD shape. Keep the existing settlement-local sale date; occurrence and settlement clocks remain separate evidence. Provider status/receipt proves paid refunds. | Card sale and paid card-refund authority. Nayax is not evidence that vendor cash is complete. |
| Refund case | `id`, `duplicate_of_refund_case_id`, `customer_request_received_at`, `payment_amount_cents`, `refund_amount_cents`, matched sale/Nayax amount, decision/status, completion receipt/adjustment | Public intake requires a positive amount and currently writes it to both payment and refund amount fields. The UI describes it as the customer's requested amount/estimate. Exact selected Nayax or cash-sale evidence supersedes the estimate for review/execution. | Request time is server-owned. Case status describes workflow; financial payment requires an authoritative receipt/adjustment. A failed/ambiguous execution can still leave a valid request outstanding. | Canonical requested and paid refund components. Duplicate cases contribute zero independently. |

## Bounded comparison evidence

| Sample | App/source comparison | Count/cent result | Conclusion or unresolved difference |
| --- | --- | --- | --- |
| Sunze Orders export used by the existing importer | For the inspected filter, export row count equalled the Orders UI record count and the sum of `Order amount` equalled UI `Revenue`. | Exact parity was observed; the dated sanitized discovery record intentionally retained no private count or cent total. | UI/export arithmetic parity is proved for that filter. Tax basis and timezone are not. White Oaks and Woodland refund figures remain bounded reference fixtures, not final request-adjusted totals. |
| Kexiaozhan complete September 20 payment window | 26 payment rows, all status 1: 5 cash and 21 card-context rows. All 26 joined to one order in this sample; each payment amount/time equalled its linked order. The API also returned 30 paid/completed orders, four with payment times outside the requested window. | Five cash payment values matched the UI-rendered/API major-unit values and their linked order values exactly to the cent. | Payments, rather than orders, anchor financial count and window coverage. This proves the sampled cash shape, not universal card completeness or tax basis. |
| Six mapped Kexiaozhan/Nayax cohorts, September 24-27 | Five successful Kex card observations and five positive-authorization Nayax observations; four unique same-amount candidates were within 3.74 seconds. | One Central-machine pair did not match by amount/time within two minutes. | Vendor card coverage is not proved. Machine-name mapping does not make two payments the same transaction. |
| Kexiaozhan refunded payments | 18 sampled status-4 rows had `refundAmount = paymentAmount`; no pending, failed or partial refund was present. | Full mutation shape only. | Cumulative partials, reversals and omission behavior remain unproved. The current projection preserves previously published gross as `review_preserved`; it must not remove the original sale and then also deduct Hub's refund. |
| Nayax recent census and historical ingest | 2,435 positive authorizations were observed; 2,280 rows met the complete plausible-settled shape and had equal authorization/settlement amounts. | Existing historical controls and refund receipts remain the authoritative imported card evidence; positive authorization rows outside the settled shape contribute zero. | Incomplete/authorization-only records are not sales. Already-refunded provider rows need the original sale plus one canonical refund, not a netted omission plus another deduction. |
| Livermore and Great Mall finance sheets | Finance intentionally omits cash and uses Nayax card charges. | The sheet is not an all-payments control total. | Hub must continue including vendor cash. A difference equal to cash is expected, not a source defect. |
| Enterprise Merlin | Finance removes tax from Nayax rather than treating the Nayax charge as tax-exclusive. | This is an attributed downstream rule; no vendor API field comparison was captured. | Keep Nayax gross card authority and existing configured tax normalization. Do not infer a vendor-card replacement from the spreadsheet. |

## Calculation contract for #1571

All stored calculation inputs use integer cents and carry an explicit amount
basis. Values with an unknown basis do not silently become zero-tax or
tax-exclusive values.

For each machine and reporting period:

```text
cash_ex_tax = sum(cash amounts normalized exactly once)
card_ex_tax = sum(card amounts normalized exactly once)

paid_refund_ex_tax = authoritative cumulative paid refund amount, normalized
request_target_ex_tax = current positive canonical request amount, normalized
outstanding_request_ex_tax = max(request_target_ex_tax - paid_refund_ex_tax, 0)
combined_refund_ex_tax = paid_refund_ex_tax + outstanding_request_ex_tax
already_reflected_ex_tax = portion already removed from the selected sales input
applied_refund_deduction_ex_tax = max(combined_refund_ex_tax - already_reflected_ex_tax, 0)

commissionable_sales = cash_ex_tax + card_ex_tax - applied_refund_deduction_ex_tax
```

Do not floor the final result unless the existing contract explicitly requires
it. Expose cash, card, requested outstanding, paid refund and combined deduction
separately before applying partner-specific rules.

Request-target precedence for a canonical case is:

1. Use an explicitly reviewed request target when the case records one. A
   partial request remains partial even when the matched purchase amount is
   larger.
2. Otherwise use the current positive customer request/estimate from
   `payment_amount_cents` (new public intake requires it) and retain
   `customer_estimate` provenance.
3. An exact selected provider or cash-sale amount may replace the estimate only
   when the current full-refund workflow or an explicit review sets that amount
   as the request target. Match evidence alone must not enlarge the request.
4. Treat a missing/nonpositive legacy amount as unresolved. Do not invent zero,
   the full matched sale or another case's amount.

`refund_amount_cents` is currently initialized from the intake estimate and can
later become the reviewed/execution amount. The implementation must retain the
request component and its provenance instead of assuming that every value in
that column was paid. `resolveCashReviewAmountCents` is reusable review UI logic,
but cash execution eligibility does not control the requested deduction: when
selected-sale evidence is temporarily unavailable, the original documented
request estimate remains outstanding with `customer_estimate` provenance.

Lifecycle rules:

- Exclude a row with `duplicate_of_refund_case_id`; its canonical case owns the
  components.
- A positive canonical request contributes before approval and remains
  outstanding through ordinary review, approval, provider pending, failed or
  ambiguous execution, and age beyond 30 days.
- A paid amount moves value from outstanding to paid. Full payment leaves the
  combined deduction unchanged; partial payment reduces outstanding by the same
  amount.
- Denial or explicit withdrawal removes only the unpaid remainder. Existing
  paid value remains. The current schema has a denial decision but no proved
  first-class withdrawal fact, so generic `closed` must not mean withdrawn.
- A request amount edit changes the target on the same canonical case. It is not
  a second request. Provider/email/Hub evidence deduplicates through the existing
  case, receipt and adjustment lineage.
- A source that already removed a sale because of refund status cannot also feed
  the same applied deduction. Record the already-reflected portion and reduce
  only that case's applied deduction. Keep unrelated known sales available.

Tax normalization follows the original sale's basis and effective tax rule:

- `tax_exclusive`: use the amount directly; subtract no additional tax.
- `gross_with_separate_tax`: subtract the proved tax component once.
- `tax_inclusive`: use a proved source-provided included-tax component, or for a
  proved rate `r` calculate embedded tax as
  `round(gross_cents * r / (100 + r))` and tax-exclusive sales as gross minus
  that result.
- `unknown`: retain an explicit exception; blank or zero source tax alone cannot
  choose a branch.

The legacy `round(gross * r / 100)` percentage-of-gross result is a separately
named estimate basis, not an included-tax calculation. Preserve it only where an
existing partner contract explicitly requires that legacy basis and expose its
provenance; do not feed it into the new shared tax-inclusive normalization.

Normalize each requested/paid refund component using the original sale's basis
and tax attribution. Payment completion never creates another tax reversal.

The remaining owner policy choice is period attribution for a request received
after the sale period. Existing completed adjustments use completion/evidence
dates, but that does not settle the requested-refund policy. The recommended
choice is the original sale period because it preserves machine, technician and
tax attribution and can use the existing statement regeneration/version flow.
Until the owner decides, #1571 should keep the attribution choice explicit in
fixtures and must not infer it from completion date.

## Required fixture handoff

| Fixture | Expected combined deduction |
| --- | ---: |
| $100 tax-exclusive sales + $10 outstanding request | $10; commissionable sales $90 |
| Same request after $4 paid | $4 paid + $6 outstanding = $10 |
| Remaining $6 denied/withdrawn | $4 paid + $0 outstanding = $4 |
| Payment execution failed but request remains valid | unchanged request target |
| Duplicate intake for the same canonical case | counted once |
| Request amount changed on the same case | new target minus cumulative paid |
| Request older than 30 days | unchanged unless denied/withdrawn/paid |
| Missing legacy request amount | unresolved; no fabricated deduction |
| Source already omits refunded original | combined refund stays visible; applied deduction is reduced by the proved already-reflected portion |

## Reusable implementation paths

- Intake amount/time: `supabase/functions/refund-case-intake/index.ts` and
  `supabase/functions/_shared/refund-intake-payment.ts`.
- Cash amount precedence: `src/lib/refundCashAmount.ts` and selected Sunze cash
  correlation evidence.
- Card reviewed amount: selected Nayax candidate and the existing card approval,
  attempt and authoritative receipt lineage.
- Duplicate identity: `refund_cases.duplicate_of_refund_case_id` and the current
  reconciliation functions.
- Paid reporting facts: `sales_adjustment_facts`, `reporting_adjustment_id` and
  authoritative provider receipts. These are paid evidence, not the full request
  ledger.
- Late changes: existing revenue snapshot refresh, manager notification and
  issued-statement regeneration/version flow.
- Source observations: `scripts/sunze/sunze-orders.mjs`,
  `scripts/snapcase/kexiazhan-contract.mjs`, and the existing Nayax scheduled/DTM
  importers.

## Minimum remaining evidence questions

No additional owner choice is needed for the current source authority. A future
vendor-card switch requires privacy-safe same-machine/local-window comparisons
that prove card completeness, successful/offline/late behavior, app/API amount
basis, and original-sale/refund mutation behavior for Sunze and Kexiaozhan.
Sunze still needs an independently known timestamp pair for its account-wide
timezone rule.

For requested refunds, the only remaining business choice is original-sale
period versus request period for a late request and its later reversal. A true
partial request that differs from the reported amount paid also needs an
explicit stored request target before that case can contribute; current intake
captures one required positive amount and does not distinguish those two facts.

# Sales source and refund calculation contract

Date: 2026-09-28  
Issue: [#1568](https://github.com/ethtri/bloomjoy-hub/issues/1568)  
Status: confirmed interim source split and amount-basis handoff for #1571

## Decision

The owner confirmed the interim mixed authority:

- Nayax supplies card sale amounts, settled state and paid card-refund evidence.
- Sunze and Kexiaozhan supply cash sale observations. Cash intentionally omitted
  from a finance spreadsheet is still part of Hub's all-payments data.
- Hub owns canonical refund-case identity and the once-only requested/paid
  deduction. Provider refund flags corroborate that lineage; they do not create a
  second deduction.
- Never add a vendor card amount to the corresponding Nayax card amount.

This is the selected interim source split, not a pending vendor-only switch.
Machine apps can remain incomplete while a machine is offline for several days.
A complete paginated API response or export proves that the provider returned
the complete response for that request; it does not prove that an offline
machine uploaded every cash sale. Existing overlap and backfill paths may ingest
late uploads without duplicating facts, but they do not turn absent rows into
proved zero cash.

Amount basis is specific to the provider surface and field, and for Nayax may
also vary by location and effective date. Do not infer one provider-wide tax
basis from the selected source authority.

## Field and authority matrix

| Source/surface | Imported fields | Amount and tax basis | Status and time basis | Current use |
| --- | --- | --- | --- | --- |
| Sunze Orders UI/export | `Order amount`, `Tax`, `Payment method`, `Payment time`, `Status`, `Machine code`, order ID | The exported `Order amount` is stored as `net_sales_cents`. Finance confirms that Orders UI `Revenue` is tax-exclusive, and the bounded export proves that the sum of `Order amount` equals that UI value. Treat every published Sunze `Order amount` as tax-exclusive, regardless of tender. `Tax` remains a separate nullable source field; blank/zero `Tax` is not proof of exemption. | Only `Payment success` publishes. Explicit offsets preserve their instant; timezone-less/Excel cells remain `unvalidated_utc_compatibility` until the account-wide clock is proved. Late rows arrive through overlapping exports. | Cash authority. Existing Sunze/Nayax prospective boundaries retain legacy Sunze card history but make Nayax authoritative for new card facts. Amount basis does not grant source authority; do not add Sunze card to the corresponding Nayax card. |
| Kexiaozhan merchant payment/API | payment `outTradeNo`, `orderNos`, `paymentAmount`, `refundAmount`, `paymentMethod`, `paymentInstrument`, `status`, `paymentTime`, `currency`; order fields are context | Finance screenshots show that app `Order amount` excludes tax while app `Payment amount` includes tax. The current cash importer publishes API `paymentAmount`; inspected UI/API parity supports mapping that field to the app Payment amount for the tested cash shape. Use the inclusive basis only under that supported mapping, not as a claim about every API field or location. Do not substitute the linked order amount or deduct tax from an already tax-exclusive app order amount. Empty order tax fields still mean unknown, not zero. | Payment status: 0 pending, 1 success, 2 failed, 3 refunding, 4 refund success, 5 refund failed. Publish status 1 only. Use the machine IANA timezone confirmed by the owner and half-open `[start,end)` payment windows. Payment is the financial unit even when `orderNos` has multiple entries. Complete pagination does not prove that an offline machine uploaded every payment. | Cash authority. Card rows remain comparison context only. Exact field/location/effective-date exceptions remain pending in the finance SOP. A later refund mutation must preserve the original gross sale for review instead of erasing it. |
| Nayax scheduled report / DTM | provider transaction identity, settled amount/time, authorization amount/time where retained, currency, status and refund receipt/event | Basis is not provider-wide. Existing finance examples use tax-inclusive Nayax card charges at some locations and remove tax downstream. Finance now also reports that Nayax data for two Oklahoma locations excludes sales tax, but the exact locations, machines, effective dates, report field and rate rules have not been supplied. Keep that statement as attributed evidence; it does not prove a zero rate, an exemption, or that Hub's imported field is tax-exclusive. | Admit only the existing settled USD shape. Keep the existing settlement-local sale date; occurrence and settlement clocks remain separate evidence. Provider status/receipt proves paid refunds. | Card sale and paid card-refund authority. Before shared consumer activation, choose the amount basis from an explicit location/machine, imported field and effective-date rule. Unknown affected basis remains visible rather than becoming zero-tax. Nayax is not evidence that vendor cash is complete. |
| Refund case | `id`, `duplicate_of_refund_case_id`, `customer_request_received_at`, `payment_amount_cents`, `refund_amount_cents`, matched sale/Nayax amount, decision/status, completion receipt/adjustment | Public intake requires a positive amount and currently writes it to both payment and refund amount fields. The UI describes it as the customer's requested amount/estimate. Exact selected Nayax or cash-sale evidence supersedes the estimate for review/execution. | Request time is server-owned. Case status describes workflow; financial payment requires an authoritative receipt/adjustment. A failed/ambiguous execution can still leave a valid request outstanding. | Canonical requested and paid refund components. Duplicate cases contribute zero independently. |

## Bounded comparison evidence

| Sample | App/source comparison | Count/cent result | Conclusion or unresolved difference |
| --- | --- | --- | --- |
| Sunze Orders export used by the existing importer | For the inspected filter, export row count equalled the Orders UI record count and the sum of `Order amount` equalled UI `Revenue`; Finance confirms that the online Orders values exclude tax. | Exact parity was observed; the dated sanitized discovery record intentionally retained no private count or cent total. | Published Sunze `Order amount` is tax-exclusive for cash and retained card history. This basis rule does not change the current cash/card authority split. The payment-time timezone remains unresolved. |
| Kexiaozhan complete September 20 payment window | 26 payment rows, all status 1: 5 cash and 21 card-context rows. All 26 joined to one order in this sample; each payment amount/time equalled its linked order. The API also returned 30 paid/completed orders, four with payment times outside the requested window. | Five API `paymentAmount` values matched the UI-rendered Payment amount and their linked order values exactly to the cent. | Payments, rather than orders, anchor financial count and window coverage. Finance screenshots distinguish tax-inclusive app Payment amount from tax-exclusive app Order amount; the inspected parity supports the current API `paymentAmount` mapping for this cash shape without proving every API field or location. The sample also does not prove that an offline machine had uploaded every payment. |
| Six mapped Kexiaozhan/Nayax cohorts, September 24-27 | Five successful Kex card observations and five positive-authorization Nayax observations; four unique same-amount candidates were within 3.74 seconds. | One Central-machine pair did not match by amount/time within two minutes. | Vendor card coverage is not proved. Machine-name mapping does not make two payments the same transaction. |
| Kexiaozhan refunded payments | 18 sampled status-4 rows had `refundAmount = paymentAmount`; no pending, failed or partial refund was present. | Full mutation shape only. | Cumulative partials, reversals and omission behavior remain unproved. The current projection preserves previously published gross as `review_preserved`; it must not remove the original sale and then also deduct Hub's refund. |
| Nayax recent census and historical ingest | 2,435 positive authorizations were observed; 2,280 rows met the complete plausible-settled shape and had equal authorization/settlement amounts. | Existing historical controls and refund receipts remain the authoritative imported card evidence; positive authorization rows outside the settled shape contribute zero. | Incomplete/authorization-only records are not sales. Already-refunded provider rows need the original sale plus one canonical refund, not a netted omission plus another deduction. |
| Livermore and Great Mall finance sheets | Finance intentionally omits cash and uses Nayax card charges. | The sheet is not an all-payments control total. | Hub must continue including vendor cash. A difference equal to cash is expected, not a source defect. |
| Enterprise Merlin | Finance removes tax from Nayax rather than treating the Nayax charge as tax-exclusive. | This is an attributed downstream rule; no vendor API field comparison was captured. | Keep Nayax gross card authority and existing configured tax normalization. Do not infer a vendor-card replacement from the spreadsheet. |
| Two unnamed Oklahoma locations | Finance reports that the relevant Nayax data excludes sales tax. | Location/machine identities, effective dates, the exact report/customer-payment field and applicable rates were not supplied. | This disproves a universal Nayax-inclusive fallback, but it does not yet select a calculation branch for a Hub fact. It is not evidence of zero tax or a jurisdiction exemption. |

## Calculation contract for #1571

All stored calculation inputs use integer cents and carry an explicit amount
basis. Values with an unknown basis do not silently become zero-tax or
tax-exclusive values.

For cumulative case reconciliation:

```text
cash_ex_tax = sum(cash amounts normalized exactly once)
card_ex_tax = sum(card amounts normalized exactly once)

paid_refund_ex_tax = authoritative cumulative paid refund amount, normalized
gift_card_purchase_ex_tax = original purchase resolved by an issued gift card, normalized
request_target_ex_tax = current positive canonical request amount, normalized
outstanding_request_ex_tax = max(request_target_ex_tax - paid_refund_ex_tax - gift_card_purchase_ex_tax, 0)
combined_refund_ex_tax = paid_refund_ex_tax + gift_card_purchase_ex_tax + outstanding_request_ex_tax
already_reflected_ex_tax = portion already removed from the selected sales input
applied_refund_deduction_ex_tax = max(combined_refund_ex_tax - already_reflected_ex_tax, 0)

cumulative_sales_after_refunds = cash_ex_tax + card_ex_tax - applied_refund_deduction_ex_tax
```

The cumulative balances above explain how much one case has removed to date;
they are not the monthly expense formula. For each machine-local reporting
period, commissionable sales use sales in that period minus new request
deductions and request-amount increases, plus unpaid denials, withdrawals and
amount decreases recorded in that period. A later payment changes requested and
paid context but contributes zero additional deduction. A gift-card issuance
resolves the original purchase amount without becoming cash/card paid. Its
separate receipt records purchase amount, face value and Bloomjoy-funded goodwill.
The launch value rounds up to a $5 increment; goodwill creates no additional
technician or partner deduction. Issuance, email retry and later redemption do
not add another request deduction. A report dated before issuance does not treat
that purchase as gift-card resolved. Redemption remains unknown until supported
provider evidence establishes it; the issued value is not new sales revenue.

```text
period_refund_impact_ex_tax = new_requests + amount_increases
  - unpaid_denial_or_withdrawal_reversals - amount_decreases
period_commissionable_sales = period_cash_ex_tax + period_card_ex_tax
  - period_refund_impact_ex_tax
```

Do not floor the final result unless the existing contract explicitly requires
it. Expose cash, card, requested outstanding, paid refund, period deduction,
period reversal and cumulative deduction separately before applying
partner-specific rules.

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

- A case already identified by `duplicate_of_refund_case_id` before recognition
  contributes zero independently; its canonical case owns the components. If a
  duplicate is identified only after an earlier period recognized it, preserve
  that period and post the dated reversal or reallocation in the change month.
  Never delete or retroactively exclude the original recognition history.
- Recognize a financially valued request in the machine-local month in which
  the request was received. Keep the request's proved original purchase machine,
  location, account and sale tax basis even if the machine later moves.
- A positive canonical request contributes before approval and remains
  outstanding through ordinary review, approval, provider pending, failed or
  ambiguous execution, and age beyond 30 days.
- A paid amount moves value from outstanding to paid. Full payment leaves the
  combined deduction unchanged; partial payment reduces outstanding by the same
  amount. Payment never reopens the request month and posts no new sales
  deduction in the payment month.
- Denial or explicit withdrawal removes only the unpaid remainder. Existing
  paid value remains. Post the reversal in the machine-local month of the dated
  denial or withdrawal; do not rewrite the earlier request month. The current
  schema has a denial decision but no proved first-class withdrawal fact, so
  generic `closed` must not mean withdrawn.
- A request amount edit changes the target on the same canonical case. It is not
  a second request. Post only the increase or decrease in the machine-local month
  of the dated change. Provider/email/Hub evidence deduplicates through the
  existing case, receipt and adjustment lineage.
- Existing effective assignment and compensation terms continue to control.
  The request or change month is an accounting date, not authority to charge a
  replacement technician, partner or owner after a machine move.
- A source that already removed a sale because of refund status cannot also feed
  the same applied deduction. Record the already-reflected portion and reduce
  only that case's applied deduction. Keep unrelated known sales available.

Tax normalization follows the original sale's basis and effective tax rule:

- `tax_exclusive`: use the amount directly; subtract no additional tax.
- `separate_tax`: subtract the proved tax component once.
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

Normalize each requested/paid refund component only when its own amount basis is
proved, while retaining the original sale's tax attribution as separate context.
Payment completion never creates another tax reversal.

The shared implementation in
`private.machine_sales_calculation_candidates(uuid, date, date)` returns an
evidence union of sale, outstanding-request and paid-refund candidates. Its date
range finds candidates through sale, incident, request-receipt or paid-evidence
dates; it is not a final additive accounting-period rollup. Request rows
carry only their unpaid gross amount as the additive component; cumulative paid
cents across the canonical case and its duplicate descendants are context,
while each distinct positive adjustment remains its own paid component. Legacy
adjustments linked only by `refund_cases.reporting_adjustment_id` retain their
case and tender context. The function exposes incident, request-receipt and
paid-evidence dates separately and does not select an effective refund date.
The approved adapter must derive signed dated request/change components from
durable evidence rather than reconstructing prior periods from the case's current
status or current amount. Existing dated case audit and payment evidence should
be reused; add only the smallest recognition record needed where those facts
cannot reproduce the approved history.

Refund amount basis follows explicit adjustment metadata or exact Nayax
card/refund provenance only when that provenance also identifies the applicable
amount-basis rule. The hosted public intake's required "amount you paid"
is a tax-inclusive customer-charge estimate and remains usable before payment
matching. A matched sale's basis alone does not prove whether a separately
recorded request or adjustment amount includes tax. A legacy sheet/manual amount
without that evidence remains `unknown`; its recorded cents stay visible and is
not relabeled tax-inclusive. A positive imported `tax_cents` value also needs an
explicit amount/tax-basis contract before it can prove separate-tax treatment.

`private.normalize_financial_amount_cents(...)` keeps an unknown basis nullable
instead of calling the recorded input tax-exclusive. Its per-fact normalized
sale fields are diagnostic. A financial consumer must group recorded sale cents
by machine-local day, effective amount basis and effective rate, then normalize
and round once at that approved scope; summing transaction-level rounded tax can
move pennies. `private.normalize_refund_cents(...)` instead normalizes the
cumulative requested target and cumulative paid amount before subtracting them,
which prevents partial-payment rounding drift.

The reviewed helper does not treat a provider name as proof that every amount is
tax-inclusive. A sale uses explicit `amountBasis` or `taxBasis` metadata, or the
documented Sunze order basis; an otherwise unknown Nayax sale remains unknown.
Separately, a refund request amount remains unknown unless exact cash completion,
exact matched Nayax customer-charge evidence, an authoritative receipt, or
inherited explicit paid metadata proves that amount's basis. The Oklahoma finance
evidence still requires an explicit location/machine, imported field and
effective-date rule before activation. Do not guess the missing rule or change
an unknown basis to zero tax.

The approved period policy recognizes a request in its machine-local receipt
month. A later payment contributes zero; a later unpaid denial, withdrawal or
amount change contributes only its signed difference in the change month. This
accounting date is separate from purchase attribution: retain the proved
original machine, location, account, sale tax basis and existing assignment
terms. Do not infer a request or reversal date from payment completion or the
case's current status.

## Dated reporting treatment controls (`#1708`)

Administrators can retain the existing source default or specify whether card
and cash source amounts include tax, with an independently configured taxable
portion from 0% to 100%. These are reporting assumptions, separate from the
reader's tax settings. The existing statutory-rate history remains separate;
saving a rate and changed treatments together is atomic and records the reason.
No location, product or jurisdiction receives an automatic rule or backfill.

Explicit amount-basis or separate-tax metadata on a source record remains
authoritative. A dated card/cash setting replaces a source default; the
`source_default` choice preserves the existing provider behavior. Tax-exclusive
amounts have no further tax removed, and separately recorded tax is subtracted
only once. For tax-inclusive amounts, let `p` be the taxable portion as a
fraction and `r` the rate as a percentage. Embedded reporting tax is
`round(gross_cents * (p * r) / (100 + p * r))`. A hypothetical $100 receipt at
10% with a 33% taxable portion gives $3.19 reporting tax removed and $96.81
sales excluding tax. A zero taxable portion is explicit; missing evidence is
not silently converted to an exemption.

Refund normalization retains the refund amount's own proved basis and the
original purchase date's applicable taxable portion/rate. A source report that
already excludes tax does not make an actual tax-inclusive customer refund
tax-exclusive. Existing request-month recognition, later change-month reversals
and issued-statement versioning remain unchanged.

The Finance view combines authorized canonical sales/refund calculations per
machine and location. Net sales are sales excluding reporting tax, less request
deductions, plus reversals, less any eligible historical paid deduction. Recorded
money refunds, gift purchase value, issued face value, goodwill and balances at
period end are separate reconciliation context; they do not deduct again.
Unknown accounting is unavailable, with partial activity/coverage identified.
“Reporting tax removed” is not proof of tax collected, legally owed or remitted.
This view is available only where existing sales and refund-analytics access
intersect; it adds no refund decision or payment authority.

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
| September sale, October $10 request, November payment | October -$10; November $0 |
| October $10 request, November unpaid denial | October -$10; November +$10 |
| October $10 request, $4 paid, November denial | October -$10; November +$6 |
| Previously unrecognized eligible unpaid request at cutover | one opening deduction; replay remains zero |

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

## Current late-upload recovery and finance SOP dependency

- Sunze's current primary and backup daily imports replay `Last 7 Days`
  idempotently. A monthly safety run replays `Last Month`, and the existing
  manual import accepts a bounded custom range.
- SnapCase remains on its existing 05:17 and 17:17 UTC cadence. Each routine run
  requests a rolling 34-day window. The existing manual live import and
  historical backfill accept explicit bounded dates and reuse the same
  acknowledged idempotent publication path.
- A late app upload that appears inside those windows can refresh the existing
  sales facts. A correction affecting an issued Pay Stub uses the existing
  targeted stale notification and manager regeneration/version flow; it does
  not overwrite the issued statement.
- These replay windows are recovery coverage, not proof of physical machine
  upload completeness. Keep known sales available and reconcile later arrivals;
  do not infer zero cash from a complete empty response or add a new global
  payroll gate. The twice-daily SnapCase cadence remains unchanged.

The owner and finance team will provide the reporting procedure and location tax
nuances. For each exception, the SOP must identify the exact location and
machine scope, provider surface and field (for example customer Payment amount
versus exported Order/sales total), tax-inclusive, tax-exclusive or separate-tax
treatment, applicable rate, and machine-local effective dates. It must also say
how offline periods are recognized and which existing replay/backfill procedure
is used. Until those facts are supplied, retain the raw attributed observation
and do not create a location identity, date, rate or zero-tax rule.

## Minimum remaining evidence questions

No additional owner choice is needed for the interim mixed source authority or
activation. Nayax customer charges provisionally use the existing configured
machine rate as embedded tax, explicit per-row basis metadata wins, and Sunze
remains tax-exclusive. Missing configured rates retain numeric display with no
provisional deduction and keep the existing incomplete-tax publication state;
that compatibility treatment is not proof of exemption or a 0% rate. The
finance SOP details above remain necessary only to introduce a named
location/field/effective-date exception. A future vendor-card switch would be a
separate recorded decision.
Sunze still needs an independently known timestamp pair for its account-wide
timezone rule.

The owner selected request-month recognition with later change-month reversals.
At activation, previously posted paid deductions remain in place and eligible
previously unrecognized unpaid requests are recognized once in the activation
month. Replaying the cutover must not book them again, and ordinary later
payments or denials must not reopen old issued statements. A true partial request
that differs from the reported amount paid still needs an explicit stored
request target before that case can contribute; current intake captures one
required positive amount and does not distinguish those two facts.

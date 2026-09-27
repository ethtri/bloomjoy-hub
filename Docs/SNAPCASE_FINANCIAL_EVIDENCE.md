# SnapCase financial evidence for reconciliation

This dated read-only evidence record supports the cash/card publication contract.
Implementation subsequently shipped in #1506, #1508, #1512 and #1514. Use the
[operational runbook](../scripts/snapcase/RUNBOOK.md) and [epic #1474](https://github.com/ethtri/bloomjoy-hub/issues/1474)
for live status; this document does not certify complete historical coverage.

Status: read-only evidence record for `#1478`, captured on 2026-09-26. No
provider, Supabase, mapping, deployment, secret, import, refund or payroll state
was changed. No raw transaction or payment identifier is recorded here.

## Publication policy supported by current evidence

- Publish Kexiaozhan cash from the payment's known cash tender and original
  collected amount, using the enumerated paid/refund lifecycle states. Treat
  `paymentAmount` as gross cash collected; a refund-state revision does not erase
  that original gross or create a second deduction.
- Use explicit payment currency first. As an implementation rule, a missing row
  currency may use the source machine's configured USD currency. Preserve that
  provenance; never override an explicit conflicting currency. The direct sample
  below had row-level USD throughout, so it did not exercise this fallback.
- Publish card money only from the existing canonical Nayax scheduled-report
  fact. Kexiaozhan card rows provide order and coverage context; they do not add
  another amount.
- Keep source tax unknown. The sampled Kexiaozhan order rows had empty
  `taxRate` and `taxRateAmount`; absence is not zero. Continue using an approved,
  effective Hub tax rule with derived provenance when reporting requires tax.
- Keep existing Nayax settlement-local sale dates for card facts. A future
  occurrence-time comparison may create a timing exception, but must not
  silently redate existing card history. The owner has confirmed that Kexiaozhan
  sales timestamps use each machine's local timezone; use that IANA zone for
  cash occurrence times and business dates.
- Deduct a refund once through the canonical Hub/Nayax adjustment lineage.
  Kexiaozhan refund fields are corroboration only until their cumulative,
  partial and reversal behavior is documented.

This disjoint authority is the simplest safe rule: Kexiaozhan supplies cash;
Nayax supplies card amount/state; Hub owns mapping, readiness and the one refund
adjustment. Aggregate disagreement remains pending review. Time-and-amount
similarity is candidate evidence only and cannot allocate or link a payment.

## Direct Kexiaozhan observations

The bounded probe used only authenticated `GET /v1/machines`, `/v1/orders` and
`/v1/payments`. One complete September 20 window covered all 22 accessible
machines and stayed below the observed 50-row page cap.

### Order and payment relationship

- The day returned 26 payment rows. Each payment contained exactly one
  `orderNos` entry, all 26 joined exactly to one `orderNo`, and no order appeared
  in more than one payment.
- For those 26 joins, payment amount and payment time equaled the linked order's
  payment amount and payment time.
- Grouped payments remain part of the provider shape because `orderNos` is an
  array. The sample does not prove they cannot occur. Publish once by payment
  identity; linked orders are optional context, not another revenue source or a
  prerequisite for publishing the payment's known cash amount.
- `outTradeNo` was present, but `transactionId` was empty on all 26 sampled
  payment rows. Neither `outTradeNo` nor `orderNo` can currently be treated as a
  shared Nayax reference. A shared reference would strengthen reconciliation,
  but its absence does not veto the disjoint cash/card authority policy.

### Tender, status and amount

The successful payment sample contained:

| Kexiaozhan method | Instrument | Count | Safe interpretation |
| --- | --- | ---: | --- |
| `0` | `creditCard` | 20 | Card context only; do not publish its amount |
| `1` | `cash` | 5 | Cash payment |
| `3` | `creditCard` | 1 | Alternate payment-board card context; processor is unproved |

The merchant UI labels method `0` as POS payment, method `1` as cash acceptor,
and method `3` as payment board. Method `3` is not proof of Nayax or Stripe.

The vendor UI renders `paymentAmount` directly beside the currency symbol and
does not divide by 100. All sampled payment values had two decimal places, all
22 machines reported `USD`, and every payment row reported `USD`. For the five
cash rows, the payment amount exactly equaled the linked order's `paymentAmount`
and `orderAmount`; discount, tip and tax fields were empty. This supports
major-unit parsing to integer cents and `paymentAmount` as gross cash collected
for this tested shape. A present discount, tip or tax field is not itself a ban:
the collector `paymentAmount` remains the cash authority. Another currency or an
unexplained inconsistent monetary relationship must remain an exception until
that shape is proved.

Item quantity remains unknown. The complete 46-row order sample contained no
`quantity`, `qty`, `itemCount` or equivalent item-count field, and the merchant
order UI exposes no quantity column. `materialCount` is material metadata and
must not be treated as item quantity. Singular product fields do not prove one
vend or item per order, and a payment's `orderNos` length is linked-order count,
not item count. Keep order and payment `quantity` null unless a source quantity
contract is proved. Cash gross remains independently publishable from the
authoritative payment amount without per-item allocation or inferred unit cost.

The vendor UI defines payment statuses as `0` unpaid, `1` paid, `2` failed, `3`
refunding, `4` refunded and `5` refund failed. The day sample had 26 status-`1`
payments. The order UI separately defines order lifecycle values, including
completed, cancelled and marked-refunded states; order status is not financial
payment authority.

### Window and zero-sales behavior

`/v1/payments` uses a half-open payment-time interval. A target payment at `t`
was present for `[t,t+1 second)`, absent for `[t-1 second,t)`, present when the
window surrounded `t`, and an empty `[t,t)` query returned zero. Importers should
send an inclusive start and exclusive next-window start as the end.

The same day returned 30 paid/completed orders but only 26 payment rows. Four
paid order `paymentTime` values were outside the requested window, and cancelled
orders without a payment time were also returned. `/v1/orders` therefore cannot
anchor financial coverage even though the UI sends parameters named
`paymentTimeStart` and `paymentTimeEnd`. Payments anchor the financial window;
orders are context.

All 22 per-machine payment and order requests returned their declared totals
without truncation. Eight machines returned zero orders and zero payments. This
proves eight complete source-query zero windows. Implementation must bind the
requested local-day bounds to the mapped machine before recording business-day
coverage; the owner has now confirmed the source clock interpretation.

### Owner-confirmed machine-local time

Payment timestamps are naive strings. Changing `X-App-TimeZone` from `UTC` to
`America/Los_Angeles` changed neither returned rows nor values. Machine inventory
does expose IANA zones: 7 Central, 5 Pacific and 10 Eastern.

The owner has confirmed that sales timestamps use each machine's local timezone.
This resolves the earlier open owner question. Retain the raw timestamp, convert
with the machine's configured IANA zone, and test DST, month boundaries and query
windows. No further owner or vendor timezone confirmation is required. This
decision does not itself activate production jobs or publish financial records.

The owner clarified that Nayax and Kexiaozhan are separate systems and are not
expected to share IDs. The team intentionally aligns machine names across the
systems. The supported mapping proposal is therefore fuzzy normalized-name
similarity plus account/location context. A serial is optional corroboration.
Ambiguous candidates require human review; duplicate or mismatched names are
actionable mapping or naming-cleanup exceptions. The owner applies this same
proposal policy to Nayax-to-Sunze mapping.

After a human reviews that proposal, persist each provider's distinct stable
machine ID in the effective mapping. A later rename must not change transaction
identity or duplicate sales, so the mutable display name is never a transaction
key. Machine-name similarity proposes a machine mapping only; it never links
payments. The current Hub registry has eight SnapCase rows, six with Nayax IDs.
A read-only review found six unambiguous Kexiaozhan name/context candidates for
those six rows; it did not change a name or mapping.

One bounded comparison used those six proposed cohorts and the half-open interval
September 24 through September 27. It found five successful Kexiaozhan card rows
and five positive-authorization USD Nayax rows. Four formed unique same-amount
candidates within 3.74 seconds when Kexiaozhan `paymentTime` was compared with
Nayax `MachineAuthorizationTime`; none formed a same-amount candidate within two
minutes against `AuthorizationDateTimeGMT`. The four candidates occurred across
two Eastern machines. On a Central machine, each source had one row but they did
not form a same-amount candidate within two minutes. That difference remains an
unexplained aggregate discrepancy.

These observations corroborate the subsequently owner-confirmed local-time
interpretation. They do not create exact transaction links. Amount-and-time
proximity remains aggregate/candidate evidence only. The unresolved Central
machine discrepancy is a specific reconciliation item, not a reason to withhold
unrelated cash sales or reopen the timezone decision.

## Direct Nayax and Hub observations

Production currently has the scheduled-report ingest RPC, 171 file receipts and
154 canonical `nayax_scheduled_report` card facts covering September 12 through
September 26. They are settled USD rows. The same receipts reported 1,654
settled source rows in total: 154 imported, 231 unmapped and 1,269 intentionally
excluded for Sunze overlap. Nine scheduled refund observations are present.

This is active ingestion, not complete per-machine coverage. There are no
provider-run control observations yet, and Last Sales is a bounded recent feed,
not a historical window API. Reconciliation readiness therefore needs an exact
machine mapping plus source-window evidence; the existence of a fact or email
attachment does not prove no other card sales occurred.

A bounded read-only Last Sales census observed 2,435 positive authorization rows,
all USD. For 2,280 plausibly settled rows, authorization and settlement amounts
were equal. Settlement followed authorization by a median of 0.01 seconds and a
maximum of 3.007 seconds in this census; none crossed the mapped reporting-local
day or month. Only those 2,280 rows met the full plausible-settled admission
shape; other positive-authorization rows must not be admitted as settled sales.

Nayax `MachineAuthorizationTime` is a machine wall clock distinct from
`AuthorizationDateTimeGMT`. Across the census, its offset from GMT was exactly
`-07`, `-05` or `-04` hours, consistent with the three US zone offsets advertised
by the fleet metadata. Preserve both fields. The current scheduled-report sales fact intentionally uses provider
settlement time and does not retain machine authorization time, so a future
occurrence-window comparison must add that separate observation rather than
reinterpret `payment_time`.

The short observed settlement lag makes a cross-month shift rare, not
impossible. Card publication should preserve the existing settlement-local date.
Reconciliation should account for occurrence and settlement falling in different
periods. An explained timing difference is not a new payroll approval step or a
blanket hold. Investigate a genuinely missing required card import through the
existing import/completion flow without changing canonical settlement dates.

## Refund evidence and policy

Kexiaozhan currently reports 18 payment rows with status `4`. All 18 sampled rows
had `refundAmount=paymentAmount`, and `updateTime` followed `paymentTime` on the
same payment row. No status-`3`, status-`5` or partial payment refund was present.
This shows full-refund mutation behavior in the current sample only. It does not
prove whether `refundAmount` is cumulative, how partial refunds appear, or how a
reversal is represented.

Hub has 14 authoritative Nayax refund receipts, all currently full refunds; the
scheduled-report refund observer adopted six existing receipts, left one for
provider review, and left two unmatched. Use the canonical receipt/case lineage
to create at most one actual deduction. Pending, failed, unmatched or merely
Kexiaozhan-marked evidence cannot deduct revenue. A later partial/refund-reversal
shape stays blocked until its provider semantics and cumulative behavior are
proved.

## Simple implementation and completion rules

The owner's latest direction supersedes the earlier broad readiness checklist:
reuse existing flows, avoid unnecessary safeguards and keep normal reporting
quiet. Do not add a parallel proof framework, approval process or error-heavy UI.

- Attribute money through the existing effective machine mapping. Once mapped,
  a naming difference does not invalidate the stored provider IDs or hold sales.
- Record import success after all requested pages and ingest acknowledgements
  complete. A correctly scoped complete empty response is a normal zero-sale
  result; a failed or truncated request is not a zero.
- Count Kexiaozhan cash and canonical Nayax card/refund money once. Missing
  product labels, item quantities or shared payment IDs do not block known cash.
- Keep importing valid records and retain specific rejected financial records
  for existing admin review. Do not turn one optional-field issue or one machine
  exception into a fleet-wide hold.
- Reuse existing closed-period completion and statement-correction checks for
  actual missing revenue affecting a commission statement. Explained settlement
  timing differences and normal open-month progress do not require approval.
- Show a concise actionable message only where an actual problem affects the
  operation. Keep technical detail in existing admin/log views; do not show a
  permanent warning merely because the selected machine is SnapCase.

The current source-window gaps are implementation work to resolve, not a new
owner sign-off or requirement to upload evidence. Production activation remains
separate from this evidence record and the implementation PRs.

# SnapCase financial evidence for reconciliation

Status: read-only evidence record for `#1478`, captured on 2026-09-26. No
provider, Supabase, mapping, deployment, secret, import, refund or payroll state
was changed. No raw transaction or payment identifier is recorded here.

## Publication policy supported by current evidence

- Publish Kexiaozhan cash only from a successful `/v1/payments` row with
  `paymentMethod=1`, `paymentInstrument=cash`, `status=1`, `currency=USD` and a
  valid two-decimal `paymentAmount`. Treat that amount as gross cash collected.
- Publish card money only from the existing canonical Nayax scheduled-report
  fact. Kexiaozhan card rows provide order and coverage context; they do not add
  another amount.
- Keep source tax unknown. The sampled Kexiaozhan order rows had empty
  `taxRate` and `taxRateAmount`; absence is not zero. Continue using an approved,
  effective Hub tax rule with derived provenance when reporting requires tax.
- Keep existing Nayax settlement-local sale dates for card facts. A future
  occurrence-time comparison may create a timing exception, but must not
  silently redate existing card history. Cash business dates remain blocked
  until the Kexiaozhan clock basis is proved.
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
  array. The sample does not prove they cannot occur. A payment-keyed financial
  fact does not need an order-level allocation, but every linked order must have
  exact membership and must not be reused by another admitted payment.
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
proves eight complete source-query zero windows, but not eight business-day zero
windows until the source clock is proved.

### Time basis remains the narrow blocker

Payment timestamps are naive strings. Changing `X-App-TimeZone` from `UTC` to
`America/Los_Angeles` changed neither returned rows nor values. Machine inventory
does expose IANA zones: 7 Central, 5 Pacific and 10 Eastern.

The owner's current working assumption is that `paymentTime` and its query bounds
use each machine's local time zone from that inventory. The owner explicitly
marked this as an open item to verify. It may guide inactive implementation and
tests, but it is not provider proof and does not activate cash business-date
publication.

The owner clarified that Nayax and Kexiaozhan are separate systems and are not
expected to share IDs. The team intentionally aligns machine names across the
systems. The supported mapping proposal is therefore a unique normalized machine
name plus account/location context. A serial is optional corroboration. Duplicate
or mismatched names are actionable mapping or naming-cleanup exceptions.

After a human reviews that proposal, persist each provider's distinct stable
machine ID in the effective mapping. A later rename must not change transaction
identity or duplicate sales, so the mutable display name is never a transaction
key. The current Hub registry has eight SnapCase rows, six with Nayax IDs. A
read-only review found six unique Kexiaozhan name/context candidates for those
six rows; it did not change a name or mapping.

One bounded comparison used those six proposed cohorts and the half-open interval
September 24 through September 27. It found five successful Kexiaozhan card rows
and five positive-authorization USD Nayax rows. Four formed unique same-amount
candidates within 3.74 seconds when Kexiaozhan `paymentTime` was compared with
Nayax `MachineAuthorizationTime`; none formed a same-amount candidate within two
minutes against `AuthorizationDateTimeGMT`. The four candidates occurred across
two Eastern machines. On a Central machine, each source had one row but they did
not form a same-amount candidate within two minutes. That difference remains an
unexplained aggregate discrepancy.

This strongly corroborates the owner's machine-local working assumption, but it
does not create exact transaction links and does not close the owner's requested
clock verification. Amount-and-time proximity remains aggregate/candidate
evidence only. Publication stays inactive pending the verification below.

The remaining owner/provider verification item before assigning a cash business
date is either:

1. provider confirmation that `/v1/payments.paymentTime` is the machine-local
   wall clock represented by `/v1/machines.timezone`, and that query bounds use
   that same clock; or
2. one supported read-only export/API observation containing the same payment's
   naive `paymentTime` and an offset-aware occurrence timestamp, on an exactly
   mapped machine.

Until then, retain the raw time and machine timezone in private staging, leave
`occurred_at`/business date unpublished, and keep
`source_time_semantics_unverified`.

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
Reconciliation should compare occurrence windows separately and raise a timing
exception when occurrence and settlement fall in different periods. Month-end
readiness must wait for a complete post-boundary card source window rather than
assuming that a last-day occurrence settled in the same month.

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

## Readiness rule for implementation

A Kexiaozhan machine/window is financially complete only when all of the
following hold:

- the exact source machine has an effective Hub mapping and source ownership;
- that mapping was reviewed from a unique normalized name plus account/location
  context, retains both providers' stable IDs, and has no unresolved duplicate or
  naming exception;
- `/v1/payments` pagination reaches the declared total with no rejected rows,
  truncation or cursor remaining;
- the half-open source bounds and source clock are verified;
- every admitted cash row has the proved tender/status/currency/amount shape;
- card population is covered by a complete Nayax source window for the same
  mapped machine, while card money comes only from Nayax;
- timing, unmapped, alternate-card-processor, amount and refund discrepancies
  are either zero or explicitly held for review.

A verified zero requires the same conditions with a complete payment response
whose declared total and observed count are both zero. An empty response without
proved clock, machine and provider coverage remains an extraction zero, not a
commission-ready business zero.

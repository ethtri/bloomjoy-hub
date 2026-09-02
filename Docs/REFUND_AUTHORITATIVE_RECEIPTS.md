# Authoritative full-refund observations with unknown settlement time

This is the bounded `#628` / `#971` reconciliation receipt contract. It does not
choose an accounting period or make a payment. Deployment and hosted database
verification are separate release gates; no production backfill is included.

## Required evidence and authority

Only a current, nonanonymous, mapped Refund Operations super-admin session can
record an observation. The exact selected original transaction, account, machine,
currency, sale amount and full refunded amount must agree with authoritative
Nayax `Refunded` status `62`. Pending, partial, mismatched and stale evidence fails
closed. A receipt binds the latest unresolved attempt, or explicitly binds the
legacy `card_payment_state_without_attempt` integrity hold when no attempt exists.
For a modern existing attempt, this slice requires the supported manual-portal
registration's exact-original/account idempotency key, consumed approval and
request fingerprint. One separately labelled legacy observation lane recognizes
only the documented 20260901 ad-hoc registration shape: exact dated key,
SHA256(case UUID|selected original|amount cents), matching provider reference,
USD/full amount, unresolved manual state, and the companion event's exact attempt,
actor and timestamp relationship. Its historical fingerprint contains **no account
identity**, and the old registration is **not modern authorization**. The server
derives this label; a caller cannot supply it. Ordinary mapped machines only are
eligible, with a separate explicit current provider account/machine/original/full
status-62 observation attestation saved in the immutable receipt. The provenance
event is retained privately; the old attempt and its absent approval stay unchanged.
Other incompatible historical/direct attempts fail closed for separate evidence
review; same amount and latest-row status alone are not proof.
It never creates an attempt to repair historical structure.

The authenticated `refund-case-admin-update` endpoint accepts two evidence-only
modes, implemented by `handleAuthoritativeReceipt`:

- `record_authoritative_receipt` calls `admin_record_refund_authoritative_receipt`.
  Its fields are `caseId`, nullable `attemptId`, `expectedCaseVersion`,
  `accountScope`, `providerMachineId`, `originalTransactionId`,
  `originalAmountCents`, `refundedAmountCents`, `currencyCode`, `providerStatus`
  and the exact `evidenceReference` (`DTM:NAYAX-` plus the selected original), plus
  `reviewedCurrentProviderObservation: true`.
- `adopt_completion_notice` calls `admin_adopt_refund_completion_notice`.
  Its fields are `caseId`, `receiptId`, `gmailMessageId`, `expectedCaseVersion`,
  `completionCaseReference`, `completionOriginalTransactionId`,
  `completionAmountCents` and `reviewedFullRefundNotice: true`.

Unknown fields, including any supplied observation/settlement timestamp, are
rejected by the handler. Exact replay is idempotent. Conflicting evidence needs
internal review, not another payment or notification.

In `/refunds`, open the exact card case's existing decision/reconciliation panel.
The **Nayax confirms a full refund, but no settlement date?** section shows the
selected claim, original, account/machine and full amount. Enter the exact source
reference and attest to the reviewed full-refund evidence, then choose **Record
full-refund observation only**. No settlement date input exists.
Legacy provenance is visibly labelled before and after saving. A preserved row
or current inventory bridge is not a fresh provider-account review: if current
account/machine evidence is unavailable or mismatched, do not attest or save.

The same panel then loads eligible already-sent messages, including an explicitly
reviewed related-case thread. Read the actual plain-text message, attest to this
claim/original/amount only, and choose **Use existing notice · do not send again**.
**Refresh saved evidence** re-reads the private receipt/adoption, so reopening the
case does not require preserving an ID or repeating either write. Missing sent
evidence stays internal synchronization/review work, never a prompt to resend.
The authenticated overview RPC independently checks current session and exact
machine mapping; receipt tables remain unreadable through the public Data API.
Successful record/adoption invalidates the actual parent overview and payment
availability query keys as well as receipt/reconciliation views, so current
progress and disabled payment controls refresh without reopening the case.

## Time, accounting and communication remain separate

The append-only receipt records server `observed_at` and explicit
`settlement_time_precision = unknown`, with `settled_at` always null. A provider's
unchanged sale/update date is not a refund settlement date. No completion
timestamp, successful execution attempt or sales adjustment is fabricated.

The canonical customer/workbench projection recognizes confirmed payment only
because the receipt exists. It says accounting-date review is internal work,
offers no retry and makes no dated bank-arrival promise. Existing dated
completion, payment, adjustment and customer-send paths are blocked for these
cases. A separately reviewed accounting finalization contract is still required
to clear that internal work; this slice intentionally provides no date policy.

Notice adoption requires an already-ingested, provider-identified Gmail `sent`
message in the exact case's original or explicitly reviewed related-case thread,
addressed from the canonical mailbox
to that case's customer. An operator must review the actual content and attest to
the exact claim/original/amount; thread membership alone is not completion proof.
A combined notice cannot silently complete another pending claim in that thread.
The immutable adoption snapshots digests and actual send time, not copied content.
Existing CC evidence is retained as found; a missing manager CC is recorded as
unverified, never fabricated and never repaired by sending the customer again.
Before adoption, payment is confirmed at progress rank 70; only an exact adopted
notice advances to `customer_notified` at rank 80. Accounting remains pending in
both states, and a related claim's adoption does not alter the primary claim.

No provider call, customer send, import, lifecycle backfill or production mutation
is part of this implementation. Receipt identities and mail evidence are private;
public projections and audit events are redacted.

## Verification and release

Run `npm run refunds:validate-authoritative-receipt`, the full application checks,
and `supabase/tests/refund_authoritative_reconciliation_receipt.sql` in the
disposable hosted migration test workflow. Before deployment, sync onto canonical
main and regenerate the refund release manifest for the final source commit.
The unapplied receipt migration must sort after the current core delivery repair;
its outer send guards wrap the current core implementations, not earlier copies.
The disposable runner compares all four exact function bodies and service-only
permissions against source before and after populated-upgrade regressions.
Deploy database contract, tracked `refund-case-admin-update` function and frontend
as one gated release. Verify the existing workbench/customer copy with synthetic
receipt cases at desktop and mobile widths. Never use production rows as fixtures.

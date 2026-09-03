# Historical owner-mailbox notice review

This is evidence-only historical reconciliation, not an alternate email workflow. It follows the authoritative receipt and machine-correction migrations. The fixed historical cutoff is September 2, 2026, 19:51:58 UTC; future/new owner-mailbox messages are ineligible.

## Operator contract

1. Open the exact confirmed refund receipt in `/admin/refunds`. Current verified sign-in must own the historical sender mailbox and retain a live session, Super Admin authority and active manager mapping for the current machine.
2. Choose **Already notified from your own mailbox before the cutoff?** Supply the original lowercase Gmail API message/thread IDs, original UTC sent time, sole customer recipient and SHA-256 reviewed-message fingerprint from the private evidence packet. Do not use browser fragments or RFC Message-ID headers as API identifiers.
3. Review the original owned-mailbox Sent message, its customer-only recipient/no CC or BCC, and the exact claim/full amount. Receipt bindings do not assert that the email literally contained the original transaction, account, machine or currency identifiers.
4. Record historical notice only. A current-case read precedes the authenticated write. Changed evidence or version clears review; a failed save requires fresh review. A successful save stays saved through delayed/failed parent refresh.
5. Reopen to verify **Historical owner-mailbox notice recorded — operator reviewed; no manager CC**. This does not verify delivery or support-thread ownership. The original SENT time is separate from current server observation time and unknown settlement time.

No customer contact, payment, accounting, mailbox ingestion, source-history rewrite, sender alias or OAuth configuration is part of this action. A claim without a confirmed full-refund receipt cannot adopt a notice. One message cannot complete multiple claims, even in the same thread. Existing support-mailbox adoption remains its separate unchanged path.

An opaque SHA-256 review binding ties checked evidence to the current validated session, user and verified normalized email. It contains no raw identity, token or secret. The write compares it before replay or insert; changing actor, session or email requires fresh review. This binding is not a substitute for current authority checks.

## Verification

- `npm run refunds:validate-authoritative-receipt` includes the new strict handler/client tests and actual component/API execution checks.
- `supabase/tests/refund_historical_owner_notice.sql` checks real authenticated writes, authority/identity/version/evidence negatives, exact replay, both source shapes, immutable histories, canonical lifecycle and zero send/payment/accounting effects.
- `supabase/tests/refund_historical_owner_notice_concurrency.sql` uses a disposable database and two real sessions. It proves waiting locks for same-case replay, support-vs-owner contention and different-case same-message uniqueness. Committed synthetic fixtures are removed only after assertions with the named immutable guards restored in the same cleanup transaction.
- Existing source-derived receipt/core wrapper parity runs before and after populated upgrade tests. This migration does not replace the support adopter, lifecycle projector or delivery functions.
- Browser verification must exercise the actual workbench on desktop/mobile: edit evidence after checking it, refresh a changed version, revoke access at save, hold/fail parent refresh after success, close/reopen and confirm no payment/send/footer actions. Use synthetic data only; never put private production evidence in screenshots or PRs.

Deployment and any production observation remain separate release-coordinator actions. Worker pauses and other production activation holds are not changed by this feature.

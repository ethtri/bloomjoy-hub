# Working Nayax refund API contract

Verified in production on September 8, 2026. This is the starting point for all
Bloomjoy refund API implementation and troubleshooting. Historical incident
notes are not the current permissions or execution baseline.

## Permissions and successful execution are established

**Bloomjoy's canonical active account and its existing separate request and
approval credentials have working production refund permissions.** Both stages
succeeded without changing the account, granting roles, rotating tokens, or
asking Nayax to enable anything. Use the existing account-scoped write slots;
do not substitute a reporting token or another user's account.

- Valley: full $26.50 API request, exact DTM status 63 (Refund Requested), one
  guarded approval of that same request, then exact DTM status 62 (Refunded).
- Great Mall: full $10.90 through the normal manager flow, exactly one new
  request and one approval, independently confirmed DTM status 62, one reporting
  adjustment, and customer completion in the original thread with managers copied.
- Both customers were subsequently notified. Valley's supported authoritative
  receipt preserves an unknown settlement time; its accounting date remains a
  separate question. Great Mall needed one email-only recovery after payment
  success. Neither payment may be repeated.

Evidence: [first attributed success](https://github.com/ethtri/bloomjoy-hub/issues/990#issuecomment-5581170824),
[normal-flow success and customer completion](https://github.com/ethtri/bloomjoy-hub/issues/990#issuecomment-5581337850).
Exact transaction IDs, journals and private receipts remain in restricted records.
The older Eastridge refund still has unproved API attribution; do not rewrite it.

## Use this request and approval flow

Production base URL: `https://lynx.nayax.com/operational/v1`. Nayax's documentation
examples use a QA URL; do not copy that host into production.

Use `Authorization: Bearer <stage-specific credential>`, `Content-Type:
application/json`, and `Accept: application/json`. Credentials stay server-side.
An ordinary manager decision authorizes the exact matched purchase and full
original amount; no separate API-test approval is needed.

1. Obtain the exact original transaction and Site ID from the selected machine's
   Last Sales evidence. Site ID is a provider identifier, not a location name.
2. Send `POST /payment/refund-request` using numeric `TransactionId` and `SiteId`,
   full `RefundAmount` in **major currency units** with exact-cent conversion,
   `RefundReason`, and **`RefundEmailList: ""` explicitly present**. Do not omit
   the email field or replace it with null. An original 1090 cents becomes 10.9,
   not 1090; zero or omitted amount is not a full-refund shortcut.
3. For `MachineAuTime`, preserve the exact raw `MachineAuthorizationTime` string
   and fractional precision from the selected evidence. Use `exact_source`.
   Do not substitute `AuthorizationDateTimeGMT`, normalize through a local Date,
   or append `Z` or an offset. An offset experiment produced a combined
   access-or-transaction-credentials error despite working permissions.
4. After the database journal authorizes approval of the accepted request, send
   `POST /payment/refund-approve` with `IsRefundedExternally: false` and the
   **identical** `TransactionId`, `SiteId`, and `MachineAuTime`. Omit
   `RefundDocumentUrl` for this ordinary API refund. Use the approval credential.
5. Verify the exact original's full amount and final status independently in
   DTM when report evidence is insufficient. Keep payment, accounting and email
   results separate. Recover a failed email through its existing message flow,
   never by issuing another refund.

Synthetic illustration only; never send these example identifiers to production:

Request body:
```json
{"RefundAmount":10.9,"RefundEmailList":"","RefundReason":"Bloomjoy manager-approved customer refund","TransactionId":123456781,"SiteId":2,"MachineAuTime":"2026-01-02T13:47:39.017"}
```

Approval body for that same accepted request:
```json
{"IsRefundedExternally":false,"TransactionId":123456781,"SiteId":2,"MachineAuTime":"2026-01-02T13:47:39.017"}
```

The tested, nonsecret configuration is
[`scripts/refunds/fixtures/nayax-production-refund-contract.json`](../scripts/refunds/fixtures/nayax-production-refund-contract.json).
It is a response/payload configuration, not executable payment authority or a
credential file. The production overrides are
`NAYAX_REFUND_MACHINE_AUTHORIZATION_TIME_MODE=exact_source` and
`NAYAX_REFUND_EMAIL_LIST_MODE=empty_string`. These values and the actual timestamp
wire are frozen with the attempt; continuation must not rebuild them from new
configuration. Keep `writeCredentialMode=separate` and
`sameWriteTokenContractConfirmed=false`.

## The exact response that succeeded

Both stages returned HTTP 200, JSON object, with this exact pair:

```json
{"Result":"Refund status updated successfully, but the email could not be sent","Status":"Partial success"}
```

| Stage | Verified meaning | Next action |
| --- | --- | --- |
| Request | Accepted; independently observed as DTM 63 | Approve this existing request once through the journal-authorized flow |
| Approval | Succeeded; independently observed as DTM 62 for the full amount | Record completion and deliver Bloomjoy's customer notice |

The email failure is not a refund failure. Our previous configuration omitted
the email field and had no recognized success pairs. Explicit empty email made
the request work; recognizing the proven pair enabled the normal chain. This is
the verified fix on our side, not proof of Nayax's internal implementation or
the cause of every historical failure.

Do not generalize this to every `Partial success`, any HTTP 200, an unfamiliar
pair, malformed JSON, timeout or transport failure. Unlisted responses remain
unknown. Never reclassify an immutable historical attempt merely because a new
contract has been learned. The temporary guarded Valley approval established
evidence; it does not reactivate the retired `approve_pending_request` route.

## Investigate our integration before blaming permissions

Start with the proven working account and contract above. A generic permission-
sounding error is **not evidence that permissions are missing**: it can also mean
the transaction identity or timestamp is invalid. Read current official docs,
compare the actual frozen outbound body and stage credential selection with this
contract, inspect retained Result/Status and journal decisions, and check exact
provider state. Fix demonstrated differences and test them with synthetic
responses before another authorized live operation.

An uncertain response may already have created or completed a refund. Pending
means continue that request; Refunded means no more payment calls. A changed
request is eligible only after authoritative no-refund reconciliation through
the existing supported flow. Keep duplicate prevention and existing manager
authority intact; this guidance adds no new approvals, caps or rollout gates.

Reopen a permissions diagnosis only with new concrete evidence for the exact
active account/stage credential, such as a verified revocation or provider log
identifying a scope defect. Do not request roles, rotate tokens, or email Nayax
on the strength of an old summary or ambiguous error text. If support is needed,
state observations and remaining questions, include the successful baseline,
and label hypotheses as hypotheses. Sending still requires existing explicit
authority; this document does not authorize correspondence.

## Verification and primary references

`npm run refunds:validate-nayax-provider` exercises the working contract through
the real adapter with synthetic transactions and mocked transport, including
stage separation and failure holds. It sends no real refunds.

[Nayax request guide](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds)
documents the fields and source identifiers;
[approval guide](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund)
requires reusing the request identifiers. The literal success pair and explicit
empty-email behavior above come from Bloomjoy's verified production evidence,
not from an assumed complete response enumeration in those guides.

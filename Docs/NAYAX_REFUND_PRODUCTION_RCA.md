# Nayax Refund Production Root Cause Analysis

Last updated: 2026-09-03

## Executive finding

**The historical Eastridge `$10.90` refund is confirmed; its attribution to Bloomjoy's API calls is unproved.** September 3 review of the original request and both approval logs found provider-reported failures. Later Nayax Support and DTM confirmation establishes that the transaction was refunded, but does not establish which operation or actor completed it. The earlier claim that this case proved API write capability was too strong.

The unresolved problem is narrower and more technical:

1. Bloomjoy has not yet proved one direct, fully automatic request -> approval -> finalization run whose immediate API responses were classified correctly without Nayax Support or Dynamic Transactions Monitor (DTM) reconciliation.
2. Nayax returns business meaning in the JSON `Result` and `Status` fields, but its public contract does not publish the literal accepted/rejected values that Bloomjoy must match.
3. An outer HTTP `200` is not proof of business acceptance. Nayax's provider-owned log for the later held `$8` request proves an HTTP-`200` business rejection.
4. Nayax's public Lynx documentation does not identify a read-only refund-status endpoint. DTM or a Nayax Support confirmation is therefore the authoritative fallback when the write response is ambiguous.

These failures also do not establish that the calls had no side effects or that the API cannot refund. The owner's September 2 API-first operating decision remains unchanged; safe execution and its end-to-end proof remain implementation work in `#990`.

## What each kind of proof means

These states must not be collapsed into one “success” label:

| State | What it proves | What it does not prove |
| --- | --- | --- |
| HTTP success | Nayax's HTTP surface returned a `2xx` response | The refund request was accepted, approved, or paid |
| Request accepted | Nayax created a pending refund request | The separate approval completed or money was returned |
| Provider refund confirmed | Nayax/DTM shows the refund as completed | Which call or actor caused it, or whether Bloomjoy classified both write responses automatically |
| Bloomjoy settled | The case, reporting adjustment, audit, and customer completion were committed exactly once | The provider call itself was successful unless linked to authoritative provider evidence |
| Direct end-to-end success | One manager action produced one accepted request, at most one accepted approval, authoritative provider success, and exactly-once Bloomjoy settlement without manual provider reconciliation | Nothing further for that case; this is the required launch proof |

The historical Eastridge case reached **provider refund confirmed** and was reconciled into Bloomjoy. Its final refund cannot be attributed to the reviewed API calls from the retained evidence, and it does not establish **direct end-to-end success**.

## Production evidence timeline

### 1. Historical Eastridge refund: outcome confirmed, API attribution unproved (`#877`)

- Bloomjoy attempted a legitimate Eastridge `$10.90` refund through its normal manager/API path.
- The original August 20 request returned HTTP `200` with business `Status: failed` and a combined access-or-transaction-credentials rejection. It did not report acceptance. A later **Refund Requested** observation does not by itself link that state to this request.
- The then-current normal-manager implementation lacked the controlled pilot's complete stage journal, so Bloomjoy could not reconstruct the safe response envelope afterward.
- One application recovery reservation was used. Both original approval logs return outer HTTP `500` / inner HTTP `400`, the same combined access-or-transaction-credentials error, and the same transaction/site/authorization-time identity as the request. The historical Bloomjoy journal cannot map both provider entries to one definitive application cause. These are provider-reported failures, not proof of zero side effects. DTM initially remained **Refund Requested**, and no further blind retry was permitted.
- The fresh exact-original DTM record identifies Eastridge, full refund status, the same $10.90 amount, and a refund requester different from the reviewed API caller. That requester field alone does not identify the operation that completed it. The older Tulsa label conflated separate incidents.
- Nayax Support later confirmed that the payment appeared refunded. DTM/production reconciliation agreed, and Bloomjoy committed one case completion, one reporting adjustment, and one customer completion without another refund request.

**Conclusion:** the later refund and its reconciliation are confirmed. The initiating operation and actor remain unproved; this case cannot substantiate the prior claim of successful API execution. Preserve the historical attempt records rather than rewriting them to fit either conclusion.

### 2. Second Tulsa incident: cross-layer contract drift exposed (`#961`)

- A separate manager-authorized request returned HTTP `200` with an unfamiliar `Result`/`Status` pair.
- The Edge/provider layer had been changed to allow an unfamiliar successful `2xx` to advance, but the database journal still required an exact accepted pair before it would authorize approval.
- The database correctly refused the approval-start marker; the Edge layer incorrectly generalized that internal rejection as a provider transport exception.
- The regression tests had exercised an in-memory stage callback, not the real migrated database transition. They therefore missed the Edge/database disagreement.
- Later DTM evidence showed a separate negative Tulsa refund transaction. Bloomjoy used provider-free, evidence-only reconciliation and made no duplicate provider call.

**Conclusion:** this incident proved a Bloomjoy code/integration defect—two layers disagreed about the approval transition. It did not prove a Nayax outage or a missing account role.

### 3. First later `$8` attempt: request/approval ambiguity, no refund (`#990`)

- One legitimate manager confirmation created one immutable attempt.
- Bloomjoy sent exactly one request and one approval under the then-current unfamiliar-`2xx` transition rule.
- The request returned HTTP `2xx` without a proven contract match. The approval returned HTTP `500`.
- Bloomjoy correctly created no retry, case completion, reporting adjustment, or customer-success message.
- Authoritative DTM evidence later proved no refund occurred. The attempt was released provider-free and was never replayed.

**Conclusion:** this attempt did not refund the customer. The retained evidence does not prove whether the approval failed because of payload values, token scope, provider state, or another Nayax-side validation rule.

### 4. Second later `$8` attempt: definitive request rejection over HTTP `200` (`#990`)

- A later fresh manager action made exactly one request and no approval.
- Journal v3 captured HTTP `200`, `application/json`, a valid object, string `Result`/`Status` fields, and a semantic mismatch without storing the raw values.
- Nayax's provider-owned API log `17117058946` authoritatively classified that exact request as a business rejection.
- DTM showed no refund amount or refund requester. Bloomjoy performed provider-free no-refund reconciliation, returned the case to review under a new generation, and created no completion, adjustment, or customer message.

**Conclusion:** this was not an “unknown HTTP response” and not a refund success. It was a rejected business request carried over HTTP `200`. The exact rejection reason remains provider-owned and unconfirmed.

## Root causes

### Confirmed root causes

#### A. Nayax's public response contract is incomplete for safe automation

The public request and approval references describe a JSON response with `Result` and `Status` strings, but do not enumerate the literal accepted, rejected, pending, duplicate, or already-refunded values. Bloomjoy cannot safely turn undocumented examples or guessed spelling/casing into production money-movement authority.

The latest production log also proves why HTTP status is insufficient: the transport returned `200` while the business operation was rejected.

#### B. Historical Bloomjoy code used conflicting response rules

PR `#905` made an unfamiliar request `2xx` eligible to advance in the provider layer. The database transition delivered earlier still required an exact accepted pair. That cross-layer drift caused one real request to stop at the database boundary before approval.

The later journal-v2 change temporarily made the database the sole transition authority and allowed an unfamiliar request `2xx`. Production evidence then proved that rule was unsafe because Nayax can return a business rejection over HTTP `200`.

Journal v3 now requires exact HTTP `200`, `application/json`, a valid JSON object, string `Result` and `Status` fields, and an exact account-confirmed accepted pair before approval. An unfamiliar `2xx` cannot advance.

#### C. Historical evidence was insufficient to diagnose the approval failures

The first normal-manager path did not retain the complete privacy-safe stage envelope used by the controlled pilot. Later approval evidence also contained conflicting layers—outer `500`, inner `400`, and eventual provider refund evidence. That history cannot support a defensible single cause such as “bad credentials” or “wrong payload.”

Journal v3 repairs this observability boundary by storing only safe envelope classes and a keyed digest: HTTP class, media type class, body/JSON/schema markers, semantic-match booleans, and bounded failure classes. It deliberately does not store raw provider values, tokens, or customer/payment data.

#### D. There is no proved automatic final-status readback

Nayax documents DTM as the place where a pending request and later approval/decline status can be seen. Its public Lynx documentation does not identify a GET endpoint that authoritatively returns the final refund state. This leaves Bloomjoy dependent on DTM, Support, or a separately validated report-delivery contract after an ambiguous write.

That limitation does not prevent refunds. It prevents Bloomjoy from claiming fully automatic final reconciliation until a supported readback contract is implemented and proved.

### Not established as root causes

The evidence does **not** currently prove any of the following:

- that Nayax's refund API is unavailable;
- that the canonical active user lacks account-level request or approval roles;
- that the current request and approval tokens have a specific scope defect;
- that the `$8` request was rejected because Bloomjoy selected the wrong transaction;
- that `RefundAmount`, `RefundEmailList`, `MachineAuTime`, or another payload value caused the rejection;
- that either an HTTP `200` or an HTTP `500` alone describes the final money-movement outcome.

These remain hypotheses until Nayax ties an exact provider log to an exact reason or supplies an authoritative account/token contract.

## Current code and payload audit

The current server adapter in `supabase/functions/_shared/nayax-refund-provider.mjs` matches the shape of Nayax's published write contract:

| Stage | Current Bloomjoy behavior | Public-contract comparison |
| --- | --- | --- |
| Request | Sends `RefundAmount`, a bounded reason, `TransactionId`, `SiteId`, `MachineAuTime`, and contract-controlled email-list behavior | Same documented request fields |
| Approval | Sends `IsRefundedExternally: false` and repeats the exact `TransactionId`, `SiteId`, and `MachineAuTime` | The guide requires the same three identifiers; the external flag is for refunds already processed by a billing provider, so `false` is the ordinary Nayax-issued path |
| Authorization | Uses Bearer authentication and separate server-only request/approval credential slots | Same documented authentication scheme; separate credentials are a Bloomjoy least-privilege safeguard |
| Response classification | Requires exact HTTP/media/JSON/schema/semantic evidence | Stricter than the incomplete public response description, intentionally fail-closed |
| Approval authority | Uses the database journal's returned decision; JavaScript cannot independently authorize approval | Repairs the historical cross-layer drift |

This structural match is meaningful but not a successful-production proof. The following account-specific facts still require Nayax confirmation:

- literal, case-sensitive accepted and rejected `Result` + `Status` pairs for request and approval;
- the precise reason for the business rejection in provider log `17117058946`;
- whether either active token has a token-specific scope restriction despite the account's provider-confirmed roles;
- the production interpretation of refund amount units/rounding and whether omitted versus empty notification-email behavior affects this account.

No code or configuration should be changed to one of these hypotheses without provider evidence.

## Why production remains held

The hold is not a claim that refunds are impossible. It prevents a duplicate or wrong refund while Bloomjoy cannot yet distinguish every accepted and rejected provider response deterministically.

While the response-contract hold is active:

- do not replay either `$8` transaction;
- do not send an approval for either historical request;
- do not use a historical Tulsa or `$8` case as the direct operating proof;
- do not infer acceptance from HTTP `200`;
- do not rotate roles or tokens unless Nayax identifies an exact scope defect;
- use only provider-free DTM/Support reconciliation for a held attempt.

## Current provider-response wait state

Provider-free reconciliation of both later `$8` attempts is complete. Neither attempt is pending or replayable, and no refund request or approval is currently in flight. The production hold now exists only because Bloomjoy lacks the provider-owned response contract and rejection explanation required for one fresh direct proof.

The confirmed escalation routes are Nayax Support case `#03594386` and routing tickets `#03624855`, `#03624856`, and `#03624867`. A copy sent to `integration-support@nayax.com` bounced with a recipient-address rejection, so that address is not a delivered or working route. No substantive human response had arrived by this 2026-08-28 refresh.

A read-only mailbox monitor checks the relevant owner mailbox at 8:00, 11:00, 14:00, and 17:00 Pacific on weekdays beginning 2026-08-31. It remains quiet when nothing material changes and must not send email, change mailbox state intentionally, edit the repository, alter Supabase or Nayax, or issue or approve a refund. When a substantive response arrives, it reports what Nayax confirmed, the exact remaining fact, and the safest next step; it does not automatically take the next external or financial action.

While waiting, Bloomjoy can keep the RCA, regression coverage, issue state, and response-ready implementation path current. It cannot safely register guessed response literals, change payload values, rotate users/roles/tokens, select a live transaction in advance, or run another provider write to discover the answer.

## Resolution plan and exit evidence

1. Use only the confirmed Support case and routing tickets to obtain the literal, case-sensitive accepted and rejected `Result` + `Status` pairs for both request and approval. Do not reuse the bounced integration-support address.
2. Obtain Nayax's exact classification of provider log `17117058946`, including any token-scope or payload-field defect. Do not request another provider write to learn this.
3. If the evidence requires a change, make the smallest server-only contract/configuration correction. Keep all token values out of code, logs, docs, issues, and the browser.
4. Run the complete local/database/provider regression suite. Preserve exact manager authority, immutable attempt generations, one request/at-most-one approval, caps, idempotency, duplicate protection, circuit breaker, kill switch, and uncertainty hold.
5. Select one new, legitimate, owed customer refund of `$10` or less with no prior provider attempt or refund and one exact matching transaction.
6. Perform one manager-confirmed **Refund $X** action. Immediately verify the request and approval classifications and confirm the final provider state in Nayax.
7. Prove exactly one Bloomjoy case completion, reporting adjustment, audit outcome, and customer completion message, with no wrong payment or duplicate.
8. Leave the ordinary qualified lane enabled only after that direct proof and start issue `#427`'s fresh 72-hour observation from the successful production refund.

## Evidence sources

- GitHub issues `#877`, `#961`, `#990`, and `#971`, including their newest sanitized production receipts.
- Production's append-only refund attempt, stage-journal, reconciliation, case, adjustment, event, and delivery records, inspected read-only.
- Nayax Core DTM and provider-owned Lynx API Logs, inspected read-only.
- Nayax Support's confirmation of the historical Tulsa refund and the canonical account's roles.
- Nayax public documentation:
  - <https://devzone.nayax.com/reference/lynx/payment/request-a-payment-refund>
  - <https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds>
  - <https://devzone.nayax.com/reference/lynx/payment/approve-payment-refund>
  - <https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund>

Raw provider response values, credentials, IP addresses, customer data, and card data are intentionally excluded.

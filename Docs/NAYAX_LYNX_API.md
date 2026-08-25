# Nayax Lynx API Notes

Last updated: 2026-08-25

## Purpose
Bloomjoy is evaluating Nayax Lynx as the server-side source for machine inventory and machine-level sales activity.

Do not call Nayax directly from the browser. Any implementation should run through Supabase Edge Functions or another backend-only surface.

## Current Release Status

- The first normal production request created one DTM **Refund Requested** row but returned a response pair outside Bloomjoy's guessed contract. Nayax later confirmed the transaction appears refunded, and Bloomjoy reconciled that historical attempt exactly once with no duplicate provider call.
- Nayax's API log records two identical approval POSTs for that historical attempt. Both returned outer HTTP 500 because the inner service returned HTTP 400 with `refund_approve_refund_bad_request`. Support described missing user-level roles only as a possibility, not a confirmed requirement. The successful refund is authoritative; no additional permission confirmation is required for routine launch and the historical transaction must never be called again.
- The audited provider-outcome resolution migration and its three reviewed functions are deployed **default-off**. They seed no operator and do not enable an official action, a provider call, a refund, or a customer message.
- The repaired normal manager function requires an explicit reviewed production contract and an exact Edge/database version handshake. The database journal alone decides whether a request may advance: exact acceptance or an unfamiliar successful `2xx` may authorize one approval; every rejection, duplicate, already-refunded, pending, non-2xx, timeout, network, ordering, or version failure stops before approval.
- Normal execution also requires separate account-scoped request and approval write credentials, explicit approval-scope confirmation, and an exact non-customer canary or separate broad-reopen approval. An unresolved v2 attempt pauses new normal refunds for that Nayax account. Deployment by itself leaves all execution gates closed.
- Issue `#877` added keyed redacted stage journaling and a default-off single-use approval-only recovery for the historical incident. Routine execution no longer depends on a temporary pilot contract secret, and an invalid environment override still fails closed.

## Current Production Credential Status
- Production Supabase project: `ygbzkgxktzqsiygjlqyg`
- Server-only reporting/lookup secret name: `NAYAX_LYNX_API_TOKEN`
- Normal write secret names: `NAYAX_REFUND_REQUEST_WRITE_TOKEN_<ACCOUNT_KEY>` and `NAYAX_REFUND_APPROVE_WRITE_TOKEN_<ACCOUNT_KEY>`
- Local development may use `.env` only on the agent machine. Never commit token values.
- Never prefix this token with `VITE_`; Vite exposes `VITE_` values to the browser.

The secret was added to Supabase on 2026-05-11 and verified by name/digest with:

```bash
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg
```

Read-only lookup functions may read the reporting token with:

```ts
const nayaxToken = Deno.env.get("NAYAX_LYNX_API_TOKEN");
```

The reporting token is read-only lookup authority only. Normal refund writes require both dedicated account-scoped request/approval slots; there is no reporting-token or generic-token fallback. Never use the reporting token as a write-permission probe.

## Verified Endpoint Status
Base path that works in production:

```text
https://lynx.nayax.com/operational/v1
```

Do not use `/operational/api/v1` for the currently tested production calls. That path returned `404` for last-sales checks.

Live API validation on 2026-05-11:

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /machines?ResultsLimit=1000` | `200` | Returned 43 machines. |
| `GET /machines/{MachineID}/lastSales` | `200` | Returned `200` for all 43 checked machines. Some machines have no recent sales. |
| `GET /devices?pageSize=1` | `403` | Nayax permission gap. Latest message: `You are not allowed to view this content`. |
| `GET /dashboard/widgets?screenTypeId=1` | `403` | Reporting widget permission gap. |
| `GET /dashboard/widgets?screenTypeId=2` | `403` | Reporting widget permission gap. |

Recent device failure correlation IDs captured during support testing:
- `M7XIgFESb0Oy5GOO`
- `wr1Q9ak1vUKZRrn8`
- `0eLcPE8l5kqc305I`

## Field Coverage From Working Calls
`GET /machines?ResultsLimit=1000` returned the machine identifiers needed for a first integration:
- `MachineID`
- `ActorID`
- `OperatorActorID`
- `MachineName`
- `MachineNumber`
- `MachineStatusBit`
- `MachineTypeID`
- `VPOSSerialNumber`
- `DeviceSerialNumber`
- `VPOSID`
- `DeviceID`

Observed coverage:
- 43 of 43 machines had `MachineID`, `MachineName`, `MachineNumber`, `MachineStatusBit`, and `MachineTypeID`.
- 34 of 43 machines had `VPOSSerialNumber`, `DeviceSerialNumber`, `VPOSID`, and `DeviceID`.

`GET /machines/{MachineID}/lastSales` returned transaction fields suitable for recent sales ingestion:
- `TransactionID`
- `PaymentServiceTransactionID`
- `PaymentServiceProviderName`
- `MachineID`
- `MachineName`
- `MachineNumber`
- `AuthorizationValue`
- `SettlementValue`
- `CurrencyCode`
- `PaymentMethod`
- `RecognitionMethod`
- `ProductName`
- `Quantity`
- `AuthorizationDateTimeGMT`
- `MachineAuthorizationTime`
- `SettlementDateTimeGMT`

Observed sales validation:
- 43 of 43 machine last-sales calls returned `200`.
- 29 of 43 machines returned at least one recent sale in the tested response.
- 2,886 recent sales were fetched across the checked machines.

## Do We Need Devices?
Not for the first useful integration.

Use `machines` plus `machines/{MachineID}/lastSales` for:
- machine sync
- machine ID/name/number/status mapping
- Bloomjoy customer or reporting-machine mapping
- recent sales ingestion
- basic transaction and revenue views if the sync runs regularly and stores results

The `devices` endpoint is only needed for hardware/payment-terminal management, such as:
- full terminal inventory
- IMEI, chip ID, board serial, or hardware serial details
- device transfer or disable workflows
- payment-reader troubleshooting separate from the machine record

## Bigger Permission Gap
The next permission to request from Nayax is probably reporting widgets, not devices.

`lastSales` is a recent/latest transaction endpoint. It is useful for polling and storing sales, but it is not the same as a clean historical reporting API with date ranges and rollups.

Ask Nayax to enable or confirm access to:
- `GET /operational/v1/dashboard/widgets?screenTypeId=1`
- `GET /operational/v1/dashboard/widgets?screenTypeId=2`
- `POST /operational/v1/dashboard/get-widget-data`

## Implementation Guidance
Recommended first slice:
1. Add a Supabase Edge Function that reads `NAYAX_LYNX_API_TOKEN`.
2. Pull `GET /machines?ResultsLimit=1000`.
3. Store or map `MachineID`, `MachineName`, `MachineNumber`, and status fields to Bloomjoy reporting/admin records.
4. Poll `GET /machines/{MachineID}/lastSales` per known machine.
5. Upsert by `TransactionID` to avoid duplicates.
6. Store only reporting-safe transaction fields. Avoid storing card digits or customer/payment identifiers unless there is a documented need.

Do not build browser-side Nayax calls, and do not expose Nayax raw responses in public or customer-facing pages without a privacy review.

## Refund Execution Guardrails

The versioned matching weights, states, timezone rules, privacy-safe evidence, fixtures, and rollback procedure are documented in [REFUND_NAYAX_MATCHING_RUNBOOK.md](./REFUND_NAYAX_MATCHING_RUNBOOK.md).
Refund execution is separate from read-only Last Sales lookup.

The deployed foundation includes `nayax-card-refund` as a backend-only, fail-closed execution surface. The P0 `#961` repair makes its journaled database transition authoritative, adds an exact provider/journal compatibility handshake, separates request and approval credentials, and activates an account circuit breaker only through the new versioned reservation path. Provider success, Bloomjoy settlement, and customer delivery retain separate durable classifications so a later failure cannot invite a duplicate refund.

The historical rollout values remain defense-in-depth controls and must stay in their fail-closed state while the handler is disabled:
- sponsor go/no-go unset;
- `NAYAX_REFUND_EXECUTION_ENABLED=false`;
- `NAYAX_REFUND_EXECUTION_DRY_RUN=true`;
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`; and
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false`.

Canonical source includes a real provider adapter and a forward-only atomic daily-cap wrapper around the existing receipt-bound attempt reservation. The proposed controlled owner pilot may select that adapter only through the checked-in owner-private runner, a dedicated assertion, exact account-scoped request/approve credentials, one DB authorization, and one fresh TOTP. TOTP consumption, case approval-to-pending, official receipt, worker lease, and the sole provider reservation commit in one database transaction. The global official-action gate, broad execution gate, schedules, and portal remain off. The adapter accepts only an exact versioned account contract, approved Nayax HTTPS hosts, frozen self-owned case/payment/account evidence, and the documented request-then-approve sequence. It has no internal retry and treats duplicate, already-refunded, pending, timeout, malformed, network, and unknown outcomes as reconciliation states unless the exact configured success pair is returned. It is provider-only: Hub customer/Gmail completion remains disabled. Nayax-originated email is not inferred from Hub deltas; the written contract must either prove provider suppression or record the owner's explicit expectation/consent. See `Docs/REFUND_NAYAX_CONTROLLED_OWNER_PILOT.md` for the held initialization, dry-run, live, recovery, and credential-retirement ceremonies.

### Default-off provider-outcome resolution

The audited outcome-resolution foundation is deployed. Nayax support has now confirmed that transaction `6841061866` appears refunded and that missing user-level approval roles likely caused the earlier approval error. For this held attempt, another provider request or approval is prohibited. P0 `#427` uses a paired reviewed migration window to activate only the provider-free structured resolver, provision the exact current mapped owner-manager temporarily, require a fresh refund-specific TOTP, reconcile the support-confirmed result, and then revoke that temporary authority and restore the immutable false gate.

### Local orchestration proof (not a live-provider path)

The current orchestration proof injects a local synthetic provider adapter. Its executable evidence covers one each of success, rejection, timeout, and unknown outcome plus replay. Only token-bound confirmed success may atomically complete the case and reporting adjustment, then create one completion in the verified original Gmail thread with the full send-time set of current active mapped managers visibly CC'd. Rejection leaves the case open; timeout and unknown outcomes require reconciliation. None of these paths sends a fallback or a duplicate manager-only completion notice.

The normal product path and the historical controlled-owner pilot remain independently gated. The production account token proved that it can create the exact pending request, but Nayax recorded two identical approval POSTs that both failed and the signed-in portal role exposes no Approve/Decline action. The normal portal action remains unavailable. The separate read-only reporting token was not used for this incident; it has not been write-tested or confirmed broken, and it must never be used as a permission probe. This does not prove approval authority or final refund success. The `#877` approval-only recovery is default-off and single-use: it requires the exact latest request-stage mismatch plus DTM evidence, contains no request endpoint, and is unavailable after any approval-start marker. A successful approval response still waits for DTM/support confirmation and structured resolution before reporting or customer email.

There is intentionally no automatic or ad hoc "mark successful" shortcut for timeout, pending, duplicate, already-refunded, or unknown outcomes. An attempt stays on a durable hold until exact DTM or support evidence exists. Even then, only the structured resolver may record the outcome: exact current mapping, named operator, durable TOTP enrollment, frozen evidence/version, one-use intent, and evidence-type-specific reference validation are mandatory. The resolver makes no provider call. Its bounded `#427` production window closes only after the exact completion is settled and returns the gate/operator state to off.

### Read-only execution availability

An authenticated caller may POST `{ "operation": "availability" }` to `nayax-card-refund` before rendering an execution control. This global operation evaluates the exact same resolved server configuration object and hard-off official-action gate used by execution. It returns only `{ available, status, blockReason, payloadRedacted }`, where `blockReason` is null or one of `official_actions_disabled`, `kill_switch_active`, `configuration_missing`, and `contract_unconfirmed`. It never accepts or parses a case identifier and returns before any case read, RPC, manager authorization, HMAC, attempt reservation, provider adapter, orchestration, case mutation, or customer communication. Missing or invalid configuration is collapsed into the safe reason enum; secret presence, values, caps, and raw configuration block names are never returned.

## Official Refund Contract Audit (2026-07-22)

Nayax's public Lynx documentation now confirms that a card refund is a two-step operation, even if Bloomjoy presents it as one manager action:

1. `POST /operational/v1/payment/refund-request` creates a pending refund request.
2. `POST /operational/v1/payment/refund-approve` approves that request; the documented decline path is `POST /operational/v1/payment/refund-decline`.

The request body uses `RefundAmount`, optional `RefundEmailList`, optional `RefundReason`, `TransactionId`, `SiteId`, and `MachineAuTime`. The approve request must repeat the same transaction, site, and machine-authorization-time identifiers and includes `IsRefundedExternally` plus an optional `RefundDocumentUrl`. Nayax documents `TransactionID` and `SiteID` as fields returned by Last Sales, although `SiteID` was not present in Bloomjoy's previously captured production field inventory.

Nayax defines `IsRefundedExternally=true` only for a refund the customer's billing provider already handled; that path requires the provider's refund document URL. Therefore, for an ordinary refund that Nayax itself should process, Bloomjoy's expected approval value is `IsRefundedExternally=false` and no external-refund document URL. This is now the documented default, but it must still be confirmed in Bloomjoy's Nayax QA/account before a production write call is enabled.

Nayax also documents a manual reconciliation path: a successfully requested refund remains `Pending` and appears in **Reports > Online Reports > Dynamic Transactions Monitor** under the `Refund Requested` status; approval or decline updates that status. This gives Bloomjoy a fail-safe manual check after a timeout or uncertain response, but the public Lynx documentation still does not identify a read-only API endpoint for programmatic refund-status reconciliation.

Production review also found a matched case whose refund had completed in Dynamic Transactions Monitor before Bloomjoy recorded any provider attempt. That case must not enter the normal refund executor or be marked retry-safe. The reviewed `evidence_only` path opens one provider-free synthetic hold, accepts only exact DTM/support success evidence or a preserved hold, and then reuses the existing exactly-once reporting/customer-completion resolver. It stores only a one-way reference digest and never calls Nayax. This is the supported operational fallback for `#971` until Nayax provides an authoritative programmatic readback contract.

Nayax's current Dynamic Transactions Monitor guide defines Transaction Status ID `12` as **Approved** and describes the other listed IDs as cancellation reasons; it also exposes refund requester, date, and reason fields. The current MoMa guide says only **Settled** transactions are refund-eligible and a separate user with refund-approval permission must approve. These facts strengthen a human support check, but they do not identify which Bloomjoy Last Sales/API field maps to that status, name the exact Lynx write role, establish amount units, prove blank-email suppression, or supply a safe readback API after an uncertain request. They therefore do not remove the account-specific contract blocker.

Primary references:
- [Refund flow overview](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/payments)
- [Request a refund](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds)
- [Approve or decline a refund](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund)
- [Upload refund documentation](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/upload-refund-document)
- [Last Sales response](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/machines/getting-a-machines-last-sales)
- [Security and token handling](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/security)
- [Dynamic Transactions Monitor overview](https://nayax-u.nayax.com/article/dynamic-transaction-monitor-dtm-in-nayax-core-overview-10787)
- [MoMa refund eligibility and approval](https://nayax-u.nayax.com/article/how-to-use-mo-ma-on-a-route-80366)

This public documentation is enough to define the expected request shape, but not enough to enable production execution safely. It uses QA host examples and does not establish all of the following for Bloomjoy's account:
- the exact production refund hostname/path and the dedicated account-scoped request and approval write credentials; the existing reporting token must never be used as a write-permission probe or fallback;
- whether `RefundAmount` is expressed in major currency units and how rounding is handled;
- the exact `Result` and `Status` values for accepted, rejected, already-refunded, duplicate, pending, and unknown outcomes;
- whether either step supports a provider idempotency key, how duplicate retries behave, and whether an API status/reconciliation endpoint exists after a timeout; the documented Dynamic Transactions Monitor remains the manual fallback;
- which production response supplies `SiteID` when Last Sales omits it, and what field/value proves that the original sale is approved and refundable;
- whether `RefundEmailList` can remain empty so Bloomjoy sends the single customer confirmation only after final confirmed success.

A read-only Gmail and Drive audit on 2026-07-22 found no private technical refund contract that closes these gaps. The only internal token request located was explicitly for sales reporting, and the signed commercial agreement covers commercial/clearing terms rather than refund API semantics. Do not infer write authority from that token or agreement.

Before reopening normal execution, obtain sanitized Nayax account-owner evidence covering the unresolved response pairs and approval permission, validate them in QA, and install the exact versioned manager contract as server configuration. The backend must treat a request/approval timeout, HTTP error, malformed response, contract mismatch, or journal failure as unresolved: keep the case open, suppress Bloomjoy's success email and settlement adjustment, and route it to reconciliation. No approval-only recovery may be used for the current incident unless Nayax confirms a fresh action is safe; two rejected approval POSTs have already been recorded for this transaction.

## Retest Commands
Use a local-only `.env` value. Do not paste tokens into chat, issues, PRs, or docs.

```powershell
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg | Select-String -Pattern 'NAYAX|LYNX'
```

For local endpoint checks, prefer scripts that print only HTTP status, response shape, counts, and correlation IDs. Do not print raw sales rows.

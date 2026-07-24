# Nayax Lynx API Notes

Last updated: 2026-07-22

## Purpose
Bloomjoy is evaluating Nayax Lynx as the server-side source for machine inventory and machine-level sales activity.

Do not call Nayax directly from the browser. Any implementation should run through Supabase Edge Functions or another backend-only surface.

## Current Production Credential Status
- Production Supabase project: `ygbzkgxktzqsiygjlqyg`
- Read-only/reporting Supabase secret name: `NAYAX_LYNX_API_TOKEN`
- No refund-write credential is currently approved or configured.
- Local development may use `.env` only on the agent machine. Never commit token values.
- Never prefix this token with `VITE_`; Vite exposes `VITE_` values to the browser.

The secret was added to Supabase on 2026-05-11 and verified by name/digest with:

```bash
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg
```

Edge Functions should read the token with:

```ts
const nayaxToken = Deno.env.get("NAYAX_LYNX_API_TOKEN");
```

Read-only lookup may use an account-scoped secret such as `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB`, then fall back to `NAYAX_LYNX_API_TOKEN`. Refund execution deliberately does not reuse or fall back to either reporting token. It requires an exact account-scoped `NAYAX_REFUND_API_TOKEN_<ACCOUNT_KEY>` secret whose write authority has been separately confirmed.

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

The current refund adapter implements Nayax's two-step request-and-approve flow behind a backend-only, fail-closed execution surface. Deploying the adapter does not enable live calls. It cannot call the refund endpoints until all of these are true:
- Sponsor go/no-go is recorded outside secrets and mirrored by server-only env.
- `NAYAX_REFUND_EXECUTION_ENABLED=true`
- `NAYAX_REFUND_EXECUTION_DRY_RUN=false`
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH=false`
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=true`
- An exact account-scoped `NAYAX_REFUND_API_TOKEN_<ACCOUNT_KEY>` write credential exists; reporting-token fallback is prohibited.
- `NAYAX_REFUND_PROVIDER_CONTRACT_JSON` contains the account-approved authorization header mode, amount unit, refund-email behavior, and exact `Result`/`Status` pairs for every recognized outcome.
- The machine is explicitly allowlisted for Nayax refunds and the refund is below configured caps.
- The case is card-only, manager-approved, `card_refund_pending`, matched to sanitized Nayax evidence, and has no prior settlement adjustment.

First automated execution remains full-refund only, USD only, and manager initiated for a case that manager is authorized to handle. Apple Pay or wallet last-four mismatches remain manual-review until a later decision changes that rule.

The adapter obtains a database-atomic single-use claim before contacting Nayax. The claim rejects any case, transaction, amount, machine, or account-key change between the initial read and the database lock, then returns the exact frozen server-only evidence used for both provider calls. It serializes daily cap checks and prevents double clicks, parallel servers, timeouts, and alternate idempotency keys from creating a second provider attempt for the same case. An unfamiliar response, non-success HTTP status, timeout, network error, pending approval, duplicate signal, or failure to record the result never produces a customer success email or reporting adjustment. The manager is told not to retry and must reconcile the attempt in Nayax.

## Official Refund Contract Audit (2026-07-22)

Nayax's public Lynx documentation now confirms that a card refund is a two-step operation, even if Bloomjoy presents it as one manager action:

1. `POST /operational/v1/payment/refund-request` creates a pending refund request.
2. `POST /operational/v1/payment/refund-approve` approves that request; the documented decline path is `POST /operational/v1/payment/refund-decline`.

The request body uses `RefundAmount`, optional `RefundEmailList`, optional `RefundReason`, `TransactionId`, `SiteId`, and `MachineAuTime`. The approve request must repeat the same transaction, site, and machine-authorization-time identifiers and includes `IsRefundedExternally` plus an optional `RefundDocumentUrl`. Nayax documents `TransactionID` and `SiteID` as fields returned by Last Sales, although `SiteID` was not present in Bloomjoy's previously captured production field inventory.

Nayax defines `IsRefundedExternally=true` only for a refund the customer's billing provider already handled; that path requires the provider's refund document URL. Therefore, for an ordinary refund that Nayax itself should process, Bloomjoy's expected approval value is `IsRefundedExternally=false` and no external-refund document URL. This is now the documented default, but it must still be confirmed in Bloomjoy's Nayax QA/account before a production write call is enabled.

Nayax also documents a manual reconciliation path: a successfully requested refund remains `Pending` and appears in **Reports > Online Reports > Dynamic Transactions Monitor** under the `Refund Requested` status; approval or decline updates that status. This gives Bloomjoy a fail-safe manual check after a timeout or uncertain response, but the public Lynx documentation still does not identify a read-only API endpoint for programmatic refund-status reconciliation.

Primary references:
- [Refund flow overview](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/payments)
- [Request a refund](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds)
- [Approve or decline a refund](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund)
- [Upload refund documentation](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/upload-refund-document)
- [Last Sales response](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/machines/getting-a-machines-last-sales)
- [Security and token handling](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/security)

This public documentation is enough to define the expected request shape, but not enough to enable production execution safely. It uses QA host examples and does not establish all of the following for Bloomjoy's account:
- the production refund hostname/path and whether the existing reporting token has refund request and approval permissions;
- whether `RefundAmount` is expressed in major currency units and how rounding is handled;
- the exact `Result` and `Status` values for accepted, rejected, already-refunded, duplicate, pending, and unknown outcomes;
- whether either step supports a provider idempotency key, how duplicate retries behave, and whether an API status/reconciliation endpoint exists after a timeout; the documented Dynamic Transactions Monitor remains the manual fallback;
- which production response supplies `SiteID` when Last Sales omits it, and what field/value proves that the original sale is approved and refundable;
- whether `RefundEmailList` can remain empty so Bloomjoy sends the single customer confirmation only after final confirmed success.

A read-only Gmail and Drive audit on 2026-07-22 found no private technical refund contract that closes these gaps. The only internal token request located was explicitly for sales reporting, and the signed commercial agreement covers commercial/clearing terms rather than refund API semantics. Do not infer write authority from that token or agreement.

Before enabling the implemented adapter, obtain a sanitized Nayax account-owner response covering the unresolved items above and validate the two calls in Nayax's QA environment. Encode the confirmed raw-key or bearer authorization mode and only the approved exact response pairs in the server-only provider contract. The backend orchestrator treats a successful request followed by a failed, timed-out, pending, or unknown approval as unresolved: it keeps the case open, suppresses Bloomjoy's success email and settlement adjustment, and routes it to reconciliation. Live production calls remain prohibited by `Docs/DECISIONS.md` and issue `#430` until the separate sponsor pilot decision is recorded.

## Retest Commands
Use a local-only `.env` value. Do not paste tokens into chat, issues, PRs, or docs.

```powershell
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg | Select-String -Pattern 'NAYAX|LYNX'
```

For local endpoint checks, prefer scripts that print only HTTP status, response shape, counts, and correlation IDs. Do not print raw sales rows.

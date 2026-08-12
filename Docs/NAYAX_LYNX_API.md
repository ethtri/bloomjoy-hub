# Nayax Lynx API Notes

Last updated: 2026-08-03

## Purpose
Bloomjoy is evaluating Nayax Lynx as the server-side source for machine inventory and machine-level sales activity.

Do not call Nayax directly from the browser. Any implementation should run through Supabase Edge Functions or another backend-only surface.

## Current Production Credential Status
- Production Supabase project: `ygbzkgxktzqsiygjlqyg`
- Server-only Supabase secret name: `NAYAX_LYNX_API_TOKEN`
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

Refund operations may use an account-scoped secret first, such as `NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB`, then fall back to `NAYAX_LYNX_API_TOKEN`. Keep both server-only.

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

The deployed foundation added `nayax-card-refund` as a backend-only, fail-closed execution surface. In the current unmerged candidate, the production handler always selects a statically disabled adapter and stops before attempt reservation, manager-proof consumption, provider access, case/reporting mutation, or email. No request value, browser value, environment value, or combination of the historical rollout flags can activate a live call.

The historical rollout values remain defense-in-depth controls and must stay in their fail-closed state while the handler is disabled:
- sponsor go/no-go unset;
- `NAYAX_REFUND_EXECUTION_ENABLED=false`;
- `NAYAX_REFUND_EXECUTION_DRY_RUN=true`;
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH=true`; and
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=false`.

The `#430` candidate now includes an unselected real provider adapter and a forward-only atomic daily-cap wrapper around the existing receipt-bound attempt reservation. The HTTP handler fail-closes on every rollout/configuration block before orchestration, requires separate strong idempotency and function-identity secrets, and pre-wires the single-use manager receipt through the atomic v2 count/amount-cap reservation and token-bound settlement RPCs. Those dependencies remain unreachable because the handler still imports only the disabled adapter. The adapter accepts only an exact versioned account contract, approved Nayax HTTPS hosts, a dedicated account-scoped write token, frozen case/payment evidence, and the documented request-then-approve sequence. It has no internal retry and treats duplicate, already-refunded, pending, timeout, malformed, network, and unknown outcomes as reconciliation states unless the exact configured success pair is returned. Account write authority, confirmed amount/response semantics, explicit machine allowlist, completion delivery, assertion-digest registration, and a controlled low-value smoke remain required before a separate gate-on change is considered. The official actor remains a current active Machine Manager mapped to the case's machine, personally completing the fresh action-bound TOTP step-up. Super Admin, Scoped Admin, service, email, scheduler, GPT, and agent authority cannot substitute for that mapping and step-up.

### Local orchestration proof (not a live-provider path)

The current orchestration proof injects a local synthetic provider adapter. Its executable evidence covers one each of success, rejection, timeout, and unknown outcome plus replay. Only token-bound confirmed success may atomically complete the case and reporting adjustment, then create one completion in the verified original Gmail thread with the full send-time set of current active mapped managers visibly CC'd. Rejection leaves the case open; timeout and unknown outcomes require reconciliation. None of these paths sends a fallback or a duplicate manager-only completion notice.

The real `nayax-card-refund` HTTP function still always uses the disabled adapter. Normal production defaults return the complete fail-closed configuration block list before orchestration. Even if every rollout value were deliberately changed, orchestration returns `409` with `provider_execution_not_yet_enabled` before invoking the pre-wired reservation dependency, consuming manager evidence, contacting Nayax, changing a case, or sending email. The new adapter is intentionally unreachable from the HTTP handler in this bounded change; its tests prove request construction and outcome handling, not account permission or a live provider result. Provider contract evidence, completion delivery, executor-digest registration, and the controlled pilot require separate reviewed evidence. Do not interpret browser mocks, injected adapters, or unit fixtures as a successful live HTTP/provider test.

There is intentionally no automated or internal "mark successful" resolver for timeout, pending, duplicate, already-refunded, or unknown outcomes. Without an account-confirmed read-only reconciliation contract, software cannot distinguish a completed refund from a failed one safely. These attempts stay on a durable reconciliation hold with no retry, fallback payment, reporting adjustment, or success email. A manager may inspect Nayax's Dynamic Transactions Monitor, but an audited state-changing resolver remains blocked until Nayax confirms which evidence is authoritative and how it can be retrieved without issuing another refund.

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

Before connecting the adapter to the handler, obtain a sanitized Nayax account-owner response covering the unresolved items above and validate the two calls in Nayax's QA environment. The backend orchestrator must treat a successful request followed by a failed, timed-out, or unknown approval as unresolved: keep the case open, suppress Bloomjoy's success email and settlement adjustment, and route it to reconciliation. Live production calls remain prohibited by `Docs/DECISIONS.md` and issue `#430` until the separate sponsor pilot decision is recorded.

## Retest Commands
Use a local-only `.env` value. Do not paste tokens into chat, issues, PRs, or docs.

```powershell
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg | Select-String -Pattern 'NAYAX|LYNX'
```

For local endpoint checks, prefer scripts that print only HTTP status, response shape, counts, and correlation IDs. Do not print raw sales rows.

# Nayax Lynx API Notes

Last updated: 2026-05-11

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
Refund execution is separate from read-only Last Sales lookup.

The current full-automation foundation adds `nayax-card-refund` as a backend-only, fail-closed execution surface. It does not call live Nayax refund endpoints until all of these are true:
- Sponsor go/no-go is recorded outside secrets and mirrored by server-only env.
- `NAYAX_REFUND_EXECUTION_ENABLED=true`
- `NAYAX_REFUND_EXECUTION_DRY_RUN=false`
- `NAYAX_REFUND_EXECUTION_KILL_SWITCH=false`
- `NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED=true`
- The machine is explicitly allowlisted for Nayax refunds and the refund is below configured caps.
- The case is card-only, manager-approved, `card_refund_pending`, matched to sanitized Nayax evidence, and has no prior settlement adjustment.

First automated execution remains full-refund only, USD only, and super-admin initiated. Apple Pay or wallet last-four mismatches remain manual-review until a later decision changes that rule.

## Retest Commands
Use a local-only `.env` value. Do not paste tokens into chat, issues, PRs, or docs.

```powershell
supabase secrets list --project-ref ygbzkgxktzqsiygjlqyg | Select-String -Pattern 'NAYAX|LYNX'
```

For local endpoint checks, prefer scripts that print only HTTP status, response shape, counts, and correlation IDs. Do not print raw sales rows.

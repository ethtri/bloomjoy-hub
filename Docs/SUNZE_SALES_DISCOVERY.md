# Sunze Sales Discovery

Date: 2026-04-25

## Scope

This note records safe discovery for the Sunze-managed sales source that feeds Bloomjoy Hub reporting. The goal was to identify a reliable extraction path without changing machine settings, operational parameters, or source data.

No credentials, raw workbook files, order numbers, row-level customer/order values, or production machine IDs are stored in this document.

## Safety Posture

- Credentials were read only from local environment variables and were not committed.
- Discovery stayed on read-oriented pages: login, home dashboard, orders, rankings, and the top-level machine list.
- Machine-level `More` menus were not opened because they are likely to expose operational controls or settings.
- Filter dialogs were inspected without selecting machine settings or changing source data.
- Downloaded export artifacts were treated as sensitive and removed after inspection.
- Future automation uses an isolated browser profile and a download directory outside the repo, then deletes raw downloads after parsing unless a private audit-retention policy is approved.

## Sunze App Surfaces

### Login

- Route observed: `#/login`
- Page title: `Sunzee`
- Login supports `Password` and `SMS Code` tabs.
- Password login fields observed:
  - `Username or Email`
  - `Password`
  - `Remember`
  - `Forgot Password?`
  - `Login`

### Home Dashboard

- Route observed: `#/home`
- Shows account display name, total machine count, and active machine count.
- Top filters:
  - Date range, default `Today`
  - Machine selector, default `All Machines`
  - `More` filter
- Dashboard metrics:
  - `Revenue`
  - `Volume`
  - selected date range
- Machine sales cards list machine-level totals split by:
  - `Cash Total`
  - `Credit Card`
  - `e-Payment`
  - `Total`
- The `More` filter includes:
  - Machine Type: `All`, `MG`, `POP`, `ICE`
  - Payment: `All`, `Free`, `Coins`, `Cash`, `Cash Total`, `Credit Card`, `e-Payment`

### Orders

- Route observed: `#/orderCenter`
- This is the strongest extraction source for reporting because it exposes a filtered order export.
- Search controls:
  - Search field type defaults to `Order No`
  - Text input placeholder: `Enter Order No`
- Top filters:
  - Date range, default `Today`
  - Machine selector, default `All Machines`
  - `More` filter
- Date options observed:
  - `Today`
  - `Yesterday`
  - `Last 3 Days`
  - `Last 7 Days`
  - `Last Month`
  - `Last 3 Months`
  - `Custom Range`
- `Last 7 Days` is the daily catch-up preset so each run has rolling overlap for missed or late rows. `Last Month` remains the monthly safety-sweep preset.
- `Custom Range` is approved for historical backfills only through the new Export Task flow, and should be run in monthly chunks with parsed dates verified before ingesting.
- If Sunze's custom date selector is unavailable, manually downloaded Export Task `.zip`/`.xlsx` files may be backfilled with `--parse-file` plus explicit monthly `--date-start` / `--date-end`; the same workbook header and row-date validation still applies before ingest.
- The page displays filtered totals:
  - `Revenue`
  - `Volume`
  - total record count
- The `Export` action now opens a confirmation dialog and creates an asynchronous export task. Completed task files are downloaded from `#/taskExportList` and may be either a single `.xlsx` workbook or a `.zip` containing multiple monthly `.xlsx` workbooks.

### Machine Center

- Route observed: `#/device`
- Page label: `Machine Center`
- Shows total run count and all-machine count.
- Tabs:
  - `All`
  - `Operational`
  - `Abnormal`
- Machine cards display:
  - Machine name
  - `Machine ID`
  - Heating temperature
  - Internal temperature
  - Humidity
  - `More`
- The top-level list can be used to seed or reconcile Sunze machine IDs, but the `More` menus should remain out of scope for reporting automation unless a separate read-only review confirms they are safe.

### Rankings

- Route observed: `#/robotranking`
- Sections:
  - `Daily Rank`: `Today`, `Yesterday`, `Custom`
  - `Weekly Rank`: `This Week`, `Last Week`, `Custom`
  - `Monthly Rank`: `This Month`, `Last Month`, `Custom`
  - `Annual Rank`: `This Year`, `Last Year`, `Custom`
- Rankings may be useful for UI parity checks, but it is not the recommended source of truth because the Orders export provides transaction-level rows.

## Export Data Contract

The Orders export workbook usually contains one worksheet named `Order`. Export Task zip workbooks have also been observed with the first worksheet named `0`; the parser accepts that sheet name only if the required order headers validate.

Observed headers:

| Column | Notes |
| --- | --- |
| `Order number` | Stable source order identifier; treat as sensitive. |
| `Trade name` | Product/pattern text; can include multiple comma-separated items. |
| `Affiliated merchant` | Optional merchant/account identifier; treat as sensitive. |
| `Machine code` | Sunze machine identifier from the order export. |
| `Machine name` | Optional human-readable machine name. |
| `Order amount` | Numeric order amount. |
| `Tax` | Numeric tax field; nullable in some rows. |
| `Payment method` | Source payment label. |
| `Payment time` | Observed as Excel date cells/timezone-less text and explicit-offset text in parser fixtures. Sunze's timezone basis is not yet independently proved. |
| `Status` | Source payment/order status. |

Observed payment method values:

- `Credit card`
- `Coin + Notes`
- `No-Pay`

Observed status value:

- `Payment success`

Important metric notes:

- The inspected export row count matched the Orders UI record count for the selected filter.
- The sum of `Order amount` reconciled to the Orders UI `Revenue` value for the selected filter.
- The export does not include an explicit quantity column, so the dashboard `Volume` value is not directly reproducible from this workbook without further validation.
- `No-Pay` rows can have zero order amount and are normalized to `other`, not cash or credit.
- Machine names alone should not be used as durable identifiers. Use `Machine code` and reconcile it with Bloomjoy reporting machines.

## Implemented Extractor Flow

1. GitHub Actions runs the Playwright worker daily.
2. The worker launches an isolated Chromium context with downloads enabled.
3. It logs in with the Bloomjoy-owned service account.
4. It navigates directly to `#/orderCenter`.
5. It selects the safe `Last 7 Days` daily preset, `Last Month` for the monthly catch-up schedule, or an explicit monthly custom range for backfills.
6. It keeps the machine selector on `All Machines`.
7. It clicks `Export`, confirms the export dialog, navigates to `#/taskExportList`, pins the requested task created after the request timestamp, fails immediately on a terminal failed task, and downloads only after completion.
8. It validates the workbook sheet and required headers across `.xlsx` files or `.zip` bundles; optional merchant/name metadata may be absent from Export Task workbooks.
9. It normalizes rows into payment method, sale date, machine code, net sales cents, tax cents, and source status.
10. It deletes raw workbook or zip files after parsing.
11. It sends normalized rows to `sunze-sales-ingest` with `REPORTING_INGEST_TOKEN`.
12. The Edge Function hashes sensitive order identifiers with `REPORTING_ROW_HASH_SALT`, rejects unknown machines/statuses/payment methods, and upserts idempotent `machine_sales_facts`.

## Cash Refund Timestamp And Coverage Contract

- Existing reporting ingestion preserves its historical behavior for Excel date cells and timezone-less strings: their wall-clock parts are stored using the prior UTC conversion, now labeled `unvalidated_utc_compatibility`. This is reporting compatibility, not evidence that Sunze emits UTC.
- Explicit `Z`/offset strings retain their actual instant and are labeled `explicit_offset`. A configured IANA conversion is accepted only when `SUNZE_PAYMENT_TIME_SEMANTICS_STATUS=validated`, `SUNZE_PAYMENT_TIME_PROOF_SCOPE=account`, and `SUNZE_PAYMENT_TIME_TIMEZONE` names the independently proved account-wide basis. A location timezone or browser/export timezone must not be substituted without proof.
- A validated local timestamp that is nonexistent in a DST spring gap or ambiguous in a fall fold is rejected. Fixtures cover Excel dates, timezone-less strings, explicit offsets, midnight, and both DST transitions.
- Refund coverage is stored privately as one interval per machine per completed import. Intervals are never merged across gaps. A source watermark advances only when the export has validated account-wide timestamp semantics, trusted complete machine visibility without a count mismatch, and exact selected-window bounds.
- `checking_sales_history`: a supported, mapped, fresh source exists but its latest watermark has not yet reached the full purchase lookup window.
- `sale_found`: exactly one validated cash fact matches the exact machine and +/- one-hour window inside one fresh coverage interval. Amount is an advisory comparison, never an eligibility filter.
- `multiple_possible_sales`: more than one such validated fact remains.
- `no_sale_found_with_complete_coverage`: zero such facts remain and one fresh validated interval covers the complete +/- one-hour window.
- `sales_history_unavailable`: the machine/source is unsupported or unmapped, timestamp proof is absent/out of scope, coverage is stale, or no one interval completely covers the historical window.
- These states are server-owned evidence, not approval or completion gates. A Manager may act on any reviewed evidence under `REFUND_WORKFLOW.md`. When an exact Sunze sale is selected, the same sale cannot support a second non-duplicate completion. Raw workbooks, source order numbers, raw machine identifiers, and candidate rows are not exposed by the readiness contract.

### Evidence still needed

To enable validated conversion, capture one privacy-safe owner-controlled order whose occurrence instant is independently known (for example a UTC-stamped device/operator observation), its exact exported `Payment time` cell shape, the account/browser/location timezone settings at export, and a second independently known order across a daylight-saving boundary. The pair must establish whether the basis is UTC, account, browser/export, or machine/location time and whether one rule applies account-wide. Until then, the contract remains unvalidated and cannot emit complete-no-match.

### Nayax secondary capability check

A privacy-safe read-only check on 2026-09-13 queried three existing-account machines successfully and scanned 202 recent Last Sales rows. Every row populated `PaymentMethod`, but the sample contained one label and no cash-like label. Result: **inconclusive**. The endpoint exposes a payment-method field, but this sample does not prove that Bloomjoy's account receives cash rows or that their absence is complete. This finding does not change Nayax card matching or refund execution.

## Reporting Implications

- Bubble Planet weekly reporting can use the imported transaction facts and filter/report by the entitled Bubble Planet machines in Bloomjoy Hub.
- Gross sales still requires the complaints/refunds source. Until Sunze refund semantics are validated, treat Sunze `Order amount` as net sales and calculate gross as `net_sales + refund_amount` from the refund adjustment import.

## Open Questions

- What is the maximum safe export date range before Sunze times out or truncates results?
- Does the export always include all filtered records for larger ranges?
- What timezone does `Payment time` represent? This remains precisely blocked on the independent known-order/DST evidence described above.
- Are refunded, voided, reversed, or partially refunded orders represented in Sunze, and if so what statuses/amount signs appear?
- Are `Machine code` in Orders and `Machine ID` in Machine Center always the same identifier?
- Can dashboard `Volume` be derived from another export field, or does it require a separate source/report?
- Should raw workbooks ever be retained in a private audit bucket, or should the system retain only parsed rows and import metadata?

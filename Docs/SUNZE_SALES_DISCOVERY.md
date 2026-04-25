# Sunze Sales Discovery

Date: 2026-04-25

Branch: `agent/sunze-sales-discovery`

## Scope

This note records safe discovery for the Sunze-managed sales source that will feed Bloomjoy Hub reporting. The goal was to identify a reliable extraction path without changing machine settings, operational parameters, or source data.

No credentials, order numbers, raw rows, downloaded workbooks, machine IDs, or customer/order-specific values are stored in this document.

## Safety Posture

- Credentials were read only from local environment variables and were not committed.
- Discovery stayed on read-oriented pages: login, home dashboard, orders, rankings, and the top-level machine list.
- Machine-level `More` menus were not opened because they are likely to expose operational controls or settings.
- Filter dialogs were inspected without selecting machine settings or changing source data.
- Downloaded export artifacts were treated as sensitive and removed from the worktree after inspection.
- Future automation should use an isolated browser profile and a download directory outside the repo, then delete raw downloads after parsing unless a private audit-retention policy is approved.

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
- Custom range opens a calendar view spanning historical months back to at least 2022.
- Machine selector is a flat list of `All Machines` plus the available machine names.
- The `More` filter matches the home dashboard filter:
  - Machine Type: `All`, `MG`, `POP`, `ICE`
  - Payment: `All`, `Free`, `Coins`, `Cash`, `Cash Total`, `Credit Card`, `e-Payment`
- The page displays filtered totals:
  - `Revenue`
  - `Volume`
  - total record count
- The `Export` action downloads an `.xlsx` workbook for the active filters.

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
- Filter options:
  - Metric: `Revenue`, `Patterns`
  - Machine Type: `All`, `Cotton Candy`, `Popcorn`
- Rankings may be useful for UI parity checks, but it is not the recommended source of truth because the Orders export provides transaction-level rows.

## Export Data Contract

The Orders export workbook contains one worksheet named `Order`.

Observed headers:

| Column | Notes |
| --- | --- |
| `Order number` | Stable source order identifier; treat as sensitive. |
| `Trade name` | Product/pattern text; can include multiple comma-separated items. |
| `Affiliated merchant` | Merchant/account identifier; treat as sensitive. |
| `Machine code` | Sunze machine identifier from the order export. |
| `Machine name` | Human-readable machine name. |
| `Order amount` | Numeric order amount. |
| `Tax` | Numeric tax field; observed but not yet validated for non-zero behavior. |
| `Payment method` | Source payment label. |
| `Payment time` | Excel serial date/time value. |
| `Status` | Source payment/order status. |

Observed payment method values in the inspected export:

- `Credit card`
- `Coin + Notes`
- `No-Pay`

Observed status values in the inspected export:

- `Payment success`

Important metric notes:

- The inspected export row count matched the Orders UI record count for the selected filter.
- The sum of `Order amount` reconciled to the dashboard `Revenue` value for the selected filter.
- The export does not include an explicit quantity column, so the dashboard `Volume` value is not directly reproducible from the workbook without further validation.
- `No-Pay` rows can have zero order amount and should not be treated as cash or credit sales.
- `Payment time` should be parsed as an Excel serial date/time and then normalized into the reporting timezone after timezone semantics are confirmed.

## Recommended Extractor Flow

1. Start Playwright with an isolated browser profile and a download directory outside the repo.
2. Read `SUNZE_LOGIN_URL`, `SUNZE_REPORTING_EMAIL`, and `SUNZE_REPORTING_PASSWORD` from server-side environment variables or a local `.env` file during development.
3. Open the Sunze login URL and authenticate with the service account.
4. Navigate directly to `#/orderCenter`.
5. Select the target date range:
   - Use presets for simple catch-up windows.
   - Use `Custom Range` for exact weekly partner reports.
6. Keep machine selector on `All Machines` for scheduled imports unless a narrow backfill is needed.
7. Use payment filters only for validation or targeted imports; otherwise import all methods and normalize downstream.
8. Click `Export` and wait for the `.xlsx` download.
9. Parse worksheet `Order` using the headers above.
10. Convert `Payment time` from Excel serial to timestamp.
11. Normalize payment method values:
    - `Credit card` -> `credit`
    - `Coin + Notes` -> `cash`
    - `No-Pay` -> `other` or `free`, depending on the final reporting enum
12. Insert raw import rows into a staging table with a deterministic source-row hash.
13. Upsert normalized sales facts keyed by source system, order number, machine code, payment time, amount, and row hash.
14. Aggregate report views in Bloomjoy Hub by machine, location, date grain, and payment method.
15. Delete the raw local workbook after parsing unless private retention has been explicitly approved.

## Reporting Implications

- Bubble Planet weekly reporting can use one weekly Orders export for `All Machines`, then filter/report by the entitled Bubble Planet machines in Bloomjoy Hub.
- Machine names alone should not be used as durable identifiers. Use `Machine code` from Orders and reconcile it with `Machine ID` from Machine Center.
- The Machine Center list can support initial `reporting_machines.sunze_machine_id` seeding and periodic machine inventory reconciliation.
- The reporting database should store raw Sunze values separately from normalized reporting fields so mappings can be corrected without losing source fidelity.
- Gross sales still requires the complaints/refunds source. Until Sunze refund semantics are validated, treat Sunze `Order amount` as net sales and calculate gross as `net_sales + refund_amount` from the refund adjustment import.

## Open Questions

- What is the maximum safe export date range before Sunze times out or truncates results?
- Does the export always include all filtered records, or can very large result sets page/truncate?
- What timezone does `Payment time` represent?
- Are refunded, voided, reversed, or partially refunded orders represented in Sunze, and if so what statuses/amount signs appear?
- Are `Machine code` in Orders and `Machine ID` in Machine Center always the same identifier?
- Can dashboard `Volume` be derived from another export field, or does it require a separate source/report?
- How should `No-Pay`, `Free`, and `Coins` map into the Bloomjoy reporting `PaymentMethod` enum?
- Should raw workbooks be retained in a private audit bucket, or should the system retain only parsed staging rows and import metadata?
- Where should the Playwright extractor run in production? Supabase Cron can orchestrate scheduled work, but the Chromium runtime target should be validated before implementation.

## Next Implementation Steps

1. Add a manual Orders `.xlsx` import path using this contract before scheduling automation.
2. Add a small sanitized fixture that preserves the headers and representative payment methods without real order data.
3. Build staging validation that rejects unexpected headers, missing machine codes, invalid dates, and unknown statuses.
4. Add machine reconciliation tooling that compares Orders machine codes against Machine Center IDs.
5. Validate custom range exports for a prior Monday-Sunday week before building the Bubble Planet scheduled report.
6. Confirm refund/complaint sheet columns and gross/net rules before exposing gross sales in user-facing reports.

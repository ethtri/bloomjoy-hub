# Snapcase Data Foundation

## Purpose

This foundation brings Kexiazhan machine/order context and Nayax card evidence into a server-only shadow model before any Snapcase frontend, partner-reporting, or revenue-based Operator Pay work.

It deliberately does not publish Snapcase records into `machine_sales_facts` or `sales_adjustment_facts`.

## Discovery baseline

Read-only portal discovery on 2026-07-19 found:

- 25 devices: 18 phone-case printers and 7 film applicators.
- 8 merchant records.
- 12,060 phone-case orders from the Order List's `type=1` query.
- 3,863 payment rows.
- Multiple merchants, currencies, payment methods, cancelled/unpaid records, and test-like devices.
- Payments that reference multiple order numbers, so order and payment counts are not one-to-one.

The observed private API base is `https://kxzcnt.kexiaozhan.com/mer`. The current portal reads:

- `GET /v1/machines`
- `GET /v1/orders`
- `GET /v1/payments`

The portal currently authenticates through `POST /user/login`, sends a bearer token, and includes application language and time-zone headers. These are private implementation endpoints, not a vendor-supported reporting contract until Kexiazhan confirms them in writing.

## Observed source fields

Machines can provide vendor machine ID/serial, merchant, device type, name, location, currency, time zone, connectivity, and device configuration. Only identity, type, merchant, coarse location, expected currency/time zone, and status are retained.

Orders can provide order/print references, machine/merchant/product, amount components, payment/refund status, print status, and timestamps. Order references are salted before storage. Delivery addresses, customer designs, receipts, and other customer content are discarded before ingestion.

Payments can provide machine/merchant, one or more order references, an external payment reference, payment method/instrument, amounts, refund state, timestamp, and currency display. Payment and order references are salted before storage.

Nayax Last Sales can provide transaction/payment-service references, machine ID, authorization/settlement amounts and timestamps, currency, payment method, product, and quantity. Raw transaction references and any card evidence are not stored in the Snapcase staging path.

## Trust boundaries

- Nayax is authoritative for Snapcase card value.
- Kexiazhan is order/print context and may become authoritative for cash or confirmed non-Nayax tenders after field definitions are approved.
- Only approved merchants and phone-case printers can become validated.
- Film applicators, unknown machines, unknown merchants, non-USD rows, naive/ambiguous timestamps, unstable payment identifiers, and unapproved provider contracts remain quarantined.
- No name/location fuzzy match can map two provider identities to one physical machine.
- One canonical `reporting_machine` may have one approved Kexiazhan source identity and one approved Nayax source identity.

## Data flow

1. `reporting_provider_accounts` records the provider contract state, logical account key, approved base URL, expected currency/time zone, credential-rotation timestamp, and vendor-approval timestamp. It stores no credential.
2. Kexiazhan inventory is normalized into provider-neutral merchant and machine discovery tables.
3. Super admins approve a merchant for one Bloomjoy account and map a confirmed phone-case printer to a canonical Snapcase `reporting_machine`.
4. The read-only worker requests only allowlisted machine order/payment windows, strips forbidden fields, and sends normalized data to `snapcase-data-ingest`.
5. The ingest function salts source identifiers, applies database allowlists, and upserts server-only order/payment staging.
6. Successful runs record per-resource windows and import-run pointers in `provider_sync_cursors`; the worker intentionally re-reads a rolling 35-day window so late provider changes are idempotently absorbed.
7. Sanitized Nayax transactions can enter the corresponding staging table through the same locked contract.
8. `refresh_snapcase_payment_reconciliations` records:
   - `exact` for one shared payment-reference match.
   - `proposed` for one same-machine, same-amount, same-currency candidate within ten minutes.
   - `ambiguous` for multiple candidates.
   - `unmatched` for no candidate.
   - `approved_exception` only through a later audited review surface.
9. No function in this foundation writes reporting/payroll facts.

## Secrets and workflow controls

Provider tokens remain in process memory and must never appear in diagnostic artifacts or logs.

The scheduled workflow is fail-closed behind:

- `KEXIAZHAN_API_APPROVED=true`
- `SNAPCASE_SHADOW_SYNC_ENABLED=true`
- An approved database provider account.
- Encrypted provider and ingest secrets.

The workflow performs direct read-only API calls. It does not install or run a browser and has no code path for print, reprint, refund, restart, shutdown, or machine configuration.

If Kexiazhan declines API use, do not enable the workflow. Obtain a supported export, add a separately reviewed Excel adapter to the same staging contract, parse date windows no longer than 31 days, and delete each raw workbook immediately after parsing.

## Activation gate

Timekeeping can use approved canonical Snapcase machines because assignments already reference `reporting_machines`.

Sales publication remains a separate forward-only migration and requires:

- Written Kexiazhan authorization and rotated read-only credentials.
- A confirmed Bloomjoy merchant/machine allowlist.
- Approved Kexiazhan and Nayax identities for every admitted machine.
- At least 30 consecutive days of shadow freshness under 30 hours.
- At least 99.5% of card count and authorized value reconciled, with every residual classified.
- Zero unauthorized devices, duplicate financial facts, double-counted refunds, or privacy findings.
- Finance/operator signoff on the effective date and backfill policy.

Until then, existing reporting, partner exports, refunds, and Operator Pay must remain unchanged.

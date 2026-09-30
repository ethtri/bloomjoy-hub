# Gift-card provider supply

Implementation for [#1637](https://github.com/ethtri/bloomjoy-hub/issues/1637),
using the existing refund automation sweep. This document describes technical
provider evidence; `REFUND_WORKFLOW.md` owns the customer policy.

## Evidence checked September 30, 2026

Read-only checks used the current provider applications and authenticated
accounts. No live coupon was created, changed, redeemed or imported. No customer
or vendor message was sent. The sample voucher guide is not available stock.

| Provider | Observed creation contract | Observed inventory contract | Recovery boundary |
| --- | --- | --- | --- |
| Sunzee | Application `GET /SZWL-SERVER/tPromoCode/add`: account ID, random mode, batch count, months, fixed Cash Off amount. UI limits: 200 codes, three months. | Authenticated `POST /tPromoCode/list` succeeded. Account-wide rows contain identity, numeric six-digit code, fixed-value type `1`, unused/used `0`/`1`, value and epoch expiry. | Before dispatch, save the complete unused-ID baseline. A successful creation response plus an exact, compatible complete-list delta binds the batch. A lost response or ambiguous delta stays unknown; the API exposes no observed request/batch marker. Exceptional recovery requires a positively verified batch; there is no blind retry. |
| KeMore / Kexiaozhan | Current Americas application `POST /mer/v1/coupon-compose`: unique attempt name/description, merchant, USD fixed amount, device scopes, one use, count, explicit start/end. | Authenticated coupon/code/scope reads succeeded. Code strings have nine digits; available/used counts, code status and date fields are separate. Device scope is `scopeType=1`; code status `0` means unused in current application source. | Read the exact attempt name, confirm merchant/value/currency/scope, and import its exact unused-code batch. Missing or mismatched results remain unknown and never permit another creation. |

Primary public application sources:

- [Sunzee application](https://szwlh.sunzee.com.cn/shenze/), whose September 30
  assets include `index-COwqex-a.js`, `payCode-u843aXSb.js` and
  `index-hDBlZ6an.js` under `/shenze/static/`.
- [KeMore Americas merchant application](https://usme.kexiaozhan.com/auth/login),
  whose September 30 assets include `el-cascader-panel-CpvlZgfD.js` and
  `index-BNhaWQzl.js` under `/js/`.

These are observed application contracts, not a claim of a published API or a
live creation test. The four current KeMore coupons returned empty embedded
scope arrays and empty separate `/coupon-scopes` pages; a positive nonempty
scope response has not been observed. The adapter follows the application's
separate scope-table read, checks exact device identities, also checks any
nonempty embedded scopes, and rejects extra category or
merchant scopes; an unrecognized response holds the batch instead of importing
it. Confirm this positive shape in the first authorized creation verification.
Before activation, verify the exact account/machine mapping,
USD basis, provider timezone and machine redemption instructions. Sunzee
creation is account-wide: a configured subset must not claim the vendor limits
redemption to that subset. Credentials must belong to the configured account.
The current KeMore machine inventory reports USD on 22 devices under five
merchants. The application explicitly sends `X-App-TimeZone` from the caller's
IANA timezone, so configure that timezone rather than infer one from date text.
The Hub's existing authoritative mapping table verifies 21 exact provider-device
to Hub-machine links with location IANA timezones. KeMore mapping, USD and caller
timezone setup are therefore resolved from existing records; they do not require
the owner to supply technical settings. Configure only exact mapped devices and
their observed merchant scope. First positive created-scope verification and a
real machine redemption test remain outstanding. Sunzee account-wide machine
eligibility and USD basis have not been established by the bounded evidence.

The owner confirmed that both cotton-candy and SnapCase touchscreens offer
“Enter coupon/code.” Setup defaults to: “On the machine’s touchscreen, choose
‘Enter coupon/code’ and enter your code.” Omitted, null or blank instructions use
this default; verified machine-specific instructions can override it. This
confirmation resolves the instructions gap; live coupon creation and redemption
have not been tested. Complete KeMore payment pagination found no
coupon tender in the inspected account, so split/top-up money semantics remain
unverified and are not inferred from code usage.

## Setup and operation

Apply the issuance migration before `20260930222948_refund_gift_card_supply.sql`.
Deploy the existing `refund-case-automation-sweep` with its new shared modules;
its existing Supabase schedule and GitHub fallback remain the scheduler.

One Super-admin setup call creates a disabled pool and its rules atomically:
`admin_setup_refund_gift_card_pool`. Supply uses the single `pool.enabled` switch;
`admin_set_refund_gift_card_pool_enabled` is the supported activation/stop path.
No additional runtime flag, agent or recurring upload is required. Do not enable
a pool before completing the account/terms/credentials setup above.
An enabled verified pool supplies the scope template for other $5 denominations.
Quotes create no pools or value. On accepted submission,
`service_materialize_refund_gift_card_offer` reuses or creates the exact rounded
denomination and copies its configured refill rules; the normal worker supplies
it automatically. No per-request stock setup is required.

Server-only credential configuration uses `credential_prefix`, for example
`KEMORE_GIFT_CARD`, to read `KEMORE_GIFT_CARD_USERNAME` and
`KEMORE_GIFT_CARD_PASSWORD`. Sunzee uses the same prefix pattern. No credential
is stored in the configuration JSON or returned to the browser. API hosts are
fixed in the adapters; configuration cannot redirect credential-bearing calls.

Rules configure minimum stock, target stock and maximum batch. Usable stock
covers the currently advertised expiry. Default validity is 90 days, renewal
starts 30 days before expiry, and Sunzee validity cannot exceed its configured
one-to-three-month window (the application displays 30 days per month). Renewal
improves future offers and already-expired waiting requests; existing unexpired
promises and issued receipts retain their terms. Older codes can satisfy those
older promises. Renewal creates no extra customer step.

The worker serializes creation per provider account, records pre-dispatch
evidence, and holds interrupted dispatches as unknown. Other accounts continue.
Definite failures retry after 30 minutes. Refill failures coalesce into the
existing internal `ops_alert` action ledger by incident identity. Successful
imports call the shared issuance recovery pass, which rechecks the rolling
email allowance on the same waiting cases.

`admin_import_refund_gift_card_codes` is only a setup/recovery tool. Import codes
as strings with their original provider ID and timezone-qualified validity.
Duplicate replay preserves issued/used status; conflicting identity or validity
fails atomically. Unknown Sunzee attempts can be completed through
`admin_recover_refund_gift_card_refill` with the exact positively verified batch.
Code-free stock summaries come from `admin_get_refund_gift_card_supply`.

## Verification

Provider and worker fixtures create no live value:

```powershell
deno test --no-lock supabase/functions/_shared/refund-gift-card-providers.test.ts supabase/functions/_shared/refund-gift-card-supply.test.ts
deno check --no-lock supabase/functions/refund-case-automation-sweep/index.ts
```

Run `supabase/tests/refund_gift_card_supply.sql` on a disposable database after
the issuance/supply migrations. It checks bounded stock, account serialization,
unknown recovery, leading zeros, duplicate imports, issued-code preservation,
private RPC grants, disabled supply and automatic expiry renewal. Live creation
and hardware redemption remain outside these fixture checks.

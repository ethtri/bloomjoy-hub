# Sales Tax Operations

This runbook records Bloomjoy's operational sales-tax configuration without storing permit numbers, taxpayer identifiers, full street addresses, login details, or government documents in Git.

## Verified California account state

Verified in CDTFA Online Services on 2026-08-08:

- Account holder: Bloomjoy Services LLC.
- Account type/status: Sales and Use Tax, Current.
- Seller's permit effective date: 2026-01-01.
- Registered location: Mountain View, California 94043. The exact street address and permit number are private records and must not be copied into repository files, GitHub issues, pull requests, CI logs, or chat.
- Filing frequency: yearly. The current period ends 2026-12-31.
- Current balance: $0.00; no Bloomjoy account alerts were present during the audit.
- Filing/remittance owner: Ethan/business owner. No Stripe filing partner is enabled.

CDTFA's yearly sales-tax schedule makes the 2026 return due 2027-01-31. File the return even if no taxable sales are reported. If CDTFA later changes the account's visible filing period, follow the account assignment rather than this dated snapshot.

- Filing dates: https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-returns-filing-dates.htm
- Online filing: https://www.cdtfa.ca.gov/services/file-a-return.htm

## Private record handling

- Keep the seller's permit PDF, return PDFs, payment confirmations, Stripe exports, and reconciliations outside the repository in an access-controlled business records folder.
- Use descriptive filenames such as `CDTFA_Sellers_Permit_2026.pdf` and `CDTFA_2026_Annual_Return.pdf`.
- Never commit these records or paste their permit/account numbers into GitHub.
- The permit was generated and visually verified in CDTFA Online Services during the 2026-08-08 audit. The browser extension could not export the authenticated PDF, so saving the open permit document into the private records folder remains a manual records-management step.

## Stripe Tax configuration

Verified or applied on 2026-08-08:

- Stripe Tax is enabled for Checkout and prices are tax-exclusive.
- The head-office address in both Stripe sandbox and live mode matches the privately confirmed CDTFA Mountain View location.
- Live California Sales Tax collection was activated with explicit owner approval on 2026-08-08 at 16:58 UTC. Stripe shows California as `Collecting tax` with one active registration and no end date.
- Both live Sugar products and the active sandbox Sugar products use `txcd_40020004` (Sugar and Sugar Substitutes).
- Branded paper sticks use `txcd_99999999` (General - Tangible Goods).
- Bloomjoy Plus remains on `txcd_99999999` as the conservative taxable working treatment because the membership provides lower prices on taxable merchandise. Confirm the best Stripe product-code mapping with a tax advisor or Stripe Support; do not change the live code silently.
- Keep Stripe's default Shipping treatment unless the business owner approves a different position after confirming actual carrier cost and invoice wording. Shipping pricing remains a separate executive decision.

Primary sources:

- Food and sugar treatment: https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1602.html
- Membership fees: https://cdtfa.ca.gov/industry/membership-fees/ and https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1584.html
- Delivery charges: https://www.cdtfa.ca.gov/lawguides/vol1/sutr/1628.html
- Stripe product and shipping tax codes: https://docs.stripe.com/tax/tax-codes and https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior

These are implementation working positions, not legal or tax advice.

## Live California activation and deployment gate

The owner approved the live Stripe action, and California collection was activated through Tax > Locations > Add registration > California > I've already registered > Sales tax > Start collecting immediately. Stripe confirmed `Starting immediately`, and the registration detail shows a 2026-08-08 16:58 UTC start time.

Post-activation verification found an important production deployment gap:

- Two no-payment live Checkout previews created after activation (Sugar and branded sticks) were both open and unpaid, but their server responses had Automatic Tax disabled. The previews therefore showed no tax and are not valid tax-calculation evidence.
- The reviewed `stripe-sugar-checkout`, `stripe-sticks-checkout`, and `stripe-plus-checkout` source in PR `#716` enables Automatic Tax. Production is running older checkout-function code and must be updated through the fail-closed commerce cutover before the tax smoke can pass.
- The two diagnostic sessions must remain unpaid and reach `expired` status before the stricter webhook cutover. The available operator credential could read but not expire them, so require a fresh zero-open-session audit after their scheduled expiration.

Complete the remaining gate after deploying the three checkout creators and before deploying the stricter status/webhook functions:

1. Confirm the two 2026-08-08 unpaid diagnostic sessions are expired and require zero unresolved unmarked sessions.
2. Create new no-payment Checkout previews and confirm `automatic_tax.enabled=true` in Stripe for Sugar, branded sticks, and Bloomjoy Plus.
3. Confirm a California Sugar preview follows the food tax code, while California sticks and Plus use the destination tax treatment.
4. Confirm a taxable preview to a no-registration destination reports that Bloomjoy is not collecting tax there.
5. Expire or allow every no-payment preview to expire before webhook cutover; never submit a payment merely to prove calculation.
6. Preserve sanitized evidence in `#718`; keep session IDs, addresses, payment data, receipts, and full exports private.

## Annual filing procedure

1. After 2026-12-31, export the Stripe Tax California report for the full filing period.
2. Reconcile gross sales, exempt Sugar sales, taxable sticks and membership sales, shipping, refunds, and tax collected to paid orders and Stripe payouts.
3. Investigate differences before filing; do not silently override Stripe product codes or CDTFA totals.
4. File the yearly CDTFA return and remit any amount due by 2027-01-31, including a zero return when required.
5. Retain the filed return, payment confirmation, Stripe report, reconciliation, and supporting order records in the private business records folder.
6. Recheck the filing frequency after filing and whenever CDTFA posts a notice, because CDTFA can reassign reporting frequency.

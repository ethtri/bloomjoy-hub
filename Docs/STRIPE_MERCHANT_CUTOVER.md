# Bloomjoy Services Stripe merchant cutover

Tracking: [P0 #1693](https://github.com/ethtri/bloomjoy-hub/issues/1693).
This is a prepared procedure, not evidence that production has switched.

## Verified baseline — October 1, 2026 (Pacific time)

The live www.bloomjoyusa.com frontend targets Supabase project
`ygbzkgxktzqsiygjlqyg`. Its deployed `STRIPE_SECRET_KEY` fingerprint matches a
private credential whose Stripe account API reports TGPaci LLC,
`acct_1Sw9lhBXgw1aIcSW` (Dashboard display name: Bloomjoy Hub). A paid website
Checkout Session is retrievable in that account with a www.bloomjoyusa.com
return URL. The account name alone was not used to determine payment routing.

Read-only checks found zero subscriptions across all statuses, zero open
Checkout Sessions, zero open invoices, zero Payment Links, and three succeeded
PaymentIntents with no pending intent among the returned complete list.
The application has five paid historical orders, zero subscription rows, and
no stored Stripe customer IDs on those orders. Keep all historical records.
Repeat these checks immediately before cutover; this snapshot can become stale.
Also inspect any newly populated customer/subscription references and unfinished
Plus checkout attempts. Do not migrate or cancel billing records automatically.

The existing Stripe webhook is enabled at
`https://ygbzkgxktzqsiygjlqyg.functions.supabase.co/stripe-webhook` and includes
`checkout.session.async_payment_succeeded`. Remote commerce preflight passes
secret-presence checks, including the explicit Customer Portal configuration.
Presence does not prove correct merchant ownership or functional behavior.

## Account preparation — activated; website configuration pending

The owner opened Bloomjoy Services LLC account `acct_1UMDXoAw1uae6O3W` under
the existing login on October 2, 2026. Its nonbinding onboarding has saved the
separate legal name/EIN, Multi-member LLC structure, confirmed business address,
bloomjoyusa.com, Other merchandise category, actual business description, and
BLOOMJOY statement descriptor. Included Radar Lite is selected; tax calculation
and climate contributions are off. After the owner completed verification and
bank confirmation, the October 2 Dashboard readback showed Payments, Payouts,
and ACH Direct Debit Active with no active verification tasks. The USD default
payout bank matches the supplied business bank; automatic daily payouts are
configured. ACH is enabled in the default payment-method configuration.
Successful-payment and refund receipts and the owner's successful-payment
emails are enabled. This verifies configuration, not actual settlement.

The Services live sugar product has the standard USD 10/kg and member USD 8/kg
one-off prices. Remaining catalog tax codes/metadata, sticks and Plus prices,
test-mode catalog, portal, webhook, tax setup, and test rehearsal are pending.
Browser control became unavailable during an unsaved sticks entry; no sticks
product was saved. The connector still has only old-account access; Services
connector access has been requested from the owner. Production remains unchanged.

Use a separate Bloomjoy Services LLC account under the existing login. Keep
TGPaci's legal entity, bank, transactions, and access intact. No Connect or
organization-wide access change is needed for this request.

The owner must complete authentication, identity verification, personal
attestations, final activation submission, and required bank confirmations.
Use the owner's private business records for EIN and bank information; never
place them, credentials, or customer documents in this repository.
Describe commercial cotton-candy machine sales, related supplies, and optional
Bloomjoy Plus subscriptions accurately; use bloomjoyusa.com. Before live use,
read back the legal entity, account ID, business address, charges_enabled,
payouts_enabled, outstanding requirements, and payment-method availability.

Recreate the actual commercial catalog in both test and live modes. Record
separate account-scoped price maps securely; never reuse old-account price IDs.

| Product | Current commercial price | Server setting |
| --- | --- | --- |
| Public sugar | USD 10 / kg | `STRIPE_SUGAR_NON_MEMBER_PRICE_ID` |
| Plus member sugar | USD 8 / kg | `STRIPE_SUGAR_MEMBER_PRICE_ID` |
| Public branded sticks | USD 130 / box | `STRIPE_STICKS_PRICE_ID` |
| Plus member branded sticks | USD 104 / box | `STRIPE_STICKS_MEMBER_PRICE_ID` |
| Optional Plus Basic | USD 100 / month | `STRIPE_PLUS_PRICE_ID` |

Match quantities, billing intervals, product metadata, tax behavior, and
approved shipping settings to the served checkout code and existing catalog.
The legacy `STRIPE_SUGAR_PRICE_ID` bridge, if retained, must reference the new
member price. Do not recreate the old zero-dollar diagnostic sugar product as
a commercial offer. The Micro Machine server gate is currently off; preserve
that state and do not enable it as part of this account change.

Confirm Bloomjoy Services' actual tax registrations and effective dates using
private registration evidence and #718 before enabling automatic tax. TGPaci's
Stripe registrations are not evidence of registrations in the new account.
Review product tax codes and merchant origin address. Keep website checkout
paused if its required tax configuration is not ready rather than silently
disabling tax to complete the switch.

Create an explicit Customer Portal configuration in the new account for its
Plus price, matching the current cancellation and billing controls. The exact
server setting is `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`.

## Test rehearsal — required before production

Use an isolated test backend/database with the new account's test credentials,
test prices, portal configuration, and test webhook signing secret. Production
must never temporarily receive test credentials. Notifications must use
synthetic recipients/transport so a rehearsal does not contact customers.

Verify public/member sugar, public/member sticks, applicable mixed-cart flows,
and optional Plus Checkout. Complete only Stripe test payments. Confirm paid
orders and customer/internal notification handling, member-price eligibility,
subscription creation/update/cancellation, Plus access, and authenticated
Customer Portal return/cancellation behavior. Unpaid, duplicate, unrelated,
invalid-signature, and delayed ACH sessions must not grant access or record a
paid order prematurely. A test delayed-payment success event must record once.

Both test and live endpoints require:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Keep the current paid-session and storefront metadata/price allowlists. A
standalone machine deposit must not be misclassified as a supply order or Plus
purchase. Inspect the deployed function source as well as the branch source;
do not introduce an unrelated Stripe SDK/API upgrade during this cutover.

## Coordinated production change — not performed

1. Recheck old-account pending billing and application references. If new
   obligations exist, resolve the specific compatibility requirement before
   switching. Preserve old-account credentials securely for history/support.
2. Save a private, recoverable snapshot of every current server-side Stripe
   setting and the served commerce function versions. Secret hashes alone are
   not a rollback backup. Keep the old webhook and account available for support.
3. Prepare the new live webhook and verify its event set and account. Until
   signing secrets are coordinated, do not send production traffic to it.
4. Pause new supply/Plus Checkout using the existing maintenance controls, or
   perform a bounded reviewed maintenance deployment if no safe pause exists.
   Drain/recheck open sessions and in-flight requests. Document the exact pause
   mechanism before using it; avoid mixed old/new credentials while requests run.
5. Apply the new server-only settings as one coordinated bundle:
   `STRIPE_SECRET_KEY`, both sugar prices, the optional legacy sugar bridge,
   both sticks prices, `STRIPE_PLUS_PRICE_ID`,
   `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`, and `STRIPE_WEBHOOK_SECRET`.
   Keep all secrets out of shell history, logs, source control, and `VITE_` vars.
6. Refresh affected functions together if required for environment loading:
   sugar/sticks/Plus Checkout, checkout-status, Customer Portal, and webhook.
   Verify signatures and the account/price/portal references before reopening.
7. Perform live checks without submitting payment: inspect newly created live
   Checkout Sessions, merchant branding, amount, tax, URLs, and account ownership;
   then expire only the explicitly created verification sessions. Do not charge
   the owner or any customer. Reopen Checkout after these checks pass.
8. Record the account ID, time, served versions, configuration ownership, test
   evidence, and no-charge live evidence in #1693. End-to-end live payment and
   notification evidence remains pending until an authorized ordinary sale or
   explicitly authorized live payment occurs; do not claim a charge-free preview
   proves settlement, payouts, or delivered notifications.

## Rollback

Before any new-account obligation exists, pause Checkout, restore the complete
old credential/price/portal/webhook bundle and served versions, verify signatures
and old-account no-charge Checkout, then reopen. Never restore only the API key.

If new-account payments, delayed ACH payments, or subscriptions exist, a single
old webhook secret cannot safely process both accounts. Keep Checkout paused
while deploying a bounded account-specific webhook/portal support path or
finishing the new-account repair. Preserve both account histories and signing
secrets; do not cancel, recreate, replay charge actions, or delete obligations
as a shortcut. Record the actual rollback outcome separately from the plan.

## Fixed machine deposit link — created and verified privately

After account readiness was verified, the authorized live deposit link was
created and read back with USD 3,425.00, fixed quantity one, one completed-payment
limit (zero used), no automatic tax/shipping, no future payment-detail saving,
and distinct `checkout_source=machine_sale_deposit` metadata. Hosted Checkout
shows Bloomjoy Services LLC and card/US bank account choices. No payment was
submitted. Customer identifiers and the link are kept outside the repository.
The existing unsent reply draft was updated privately with the verified link
and preserved corrected PDF attachments; payment follows the signed agreement.

Check the verified Services live account for an existing matching link before
creating one. Use one USD 3,425.00 equipment-only deposit, quantity one with no
adjustable quantity, subscription, surcharge, shipping fee, extra tax amount,
promotion, optional upsell, or automatic later balance charge. The description
must identify the authorized buyer and machine deposit. Leave shipping/tax and
the final balance for the later agreed invoice. Offer ACH only if the account
is eligible and verify its delayed-payment handling. Set the supported completed
session limit to one and read back all restrictions, currency, amount, merchant,
and URL. A one-session limit is not proof of ACH settlement. Return the verified
link privately to the owner; do not send it to the buyer or publish it here.

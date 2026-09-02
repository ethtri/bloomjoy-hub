# Mini sales launch

Tracks the Mini slice of #715 and the shipping decision in #717. The $4,000 public machine price is the implementation baseline. This preparation does not enable live sales.

## Reviewed state on September 2, 2026

- The live Bloomjoy Hub Stripe account can accept charges and payouts. California Tax registration is active. The enabled webhook receives completed and delayed-success Checkout events.
- Stripe has no Mini product and no reusable shipping rates. Supabase has no Mini checkout gate, Price ID, or Shipping Rate ID configured.
- The current live order constraint excludes `mini_machine`. Deploy the additive migration before accepting a Mini payment.
- The branch connects Mini to cart, server checkout, verified payment returns, paid-order storage, customer confirmations, internal email, WeCom, and Admin Orders. Public copy and product data share the same browser availability flag.

## Launch configuration

1. Resolve #717: approve the shipping charge (including whether included), delivery area, delivery estimate, and any address restrictions. Confirm the $4,000 price and applicable purchase/warranty terms before opening orders. Do not infer free shipping.
2. The initial implementation accepts **one Mini per checkout, separately from every other product**, with a fixed USD Shipping Rate. Stripe collects a US shipping address. This does **not** enforce a lower-48-only, ZIP-based, PO-box, residential, freight, or international policy. If the approved policy needs those restrictions, implement and test them before activation.
3. Configure sandbox and live Mini Product/Price only after the terms are approved. Price must be active, one-time, USD 400000 cents, and tax-exclusive. The active Product must have a reviewed tax code. Confirm the applicable Stripe Tax registration and expected destination tax results; this code does not select a legal tax classification.
4. Configure an active fixed USD Shipping Rate with minimum and maximum delivery estimates. A $0 rate requires an explicit included-shipping decision.
5. Configure `STRIPE_MINI_PRICE_ID` on `stripe-sugar-checkout`, `stripe-webhook`, and `stripe-checkout-status`; configure `STRIPE_MINI_SHIPPING_RATE_ID` on checkout. Keep `MINI_CHECKOUT_ENABLED=false` and `VITE_MINI_CHECKOUT_ENABLED=false` until the relevant environment is ready.
6. Run `npm run commerce:preflight -- --project-ref <project> --mini-enabled`. This checks secret **names**, not secret values, Stripe objects, or proof of readiness.

## Verification and release

- Run `npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`, `npm run typecheck`, `npm run commerce:validate-payment-first`, and `npm run db:validate-migrations`.
- The Mini tests execute the actual checkout, status, and webhook handlers with local Stripe/database/message adapters. They cover underpriced or archived configuration, missing shipping, duplicate/mixed quantities, paid and delayed-success processing, rejected signatures, and webhook replay. These are not real Stripe transaction or delivery evidence.
- Complete a real sandbox purchase through the website using a disposable test database and local notification sink. Check the approved machine price, shipping, applicable tax, contact/address, paid status, one order, receipt URL, correct Mini email, and one internal/WeCom dispatch. Repeat cancellation, declined payment, and delayed-payment/replay paths. Keep fixtures out of production and never send test messages to real customers.
- Deployment order: `20260902160533_mini_machine_orders.sql`, then `stripe-webhook` and `stripe-checkout-status`, then `stripe-sugar-checkout`, then frontend. Verify all consumer functions have the matching Price ID before enabling checkout.
- After approved production configuration and sandbox proof, enable the server Mini gate and build/deploy the frontend with its Mini gate enabled. Check `/`, `/machines`, `/machines/mini`, `/cart`, `/resources/business-playbook/payback-planner`, structured product data, and authenticated `/admin/orders`/`/portal/orders`.
- Keep Micro's existing gates unchanged. No Mini order may be fulfilled merely from a return URL or an unpaid Checkout event.

## Rollback

Disable `MINI_CHECKOUT_ENABLED`, then rebuild the frontend with `VITE_MINI_CHECKOUT_ENABLED=false`. Expire any open Mini Checkout Sessions so existing links cannot still accept payment. Retain the Mini Price ID, additive database constraint, webhook/status support, and notification idempotency records so already-paid and delayed-success orders can finish safely. Do not delete paid orders or revert the database constraint after a Mini payment.

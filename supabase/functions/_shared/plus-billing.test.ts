import {
  findReusableOpenPlusCheckoutSession,
  hasBlockingPlusSubscription,
  selectStoredStripeCustomerId,
} from "./plus-billing.mjs";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("recoverable Plus subscriptions block duplicate checkout", () => {
  for (
    const status of [
      "active",
      "trialing",
      "past_due",
      "unpaid",
      "paused",
      "incomplete",
    ]
  ) {
    assert(
      hasBlockingPlusSubscription([{ status }]),
      `${status} should block a second subscription checkout`,
    );
  }

  for (const status of ["canceled", "incomplete_expired", "inactive", "none"]) {
    assert(
      !hasBlockingPlusSubscription([{ status }]),
      `${status} should allow a fresh subscription checkout`,
    );
  }
});

Deno.test("stored Stripe customer selection ignores malformed values", () => {
  assert(
    selectStoredStripeCustomerId([
      { stripe_customer_id: "" },
      { stripe_customer_id: "not-a-customer" },
      { stripe_customer_id: "cus_reusable" },
    ]) === "cus_reusable",
    "expected the first valid stored Stripe customer",
  );
});

Deno.test("only the current user's open Bloomjoy Plus session is reused", () => {
  const reusable = {
    status: "open",
    mode: "subscription",
    url: "https://checkout.stripe.test/reusable",
    metadata: {
      checkout_source: "bloomjoy_storefront",
      order_type: "plus_subscription",
      user_id: "user-1",
    },
  };

  assert(
    findReusableOpenPlusCheckoutSession([reusable], "user-1") === reusable,
    "expected the matching open session to be reused",
  );
  assert(
    findReusableOpenPlusCheckoutSession([reusable], "user-2") === null,
    "a different user's session must not be reused",
  );
  assert(
    findReusableOpenPlusCheckoutSession(
      [{ ...reusable, status: "expired" }],
      "user-1",
    ) === null,
    "expired sessions must not be reused",
  );
});

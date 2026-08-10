import {
  buildPlusCheckoutIdempotencyKey,
  checkoutSessionIdFromUrl,
  collectStoredStripeCustomerIds,
  findReusableOpenPlusCheckoutSession,
  hasBlockingPlusSubscription,
  plusCheckoutFailureDisposition,
  resolveReusablePlusCheckoutSession,
  resolveStripePlusBillingState,
  selectAuthoritativePlusBillingCustomer,
} from "./plus-billing.mjs";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const plusSubscription = (
  id: string,
  customer: string,
  status: string,
  userId?: string,
) => ({
  id,
  customer,
  status,
  metadata: userId ? { user_id: userId } : {},
  items: { data: [{ price: { id: "price_plus" } }] },
});

type FakeCustomer = {
  id: string;
  email?: string;
  deleted?: boolean;
  metadata?: { bloomjoy_user_id?: string };
};

const fakeStripe = ({
  customers = [],
  metadataCustomers = [],
  openSessions = [],
  subscriptions = [],
}: {
  customers?: FakeCustomer[];
  metadataCustomers?: FakeCustomer[];
  openSessions?: Array<{
    customer: string;
    status: string;
    mode: string;
    url: string;
    metadata: Record<string, string>;
  }>;
  subscriptions?: Array<ReturnType<typeof plusSubscription>>;
}) => ({
  checkout: {
    sessions: {
      list: async ({ customer }: { customer: string }) => ({
        data: openSessions.filter((session) => session.customer === customer),
        has_more: false,
      }),
    },
  },
  customers: {
    list: async ({ email }: { email: string }) => ({
      data: customers.filter((customer) => customer.email === email),
      has_more: false,
    }),
    retrieve: async (customerId: string) => {
      const customer = [...customers, ...metadataCustomers].find(
        (candidate) => candidate.id === customerId,
      );
      if (!customer) throw { code: "resource_missing" };
      return customer;
    },
    search: async () => ({ data: metadataCustomers, has_more: false }),
  },
  subscriptions: {
    list: async ({ customer }: { customer: string }) => ({
      data: subscriptions.filter((subscription) =>
        subscription.customer === customer
      ),
      has_more: false,
    }),
    retrieve: async (subscriptionId: string) => {
      const subscription = subscriptions.find((candidate) =>
        candidate.id === subscriptionId
      );
      if (!subscription) throw { code: "resource_missing" };
      return subscription;
    },
  },
});

Deno.test("only exact Stripe Checkout URLs yield a reusable session id", () => {
  assert(
    checkoutSessionIdFromUrl(
      "https://checkout.stripe.com/c/pay/cs_test_safe_attempt",
    ) ===
      "cs_test_safe_attempt",
    "expected the exact Checkout URL to yield its session id",
  );
  assert(
    checkoutSessionIdFromUrl(
      "https://checkout.stripe.com.evil.test/c/pay/cs_test_wrong",
    ) ===
      null,
    "lookalike hosts must be rejected",
  );
  assert(
    checkoutSessionIdFromUrl(
      "http://checkout.stripe.com/c/pay/cs_test_wrong",
    ) === null,
    "non-HTTPS Checkout URLs must be rejected",
  );
  assert(
    checkoutSessionIdFromUrl(
      "https://checkout.stripe.com/c/pay/not_a_session",
    ) === null,
    "invalid Checkout identifiers must be rejected",
  );
});

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

Deno.test("stored Stripe customer collection deduplicates and ignores malformed values", () => {
  const customerIds = collectStoredStripeCustomerIds([
    { stripe_customer_id: "" },
    { stripe_customer_id: "not-a-customer" },
    { stripe_customer_id: "cus_reusable" },
    { stripe_customer_id: "cus_reusable" },
    { stripe_customer_id: "cus_history" },
  ]);

  assert(customerIds.length === 2, "expected two distinct valid customer IDs");
  assert(customerIds[0] === "cus_reusable", "expected stable record order");
  assert(
    customerIds[1] === "cus_history",
    "expected historical customer preservation",
  );
});

Deno.test("active customer wins over newer terminal customer history", () => {
  const selection = selectAuthoritativePlusBillingCustomer([
    {
      customerId: "cus_terminal",
      subscriptions: [{ status: "canceled" }],
    },
    {
      customerId: "cus_active",
      subscriptions: [{ status: "active" }],
    },
  ]);

  assert(!selection.ambiguous, "one blocking customer should be authoritative");
  assert(
    selection.customerId === "cus_active",
    "active billing customer should win",
  );
  assert(
    selection.hasBlockingSubscription,
    "active subscription should block checkout",
  );
});

Deno.test("multiple blocking customers fail closed as ambiguous", () => {
  const selection = selectAuthoritativePlusBillingCustomer([
    { customerId: "cus_active", subscriptions: [{ status: "active" }] },
    { customerId: "cus_past_due", subscriptions: [{ status: "past_due" }] },
  ]);

  assert(
    selection.ambiguous,
    "two actionable billing customers must fail closed",
  );
  assert(
    selection.customerId === null,
    "ambiguous billing must not select a portal customer",
  );
  assert(
    selection.hasBlockingSubscription,
    "ambiguous live subscriptions still block checkout",
  );
});

Deno.test("ambiguous same-email customers cannot create a third billing record", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [
        { id: "cus_one", email: "owner@example.com" },
        { id: "cus_two", email: "owner@example.com" },
      ],
    }),
    subscriptionRecords: [],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(
    state.ambiguous,
    "multiple empty same-email customers should fail closed",
  );
  assert(state.customerId === null, "ambiguous customers must not be selected");
});

Deno.test("Bloomjoy user metadata selects the canonical empty customer", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [
        { id: "cus_order_one", email: "owner@example.com" },
        { id: "cus_order_two", email: "owner@example.com" },
      ],
      metadataCustomers: [
        {
          id: "cus_bloomjoy_user",
          email: "owner@example.com",
          metadata: { bloomjoy_user_id: "user-1" },
        },
      ],
    }),
    subscriptionRecords: [],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(!state.ambiguous, "one Bloomjoy-bound customer should resolve safely");
  assert(
    state.customerId === "cus_bloomjoy_user",
    "unrelated same-email commerce customers must not override user metadata",
  );
});

Deno.test("a same-email Customer bound to another Bloomjoy user fails closed", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [{
        id: "cus_prior_owner",
        email: "owner@example.com",
        metadata: { bloomjoy_user_id: "different-user" },
      }],
    }),
    subscriptionRecords: [],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(state.ambiguous, "conflicting Customer ownership must fail closed");
  assert(
    state.ownershipConflict,
    "the resolver should identify an ownership conflict",
  );
  assert(state.customerId === null, "no conflicting Customer may be selected");
});

Deno.test("a same-email Plus subscription bound to another user fails closed", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [{ id: "cus_legacy", email: "owner@example.com" }],
      subscriptions: [
        plusSubscription(
          "sub_prior_owner",
          "cus_legacy",
          "active",
          "different-user",
        ),
      ],
    }),
    subscriptionRecords: [],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(
    state.ambiguous,
    "conflicting subscription ownership must fail closed",
  );
  assert(
    state.ownershipConflict,
    "the resolver should identify a subscription ownership conflict",
  );
  assert(
    state.customerId === null,
    "no conflicting subscription Customer may be selected",
  );
});

Deno.test("Stripe terminal status overrides stale active database status", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [{ id: "cus_stale", email: "owner@example.com" }],
      subscriptions: [plusSubscription("sub_stale", "cus_stale", "canceled")],
    }),
    subscriptionRecords: [
      {
        stripe_customer_id: "cus_stale",
        stripe_subscription_id: "sub_stale",
        status: "active",
      },
    ],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(
    !state.ambiguous,
    "one terminal billing history should resolve safely",
  );
  assert(
    !state.hasBlockingSubscription,
    "authoritative Stripe cancellation should allow restart",
  );
  assert(
    state.customerId === "cus_stale",
    "restart should reuse the historical customer",
  );
});

Deno.test("active legacy customer is found across duplicate email records", async () => {
  const state = await resolveStripePlusBillingState({
    stripe: fakeStripe({
      customers: [
        { id: "cus_empty", email: "owner@example.com" },
        { id: "cus_active", email: "owner@example.com" },
      ],
      subscriptions: [plusSubscription("sub_active", "cus_active", "active")],
    }),
    subscriptionRecords: [],
    userId: "user-1",
    email: "owner@example.com",
    plusPriceId: "price_plus",
  });

  assert(
    !state.ambiguous,
    "one active customer should resolve duplicate email history",
  );
  assert(
    state.customerId === "cus_active",
    "active legacy customer should be authoritative",
  );
  assert(
    state.hasBlockingSubscription,
    "active legacy subscription must block checkout",
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

Deno.test("an open checkout on an otherwise empty duplicate customer is resumed", async () => {
  const reusable = {
    customer: "cus_open",
    status: "open",
    mode: "subscription",
    url: "https://checkout.stripe.test/open",
    metadata: {
      checkout_source: "bloomjoy_storefront",
      order_type: "plus_subscription",
      user_id: "user-1",
    },
  };
  const state = await resolveReusablePlusCheckoutSession({
    stripe: fakeStripe({ openSessions: [reusable] }),
    customerStates: [
      { customerId: "cus_terminal", subscriptions: [{ status: "canceled" }] },
      { customerId: "cus_open", subscriptions: [] },
    ],
    userId: "user-1",
  });

  assert(!state.ambiguous, "one open Checkout Session should resolve safely");
  assert(
    state.customerId === "cus_open",
    "the open-session customer should be reused",
  );
  assert(
    state.session === reusable,
    "the existing open Checkout Session should be returned",
  );
});

Deno.test("open checkouts on multiple customers fail closed", async () => {
  const makeOpenSession = (customer: string) => ({
    customer,
    status: "open",
    mode: "subscription",
    url: `https://checkout.stripe.test/${customer}`,
    metadata: {
      checkout_source: "bloomjoy_storefront",
      order_type: "plus_subscription",
      user_id: "user-1",
    },
  });
  const state = await resolveReusablePlusCheckoutSession({
    stripe: fakeStripe({
      openSessions: [makeOpenSession("cus_one"), makeOpenSession("cus_two")],
    }),
    customerStates: [
      { customerId: "cus_one", subscriptions: [] },
      { customerId: "cus_two", subscriptions: [] },
    ],
    userId: "user-1",
  });

  assert(state.ambiguous, "multiple open checkout customers must fail closed");
  assert(
    state.session === null,
    "ambiguous open checkouts must not return a URL",
  );
});

Deno.test("a timeout after Stripe accepts Checkout preserves one idempotency key", async () => {
  const userId = "user-1";
  const attemptToken = "attempt-token-1";
  const idempotencyKey = buildPlusCheckoutIdempotencyKey(userId, attemptToken);
  const acceptedSessions = new Map<string, { id: string }>();
  let timeoutAfterAcceptance = true;

  const createSession = async (key: string) => {
    const session = acceptedSessions.get(key) ?? { id: "cs_test_one" };
    acceptedSessions.set(key, session);
    if (timeoutAfterAcceptance) {
      timeoutAfterAcceptance = false;
      throw new Error("synthetic timeout after acceptance");
    }
    return session;
  };

  let firstAttemptFailed = false;
  try {
    await createSession(idempotencyKey);
  } catch {
    firstAttemptFailed = true;
    assert(
      plusCheckoutFailureDisposition(true) === "preserve",
      "an uncertain provider outcome must preserve the durable attempt",
    );
  }

  assert(firstAttemptFailed, "the first response should simulate a timeout");
  const retriedSession = await createSession(
    buildPlusCheckoutIdempotencyKey(userId, attemptToken),
  );
  assert(
    retriedSession.id === "cs_test_one",
    "the retry should reuse the accepted session",
  );
  assert(
    acceptedSessions.size === 1,
    "the accepted Checkout must remain unique across the retry",
  );
  assert(
    plusCheckoutFailureDisposition(false) === "release",
    "a failure before Checkout creation may release the attempt",
  );
});

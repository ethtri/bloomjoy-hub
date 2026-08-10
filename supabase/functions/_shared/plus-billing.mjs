export const blockingPlusSubscriptionStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

const normalizeString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const uniqueStrings = (values) => [...new Set(values.filter(Boolean))];

const hasConflictingOwner = (value, userId) => {
  const ownerId = normalizeString(value);
  return ownerId !== null && ownerId !== userId;
};

const isMissingStripeResource = (error) =>
  error?.code === "resource_missing" || error?.statusCode === 404;

const subscriptionUsesPrice = (subscription, plusPriceId) =>
  subscription?.items?.data?.some((item) => item?.price?.id === plusPriceId) ??
    false;

const subscriptionCustomerId = (subscription) =>
  normalizeString(
    typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id,
  );

export const hasBlockingPlusSubscription = (subscriptions) =>
  Array.isArray(subscriptions) &&
  subscriptions.some((subscription) =>
    blockingPlusSubscriptionStatuses.has(normalizeString(subscription?.status))
  );

export const buildPlusCheckoutIdempotencyKey = (userId, attemptToken) =>
  `bloomjoy-plus-checkout:${userId}:${attemptToken}`;

export const plusCheckoutFailureDisposition = (checkoutCreateStarted) =>
  checkoutCreateStarted ? "preserve" : "release";

export const collectStoredStripeCustomerIds = (subscriptionRecords) => {
  if (!Array.isArray(subscriptionRecords)) return [];

  return uniqueStrings(
    subscriptionRecords.map((record) => {
      const customerId = normalizeString(record?.stripe_customer_id);
      return customerId?.startsWith("cus_") ? customerId : null;
    }),
  );
};

export const collectStoredStripeSubscriptionIds = (subscriptionRecords) => {
  if (!Array.isArray(subscriptionRecords)) return [];

  return uniqueStrings(
    subscriptionRecords.map((record) => {
      const subscriptionId = normalizeString(record?.stripe_subscription_id);
      return subscriptionId?.startsWith("sub_") ? subscriptionId : null;
    }),
  );
};

export const selectAuthoritativePlusBillingCustomer = (customerStates) => {
  const normalizedStates = Array.isArray(customerStates)
    ? customerStates.filter((state) => normalizeString(state?.customerId))
    : [];
  const blockingStates = normalizedStates.filter((state) =>
    hasBlockingPlusSubscription(state.subscriptions)
  );

  if (blockingStates.length > 1) {
    return {
      ambiguous: true,
      customerId: null,
      hasBlockingSubscription: true,
    };
  }

  if (blockingStates.length === 1) {
    return {
      ambiguous: false,
      customerId: blockingStates[0].customerId,
      hasBlockingSubscription: true,
    };
  }

  const historyStates = normalizedStates.filter((state) =>
    Array.isArray(state.subscriptions) && state.subscriptions.length > 0
  );

  if (historyStates.length > 1) {
    return {
      ambiguous: true,
      customerId: null,
      hasBlockingSubscription: false,
    };
  }

  if (historyStates.length === 1) {
    return {
      ambiguous: false,
      customerId: historyStates[0].customerId,
      hasBlockingSubscription: false,
    };
  }

  const identityBoundStates = normalizedStates.filter((state) =>
    state?.identityBound === true
  );

  if (identityBoundStates.length > 1) {
    return {
      ambiguous: true,
      customerId: null,
      hasBlockingSubscription: false,
    };
  }

  if (identityBoundStates.length === 1) {
    return {
      ambiguous: false,
      customerId: identityBoundStates[0].customerId,
      hasBlockingSubscription: false,
    };
  }

  if (normalizedStates.length > 1) {
    return {
      ambiguous: true,
      customerId: null,
      hasBlockingSubscription: false,
    };
  }

  return {
    ambiguous: false,
    customerId: normalizedStates[0]?.customerId ?? null,
    hasBlockingSubscription: false,
  };
};

export const resolveStripePlusBillingState = async ({
  stripe,
  subscriptionRecords,
  userId,
  email,
  plusPriceId,
}) => {
  const storedCustomerIds = collectStoredStripeCustomerIds(
    subscriptionRecords,
  );
  const candidateCustomerIds = new Set(storedCustomerIds);
  const identityBoundCustomerIds = new Set(storedCustomerIds);
  let ownershipConflict = false;

  for (
    const subscriptionId of collectStoredStripeSubscriptionIds(
      subscriptionRecords,
    )
  ) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!subscriptionUsesPrice(subscription, plusPriceId)) continue;
      if (hasConflictingOwner(subscription?.metadata?.user_id, userId)) {
        ownershipConflict = true;
        continue;
      }
      const customerId = subscriptionCustomerId(subscription);
      if (customerId?.startsWith("cus_")) {
        candidateCustomerIds.add(customerId);
        identityBoundCustomerIds.add(customerId);
      }
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error;
    }
  }

  const [metadataCustomers, emailCustomers] = await Promise.all([
    stripe.customers.search({
      query: `metadata['bloomjoy_user_id']:'${userId}'`,
      limit: 100,
    }),
    stripe.customers.list({ email, limit: 100 }),
  ]);

  if (metadataCustomers.has_more || emailCustomers.has_more) {
    throw new Error("Too many Stripe billing records to resolve safely.");
  }

  for (const customer of metadataCustomers.data) {
    const customerId = normalizeString(customer?.id);
    if (hasConflictingOwner(customer?.metadata?.bloomjoy_user_id, userId)) {
      ownershipConflict = true;
      continue;
    }
    if (customerId?.startsWith("cus_") && !customer?.deleted) {
      candidateCustomerIds.add(customerId);
      identityBoundCustomerIds.add(customerId);
    }
  }

  for (const customer of emailCustomers.data) {
    const customerId = normalizeString(customer?.id);
    if (!customerId?.startsWith("cus_") || customer?.deleted) continue;
    if (hasConflictingOwner(customer?.metadata?.bloomjoy_user_id, userId)) {
      ownershipConflict = true;
      continue;
    }
    candidateCustomerIds.add(customerId);
    if (customer?.metadata?.bloomjoy_user_id === userId) {
      identityBoundCustomerIds.add(customerId);
    }
  }

  const customerStates = [];
  for (const customerId of candidateCustomerIds) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.deleted) continue;
      if (hasConflictingOwner(customer?.metadata?.bloomjoy_user_id, userId)) {
        ownershipConflict = true;
        continue;
      }
      if (customer?.metadata?.bloomjoy_user_id === userId) {
        identityBoundCustomerIds.add(customerId);
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        price: plusPriceId,
        status: "all",
        limit: 100,
      });
      if (subscriptions.has_more) {
        throw new Error("Too many Plus subscriptions to resolve safely.");
      }
      if (
        subscriptions.data.some((subscription) =>
          hasConflictingOwner(subscription?.metadata?.user_id, userId)
        )
      ) {
        ownershipConflict = true;
        continue;
      }

      customerStates.push({
        customerId,
        identityBound: identityBoundCustomerIds.has(customerId),
        subscriptions: subscriptions.data,
      });
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error;
    }
  }

  if (ownershipConflict) {
    return {
      ambiguous: true,
      customerId: null,
      hasBlockingSubscription: true,
      ownershipConflict: true,
      customerStates,
    };
  }

  return {
    ...selectAuthoritativePlusBillingCustomer(customerStates),
    ownershipConflict: false,
    customerStates,
  };
};

export const resolveReusablePlusCheckoutSession = async ({
  stripe,
  customerStates,
  userId,
}) => {
  const reusableSessions = [];

  for (const state of Array.isArray(customerStates) ? customerStates : []) {
    const customerId = normalizeString(state?.customerId);
    if (!customerId?.startsWith("cus_")) continue;

    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 100,
    });
    if (openSessions.has_more) {
      throw new Error(
        "Too many open Plus Checkout Sessions to resolve safely.",
      );
    }

    const session = findReusableOpenPlusCheckoutSession(
      openSessions.data,
      userId,
    );
    if (session) reusableSessions.push({ customerId, session });
  }

  if (reusableSessions.length > 1) {
    return { ambiguous: true, customerId: null, session: null };
  }

  return {
    ambiguous: false,
    customerId: reusableSessions[0]?.customerId ?? null,
    session: reusableSessions[0]?.session ?? null,
  };
};

export const findReusableOpenPlusCheckoutSession = (sessions, userId) => {
  if (!Array.isArray(sessions)) return null;

  return (
    sessions.find(
      (session) =>
        session?.status === "open" &&
        session?.mode === "subscription" &&
        normalizeString(session?.url) !== null &&
        session?.metadata?.checkout_source === "bloomjoy_storefront" &&
        session?.metadata?.order_type === "plus_subscription" &&
        session?.metadata?.user_id === userId,
    ) ?? null
  );
};

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

export const hasBlockingPlusSubscription = (subscriptions) =>
  Array.isArray(subscriptions) &&
  subscriptions.some((subscription) =>
    blockingPlusSubscriptionStatuses.has(normalizeString(subscription?.status))
  );

export const selectStoredStripeCustomerId = (subscriptionRecords) => {
  if (!Array.isArray(subscriptionRecords)) return null;

  for (const record of subscriptionRecords) {
    const customerId = normalizeString(record?.stripe_customer_id);
    if (customerId?.startsWith("cus_")) return customerId;
  }

  return null;
};

export const findReusableOpenPlusCheckoutSession = (
  sessions,
  userId,
) => {
  if (!Array.isArray(sessions)) return null;

  return sessions.find((session) =>
    session?.status === "open" &&
    session?.mode === "subscription" &&
    normalizeString(session?.url) !== null &&
    session?.metadata?.checkout_source === "bloomjoy_storefront" &&
    session?.metadata?.order_type === "plus_subscription" &&
    session?.metadata?.user_id === userId
  ) ?? null;
};

export const PAID_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export const STOREFRONT_CHECKOUT_SOURCE = "bloomjoy_storefront";

const PAYMENT_ORDER_TYPES = new Set([
  "sugar",
  "blank_sticks",
  "micro_machine",
  "mixed",
]);

export const shouldFulfillCheckoutSession = (eventType, session, expectedMode = "payment") =>
  PAID_CHECKOUT_EVENT_TYPES.has(eventType) &&
  session?.mode === expectedMode &&
  session?.payment_status === "paid";

export const isBloomjoyCheckoutSession = (session, expectedMode = "payment") => {
  const orderType = session?.metadata?.order_type;
  const allowedOrderType = expectedMode === "subscription"
    ? orderType === "plus_subscription"
    : PAYMENT_ORDER_TYPES.has(orderType);

  return session?.mode === expectedMode &&
    session?.metadata?.checkout_source === STOREFRONT_CHECKOUT_SOURCE &&
    allowedOrderType;
};

const compactPriceSet = (values) => new Set(values.filter(Boolean));

export const hasAllowedCheckoutPrices = (session, config) => {
  const priceIds = session?.line_items?.data?.map((item) =>
    typeof item?.price === "string" ? item.price : item?.price?.id ?? null
  ) ?? [];
  if (priceIds.length === 0 || priceIds.some((priceId) => !priceId)) return false;

  const sugarPriceIds = compactPriceSet(config?.sugarPriceIds ?? []);
  const sticksPriceIds = compactPriceSet(config?.sticksPriceIds ?? []);
  const microMachinePriceId = config?.microMachinePriceId;
  const plusPriceId = config?.plusPriceId;
  const orderType = session?.metadata?.order_type;

  if (orderType === "sugar") {
    return priceIds.length === 1 && priceIds.every((priceId) => sugarPriceIds.has(priceId));
  }

  if (orderType === "blank_sticks") {
    return priceIds.length === 1 && priceIds.every((priceId) => sticksPriceIds.has(priceId));
  }

  if (orderType === "micro_machine") {
    return Boolean(microMachinePriceId) &&
      priceIds.length === 1 &&
      priceIds[0] === microMachinePriceId;
  }

  if (orderType === "mixed") {
    return Boolean(microMachinePriceId) &&
      priceIds.length === 2 &&
      priceIds.some((priceId) => sugarPriceIds.has(priceId)) &&
      priceIds.some((priceId) => priceId === microMachinePriceId) &&
      priceIds.every((priceId) =>
        sugarPriceIds.has(priceId) || priceId === microMachinePriceId
      );
  }

  if (orderType === "plus_subscription") {
    return Boolean(plusPriceId) && priceIds.length === 1 && priceIds[0] === plusPriceId;
  }

  return false;
};

export const hasExpectedPlusSubscriptionPrice = (subscription, plusPriceId) => {
  const priceIds = subscription?.items?.data?.map((item) => item?.price?.id) ?? [];
  return Boolean(plusPriceId) && priceIds.length === 1 && priceIds[0] === plusPriceId;
};

export const isBloomjoyPlusSubscription = (subscription, plusPriceId) =>
  hasExpectedPlusSubscriptionPrice(subscription, plusPriceId) &&
    subscription?.metadata?.checkout_source === STOREFRONT_CHECKOUT_SOURCE &&
    subscription?.metadata?.order_type === "plus_subscription";

export const buildOrderEmailIdempotencyKey = (channel, checkoutSessionId) =>
  `order-${channel}-${checkoutSessionId}`;

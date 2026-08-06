export const PAID_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export const shouldFulfillCheckoutSession = (eventType, session, expectedMode = "payment") =>
  PAID_CHECKOUT_EVENT_TYPES.has(eventType) &&
  session?.mode === expectedMode &&
  session?.payment_status === "paid";

export const buildOrderEmailIdempotencyKey = (channel, checkoutSessionId) =>
  `order-${channel}-${checkoutSessionId}`;

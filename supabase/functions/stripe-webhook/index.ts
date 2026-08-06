import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  sendInternalEmail,
  sendTransactionalEmail,
} from "../_shared/storefront-email.ts";
import { sendWeComAlertResult } from "../_shared/wecom-alert.ts";
import { buildCustomerOrderEmail } from "../_shared/customer-order-email.ts";
import {
  buildOrderEmailIdempotencyKey,
  shouldFulfillCheckoutSession,
} from "../_shared/paid-checkout.mjs";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const adminOrdersUrl = "https://app.bloomjoyusa.com/admin/orders";

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!webhookSecret) {
  console.error("Missing STRIPE_WEBHOOK_SECRET");
}

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-04-10",
    })
  : null;

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    })
  : null;

type StripeLineItemSummary = {
  description: string | null;
  quantity: number | null;
  amount_total: number | null;
  currency: string | null;
  price_id: string | null;
  metadata?: Record<string, unknown>;
};

type OrderType = "sugar" | "blank_sticks" | "micro_machine" | "mixed" | "unknown";
type PricingTier = "plus_member" | "standard" | null;

type AddressSnapshot = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

type SugarMixSummary = {
  white_kg: number;
  blue_kg: number;
  orange_kg: number;
  red_kg: number;
  total_kg: number;
};

type BlankSticksSummary = {
  box_count: number;
  pieces_per_box: number;
  stick_size: string | null;
  address_type: string | null;
  shipping_rate_per_box_usd: number;
  shipping_total_cents: number;
  free_shipping: boolean;
};

type MicroMachineSummary = {
  quantity: number;
};

type PersistedOrderRow = {
  id: string;
  internal_notification_sent_at: string | null;
  customer_confirmation_sent_at: string | null;
  wecom_alert_sent_at: string | null;
};

type OrderContext = {
  orderId: string;
  session: Stripe.Checkout.Session;
  orderType: OrderType;
  pricingTier: PricingTier;
  unitPriceCents: number | null;
  shippingTotalCents: number;
  receiptUrl: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  billingAddress: AddressSnapshot | null;
  shippingName: string | null;
  shippingPhone: string | null;
  shippingAddress: AddressSnapshot | null;
  lineItems: StripeLineItemSummary[];
  sugarMix: SugarMixSummary;
  blankSticks: BlankSticksSummary | null;
  microMachine: MicroMachineSummary | null;
  existingInternalNotificationSentAt: string | null;
  existingCustomerConfirmationSentAt: string | null;
  existingWeComAlertSentAt: string | null;
};

const claimDispatch = async (
  eventKey: string,
  sourceId: string,
  meta: Record<string, unknown>,
  dispatchType = "order_checkout",
  sourceTable = "orders",
): Promise<boolean> => {
  if (!supabase) return false;

  const { error } = await supabase.from("internal_notification_dispatches").insert({
    event_key: eventKey,
    dispatch_type: dispatchType,
    source_table: sourceTable,
    source_id: sourceId,
    meta,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  throw new Error(error.message || "Failed to claim order notification dispatch.");
};

const releaseDispatch = async (eventKey: string) => {
  if (!supabase) return;
  await supabase.from("internal_notification_dispatches").delete().eq("event_key", eventKey);
};

const markDispatchSent = async (eventKey: string, meta: Record<string, unknown>) => {
  if (!supabase) return;
  await supabase
    .from("internal_notification_dispatches")
    .update({
      sent_at: new Date().toISOString(),
      meta,
    })
    .eq("event_key", eventKey);
};

const parseNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toAddressSnapshot = (
  address: Stripe.Address | null | undefined
): AddressSnapshot | null => {
  if (!address) return null;

  const snapshot: AddressSnapshot = {
    line1: normalizeString(address.line1),
    line2: normalizeString(address.line2),
    city: normalizeString(address.city),
    state: normalizeString(address.state),
    postal_code: normalizeString(address.postal_code),
    country: normalizeString(address.country),
  };

  return Object.values(snapshot).some(Boolean) ? snapshot : null;
};

const formatAddress = (address: AddressSnapshot | null | undefined) => {
  if (!address) return "n/a";

  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "n/a";
};

const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
  if (typeof amount !== "number") return "n/a";
  const normalizedCurrency = (currency || "usd").toUpperCase();
  return `${normalizedCurrency} ${(amount / 100).toFixed(2)}`;
};

const formatUnitPrice = (unitPriceCents: number | null | undefined) => {
  if (typeof unitPriceCents !== "number") return "n/a";
  return `USD ${(unitPriceCents / 100).toFixed(2)}`;
};

const formatPricingTier = (pricingTier: PricingTier) => {
  switch (pricingTier) {
    case "plus_member":
      return "Bloomjoy Plus member";
    case "standard":
      return "Standard";
    default:
      return "n/a";
  }
};

const formatOrderType = (orderType: OrderType) => {
  switch (orderType) {
    case "sugar":
      return "Sugar";
    case "blank_sticks":
      return "Bloomjoy branded sticks";
    case "micro_machine":
      return "Micro Machine";
    case "mixed":
      return "Mixed storefront";
    default:
      return "Unknown";
  }
};

const formatStickSize = (stickSize: string | null | undefined) => {
  switch (stickSize) {
    case "commercial_10x300":
      return "Commercial / Full Machine (10mm x 300mm)";
    case "mini_10x220":
      return "Mini Machine (10mm x 220mm)";
    default:
      return stickSize || "n/a";
  }
};

const formatAddressType = (addressType: string | null | undefined) => {
  switch (addressType) {
    case "business":
      return "Business address";
    case "residential":
      return "Residential address";
    default:
      return addressType || "n/a";
  }
};

const deriveUnitPriceCents = (lineItems: StripeLineItemSummary[]): number | null => {
  const primaryLineItem = lineItems.find(
    (item) =>
      typeof item.amount_total === "number" &&
      typeof item.quantity === "number" &&
      item.quantity > 0
  );

  if (!primaryLineItem || primaryLineItem.amount_total === null || primaryLineItem.quantity === null) {
    return null;
  }

  return Math.round(primaryLineItem.amount_total / primaryLineItem.quantity);
};

const resolveReceiptUrl = async (
  paymentIntentId: string | null
): Promise<{
  receiptUrl: string | null;
  billingAddress: AddressSnapshot | null;
  billingName: string | null;
  billingPhone: string | null;
  billingEmail: string | null;
}> => {
  if (!stripe || !paymentIntentId) {
    return {
      receiptUrl: null,
      billingAddress: null,
      billingName: null,
      billingPhone: null,
      billingEmail: null,
    };
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });

  const latestCharge =
    typeof paymentIntent.latest_charge === "object" && paymentIntent.latest_charge
      ? paymentIntent.latest_charge as Stripe.Charge
      : null;
  const billingDetails = latestCharge?.billing_details ?? null;

  return {
    receiptUrl: normalizeString(latestCharge?.receipt_url),
    billingAddress: toAddressSnapshot(billingDetails?.address),
    billingName: normalizeString(billingDetails?.name),
    billingPhone: normalizeString(billingDetails?.phone),
    billingEmail: normalizeString(billingDetails?.email),
  };
};

async function resolveUserId(userId: string | null | undefined) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    return null;
  }
  return data.user.id;
}

async function resolveUserIdByEmail(email: string | null | undefined) {
  if (!supabase || !email) return null;
  const { data, error } = await supabase
    .schema("auth")
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data.id;
}

async function upsertSubscription(subscription: Stripe.Subscription) {
  if (!supabase) return;

  const metadataUserId = subscription.metadata?.user_id;
  const customer =
    typeof subscription.customer === "string"
      ? await stripe?.customers.retrieve(subscription.customer)
      : subscription.customer;
  const customerEmail =
    typeof customer === "object" && customer && "email" in customer
      ? customer.email
      : null;

  let resolvedUserId: string | null = null;

  if (metadataUserId) {
    resolvedUserId = await resolveUserId(metadataUserId);
    if (!resolvedUserId) {
      console.warn("Subscription metadata user_id did not resolve", subscription.id);
      return;
    }
  } else {
    resolvedUserId = await resolveUserIdByEmail(customerEmail);
  }

  if (!resolvedUserId) {
    console.warn("No matching user for subscription", subscription.id);
    return;
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const payload = {
    user_id: resolvedUserId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };

  const { error } = await supabase
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error("Failed to upsert subscription", error);
  }
}

const buildLineItemSummary = (lineItems: StripeLineItemSummary[]) =>
  lineItems.length
    ? lineItems.map((item, index) => {
      const detailLines = [
        `${index + 1}. ${item.description || "Line item"}`,
        `   Quantity: ${item.quantity ?? "n/a"}`,
        `   Line total: ${formatCurrency(item.amount_total, item.currency)}`,
      ];

      if (item.price_id) {
        detailLines.push(`   Price ID: ${item.price_id}`);
      }

      if (item.metadata) {
        detailLines.push(`   Metadata: ${JSON.stringify(item.metadata)}`);
      }

      return detailLines.join("\n");
    }).join("\n")
    : "No line items available.";

const coerceOrderType = (
  value: string | null | undefined,
  sugarMix: SugarMixSummary,
  blankSticks: BlankSticksSummary,
  microMachine: MicroMachineSummary
): OrderType => {
  if (
    value === "sugar" ||
    value === "blank_sticks" ||
    value === "micro_machine" ||
    value === "mixed"
  ) {
    return value;
  }

  if (sugarMix.total_kg > 0 && microMachine.quantity > 0) {
    return "mixed";
  }

  if (microMachine.quantity > 0) {
    return "micro_machine";
  }

  if (sugarMix.total_kg > 0) {
    return "sugar";
  }

  if (blankSticks.box_count > 0) {
    return "blank_sticks";
  }

  return "unknown";
};

const buildInternalOrderEmail = (context: OrderContext) => {
  const lineItemSummary = buildLineItemSummary(context.lineItems);
  let detailSection: string[];

  if (context.orderType === "blank_sticks") {
    detailSection = [
        "",
        "Bloomjoy Branded Stick Details:",
        `- Boxes: ${context.blankSticks?.box_count ?? "n/a"}`,
        `- Pieces per box: ${context.blankSticks?.pieces_per_box ?? "n/a"}`,
        `- Stick size: ${formatStickSize(context.blankSticks?.stick_size)}`,
        `- Address type: ${formatAddressType(context.blankSticks?.address_type)}`,
        `- Shipping rate per box: ${
          context.blankSticks?.shipping_rate_per_box_usd
            ? `USD ${context.blankSticks.shipping_rate_per_box_usd.toFixed(2)}`
            : "USD 0.00"
        }`,
        `- Free shipping: ${context.blankSticks?.free_shipping ? "Yes" : "No"}`,
      ];
  } else if (context.orderType === "micro_machine") {
    detailSection = [
      "",
      "Micro Machine Details:",
      `- Quantity: ${context.microMachine?.quantity ?? "n/a"}`,
    ];
  } else {
    detailSection = [
        "",
        "Sugar Breakdown (KG):",
        `- White: ${context.sugarMix.white_kg}`,
        `- Blue: ${context.sugarMix.blue_kg}`,
        `- Orange: ${context.sugarMix.orange_kg}`,
        `- Red: ${context.sugarMix.red_kg}`,
        `- Total: ${context.sugarMix.total_kg}`,
      ];

    if (context.orderType === "mixed") {
      detailSection.push(
        "",
        "Micro Machine Details:",
        `- Quantity: ${context.microMachine?.quantity ?? "n/a"}`,
      );
    }
  }

  return {
    subject: `New ${formatOrderType(context.orderType).toLowerCase()} order: ${context.session.id}`,
    text: [
      `A Stripe ${formatOrderType(context.orderType).toLowerCase()} checkout completed.`,
      "",
      `Checkout Session ID: ${context.session.id}`,
      `Completed At (UTC): ${new Date().toISOString()}`,
      `Order Type: ${formatOrderType(context.orderType)}`,
      `Payment Status: ${context.session.payment_status || "unpaid"}`,
      `Amount Total: ${formatCurrency(context.session.amount_total, context.session.currency)}`,
      `Pricing Tier: ${formatPricingTier(context.pricingTier)}`,
      `Unit Price: ${formatUnitPrice(context.unitPriceCents)}`,
      `Shipping Total: ${formatCurrency(context.shippingTotalCents, context.session.currency)}`,
      `Customer Email: ${context.customerEmail ?? "n/a"}`,
      `Customer Name: ${context.customerName ?? "n/a"}`,
      `Customer Phone: ${context.customerPhone ?? "n/a"}`,
      `Billing Address: ${formatAddress(context.billingAddress)}`,
      `Shipping Name: ${context.shippingName ?? "n/a"}`,
      `Shipping Phone: ${context.shippingPhone ?? "n/a"}`,
      `Shipping Address: ${formatAddress(context.shippingAddress)}`,
      `Receipt URL: ${context.receiptUrl ?? "n/a"}`,
      ...detailSection,
      "",
      "Fulfillment Next Steps:",
      `- Open Admin Orders: ${adminOrdersUrl}`,
      `- Search for checkout session ${context.session.id}.`,
      "- Assign an owner, add fulfillment notes, and update status/tracking as the order moves.",
      "- Fulfill from the product details and shipping address above.",
      "",
      "Line Items:",
      lineItemSummary,
    ].join("\n"),
  };
};

const buildWeComProductSummary = (context: OrderContext): string => {
  if (context.orderType === "blank_sticks") {
    return `Boxes / Pieces per box: ${context.blankSticks?.box_count ?? "n/a"} / ${context.blankSticks?.pieces_per_box ?? "n/a"}`;
  }
  if (context.orderType === "micro_machine") {
    return `Micro Machines: ${context.microMachine?.quantity ?? "n/a"}`;
  }
  if (context.orderType === "mixed") {
    return `Sugar KG: ${context.sugarMix.total_kg}; Micro Machines: ${context.microMachine?.quantity ?? "n/a"}`;
  }
  return `Sugar KG (W/B/O/R/T): ${context.sugarMix.white_kg}/${context.sugarMix.blue_kg}/${context.sugarMix.orange_kg}/${context.sugarMix.red_kg}/${context.sugarMix.total_kg}`;
};

const buildWeComAlertLines = (context: OrderContext): string[] => [
  `Checkout Session ID: ${context.session.id}`,
  `Order Type: ${formatOrderType(context.orderType)}`,
  `Payment Status: ${context.session.payment_status || "unpaid"}`,
  `Amount Total: ${formatCurrency(context.session.amount_total, context.session.currency)}`,
  `Pricing Tier: ${formatPricingTier(context.pricingTier)}`,
  `Customer Email: ${context.customerEmail ?? "n/a"}`,
  `Customer Name: ${context.customerName ?? "n/a"}`,
  `Shipping Name: ${context.shippingName ?? "n/a"}`,
  `Admin Orders: ${adminOrdersUrl}`,
  buildWeComProductSummary(context),
];

const updateOrderNotificationState = async (
  orderId: string,
  patch: Record<string, unknown>
) => {
  if (!supabase) return;

  const { error } = await supabase.from("orders").update(patch).eq("id", orderId);
  if (error) {
    console.error("Failed to update order notification state", { orderId, error, patch });
  }
};

async function upsertOrder(session: Stripe.Checkout.Session): Promise<OrderContext | null> {
  if (!stripe || !supabase) return null;

  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  }) as Stripe.Checkout.Session & { line_items?: Stripe.ApiList<Stripe.LineItem> };

  const lineItems: StripeLineItemSummary[] = expanded.line_items?.data?.map((item: Stripe.LineItem) => ({
    description: item.description,
    quantity: item.quantity,
    amount_total: item.amount_total,
    currency: item.currency,
    price_id: typeof item.price === "object" && item.price ? item.price.id : null,
  })) ?? [];

  const sugarMix: SugarMixSummary = {
    white_kg: parseNumber(expanded.metadata?.sugar_white_kg),
    blue_kg: parseNumber(expanded.metadata?.sugar_blue_kg),
    orange_kg: parseNumber(expanded.metadata?.sugar_orange_kg),
    red_kg: parseNumber(expanded.metadata?.sugar_red_kg),
    total_kg: parseNumber(expanded.metadata?.sugar_total_kg),
  };

  const blankSticks: BlankSticksSummary = {
    box_count: parseNumber(expanded.metadata?.sticks_box_count),
    pieces_per_box: parseNumber(expanded.metadata?.sticks_pieces_per_box),
    stick_size: normalizeString(expanded.metadata?.stick_size),
    address_type: normalizeString(expanded.metadata?.sticks_address_type),
    shipping_rate_per_box_usd: parseNumber(expanded.metadata?.sticks_shipping_rate_per_box_usd),
    shipping_total_cents: parseNumber(expanded.metadata?.sticks_shipping_total_cents),
    free_shipping: String(expanded.metadata?.sticks_free_shipping ?? "false") === "true",
  };

  const microMachine: MicroMachineSummary = {
    quantity: parseNumber(expanded.metadata?.micro_machine_quantity),
  };

  if (sugarMix.total_kg > 0) {
    lineItems.push({
      description: "Sugar mix breakdown",
      quantity: sugarMix.total_kg,
      amount_total: null,
      currency: expanded.currency,
      price_id: null,
      metadata: sugarMix,
    });
  }

  if (blankSticks.box_count > 0 || blankSticks.pieces_per_box > 0) {
    lineItems.push({
      description: "Bloomjoy branded sticks order details",
      quantity: blankSticks.box_count || null,
      amount_total: null,
      currency: expanded.currency,
      price_id: null,
      metadata: blankSticks,
    });
  }

  if (microMachine.quantity > 0) {
    lineItems.push({
      description: "Micro Machine order details",
      quantity: microMachine.quantity,
      amount_total: null,
      currency: expanded.currency,
      price_id: null,
      metadata: microMachine,
    });
  }

  const orderType = coerceOrderType(
    expanded.metadata?.order_type,
    sugarMix,
    blankSticks,
    microMachine,
  );
  const pricingTier =
    expanded.metadata?.pricing_tier === "plus_member" || expanded.metadata?.pricing_tier === "standard"
      ? expanded.metadata.pricing_tier
      : null;
  const unitPriceCents =
    parseNumber(expanded.metadata?.unit_price_cents) || deriveUnitPriceCents(lineItems);
  const shippingTotalCents =
    typeof expanded.total_details?.amount_shipping === "number"
      ? expanded.total_details.amount_shipping
      : parseNumber(expanded.metadata?.shipping_total_cents) || blankSticks.shipping_total_cents;
  const paymentIntentId = expanded.payment_intent ? String(expanded.payment_intent) : null;
  const receiptContext = await resolveReceiptUrl(paymentIntentId);
  const customerDetails = expanded.customer_details;
  const shippingDetails = expanded.shipping_details;
  const billingAddress =
    toAddressSnapshot(customerDetails?.address) || receiptContext.billingAddress;
  const customerEmail =
    normalizeString(customerDetails?.email) ||
    normalizeString(expanded.customer_email) ||
    receiptContext.billingEmail;
  const customerName =
    normalizeString(customerDetails?.name) || receiptContext.billingName;
  const customerPhone =
    normalizeString(customerDetails?.phone) || receiptContext.billingPhone;
  const shippingName = normalizeString(shippingDetails?.name);
  const shippingPhone = normalizeString(shippingDetails?.phone);
  const shippingAddress = toAddressSnapshot(shippingDetails?.address);
  const metadataUserId = normalizeString(expanded.metadata?.user_id);
  const clientReferenceId = normalizeString(expanded.client_reference_id);

  let resolvedUserId = await resolveUserId(metadataUserId || clientReferenceId);
  if (!resolvedUserId) {
    resolvedUserId = await resolveUserIdByEmail(customerEmail);
  }

  const payload = {
    user_id: resolvedUserId,
    stripe_checkout_session_id: expanded.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_customer_id: expanded.customer ? String(expanded.customer) : null,
    order_type: orderType,
    status: expanded.payment_status || "unpaid",
    amount_total: expanded.amount_total,
    currency: expanded.currency,
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    billing_address: billingAddress,
    shipping_name: shippingName,
    shipping_phone: shippingPhone,
    shipping_address: shippingAddress,
    pricing_tier: pricingTier,
    unit_price_cents: unitPriceCents,
    shipping_total_cents: shippingTotalCents,
    receipt_url: receiptContext.receiptUrl,
    line_items: lineItems,
  };

  const { data, error } = await supabase
    .from("orders")
    .upsert(payload, { onConflict: "stripe_checkout_session_id" })
    .select(
      "id, internal_notification_sent_at, customer_confirmation_sent_at, wecom_alert_sent_at"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to upsert order.");
  }

  const persistedOrder = data as PersistedOrderRow;

  return {
    orderId: persistedOrder.id,
    session: expanded,
    orderType,
    pricingTier,
    unitPriceCents: unitPriceCents || null,
    shippingTotalCents,
    receiptUrl: receiptContext.receiptUrl,
    customerEmail,
    customerName,
    customerPhone,
    billingAddress,
    shippingName,
    shippingPhone,
    shippingAddress,
    lineItems,
    sugarMix,
    blankSticks:
      blankSticks.box_count > 0 || blankSticks.pieces_per_box > 0 ? blankSticks : null,
    microMachine: microMachine.quantity > 0 ? microMachine : null,
    existingInternalNotificationSentAt: persistedOrder.internal_notification_sent_at,
    existingCustomerConfirmationSentAt: persistedOrder.customer_confirmation_sent_at,
    existingWeComAlertSentAt: persistedOrder.wecom_alert_sent_at,
  };
}

const sendInternalOrderNotification = async (context: OrderContext) => {
  if (!supabase || context.existingInternalNotificationSentAt) {
    return;
  }

  const eventKey = `order_checkout:internal:${context.session.id}`;
  const dispatchClaimed = await claimDispatch(eventKey, context.orderId, {
    checkout_session_id: context.session.id,
    order_type: context.orderType,
    channel: "internal_email",
  });

  if (!dispatchClaimed) {
    return;
  }

  const email = buildInternalOrderEmail(context);

  try {
    await sendInternalEmail({
      ...email,
      idempotencyKey: buildOrderEmailIdempotencyKey("internal", context.session.id),
    });
    await updateOrderNotificationState(context.orderId, {
      internal_notification_sent_at: new Date().toISOString(),
      internal_notification_error: null,
    });
    await markDispatchSent(eventKey, {
      checkout_session_id: context.session.id,
      order_type: context.orderType,
      channel: "internal_email",
      customer_email: context.customerEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown internal email failure.";
    await updateOrderNotificationState(context.orderId, {
      internal_notification_error: message,
    });
    await releaseDispatch(eventKey);
    throw new Error(`Internal order notification failed: ${message}`);
  }
};

const sendCustomerConfirmation = async (context: OrderContext) => {
  if (!supabase || context.existingCustomerConfirmationSentAt) {
    return;
  }

  const eventKey = `order_checkout:customer:${context.session.id}`;
  const dispatchClaimed = await claimDispatch(eventKey, context.orderId, {
    checkout_session_id: context.session.id,
    order_type: context.orderType,
    channel: "customer_confirmation",
  });

  if (!dispatchClaimed) {
    return;
  }

  if (!context.customerEmail) {
    await updateOrderNotificationState(context.orderId, {
      customer_confirmation_error: "Customer email missing.",
    });
    await releaseDispatch(eventKey);
    return;
  }

  const email = buildCustomerOrderEmail({
    orderReference: context.session.id,
    orderPlacedAt: context.session.created
      ? new Date(context.session.created * 1000).toISOString()
      : new Date().toISOString(),
    orderType: context.orderType,
    paymentStatus: context.session.payment_status || "unpaid",
    amountTotal: context.session.amount_total,
    currency: context.session.currency,
    pricingTier: context.pricingTier,
    unitPriceCents: context.unitPriceCents,
    shippingTotalCents: context.shippingTotalCents,
    customerName: context.customerName,
    shippingName: context.shippingName,
    shippingAddress: context.shippingAddress,
    receiptUrl: context.receiptUrl,
    sugarMix: context.sugarMix,
    blankSticks: context.blankSticks,
    microMachine: context.microMachine,
  });

  try {
    await sendTransactionalEmail({
      to: [context.customerEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: buildOrderEmailIdempotencyKey("customer", context.session.id),
    });
    await updateOrderNotificationState(context.orderId, {
      customer_confirmation_sent_at: new Date().toISOString(),
      customer_confirmation_error: null,
    });
    await markDispatchSent(eventKey, {
      checkout_session_id: context.session.id,
      order_type: context.orderType,
      channel: "customer_confirmation",
      customer_email: context.customerEmail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown customer confirmation failure.";
    await updateOrderNotificationState(context.orderId, {
      customer_confirmation_error: message,
    });
    await releaseDispatch(eventKey);
    throw new Error(`Customer order confirmation failed: ${message}`);
  }
};

const sendWeComOrderAlert = async (context: OrderContext) => {
  if (!supabase || context.existingWeComAlertSentAt) {
    return;
  }

  const eventKey = `order_checkout:wecom:${context.session.id}`;
  const dispatchClaimed = await claimDispatch(eventKey, context.orderId, {
    checkout_session_id: context.session.id,
    order_type: context.orderType,
    channel: "wecom_alert",
  });

  if (!dispatchClaimed) {
    return;
  }

  const result = await sendWeComAlertResult({
    tag: "Bloomjoy Order",
    title: `New ${formatOrderType(context.orderType).toLowerCase()} order: ${context.session.id}`,
    lines: buildWeComAlertLines(context),
  });

  if (result.ok) {
    await updateOrderNotificationState(context.orderId, {
      wecom_alert_sent_at: new Date().toISOString(),
      wecom_alert_error: null,
    });
    await markDispatchSent(eventKey, {
      checkout_session_id: context.session.id,
      order_type: context.orderType,
      channel: "wecom_alert",
      customer_email: context.customerEmail,
    });
    return;
  }

  await updateOrderNotificationState(context.orderId, {
    wecom_alert_error: result.message,
  });
  await releaseDispatch(eventKey);
};

const sendOrderNotifications = async (context: OrderContext | null) => {
  if (!context) return;

  const [internalResult, customerResult] = await Promise.allSettled([
    sendInternalOrderNotification(context),
    sendCustomerConfirmation(context),
    sendWeComOrderAlert(context),
  ]);

  const retryableFailures = [internalResult, customerResult]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

  if (retryableFailures.length) {
    throw new Error(retryableFailures.join("; "));
  }
};

const sendPlusActivationNotifications = async (session: Stripe.Checkout.Session) => {
  if (!supabase) return;

  const customerEmail = normalizeString(session.customer_details?.email) ||
    normalizeString(session.customer_email);
  const customerName = normalizeString(session.customer_details?.name);
  const amount = formatCurrency(session.amount_total, session.currency);
  const internalEventKey = `plus_subscription:internal:${session.id}`;
  const weComEventKey = `plus_subscription:wecom:${session.id}`;
  const claimMeta = {
    checkout_session_id: session.id,
    channel: "internal_email",
  };

  const sendInternal = async () => {
    const claimed = await claimDispatch(
      internalEventKey,
      session.id,
      claimMeta,
      "plus_subscription_activated",
      "stripe_checkout_sessions",
    );
    if (!claimed) return;

    try {
      await sendInternalEmail({
        subject: `New Bloomjoy Plus subscription: ${session.id}`,
        text: [
          "A paid Bloomjoy Plus subscription checkout completed.",
          "",
          `Checkout Session ID: ${session.id}`,
          `Payment Status: ${session.payment_status || "unpaid"}`,
          `Amount: ${amount}`,
          `Customer Email: ${customerEmail ?? "n/a"}`,
          `Customer Name: ${customerName ?? "n/a"}`,
          `User ID: ${normalizeString(session.metadata?.user_id) ?? "n/a"}`,
          "",
          "Next step: confirm Plus access is active in the Bloomjoy admin account console.",
        ].join("\n"),
        idempotencyKey: buildOrderEmailIdempotencyKey("plus-internal", session.id),
      });
      await markDispatchSent(internalEventKey, {
        ...claimMeta,
        customer_email: customerEmail,
      });
    } catch (error) {
      await releaseDispatch(internalEventKey);
      throw error;
    }
  };

  const sendWeCom = async () => {
    const claimed = await claimDispatch(
      weComEventKey,
      session.id,
      { ...claimMeta, channel: "wecom_alert" },
      "plus_subscription_activated",
      "stripe_checkout_sessions",
    );
    if (!claimed) return;

    const result = await sendWeComAlertResult({
      tag: "Bloomjoy Plus",
      title: `New paid Plus subscription: ${session.id}`,
      lines: [
        `Payment Status: ${session.payment_status || "unpaid"}`,
        `Amount: ${amount}`,
        `Customer Email: ${customerEmail ?? "n/a"}`,
        `Customer Name: ${customerName ?? "n/a"}`,
      ],
    });

    if (result.ok) {
      await markDispatchSent(weComEventKey, {
        ...claimMeta,
        channel: "wecom_alert",
        customer_email: customerEmail,
      });
      return;
    }

    await releaseDispatch(weComEventKey);
  };

  const [internalResult] = await Promise.allSettled([sendInternal(), sendWeCom()]);
  if (internalResult.status === "rejected") {
    throw internalResult.reason;
  }
};

const processPaidCheckoutSession = async (
  eventType: string,
  session: Stripe.Checkout.Session,
) => {
  if (shouldFulfillCheckoutSession(eventType, session, "subscription")) {
    await sendPlusActivationNotifications(session);
    return;
  }

  if (!shouldFulfillCheckoutSession(eventType, session)) {
    console.info("Skipping unpaid checkout fulfillment", {
      event_type: eventType,
      checkout_session_id: session.id,
      payment_status: session.payment_status,
    });
    return;
  }

  const orderContext = await upsertOrder(session);
  await sendOrderNotifications(orderContext);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!stripe || !webhookSecret || !supabase) {
    return new Response(
      JSON.stringify({ error: "Webhook is not configured." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (error) {
    console.error("Invalid webhook signature", error);
    return new Response(JSON.stringify({ error: "Invalid signature." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await processPaidCheckoutSession(event.type, session);
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await processPaidCheckoutSession(event.type, session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertSubscription(subscription);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("Webhook handler error", error);
    return new Response(JSON.stringify({ error: "Webhook handler error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

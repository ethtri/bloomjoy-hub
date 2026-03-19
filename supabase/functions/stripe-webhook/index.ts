import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendInternalEmail } from "../_shared/internal-email.ts";
import { sendWeComAlertSafe } from "../_shared/wecom-alert.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

type OrderType = "sugar" | "blank_sticks" | "unknown";

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

type OrderNotificationContext = {
  orderType: OrderType;
  lineItems: StripeLineItemSummary[];
  sugarMix: SugarMixSummary;
  blankSticks: BlankSticksSummary | null;
};

const claimDispatch = async (
  eventKey: string,
  sourceId: string,
  meta: Record<string, unknown>
): Promise<boolean> => {
  if (!supabase) return false;

  const { error } = await supabase.from("internal_notification_dispatches").insert({
    event_key: eventKey,
    dispatch_type: "order_checkout",
    source_table: "orders",
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

const formatCurrency = (amount: number | null | undefined, currency: string | null | undefined) => {
  if (typeof amount !== "number") return "n/a";
  const normalizedCurrency = (currency || "usd").toUpperCase();
  return `${normalizedCurrency} ${(amount / 100).toFixed(2)}`;
};

const formatAddress = (address: Stripe.Address | null | undefined) => {
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

async function resolveUserId(userId: string | undefined) {
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

async function upsertOrder(
  session: Stripe.Checkout.Session
): Promise<OrderNotificationContext | null> {
  if (!stripe || !supabase) return null;

  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  });

  const lineItems: StripeLineItemSummary[] = expanded.line_items?.data?.map((item: Stripe.LineItem) => ({
    description: item.description,
    quantity: item.quantity,
    amount_total: item.amount_total,
    currency: item.currency,
    price_id: typeof item.price === "object" && item.price ? item.price.id : null,
  })) ?? [];

  const sugarMixFromMetadata: SugarMixSummary = {
    white_kg: Number(session.metadata?.sugar_white_kg ?? 0),
    blue_kg: Number(session.metadata?.sugar_blue_kg ?? 0),
    orange_kg: Number(session.metadata?.sugar_orange_kg ?? 0),
    red_kg: Number(session.metadata?.sugar_red_kg ?? 0),
    total_kg: Number(session.metadata?.sugar_total_kg ?? 0),
  };
  const blankSticksFromMetadata: BlankSticksSummary = {
    box_count: Number(session.metadata?.sticks_box_count ?? 0),
    pieces_per_box: Number(session.metadata?.sticks_pieces_per_box ?? 0),
    stick_size: session.metadata?.stick_size ?? null,
    address_type: session.metadata?.sticks_address_type ?? null,
    shipping_rate_per_box_usd: Number(
      session.metadata?.sticks_shipping_rate_per_box_usd ?? 0
    ),
    shipping_total_cents: Number(session.metadata?.sticks_shipping_total_cents ?? 0),
    free_shipping: String(session.metadata?.sticks_free_shipping ?? "false") === "true",
  };
  const metadataOrderType = session.metadata?.order_type;
  let orderType: OrderType =
    metadataOrderType === "sugar" || metadataOrderType === "blank_sticks"
      ? metadataOrderType
      : "unknown";

  if (
    sugarMixFromMetadata.total_kg > 0 ||
    sugarMixFromMetadata.white_kg > 0 ||
    sugarMixFromMetadata.blue_kg > 0 ||
    sugarMixFromMetadata.orange_kg > 0 ||
    sugarMixFromMetadata.red_kg > 0
  ) {
    lineItems.push({
      description: "Sugar mix breakdown",
      quantity: sugarMixFromMetadata.total_kg || null,
      amount_total: null,
      currency: session.currency,
      price_id: null,
      metadata: sugarMixFromMetadata,
    });
  }

  if (blankSticksFromMetadata.box_count > 0 || blankSticksFromMetadata.pieces_per_box > 0) {
    lineItems.push({
      description: "Blank sticks order details",
      quantity: blankSticksFromMetadata.box_count || null,
      amount_total: null,
      currency: session.currency,
      price_id: null,
      metadata: blankSticksFromMetadata,
    });
  }

  if (orderType === "unknown" && sugarMixFromMetadata.total_kg > 0) {
    orderType = "sugar";
  }

  if (orderType === "unknown" && blankSticksFromMetadata.box_count > 0) {
    orderType = "blank_sticks";
  }

  const resolvedUserId = await resolveUserIdByEmail(
    session.customer_details?.email ?? session.customer_email ?? null
  );

  const payload = {
    user_id: resolvedUserId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent
      ? String(session.payment_intent)
      : null,
    stripe_customer_id: session.customer ? String(session.customer) : null,
    status: session.payment_status || "unpaid",
    amount_total: session.amount_total,
    currency: session.currency,
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    receipt_url: null,
    line_items: lineItems,
  };

  const { error } = await supabase
    .from("orders")
    .upsert(payload, { onConflict: "stripe_checkout_session_id" });

  if (error) {
    throw new Error(error.message || "Failed to upsert order.");
  }

  return {
    orderType,
    lineItems,
    sugarMix: sugarMixFromMetadata,
    blankSticks:
      blankSticksFromMetadata.box_count > 0 || blankSticksFromMetadata.pieces_per_box > 0
        ? blankSticksFromMetadata
        : null,
  };
}

async function sendOrderNotification(
  session: Stripe.Checkout.Session,
  context: OrderNotificationContext | null
) {
  if (!supabase || !context) return;

  const eventKey = `order_checkout:${session.id}`;
  const dispatchClaimed = await claimDispatch(eventKey, session.id, {
    checkout_session_id: session.id,
    payment_status: session.payment_status || "unpaid",
    order_type: context.orderType,
  });

  if (!dispatchClaimed) {
    return;
  }

  const lineItemSummary = context.lineItems.length
    ? context.lineItems.map((item, index) => {
      const lineTotal = formatCurrency(item.amount_total, item.currency);
      return [
        `${index + 1}. ${item.description || "Line item"}`,
        `   Quantity: ${item.quantity ?? "n/a"}`,
        `   Line total: ${lineTotal}`,
        `   Price ID: ${item.price_id ?? "n/a"}`,
      ].join("\n");
    }).join("\n")
    : "No line items available.";

  const customerDetails = session.customer_details;
  const shippingDetails = session.shipping_details;
  const shippingAmount =
    session.total_details?.amount_shipping ??
    (context.orderType === "blank_sticks"
      ? context.blankSticks?.shipping_total_cents ?? null
      : null);
  const orderSubject =
    context.orderType === "blank_sticks"
      ? `New blank sticks order: ${session.id}`
      : `New sugar order: ${session.id}`;
  const detailSection =
    context.orderType === "blank_sticks"
      ? [
        "",
        "Blank Sticks Details:",
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
      ]
      : [
        "",
        "Sugar Breakdown (KG):",
        `- White: ${context.sugarMix.white_kg}`,
        `- Blue: ${context.sugarMix.blue_kg}`,
        `- Orange: ${context.sugarMix.orange_kg}`,
        `- Red: ${context.sugarMix.red_kg}`,
        `- Total: ${context.sugarMix.total_kg}`,
      ];
  const orderText = [
    context.orderType === "blank_sticks"
      ? "A Stripe blank sticks checkout completed."
      : "A Stripe sugar checkout completed.",
    "",
    `Checkout Session ID: ${session.id}`,
    `Completed At (UTC): ${new Date().toISOString()}`,
    `Order Type: ${context.orderType}`,
    `Payment Status: ${session.payment_status || "unpaid"}`,
    `Amount Total: ${formatCurrency(session.amount_total, session.currency)}`,
    `Shipping Total: ${formatCurrency(shippingAmount, session.currency)}`,
    `Customer Email: ${session.customer_details?.email ?? session.customer_email ?? "n/a"}`,
    `Customer Name: ${customerDetails?.name ?? "n/a"}`,
    `Customer Phone: ${customerDetails?.phone ?? "n/a"}`,
    `Billing Address: ${formatAddress(customerDetails?.address)}`,
    `Shipping Name: ${shippingDetails?.name ?? "n/a"}`,
    `Shipping Phone: ${shippingDetails?.phone ?? "n/a"}`,
    `Shipping Address: ${formatAddress(shippingDetails?.address)}`,
    ...detailSection,
    "",
    "Line Items:",
    lineItemSummary,
  ].join("\n");

  try {
    await sendInternalEmail({
      subject: orderSubject,
      text: orderText,
    });
  } catch (error) {
    await releaseDispatch(eventKey);
    throw error;
  }

  await sendWeComAlertSafe({
    tag: "Bloomjoy Order",
    title:
      context.orderType === "blank_sticks"
        ? `New blank sticks order: ${session.id}`
        : `New sugar order: ${session.id}`,
    lines: [
      `Checkout Session ID: ${session.id}`,
      `Order Type: ${context.orderType}`,
      `Payment Status: ${session.payment_status || "unpaid"}`,
      `Amount Total: ${formatCurrency(session.amount_total, session.currency)}`,
      `Shipping Total: ${formatCurrency(shippingAmount, session.currency)}`,
      `Customer Email: ${session.customer_details?.email ?? session.customer_email ?? "n/a"}`,
      `Customer Name: ${customerDetails?.name ?? "n/a"}`,
      `Shipping Name: ${shippingDetails?.name ?? "n/a"}`,
      context.orderType === "blank_sticks"
        ? `Boxes / Pieces per box: ${context.blankSticks?.box_count ?? "n/a"} / ${context.blankSticks?.pieces_per_box ?? "n/a"}`
        : `Sugar Total KG: ${context.sugarMix.total_kg}`,
      context.orderType === "blank_sticks"
        ? `Stick size / Address type: ${formatStickSize(context.blankSticks?.stick_size)} / ${formatAddressType(context.blankSticks?.address_type)}`
        : `White/Blue/Orange/Red KG: ${context.sugarMix.white_kg}/${context.sugarMix.blue_kg}/${context.sugarMix.orange_kg}/${context.sugarMix.red_kg}`,
      `Line Items: ${context.lineItems.length}`,
    ],
  });

  await Promise.all([
    supabase
      .from("orders")
      .update({ internal_notification_sent_at: new Date().toISOString() })
      .eq("stripe_checkout_session_id", session.id),
    markDispatchSent(eventKey, {
      checkout_session_id: session.id,
      order_type: context.orderType,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    }),
  ]);
}

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
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
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
        if (session.mode === "payment") {
          const orderContext = await upsertOrder(session);
          await sendOrderNotification(session, orderContext);
        }
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

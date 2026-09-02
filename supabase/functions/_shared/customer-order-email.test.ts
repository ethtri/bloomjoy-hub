import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCustomerOrderEmail } from "./customer-order-email.ts";

const baseContext = {
  orderReference: "cs_paid_fixture",
  orderPlacedAt: "2026-08-06T12:00:00.000Z",
  paymentStatus: "paid",
  amountTotal: 220000,
  currency: "usd",
  pricingTier: "standard" as const,
  unitPriceCents: 220000,
  shippingTotalCents: 0,
  customerName: "Test Buyer",
  shippingName: "Test Buyer",
  shippingAddress: {
    line1: "100 Test Street",
    line2: null,
    city: "Los Angeles",
    state: "CA",
    postal_code: "90001",
    country: "US",
  },
  receiptUrl: "https://pay.stripe.com/receipts/test",
  sugarMix: { white_kg: 0, blue_kg: 0, orange_kg: 0, red_kg: 0, total_kg: 0 },
  blankSticks: null,
};

Deno.test("Micro Machine confirmation identifies the paid product and quantity", () => {
  const email = buildCustomerOrderEmail({
    ...baseContext,
    orderType: "micro_machine",
    microMachine: { quantity: 1 },
  });

  assertEquals(email.subject, "Your Bloomjoy Micro Machine order is confirmed");
  assertStringIncludes(email.text, "Product: Bloomjoy Sweets Micro Machine");
  assertStringIncludes(email.text, "Quantity: 1");
});

Deno.test("Mini confirmation identifies the product, quantity, shipping and full total", () => {
  const email = buildCustomerOrderEmail({
    ...baseContext, orderType: "mini_machine", microMachine: null,
    miniMachine: { quantity: 1 }, unitPriceCents: 400000,
    amountTotal: 465000, shippingTotalCents: 25000,
  });
  assertEquals(email.subject, "Your Bloomjoy Mini Machine order is confirmed");
  assertStringIncludes(email.text, "Product: Bloomjoy Sweets Mini Machine");
  assertStringIncludes(email.text, "Quantity: 1");
  assertStringIncludes(email.text, "$250.00");
  assertStringIncludes(email.text, "$4,650.00");
  assertEquals(email.text.includes("Sugar total"), false);
});

Deno.test("mixed confirmation includes both sugar and Micro Machine", () => {
  const email = buildCustomerOrderEmail({
    ...baseContext,
    orderType: "mixed",
    amountTotal: 224000,
    sugarMix: { white_kg: 2, blue_kg: 2, orange_kg: 0, red_kg: 0, total_kg: 4 },
    microMachine: { quantity: 1 },
  });

  assertStringIncludes(email.text, "Sugar total: 4 KG");
  assertStringIncludes(email.text, "Micro Machine quantity: 1");
});

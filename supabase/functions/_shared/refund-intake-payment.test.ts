import { assertEquals } from "jsr:@std/assert@1";
import { validateRefundIntakePayment } from "./refund-intake-payment.ts";

const cardInput = {
  paymentMethod: "card",
  amountCents: 700,
  cardLast4: "4242",
  cardNetwork: "visa",
  cardNetworkProvided: true,
  paymentInteraction: "tap_card" as const,
  submittedPaymentInteraction: "tap_card",
  paymentInteractionProvided: true,
  cardWalletUsed: false,
  walletProvider: null,
  walletProviderProvided: false,
};

Deno.test("valid card intake preserves the Nayax evidence path", () => {
  assertEquals(validateRefundIntakePayment(cardInput), {
    ok: true,
    paymentMethod: "card",
    amountCents: 700,
    cardLast4: "4242",
    cardNetwork: "visa",
    cardWalletUsed: false,
    paymentInteraction: "tap_card",
    walletProvider: null,
    shouldRunNayaxLookup: true,
  });
});

Deno.test("physical insert and swipe stay distinct", () => {
  for (const interaction of ["insert_card", "swipe_card"] as const) {
    const result = validateRefundIntakePayment({
      ...cardInput, paymentInteraction: interaction, submittedPaymentInteraction: interaction,
    });
    assertEquals(result.ok && result.paymentInteraction, interaction);
  }
});

Deno.test("cash intake needs no payout contact and strips stale card data", () => {
  assertEquals(validateRefundIntakePayment({
    ...cardInput,
    paymentMethod: "cash",
    paymentInteraction: "cash",
    submittedPaymentInteraction: "cash",
    cardWalletUsed: true,
    walletProvider: "apple_pay",
    walletProviderProvided: true,
  }), {
    ok: true,
    paymentMethod: "cash",
    amountCents: 700,
    cardLast4: null,
    cardNetwork: null,
    cardWalletUsed: false,
    paymentInteraction: "cash",
    walletProvider: null,
    shouldRunNayaxLookup: false,
  });
});

Deno.test("unsupported payment methods fail closed", () => {
  assertEquals(validateRefundIntakePayment({
    ...cardInput,
    paymentMethod: "check",
  }), {
    ok: false,
    error: "Please choose a payment method.",
  });
});

Deno.test("cash cannot be submitted with a card interaction", () => {
  assertEquals(validateRefundIntakePayment({
    ...cardInput,
    paymentMethod: "cash",
  }), {
    ok: false,
    error: "The payment method and the way you paid do not agree.",
  });
});

Deno.test("card intake still requires the last four digits", () => {
  assertEquals(validateRefundIntakePayment({
    ...cardInput,
    cardLast4: "",
  }), {
    ok: false,
    error: "Please enter the last 4 digits shown for the card payment.",
  });
});

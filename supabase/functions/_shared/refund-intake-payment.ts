export type RefundIntakePaymentMethod = "card" | "cash";

export type RefundIntakePaymentInteraction =
  | "phone_watch_wallet"
  | "tap_card"
  | "insert_or_swipe"
  | "cash"
  | "unsure";

export type RefundIntakePaymentInput = {
  paymentMethod: string;
  amountCents: number | null;
  cardLast4: string;
  cardNetwork: string | null;
  cardNetworkProvided: boolean;
  paymentInteraction: string;
  submittedPaymentInteraction: string;
  paymentInteractionProvided: boolean;
  cardWalletUsed: boolean;
  walletProvider: string | null;
  walletProviderProvided: boolean;
};

export type RefundIntakePaymentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      paymentMethod: RefundIntakePaymentMethod;
      amountCents: number;
      cardLast4: string | null;
      cardNetwork: string | null;
      cardWalletUsed: boolean;
      paymentInteraction: RefundIntakePaymentInteraction;
      walletProvider: string | null;
      shouldRunNayaxLookup: boolean;
    };

const PAYMENT_INTERACTIONS = new Set<RefundIntakePaymentInteraction>([
  "phone_watch_wallet",
  "tap_card",
  "insert_or_swipe",
  "cash",
  "unsure",
]);

export const validateRefundIntakePayment = (
  input: RefundIntakePaymentInput,
): RefundIntakePaymentResult => {
  if (input.paymentMethod !== "card" && input.paymentMethod !== "cash") {
    return { ok: false, error: "Please choose a payment method." };
  }

  if (input.amountCents === null || input.amountCents <= 0) {
    return { ok: false, error: "Please enter the amount you paid." };
  }

  if (
    input.paymentInteractionProvided &&
    !PAYMENT_INTERACTIONS.has(
      input.submittedPaymentInteraction as RefundIntakePaymentInteraction,
    )
  ) {
    return { ok: false, error: "Please choose how you paid at the machine." };
  }

  if (!PAYMENT_INTERACTIONS.has(input.paymentInteraction as RefundIntakePaymentInteraction)) {
    return { ok: false, error: "Please choose how you paid at the machine." };
  }
  const paymentInteraction = input.paymentInteraction as RefundIntakePaymentInteraction;

  if (input.paymentMethod === "cash") {
    if (paymentInteraction !== "cash") {
      return {
        ok: false,
        error: "The payment method and the way you paid do not agree.",
      };
    }

    return {
      ok: true,
      paymentMethod: "cash",
      amountCents: input.amountCents,
      cardLast4: null,
      cardNetwork: null,
      cardWalletUsed: false,
      paymentInteraction: "cash",
      walletProvider: null,
      shouldRunNayaxLookup: false,
    };
  }

  if (paymentInteraction === "cash") {
    return {
      ok: false,
      error: "The payment method and the way you paid do not agree.",
    };
  }

  if (!/^[0-9]{4}$/.test(input.cardLast4)) {
    return {
      ok: false,
      error: "Please enter the last 4 digits shown for the card payment.",
    };
  }

  if (input.cardNetworkProvided && !input.cardNetwork) {
    return {
      ok: false,
      error: "Please choose the card type shown on your card or in your wallet.",
    };
  }

  if (
    paymentInteraction === "phone_watch_wallet" &&
    input.walletProviderProvided &&
    !input.walletProvider
  ) {
    return {
      ok: false,
      error: "Please choose the phone or watch wallet you used.",
    };
  }

  return {
    ok: true,
    paymentMethod: "card",
    amountCents: input.amountCents,
    cardLast4: input.cardLast4,
    cardNetwork: input.cardNetwork,
    cardWalletUsed: input.cardWalletUsed,
    paymentInteraction,
    walletProvider: input.walletProvider,
    shouldRunNayaxLookup: true,
  };
};

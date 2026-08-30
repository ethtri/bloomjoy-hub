import {
  inferRefundCustomerLocale,
  refundCustomerLocaleFromIntakeMeta,
  sanitizeRefundCustomerLocale,
} from "./refund-language.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

Deno.test("explicit or primary browser Spanish locale is preserved", () => {
  assertEquals(
    inferRefundCustomerLocale({ explicitLocale: "es-MX" }),
    "es",
    "explicit Spanish",
  );
  assertEquals(
    inferRefundCustomerLocale({ acceptLanguage: "es-US,es;q=0.9,en;q=0.8" }),
    "es",
    "primary browser Spanish",
  );
});

Deno.test("obvious Spanish complaint is detected conservatively", () => {
  assertEquals(
    inferRefundCustomerLocale({
      customerText: "Pagué en efectivo pero la máquina no funcionó y no recibí producto.",
    }),
    "es",
    "Spanish complaint",
  );
  assertEquals(
    inferRefundCustomerLocale({ customerText: "Card charged but no product." }),
    "en",
    "English complaint",
  );
  assertEquals(
    inferRefundCustomerLocale({ customerText: "Pago" }),
    "en",
    "single ambiguous word remains English",
  );
});

Deno.test("stored locale sanitizer fails closed to English", () => {
  assertEquals(sanitizeRefundCustomerLocale("es"), "es", "Spanish stored locale");
  assertEquals(sanitizeRefundCustomerLocale("unknown"), "en", "unknown locale");
  assertEquals(
    refundCustomerLocaleFromIntakeMeta({ customer_locale: "es-MX" }),
    "es",
    "Spanish intake metadata",
  );
  assertEquals(
    refundCustomerLocaleFromIntakeMeta(null),
    "en",
    "missing intake metadata",
  );
});

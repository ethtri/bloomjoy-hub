import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveLocalNotificationSinkBaseUrl } from "./local-notification-sink.ts";

const readEnvironment =
  (values: Record<string, string>) => (key: string): string | undefined =>
    values[key];

Deno.test("local notification sink stays disabled by default", () => {
  assertEquals(resolveLocalNotificationSinkBaseUrl(readEnvironment({})), null);
});

Deno.test("local notification sink accepts an explicit test-only local configuration", () => {
  const result = resolveLocalNotificationSinkBaseUrl(readEnvironment({
    BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK: "true",
    BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL:
      "http://host.docker.internal:54329/uat-token/",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    SUPABASE_URL: "http://kong:8000",
  }));

  assertEquals(result, "http://host.docker.internal:54329/uat-token");
});

Deno.test("local notification sink rejects a live Stripe key", () => {
  assertThrows(
    () =>
      resolveLocalNotificationSinkBaseUrl(readEnvironment({
        BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK: "true",
        BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL: "http://127.0.0.1:54329",
        STRIPE_SECRET_KEY: "sk_live_fixture",
        SUPABASE_URL: "http://127.0.0.1:54321",
      })),
    Error,
    "Stripe test secret key",
  );
});

Deno.test("local notification sink rejects a remote Supabase project", () => {
  assertThrows(
    () =>
      resolveLocalNotificationSinkBaseUrl(readEnvironment({
        BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK: "true",
        BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL: "http://127.0.0.1:54329",
        STRIPE_SECRET_KEY: "sk_test_fixture",
        SUPABASE_URL: "https://example.supabase.co",
      })),
    Error,
    "local Supabase runtime",
  );
});

Deno.test("local notification sink rejects nonlocal or HTTPS targets", () => {
  for (
    const sinkUrl of [
      "https://127.0.0.1:54329",
      "http://example.com:54329",
    ]
  ) {
    assertThrows(
      () =>
        resolveLocalNotificationSinkBaseUrl(readEnvironment({
          BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK: "true",
          BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL: sinkUrl,
          STRIPE_SECRET_KEY: "sk_test_fixture",
          SUPABASE_URL: "http://localhost:54321",
        })),
      Error,
      "plain HTTP",
    );
  }
});

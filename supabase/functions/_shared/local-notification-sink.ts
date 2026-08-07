const ENABLED_VALUE = "true";
const LOCAL_SUPABASE_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "kong",
]);
const LOCAL_SINK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "host.docker.internal",
]);

export type EnvironmentReader = (key: string) => string | undefined;

const readDenoEnvironment: EnvironmentReader = (key) => Deno.env.get(key);

const parseUrl = (value: string | undefined, label: string): URL => {
  if (!value) {
    throw new Error(
      `${label} is required when the local notification sink is enabled.`,
    );
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
};

/**
 * Returns a local-only notification sink URL for payment UAT.
 *
 * The override deliberately fails closed unless all of these conditions hold:
 * - the explicit local-sink switch is exactly `true`;
 * - Stripe is using a test secret key;
 * - Supabase is the local CLI runtime; and
 * - the sink is plain HTTP on a loopback/Docker-host address.
 */
export const resolveLocalNotificationSinkBaseUrl = (
  readEnvironment: EnvironmentReader = readDenoEnvironment,
): string | null => {
  if (
    readEnvironment("BLOOMJOY_ENABLE_LOCAL_NOTIFICATION_SINK") !== ENABLED_VALUE
  ) {
    return null;
  }

  const stripeSecretKey = readEnvironment("STRIPE_SECRET_KEY") ?? "";
  if (!stripeSecretKey.startsWith("sk_test_")) {
    throw new Error(
      "The local notification sink requires a Stripe test secret key.",
    );
  }

  const supabaseUrl = parseUrl(
    readEnvironment("SUPABASE_URL"),
    "SUPABASE_URL",
  );
  if (!LOCAL_SUPABASE_HOSTS.has(supabaseUrl.hostname)) {
    throw new Error(
      "The local notification sink requires the local Supabase runtime.",
    );
  }

  const sinkUrl = parseUrl(
    readEnvironment("BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL"),
    "BLOOMJOY_LOCAL_NOTIFICATION_SINK_URL",
  );
  if (
    sinkUrl.protocol !== "http:" ||
    sinkUrl.username ||
    sinkUrl.password ||
    !LOCAL_SINK_HOSTS.has(sinkUrl.hostname)
  ) {
    throw new Error(
      "The local notification sink must use plain HTTP on localhost, 127.0.0.1, or host.docker.internal.",
    );
  }

  return sinkUrl.toString().replace(/\/$/, "");
};

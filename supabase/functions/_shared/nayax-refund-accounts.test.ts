import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  configuredNayaxRefundQueueAccounts,
  resolveNayaxRefundAttemptQueueReadiness,
  resolveNayaxRefundWriteCredentials,
  runConfiguredNayaxRefundAccounts,
} from "./nayax-refund-gates.ts";

const primary = "PRIMARY_TEST";
const secondary = "SECONDARY_TEST";
const env = {
  REFUND_AUTOMATION_ENABLED: "true",
  NAYAX_REFUND_ATTEMPT_QUEUE_ENABLED: "true",
  NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY: primary,
  NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEYS: ` secondary test,${primary},${secondary}, `,
};
const readEnv = (name: string) => (env as Record<string, string>)[name];

Deno.test("additional queue accounts preserve and deduplicate the existing account", () => {
  assertEquals(configuredNayaxRefundQueueAccounts(readEnv), [primary, secondary]);
  assertEquals(configuredNayaxRefundQueueAccounts((name) =>
    name === "NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY" ? primary : undefined), [primary]);
  assertEquals(configuredNayaxRefundQueueAccounts(() => undefined), []);
});

Deno.test("queue readiness recognizes each configured account without accepting an unrelated account", () => {
  for (const accountKey of [primary, secondary]) {
    assertEquals(resolveNayaxRefundAttemptQueueReadiness({ readEnv, requiredAccountKey: accountKey }).ready, true);
  }
  assertEquals(resolveNayaxRefundAttemptQueueReadiness({ readEnv, requiredAccountKey: "UNCONFIGURED" }).accountMatches, false);
  assertEquals(resolveNayaxRefundAttemptQueueReadiness({
    readEnv: (name) => name === "REFUND_AUTOMATION_ENABLED" ? "false" : readEnv(name),
    requiredAccountKey: secondary,
  }).ready, false);
});

Deno.test("a failed account does not block its sibling and does not echo private exceptions", async () => {
  const visited: string[] = [];
  let failures = 0;
  await runConfiguredNayaxRefundAccounts({
    readEnv,
    runAccount: (accountKey) => {
      visited.push(accountKey);
      if (accountKey === primary) throw new Error("private provider exception");
      return Promise.resolve();
    },
    onFailure: () => { failures++; },
  });
  assertEquals(visited, [primary, secondary]);
  assertEquals(failures, 1);
});

Deno.test("missing secondary credentials never cause borrowing or suppress the primary account", async () => {
  const tokens: Record<string, string> = {
    [`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${primary}`]: "primary-request",
    [`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${primary}`]: "primary-approve",
  };
  const processed: string[] = [];
  const unconfigured: string[] = [];
  await runConfiguredNayaxRefundAccounts({
    readEnv,
    runAccount: (accountKey) => {
      const credentials = resolveNayaxRefundWriteCredentials(accountKey, (key) => tokens[key]);
      if (!credentials.requestToken || !credentials.approveToken) unconfigured.push(accountKey);
      else processed.push(accountKey);
      return Promise.resolve();
    },
    onFailure: () => { throw new Error("unexpected failure"); },
  });
  assertEquals(processed, [primary]);
  assertEquals(unconfigured, [secondary]);
});

Deno.test("both accounts resolve their own request and approval credentials without reporting fallbacks", () => {
  const tokens: Record<string, string> = {
    [`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${primary}`]: "primary-request",
    [`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${primary}`]: "primary-approval",
    [`NAYAX_REFUND_REQUEST_WRITE_TOKEN_${secondary}`]: "secondary-request",
    [`NAYAX_REFUND_APPROVE_WRITE_TOKEN_${secondary}`]: "secondary-approval",
    NAYAX_LYNX_API_TOKEN: "reporting-only",
  };
  const read = (key: string) => tokens[key];
  assertEquals(resolveNayaxRefundWriteCredentials(primary, read), {
    requestToken: "primary-request", approveToken: "primary-approval",
  });
  assertEquals(resolveNayaxRefundWriteCredentials(secondary, read), {
    requestToken: "secondary-request", approveToken: "secondary-approval",
  });
  assertEquals(resolveNayaxRefundWriteCredentials("UNCONFIGURED", read), {
    requestToken: "", approveToken: "",
  });
  assertEquals(resolveNayaxRefundWriteCredentials("", read), { requestToken: "", approveToken: "" });
});

Deno.test("no account retains the existing empty-config diagnostic callback", async () => {
  const visited: string[] = [];
  await runConfiguredNayaxRefundAccounts({
    readEnv: () => undefined,
    runAccount: (key) => { visited.push(key); return Promise.resolve(); },
    onFailure: () => { throw new Error("unexpected failure"); },
  });
  assertEquals(visited, [""]);
});

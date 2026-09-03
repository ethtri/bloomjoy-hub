import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchRefundCaseGmailReply } from "./refund-gmail-transport.ts";
import {
  claimRefundGmailDeliveryWhenEnabled,
  REFUND_GMAIL_DISABLED_CODE,
  REFUND_GMAIL_DISABLED_MESSAGE,
  type RefundGmailConfig,
  RefundGmailError,
  sendRefundGmailReply,
  sha256Hex,
} from "./refund-gmail.ts";

const SYNTHETIC_ENV = {
  GMAIL_SUPPORT_CLIENT_ID: "synthetic-client-id",
  GMAIL_SUPPORT_CLIENT_SECRET: "synthetic-client-secret",
  GMAIL_SUPPORT_REFRESH_TOKEN: "synthetic-refresh-token",
  GMAIL_SUPPORT_MAILBOX: "mailbox@example.test",
  GMAIL_SUPPORT_SEND_AS_ALIASES: "support@example.test",
  GMAIL_REFUND_LABEL_ID: "Label_Synthetic",
  REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "true",
};

const withEnvironment = async (
  values: Record<string, string>,
  run: () => Promise<void>,
) => {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  try {
    await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
};

const withFetch = async (
  replacement: typeof fetch,
  run: () => Promise<void>,
) => {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

class FakeLinkQuery {
  constructor(private readonly link: Record<string, unknown> | null) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    return { data: this.link, error: null };
  }
}

const fakeSupabase = ({
  link,
  rpc,
  proofVerification,
}: {
  link: Record<string, unknown> | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: null;
  }>;
  proofVerification?: Record<string, unknown>;
}) => ({
  from: () => new FakeLinkQuery(link),
  rpc: (name: string, args: Record<string, unknown>) =>
    name === "service_verify_refund_synthetic_gmail_proof_transport"
      ? Promise.resolve({
        data: proofVerification ?? {
          required: false,
          allowed: true,
          status: "not_required",
        },
        error: null,
      })
      : rpc(name, args),
});

const email = {
  subject: "Synthetic first-contact acknowledgement",
  text: "Thank you for contacting Bloomjoy. We are reviewing your request.",
  html:
    "<p>Thank you for contacting Bloomjoy. We are reviewing your request.</p>",
};

Deno.test("correction delivery sends no raw write capability into the actual Gmail claim ledger", async () => {
  await withEnvironment({ ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "true" }, async () => {
    const token = "x".repeat(43);
    let claimed = false;
    const mailboxHash = await sha256Hex(SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX);
    const supabase = fakeSupabase({ link: { id: "synthetic-thread", mailbox_hash: mailboxHash }, rpc: async (name, args) => {
      assertEquals(name, "service_claim_refund_gmail_outbound_v3"); claimed = true;
      assertStringIncludes(String(args.p_plain_body), "[Secure refund correction link included at delivery]");
      assert(!JSON.stringify(args).includes(token));
      return { data: { claimed: false, status: "automatic_contact_disabled" }, error: null };
    } });
    await withFetch(async () => { throw new Error("Synthetic claim must not send email"); }, async () => {
      try {
        await dispatchRefundCaseGmailReply({ supabase: supabase as never, refundCaseId: "79850000-0000-4000-8000-000000000041",
          refundCaseMessageId: "79860000-0000-4000-8000-000000000041", recipientEmail: "customer@example.test",
          email: { ...email, text: `Update your request: https://app.bloomjoyusa.com/refunds/correct#token=${token}` }, deliveryKind: "automatic", gmailThreadId: "synthetic-thread" });
      } catch (error) { assert(error instanceof RefundGmailError); }
    });
    assert(claimed);
  });
});

const gmailConfig: RefundGmailConfig = {
  clientId: SYNTHETIC_ENV.GMAIL_SUPPORT_CLIENT_ID,
  clientSecret: SYNTHETIC_ENV.GMAIL_SUPPORT_CLIENT_SECRET,
  refreshToken: SYNTHETIC_ENV.GMAIL_SUPPORT_REFRESH_TOKEN,
  mailbox: SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX,
  mailboxIdentities: [
    SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX,
    "support@example.test",
  ],
  labelId: SYNTHETIC_ENV.GMAIL_REFUND_LABEL_ID,
  startAt: new Date("2026-08-03T00:00:00Z"),
};

const decodeRawMime = (raw: string) => {
  const normalized = raw.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
};

Deno.test("bounced original request RPC rejection stops actual Gmail transport before OAuth or provider access", async () => {
  await withEnvironment(
    { ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "true" },
    async () => {
      let claimCalls = 0;
      let providerCalls = 0;
      const mailboxHash = await sha256Hex(SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX);
      const supabase = {
        from: () => new FakeLinkQuery({ id: "synthetic-thread", mailbox_hash: mailboxHash }),
        rpc: async (name: string) => {
          if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
            return { data: { required: false, allowed: true, status: "not_required" }, error: null };
          }
          assertEquals(name, "service_claim_refund_gmail_outbound_v3");
          claimCalls += 1;
          return { data: null, error: {
            code: "23514",
            message: "Follow-up reminder requires a non-failed original request",
          } };
        },
      };
      await withFetch(async () => {
        providerCalls += 1;
        throw new Error("Bounced original must never reach OAuth or Gmail");
      }, async () => {
        let caught: unknown;
        try {
          await dispatchRefundCaseGmailReply({
            supabase: supabase as never,
            refundCaseId: "79850000-0000-4000-8000-000000000041",
            refundCaseMessageId: "79860000-0000-4000-8000-000000000041",
            recipientEmail: "reminder-customer@example.test",
            email,
            deliveryKind: "automatic",
            gmailThreadId: "synthetic-thread",
          });
        } catch (error) {
          caught = error;
        }
        assert(caught instanceof RefundGmailError);
        assertEquals(caught.code, "gmail_send_claim_failed");
      });
      assertEquals(claimCalls, 1);
      assertEquals(providerCalls, 0);
    },
  );
});

Deno.test("Gmail kill switch blocks linked delivery before claim, OAuth, or provider access", async () => {
  await withEnvironment(
    { ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "false" },
    async () => {
      let fetchCalls = 0;
      let claimCalls = 0;
      let firstContactClaimCalls = 0;
      const supabase = fakeSupabase({
        link: { id: "synthetic-link", mailbox_hash: "not-read-while-disabled" },
        rpc: async (name) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            claimCalls += 1;
          }
          return { data: null, error: null };
        },
      });

      await withFetch(
        async () => {
          fetchCalls += 1;
          throw new Error("disabled Gmail transport attempted provider access");
        },
        async () => {
          let firstContactError: unknown = null;
          try {
            await claimRefundGmailDeliveryWhenEnabled(async () => {
              firstContactClaimCalls += 1;
              return { claimed: true };
            });
          } catch (error) {
            firstContactError = error;
          }
          assert(firstContactError instanceof RefundGmailError);
          assertEquals(firstContactError.code, REFUND_GMAIL_DISABLED_CODE);

          let dispatchError: unknown = null;
          try {
            await dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000001",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000001",
              recipientEmail: "first-contact-customer@example.test",
              email,
              deliveryKind: "manual",
              gmailThreadId: "synthetic-link",
            });
          } catch (error) {
            dispatchError = error;
          }
          assert(dispatchError instanceof RefundGmailError);
          assertEquals(dispatchError.code, REFUND_GMAIL_DISABLED_CODE);
          assertEquals(dispatchError.message, REFUND_GMAIL_DISABLED_MESSAGE);
          assertEquals(dispatchError.deliveryUncertain, false);

          let directSendError: unknown = null;
          try {
            await sendRefundGmailReply({
              config: gmailConfig,
              providerThreadId: "synthetic-provider-thread",
              operationKey: "refund-first-contact:synthetic-disabled",
              recipientEmail: "first-contact-customer@example.test",
              ccEmails: [
                "first-contact-manager-a@example.test",
                "first-contact-manager-b@example.test",
              ],
              deliveryKind: "automatic",
              subject: email.subject,
              text: email.text,
              html: email.html,
              inReplyTo: "<synthetic-source@example.test>",
              references: "<synthetic-source@example.test>",
            });
          } catch (error) {
            directSendError = error;
          }
          assert(directSendError instanceof RefundGmailError);
          assertEquals(directSendError.code, REFUND_GMAIL_DISABLED_CODE);
        },
      );

      assertEquals(claimCalls, 0);
      assertEquals(firstContactClaimCalls, 0);
      assertEquals(fetchCalls, 0);
    },
  );
});

Deno.test("disabled Gmail leaves the non-Gmail customer-delivery route available", async () => {
  await withEnvironment(
    { ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "false" },
    async () => {
      const rpcCalls: string[] = [];
      let fetchCalls = 0;
      const supabase = fakeSupabase({
        link: null,
        rpc: async (name) => {
          rpcCalls.push(name);
          if (name !== "service_authorize_refund_customer_outbound") {
            throw new Error(`unexpected synthetic RPC: ${name}`);
          }
          return {
            data: {
              allowed: true,
              recipientResolutionStatus: "resolved",
              managerCcEmails: [
                "first-contact-manager-a@example.test",
                "first-contact-manager-b@example.test",
              ],
              managerRecipientOverlap: false,
              managerRecipientCount: 2,
            },
            error: null,
          };
        },
      });

      await withFetch(
        async () => {
          fetchCalls += 1;
          throw new Error("non-Gmail route attempted provider access");
        },
        async () => {
          const result = await dispatchRefundCaseGmailReply({
            supabase: supabase as never,
            refundCaseId: "79850000-0000-4000-8000-000000000002",
            refundCaseMessageId: "79860000-0000-4000-8000-000000000002",
            recipientEmail: "hosted-form-customer@example.test",
            email,
            deliveryKind: "manual",
          });
          assertEquals(result.usedGmail, false);
          assertEquals(result.managerCcCount, 2);
        },
      );

      assertEquals(rpcCalls, ["service_authorize_refund_customer_outbound"]);
      assertEquals(fetchCalls, 0);
    },
  );
});

Deno.test("automatic-contact shutdown remains independent and stops before Gmail claim", async () => {
  await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      REFUND_GMAIL_ENABLED: "true",
      REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "false",
    },
    async () => {
      let claimCalls = 0;
      let fetchCalls = 0;
      const supabase = fakeSupabase({
        link: { id: "synthetic-link", mailbox_hash: "not-read-while-paused" },
        rpc: async (name) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            claimCalls += 1;
          }
          return { data: null, error: null };
        },
      });

      await withFetch(
        async () => {
          fetchCalls += 1;
          throw new Error("paused automatic contact attempted provider access");
        },
        async () => {
          let caught: unknown = null;
          try {
            await dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000004",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000004",
              recipientEmail: "first-contact-customer@example.test",
              email,
              deliveryKind: "automatic",
              gmailThreadId: "synthetic-link",
            });
          } catch (error) {
            caught = error;
          }
          assert(caught instanceof RefundGmailError);
          assertEquals(caught.code, "automatic_contact_disabled");
        },
      );

      assertEquals(claimCalls, 0);
      assertEquals(fetchCalls, 0);
    },
  );
});

Deno.test("exclusive synthetic proof rejects an unrelated transport before link lookup, claim, OAuth, or send", async () => {
  await withEnvironment(
    { ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "true" },
    async () => {
      let linkLookups = 0;
      let claimCalls = 0;
      let fetchCalls = 0;
      const supabase = {
        from: () => {
          linkLookups += 1;
          return new FakeLinkQuery(null);
        },
        rpc: async (name: string) => {
          if (
            name === "service_verify_refund_synthetic_gmail_proof_transport"
          ) {
            return {
              data: {
                required: true,
                allowed: false,
                status: "authorization_mismatch",
              },
              error: null,
            };
          }
          if (name === "service_claim_refund_gmail_outbound_v3") {
            claimCalls += 1;
          }
          throw new Error(`unexpected proof rejection RPC: ${name}`);
        },
      };

      await withFetch(
        async () => {
          fetchCalls += 1;
          throw new Error("rejected synthetic proof attempted provider access");
        },
        async () => {
          let caught: unknown = null;
          try {
            await dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000099",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000099",
              recipientEmail: "real-customer@example.test",
              email,
              deliveryKind: "manual",
            });
          } catch (error) {
            caught = error;
          }
          assert(caught instanceof RefundGmailError);
          assertEquals(
            caught.code,
            "synthetic_proof_authorization_mismatch",
          );
        },
      );

      assertEquals(linkLookups, 0);
      assertEquals(claimCalls, 0);
      assertEquals(fetchCalls, 0);
    },
  );
});

Deno.test("approved one-shot synthetic proof pins one original-thread send", async () => {
  await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      GMAIL_SUPPORT_MAILBOX: "info@bloomjoysweets.com",
      GMAIL_SUPPORT_SEND_AS_ALIASES:
        "support@bloomjoysweets.com,refunds@bloomjoysweets.com",
      REFUND_GMAIL_ENABLED: "true",
    },
    async () => {
      const authorizationId = "79880000-0000-4000-8000-000000000001";
      const threadRecordId = "79890000-0000-4000-8000-000000000001";
      const providerThreadId = "synthetic-proof-provider-thread";
      const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
      const managerRouteDigest = await sha256Hex(
        "proof-manager@example.test",
      );
      let claimCalls = 0;
      let finishCalls = 0;
      let gmailCalls = 0;
      const supabase = fakeSupabase({
        link: { id: threadRecordId, mailbox_hash: mailboxHash },
        proofVerification: {
          required: true,
          allowed: true,
          status: "authorized",
          gmailThreadId: threadRecordId,
          expectedManagerCount: 1,
          managerRouteDigest,
        },
        rpc: async (name, args) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            claimCalls += 1;
            assertEquals(args.p_target_gmail_thread_id, threadRecordId);
            return {
              data: {
                linked: true,
                claimed: true,
                status: "pending_send",
                transportMessageId: "79870000-0000-4000-8000-000000000099",
                providerThreadId,
                subject: email.subject,
                inReplyTo: "<synthetic-proof-source@example.test>",
                references: "<synthetic-proof-source@example.test>",
                recipientResolutionStatus: "resolved",
                managerCcEmails: ["proof-manager@example.test"],
                managerRecipientOverlap: false,
                managerRecipientCount: 1,
              },
              error: null,
            };
          }
          if (name === "service_finish_refund_gmail_outbound") {
            finishCalls += 1;
            return { data: true, error: null };
          }
          throw new Error(`unexpected approved proof RPC: ${name}`);
        },
      });

      await withFetch(
        async (input) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
          if (url.includes("oauth2.googleapis.com/token")) {
            return new Response(
              JSON.stringify({
                access_token: "synthetic-access",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (
            url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")
          ) {
            gmailCalls += 1;
            return new Response(
              JSON.stringify({
                id: "synthetic-proof-message",
                threadId: providerThreadId,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`unexpected approved proof URL: ${url}`);
        },
        async () => {
          const result = await dispatchRefundCaseGmailReply({
            supabase: supabase as never,
            refundCaseId: "79850000-0000-4000-8000-000000000098",
            refundCaseMessageId: "79860000-0000-4000-8000-000000000098",
            recipientEmail: "proof-customer@example.test",
            email,
            deliveryKind: "manual",
            syntheticProofAuthorizationId: authorizationId,
          });
          assertEquals(result.usedGmail, true);
          assertEquals(result.managerCcCount, 1);
        },
      );

      assertEquals(claimCalls, 1);
      assertEquals(finishCalls, 1);
      assertEquals(gmailCalls, 1);
    },
  );
});

Deno.test("synthetic proof rejects a changed manager route after claim and before OAuth or send", async () => {
  await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      GMAIL_SUPPORT_MAILBOX: "info@bloomjoysweets.com",
      GMAIL_SUPPORT_SEND_AS_ALIASES:
        "support@bloomjoysweets.com,refunds@bloomjoysweets.com",
      REFUND_GMAIL_ENABLED: "true",
    },
    async () => {
      const authorizationId = "79880000-0000-4000-8000-000000000002";
      const threadRecordId = "79890000-0000-4000-8000-000000000002";
      const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
      const expectedRouteDigest = await sha256Hex(
        "proof-manager@example.test",
      );
      let finishCalls = 0;
      let fetchCalls = 0;
      const supabase = fakeSupabase({
        link: { id: threadRecordId, mailbox_hash: mailboxHash },
        proofVerification: {
          required: true,
          allowed: true,
          status: "authorized",
          gmailThreadId: threadRecordId,
          expectedManagerCount: 1,
          managerRouteDigest: expectedRouteDigest,
        },
        rpc: async (name) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            return {
              data: {
                linked: true,
                claimed: true,
                status: "pending_send",
                transportMessageId: "79870000-0000-4000-8000-000000000098",
                providerThreadId: "synthetic-proof-provider-thread",
                subject: email.subject,
                inReplyTo: "<synthetic-proof-source@example.test>",
                references: "<synthetic-proof-source@example.test>",
                recipientResolutionStatus: "resolved",
                managerCcEmails: ["changed-manager@example.test"],
                managerRecipientOverlap: false,
                managerRecipientCount: 1,
              },
              error: null,
            };
          }
          if (name === "service_finish_refund_gmail_outbound") {
            finishCalls += 1;
            return { data: true, error: null };
          }
          throw new Error(`unexpected manager-route RPC: ${name}`);
        },
      });

      let caught: unknown = null;
      await withFetch(
        async () => {
          fetchCalls += 1;
          throw new Error("manager-route rejection attempted provider access");
        },
        async () => {
          try {
            await dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000097",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000097",
              recipientEmail: "proof-customer@example.test",
              email,
              deliveryKind: "manual",
              syntheticProofAuthorizationId: authorizationId,
            });
          } catch (caughtError) {
            caught = caughtError;
          }
        },
      );
      assert(caught instanceof RefundGmailError);
      assertEquals(
        caught.code,
        "synthetic_proof_manager_route_changed",
      );
      assertEquals(finishCalls, 1);
      assertEquals(fetchCalls, 0);
    },
  );
});

Deno.test("enabled linked delivery preserves exact thread, customer To, two manager CCs, and automatic reply MIME", async () => {
  await withEnvironment(
    { ...SYNTHETIC_ENV, REFUND_GMAIL_ENABLED: "true" },
    async () => {
      const providerThreadId = "synthetic-provider-thread";
      const customerEmail = "first-contact-customer@example.test";
      const managers = [
        "first-contact-manager-a@example.test",
        "first-contact-manager-b@example.test",
      ];
      const rpcCalls: string[] = [];
      let oauthCalls = 0;
      let gmailCalls = 0;
      let providerRequest: Record<string, unknown> = {};
      const mailboxHash = await sha256Hex(SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX);
      const supabase = fakeSupabase({
        link: { id: "synthetic-link", mailbox_hash: mailboxHash },
        rpc: async (name) => {
          rpcCalls.push(name);
          if (name === "service_claim_refund_gmail_outbound_v3") {
            return {
              data: {
                linked: true,
                claimed: true,
                status: "pending_send",
                transportMessageId: "79870000-0000-4000-8000-000000000001",
                providerThreadId,
                subject: email.subject,
                inReplyTo: "<synthetic-source@example.test>",
                references:
                  "<synthetic-prior@example.test> <synthetic-source@example.test>",
                recipientResolutionStatus: "resolved",
                managerCcEmails: managers,
                managerRecipientOverlap: false,
                managerRecipientCount: 2,
              },
              error: null,
            };
          }
          if (name === "service_finish_refund_gmail_outbound") {
            return { data: true, error: null };
          }
          throw new Error(`unexpected synthetic RPC: ${name}`);
        },
      });

      await withFetch(
        async (input, init) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
          if (url.includes("oauth2.googleapis.com/token")) {
            oauthCalls += 1;
            return new Response(
              JSON.stringify({
                access_token: "synthetic-access",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (
            url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")
          ) {
            gmailCalls += 1;
            const requestBody = init && "body" in init ? init.body : null;
            providerRequest = JSON.parse(String(requestBody ?? "{}"));
            return new Response(
              JSON.stringify({
                id: "synthetic-provider-message",
                threadId: providerThreadId,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error("unexpected synthetic provider URL");
        },
        async () => {
          const result = await dispatchRefundCaseGmailReply({
            supabase: supabase as never,
            refundCaseId: "79850000-0000-4000-8000-000000000003",
            refundCaseMessageId: "79860000-0000-4000-8000-000000000003",
            recipientEmail: customerEmail,
            email,
            deliveryKind: "automatic",
            gmailThreadId: "synthetic-link",
          });
          assertEquals(result.usedGmail, true);
          assertEquals(result.managerCcCount, 2);
          assertEquals(result.managerRecipientOverlap, false);
          assertEquals(result.managerRecipientCount, 2);
        },
      );

      const raw = typeof providerRequest.raw === "string"
        ? providerRequest.raw
        : "";
      const mime = decodeRawMime(raw);
      assertEquals(providerRequest.threadId, providerThreadId);
      assertMatch(mime, /^To: first-contact-customer@example\.test$/m);
      assertMatch(
        mime,
        /^Cc: first-contact-manager-a@example\.test, first-contact-manager-b@example\.test$/m,
      );
      assertMatch(mime, /^In-Reply-To: <synthetic-source@example\.test>$/m);
      assertMatch(
        mime,
        /^References: <synthetic-prior@example\.test> <synthetic-source@example\.test>$/m,
      );
      assertStringIncludes(mime, "Auto-Submitted: auto-generated");
      assertStringIncludes(mime, "X-Auto-Response-Suppress: All");
      assert(!mime.includes("/refunds?case="));
      assertEquals(
        rpcCalls.filter((name) =>
          name === "service_claim_refund_gmail_outbound_v3"
        ).length,
        1,
      );
      assertEquals(
        rpcCalls.filter((name) =>
          name === "service_finish_refund_gmail_outbound"
        ).length,
        1,
      );
      assert(oauthCalls <= 1);
      assertEquals(gmailCalls, 1);
    },
  );
});

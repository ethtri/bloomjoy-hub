import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deliverNayaxRefundCustomerCompletion } from "./nayax-refund-completion-delivery.ts";
import { sha256Hex } from "./refund-gmail.ts";

const CASE_ID = "b2200000-0000-4000-8000-000000000001";
const MESSAGE_ID = "b2000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "b2400000-0000-4000-8000-000000000001";
const THREAD_RECORD_ID = "b2500000-0000-4000-8000-000000000001";
const PROVIDER_THREAD_ID = "synthetic-original-provider-thread";
const CUSTOMER_EMAIL = "customer@example.test";
const CANONICAL_BODY = "Your refund is on its way. The bank may take several days to post it.";
const SOURCE_MESSAGE_HEADER = "<synthetic-source@example.test>";

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

const decodeRawMime = (raw: string) => {
  const base64 = raw.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
};

const decodeMimePart = (mime: string, mediaType: "plain" | "html") => {
  const contentType = `Content-Type: text/${mediaType}; charset="UTF-8"`;
  const headerStart = mime.indexOf(contentType);
  assert(headerStart >= 0, `expected a text/${mediaType} MIME part`);
  const contentStart = mime.indexOf("\r\n\r\n", headerStart);
  assert(contentStart >= 0, `expected a ${mediaType} MIME body`);
  const bodyStart = contentStart + 4;
  const bodyEnd = mime.indexOf("\r\n--", bodyStart);
  assert(bodyEnd >= 0, `expected a closing boundary for ${mediaType} MIME`);
  const encoded = mime.slice(bodyStart, bodyEnd).replace(/\s+/g, "");
  return new TextDecoder().decode(
    Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
  );
};

Deno.test("PR #1310 regression: completion validates its immutable body before sending status-link-enriched Gmail MIME", async () => {
  await withEnvironment({
    REFUND_GMAIL_ENABLED: "true",
    GMAIL_SUPPORT_CLIENT_ID: "synthetic-client-id",
    GMAIL_SUPPORT_CLIENT_SECRET: "synthetic-client-secret",
    GMAIL_SUPPORT_REFRESH_TOKEN: "synthetic-refresh-token",
    GMAIL_SUPPORT_MAILBOX: "info@bloomjoysweets.com",
    GMAIL_SUPPORT_SEND_AS_ALIASES: "refunds@bloomjoysweets.com",
    GMAIL_REFUND_LABEL_ID: "Label_Synthetic",
    REFUND_CUSTOMER_FROM_EMAIL: "refunds@bloomjoysweets.com",
    REFUND_STATUS_LINKS_ENABLED: "true",
    REFUND_STATUS_PUBLIC_ORIGIN: "https://app.bloomjoyusa.com",
  }, async () => {
    const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
    const rpcCalls: string[] = [];
    const claimedIdentityBodies: unknown[] = [];
    const requestedThreadIds: unknown[] = [];
    let providerRequest: Record<string, unknown> = {};
    let oauthCalls = 0;
    let gmailSendCalls = 0;
    let prepareRetryCalls = 0;

    const supabase = {
      from: (table: string) => {
        assertEquals(table, "refund_gmail_threads");
        const filters = new Map<string, unknown>();
        const query = {
          select: () => query,
          eq: (field: string, value: unknown) => {
            filters.set(field, value);
            return query;
          },
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            requestedThreadIds.push(filters.get("id"));
            return {
              data: filters.get("id") === THREAD_RECORD_ID
                ? { id: THREAD_RECORD_ID, mailbox_hash: mailboxHash }
                : null,
              error: null,
            };
          },
        };
        return query;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push(name);
        if (name === "service_claim_nayax_refund_completion") {
          return {
            data: {
              refundCaseId: CASE_ID,
              refundCaseMessageId: MESSAGE_ID,
              gmailThreadId: THREAD_RECORD_ID,
              recipientEmail: CUSTOMER_EMAIL,
              subject: "Your refund is on its way",
              body: CANONICAL_BODY,
            },
            error: null,
          };
        }
        if (name === "service_issue_refund_status_capability") {
          return {
            data: {
              issued: true,
              payloadRedacted: true,
              capabilityId: "b2600000-0000-4000-8000-000000000001",
              expiresAt: "2026-10-24T12:00:00.000Z",
            },
            error: null,
          };
        }
        if (name === "service_attach_refund_status_capability_to_message") {
          return { data: true, error: null };
        }
        if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
          return {
            data: { required: false, allowed: true, status: "not_required" },
            error: null,
          };
        }
        if (name === "service_claim_refund_gmail_outbound_v3") {
          claimedIdentityBodies.push(args.p_plain_body);
          // Model the database's P4664 immutable-body guard independently of
          // the caller: the enriched email is transport content, not identity.
          if (args.p_plain_body !== CANONICAL_BODY) {
            return {
              data: null,
              error: {
                code: "P4664",
                message: "The approved customer message body changed.",
              },
            };
          }
          return {
            data: {
              linked: true,
              claimed: true,
              status: "pending_send",
              transportMessageId: MESSAGE_ID,
              providerThreadId: PROVIDER_THREAD_ID,
              subject: "Refund conversation subject",
              inReplyTo: SOURCE_MESSAGE_HEADER,
              references: "<synthetic-prior@example.test> " + SOURCE_MESSAGE_HEADER,
              recipientResolutionStatus: "resolved",
              managerCcEmails: ["manager@example.test"],
              managerRecipientOverlap: false,
              managerRecipientCount: 1,
            },
            error: null,
          };
        }
        if (name === "service_finish_refund_gmail_outbound") {
          return { data: true, error: null };
        }
        if (name === "service_finish_nayax_refund_completion") {
          return {
            data: {
              status: args.p_delivery_status,
              transport: "gmail_thread",
              originalThread: true,
              operationApplied: true,
            },
            error: null,
          };
        }
        if (name === "service_prepare_nayax_completion_retry") {
          prepareRetryCalls += 1;
          return { data: { prepared: false }, error: null };
        }
        throw new Error(`unexpected synthetic RPC: ${name}`);
      },
    } as never;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        oauthCalls += 1;
        return new Response(JSON.stringify({
          access_token: "synthetic-access-token",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")) {
        gmailSendCalls += 1;
        providerRequest = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({
          id: "synthetic-provider-message",
          threadId: PROVIDER_THREAD_ID,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/messages/synthetic-provider-message")) {
        return new Response("{}", { status: 503 });
      }
      throw new Error(`unexpected synthetic provider request: ${url}`);
    };

    try {
      const result = await deliverNayaxRefundCustomerCompletion({
        supabase,
        executorAssertion: "synthetic-executor-assertion",
        attemptId: ATTEMPT_ID,
        caseId: CASE_ID,
      });

      assertEquals(result.status, "sent");
      assertEquals(requestedThreadIds, [THREAD_RECORD_ID]);
      assertEquals(claimedIdentityBodies, [CANONICAL_BODY]);
      assertEquals(gmailSendCalls, 1);
      assertEquals(oauthCalls, 1);
      assertEquals(providerRequest.threadId, PROVIDER_THREAD_ID);
      assertEquals(prepareRetryCalls, 0);
      assertEquals(
        rpcCalls.filter((name) => name === "service_claim_refund_gmail_outbound_v3").length,
        1,
      );
      assertEquals(
        rpcCalls.filter((name) => name === "service_finish_nayax_refund_completion").length,
        1,
      );

      const raw = typeof providerRequest.raw === "string"
        ? providerRequest.raw
        : "";
      const mime = decodeRawMime(raw);
      const plainBody = decodeMimePart(mime, "plain");
      const htmlBody = decodeMimePart(mime, "html");
      assertStringIncludes(mime, `In-Reply-To: ${SOURCE_MESSAGE_HEADER}`);
      assertStringIncludes(mime, `References: <synthetic-prior@example.test> ${SOURCE_MESSAGE_HEADER}`);
      assertStringIncludes(mime, "X-Bloomjoy-Refund-Operation:");
      assertStringIncludes(plainBody, CANONICAL_BODY);
      assertStringIncludes(plainBody, "/refunds/status#token=");
      assertStringIncludes(htmlBody, CANONICAL_BODY);
      assertStringIncludes(htmlBody, "/refunds/status#token=");
      assert(!String(claimedIdentityBodies[0]).includes("/refunds/status#token="));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

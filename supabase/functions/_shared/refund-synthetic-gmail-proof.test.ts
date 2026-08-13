import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorizeRefundSyntheticGmailProof,
  bindRefundSyntheticGmailProofMessage,
  verifyRefundSyntheticGmailProofTransport,
} from "./refund-synthetic-gmail-proof.ts";
import { RefundGmailError, sha256Hex } from "./refund-gmail.ts";

const CASE_ID = "80100000-0000-4000-8000-000000000001";
const MESSAGE_ID = "80110000-0000-4000-8000-000000000001";
const AUTHORIZATION_ID = "80120000-0000-4000-8000-000000000001";
const THREAD_ID = "80130000-0000-4000-8000-000000000001";
const RUN_TOKEN = "owner-controlled-synthetic-proof-token-0001";
const MANAGER_ROUTE_DIGEST = "a".repeat(64);

const captureProofError = async (run: () => Promise<unknown>) => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof RefundGmailError);
  return caught;
};

Deno.test("synthetic proof authorization hashes the opaque token and returns only its internal binding", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        data: {
          required: true,
          allowed: true,
          status: "authorized",
          authorizationId: AUTHORIZATION_ID,
          gmailThreadId: THREAD_ID,
          expectedManagerCount: 1,
          managerRouteDigest: MANAGER_ROUTE_DIGEST,
        },
        error: null,
      };
    },
  };

  const result = await authorizeRefundSyntheticGmailProof({
    supabase: supabase as never,
    refundCaseId: CASE_ID,
    recipientEmail: "etrifari+refundpilot@example.test",
    runToken: RUN_TOKEN,
    messageType: "status_update",
    defaultTemplateOnly: true,
  });

  assertEquals(result, {
    required: true,
    authorizationId: AUTHORIZATION_ID,
    gmailThreadId: THREAD_ID,
  });
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].name,
    "service_authorize_refund_synthetic_gmail_proof",
  );
  assertEquals(
    calls[0].args.p_run_token_digest,
    await sha256Hex(RUN_TOKEN),
  );
  assertEquals(JSON.stringify(calls).includes(RUN_TOKEN), false);
});

Deno.test("wrong case, recipient, token, template, expiry, replay, and manager route fail closed", async () => {
  for (
    const status of [
      "case_mismatch",
      "recipient_mismatch",
      "token_mismatch",
      "template_mismatch",
      "expired",
      "already_consumed",
      "manager_route_changed",
    ]
  ) {
    const supabase = {
      rpc: async () => ({
        data: { required: true, allowed: false, status },
        error: null,
      }),
    };
    const error = await captureProofError(() =>
      authorizeRefundSyntheticGmailProof({
        supabase: supabase as never,
        refundCaseId: CASE_ID,
        recipientEmail: "etrifari+refundpilot@example.test",
        runToken: RUN_TOKEN,
        messageType: "status_update",
        defaultTemplateOnly: true,
      })
    );
    assertEquals(error.code, `synthetic_proof_${status}`);
  }
});

Deno.test("a supplied proof token cannot silently fall through outside a proof window", async () => {
  const supabase = {
    rpc: async () => ({
      data: { required: false, allowed: true, status: "not_required" },
      error: null,
    }),
  };
  const error = await captureProofError(() =>
    authorizeRefundSyntheticGmailProof({
      supabase: supabase as never,
      refundCaseId: CASE_ID,
      recipientEmail: "etrifari+refundpilot@example.test",
      runToken: RUN_TOKEN,
      messageType: "status_update",
      defaultTemplateOnly: true,
    })
  );
  assertEquals(error.code, "synthetic_proof_unexpected_token");
});

Deno.test("invalid or missing opaque token is never forwarded in clear text", async () => {
  let observedDigest: unknown = "not-called";
  const supabase = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      observedDigest = args.p_run_token_digest;
      return {
        data: { required: true, allowed: false, status: "token_mismatch" },
        error: null,
      };
    },
  };
  await captureProofError(() =>
    authorizeRefundSyntheticGmailProof({
      supabase: supabase as never,
      refundCaseId: CASE_ID,
      recipientEmail: "etrifari+refundpilot@example.test",
      runToken: "short",
      messageType: "status_update",
      defaultTemplateOnly: true,
    })
  );
  assertEquals(observedDigest, "");
});

Deno.test("message binding and transport verification use only the internal authorization id", async () => {
  const calls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "service_bind_refund_synthetic_gmail_proof_message") {
        return { data: true, error: null };
      }
      return {
        data: {
          required: true,
          allowed: true,
          status: "authorized",
          gmailThreadId: THREAD_ID,
          expectedManagerCount: 1,
          managerRouteDigest: MANAGER_ROUTE_DIGEST,
        },
        error: null,
      };
    },
  };

  await bindRefundSyntheticGmailProofMessage({
    supabase: supabase as never,
    authorizationId: AUTHORIZATION_ID,
    refundCaseId: CASE_ID,
    refundCaseMessageId: MESSAGE_ID,
  });
  const verified = await verifyRefundSyntheticGmailProofTransport({
    supabase: supabase as never,
    refundCaseId: CASE_ID,
    refundCaseMessageId: MESSAGE_ID,
    recipientEmail: "etrifari+refundpilot@example.test",
    authorizationId: AUTHORIZATION_ID,
  });
  assertEquals(verified, {
    required: true,
    gmailThreadId: THREAD_ID,
    expectedManagerCount: 1,
    managerRouteDigest: MANAGER_ROUTE_DIGEST,
  });
  assertEquals(calls, [
    "service_bind_refund_synthetic_gmail_proof_message",
    "service_verify_refund_synthetic_gmail_proof_transport",
  ]);
});

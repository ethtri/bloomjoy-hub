import {
  REFUND_MANAGER_NOTIFICATION_POLICY,
  sendRefundManagerActionNotice,
  type RefundManagerNotificationReason,
} from "./refund-manager-notification.ts";
import { TransactionalEmailDeliveryUnknownError } from "./internal-email.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
};

Deno.test("manager notification policy classifies every supported event", () => {
  const reasons = Object.keys(REFUND_MANAGER_NOTIFICATION_POLICY).sort() as
    RefundManagerNotificationReason[];
  assertEquals(reasons, [
    "customer_completion_copy",
    "customer_reply",
    "follow_up_manual_review",
    "hard_bounce",
    "intake_created",
    "manager_authored_conversation",
    "manager_escalation",
    "manager_reminder",
    "provider_outage",
    "provider_rejection",
    "provider_setup",
    "provider_timeout",
    "provider_unknown",
    "routine_customer_message",
    "wallet_match_ready",
  ], "policy event inventory");

  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.intake_created, "portal_only", "intake");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.customer_reply, "immediate", "reply compatibility");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_reminder, "immediate", "reminder compatibility");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_escalation, "immediate", "escalation");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.hard_bounce, "immediate", "hard bounce");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.wallet_match_ready, "immediate", "ready action");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.routine_customer_message, "portal_only", "automated customer copy");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_authored_conversation, "portal_only", "manager-authored CC path");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.customer_completion_copy, "portal_only", "completion copy");
});

const reservation = {
  actionId: "92800000-0000-4000-8000-000000000001",
  attentionVersion: 1,
  channel: "immediate",
  deliveryState: "reserved",
  claimed: true,
  claimToken: "92900000-0000-4000-8000-000000000001",
  recipientRoute: {
    recipients: ["notice-manager@example.test"],
    routeType: "manager",
    managerRecipientCount: 1,
    recipientCount: 1,
    resolutionStatus: "resolved",
    mappingFingerprint: "a".repeat(64),
  },
};

const noticeInput = {
  refundCaseId: "92500000-0000-4000-8000-000000000001",
  customerEmail: "notice-customer@example.test",
  noticeReason: "customer_reply" as const,
  subject: "Synthetic manager notice",
  summaryText: "Synthetic action needed.",
};

Deno.test("manager notice marks provider access before send and validates settlement", async () => {
  const calls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "service_begin_refund_manager_notification") {
        return { data: reservation, error: null };
      }
      if (name === "service_mark_refund_manager_notification_provider_started") {
        return { data: true, error: null };
      }
      if (name === "service_complete_refund_manager_notification") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const result = await sendRefundManagerActionNotice({
    ...noticeInput,
    supabase: supabase as never,
    sendEmail: async () => {
      calls.push("provider_send");
      return {
        provider: "resend" as const,
        providerMessageId: "synthetic_provider_message",
        acceptedAt: new Date().toISOString(),
      };
    },
  });
  assertEquals(calls, [
    "service_begin_refund_manager_notification",
    "service_mark_refund_manager_notification_provider_started",
    "provider_send",
    "service_complete_refund_manager_notification",
  ], "provider boundary sequence");
  assertEquals(result.deliveryState, "sent", "settled delivery state");
});

Deno.test("manager notice never reaches provider when the start marker fails", async () => {
  let providerCalls = 0;
  const outcomes: unknown[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "service_begin_refund_manager_notification") {
        return { data: reservation, error: null };
      }
      if (name === "service_mark_refund_manager_notification_provider_started") {
        return { data: false, error: null };
      }
      if (name === "service_complete_refund_manager_notification") {
        outcomes.push(args.p_outcome);
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  let rejected = false;
  try {
    await sendRefundManagerActionNotice({
      ...noticeInput,
      supabase: supabase as never,
      sendEmail: async () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    });
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true, "failed marker rejects delivery");
  assertEquals(providerCalls, 0, "provider call count");
  assertEquals(outcomes, ["known_not_sent"], "safe pre-provider settlement");
});

Deno.test("manager notice holds provider and settlement uncertainty without resend", async () => {
  let completionCalls = 0;
  const outcomes: unknown[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "service_begin_refund_manager_notification") {
        return { data: reservation, error: null };
      }
      if (name === "service_mark_refund_manager_notification_provider_started") {
        return { data: true, error: null };
      }
      if (name === "service_complete_refund_manager_notification") {
        completionCalls += 1;
        outcomes.push(args.p_outcome);
        return completionCalls === 1
          ? { data: false, error: null }
          : { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  let error: unknown;
  try {
    await sendRefundManagerActionNotice({
      ...noticeInput,
      supabase: supabase as never,
      sendEmail: async () => ({
        provider: "resend" as const,
        providerMessageId: "synthetic_provider_message",
        acceptedAt: new Date().toISOString(),
      }),
    });
  } catch (caught) {
    error = caught;
  }
  assertEquals(
    error instanceof TransactionalEmailDeliveryUnknownError,
    true,
    "settlement uncertainty is surfaced",
  );
  assertEquals(outcomes, ["sent", "delivery_unknown"], "uncertain settlement outcomes");
});

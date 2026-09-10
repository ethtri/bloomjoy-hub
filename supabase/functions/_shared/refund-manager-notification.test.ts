import {
  REFUND_MANAGER_NOTIFICATION_POLICY,
  type RefundManagerNotificationReason,
} from "./refund-manager-notification.ts";

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
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.customer_reply, "daily_digest", "reply");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_reminder, "daily_digest", "reminder");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_escalation, "immediate", "escalation");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.hard_bounce, "immediate", "hard bounce");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.wallet_match_ready, "immediate", "ready action");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.routine_customer_message, "portal_only", "automated customer copy");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.manager_authored_conversation, "portal_only", "manager-authored CC path");
  assertEquals(REFUND_MANAGER_NOTIFICATION_POLICY.customer_completion_copy, "portal_only", "completion copy");
});

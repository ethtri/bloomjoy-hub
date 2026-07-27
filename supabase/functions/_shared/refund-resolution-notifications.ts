import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { sendTransactionalEmail } from "./internal-email.ts";
import {
  buildRefundCustomerEmail,
  getRefundReplyToEmail,
} from "./refund-email.ts";
import { resolveRefundPublicLabels } from "./refund-location.ts";

type OneOrMany<T> = T | T[] | null | undefined;

type ResolutionNotificationClaim = {
  id: string;
  refundCaseId: string;
  audience: "customer" | "manager";
  recipientEmail: string;
  deliveryKey: string;
  attemptCount: number;
};

type ResolutionContext = {
  id: string;
  public_reference: string;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  refund_completed_at: string | null;
  reporting_machines?: OneOrMany<{
    machine_label: string | null;
    refund_public_display_label: string | null;
  }>;
  reporting_locations?: OneOrMany<{
    name: string | null;
    timezone: string | null;
  }>;
};

export type RefundResolutionNotificationSummary = {
  claimed: number;
  sent: number;
  failed: number;
  customerStatus: string | null;
  managerStatus: string | null;
};

const firstRelation = <T>(value: OneOrMany<T>) =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isSafeEmail = (value: string) =>
  value.length >= 3 &&
  value.length <= 320 &&
  value.includes("@") &&
  !/[\r\n]/.test(value);

const normalizeClaims = (value: unknown): ResolutionNotificationClaim[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = sanitizeText(row.id, 80);
    const refundCaseId = sanitizeText(row.refundCaseId, 80);
    const audience = sanitizeText(row.audience, 20);
    const recipientEmail = sanitizeText(row.recipientEmail, 320).toLowerCase();
    const deliveryKey = sanitizeText(row.deliveryKey, 256);
    const attemptCount = Number(row.attemptCount);
    if (
      !isUuid(id) ||
      !isUuid(refundCaseId) ||
      !["customer", "manager"].includes(audience) ||
      !isSafeEmail(recipientEmail) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(deliveryKey) ||
      !Number.isInteger(attemptCount) ||
      attemptCount < 1 ||
      attemptCount > 3
    ) {
      return [];
    }
    return [{
      id,
      refundCaseId,
      audience: audience as "customer" | "manager",
      recipientEmail,
      deliveryKey,
      attemptCount,
    }];
  });
};

const getResolutionContext = async (
  supabase: SupabaseClient,
  refundCaseId: string,
): Promise<ResolutionContext | null> => {
  const { data, error } = await supabase
    .from("refund_cases")
    .select(`
      id,
      public_reference,
      customer_email,
      customer_name,
      payment_method,
      payment_amount_cents,
      refund_amount_cents,
      refund_completed_at,
      reporting_machines(machine_label, refund_public_display_label),
      reporting_locations(name, timezone)
    `)
    .eq("id", refundCaseId)
    .maybeSingle();
  if (error) throw error;
  return data as ResolutionContext | null;
};

const buildManagerCompletionEmail = ({
  context,
  machineLabel,
  locationName,
  locationTimezone,
}: {
  context: ResolutionContext;
  machineLabel: string;
  locationName: string;
  locationTimezone: string;
}) => {
  const amountCents = context.refund_amount_cents ?? context.payment_amount_cents ?? 0;
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
  let completedAt = "just now";
  if (context.refund_completed_at) {
    try {
      completedAt = new Date(context.refund_completed_at).toLocaleString(
        "en-US",
        {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: locationTimezone,
        },
      );
    } catch {
      completedAt = new Date(context.refund_completed_at).toISOString();
    }
  }
  const subject = `Refund ${context.public_reference} completed`;
  const text = [
    "Bloomjoy completed the approved card refund through Nayax.",
    "",
    `Claim: ${context.public_reference}`,
    `Amount: ${amount}`,
    `Location: ${locationName || "Bloomjoy location"}`,
    `Machine: ${machineLabel || "Bloomjoy machine"}`,
    `Completed: ${completedAt} (${locationTimezone})`,
    "",
    "No card number or provider transaction identifier is included in this confirmation.",
  ].join("\n");
  return { subject, text };
};

const finishNotification = async ({
  supabase,
  claim,
  status,
  errorCode,
  providerMessageId,
}: {
  supabase: SupabaseClient;
  claim: ResolutionNotificationClaim;
  status: "sent" | "failed";
  errorCode?: string | null;
  providerMessageId?: string | null;
}) => {
  const { error } = await supabase.rpc("service_finish_refund_resolution_notification", {
    p_notification_id: claim.id,
    p_status: status,
    p_error_code: errorCode ?? null,
    p_provider_message_id: providerMessageId ?? null,
  });
  if (error) throw error;
};

const readNotificationStatuses = async (
  supabase: SupabaseClient,
  refundCaseId: string | null,
) => {
  if (!refundCaseId) {
    return { customerStatus: null, managerStatus: null };
  }
  const { data, error } = await supabase
    .from("refund_case_resolution_notifications")
    .select("audience,status")
    .eq("refund_case_id", refundCaseId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ audience?: string; status?: string }>;
  return {
    customerStatus:
      sanitizeText(rows.find((row) => row.audience === "customer")?.status, 40) || null,
    managerStatus:
      sanitizeText(rows.find((row) => row.audience === "manager")?.status, 40) || null,
  };
};

export const deliverRefundResolutionNotifications = async ({
  supabase,
  refundCaseId = null,
  limit = 20,
}: {
  supabase: SupabaseClient;
  refundCaseId?: string | null;
  limit?: number;
}): Promise<RefundResolutionNotificationSummary> => {
  const safeCaseId = refundCaseId && isUuid(refundCaseId) ? refundCaseId : null;
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
  const { data, error } = await supabase.rpc(
    "service_claim_refund_resolution_notifications",
    {
      p_refund_case_id: safeCaseId,
      p_limit: safeLimit,
    },
  );
  if (error) throw error;

  const claims = normalizeClaims(data);
  let sent = 0;
  let failed = 0;
  const contextCache = new Map<string, ResolutionContext>();

  for (const claim of claims) {
    try {
      let context = contextCache.get(claim.refundCaseId) ?? null;
      if (!context) {
        context = await getResolutionContext(supabase, claim.refundCaseId);
        if (!context) throw new Error("Refund resolution context is unavailable.");
        contextCache.set(claim.refundCaseId, context);
      }

      const machine = firstRelation(context.reporting_machines);
      const location = firstRelation(context.reporting_locations);
      const publicLabels = resolveRefundPublicLabels({
        locationName: location?.name,
        publicMachineLabel: machine?.refund_public_display_label,
        machineLabel: machine?.machine_label,
      });

      const email = claim.audience === "customer"
        ? buildRefundCustomerEmail({
            messageType: "completed",
            publicReference: context.public_reference,
            customerName: context.customer_name,
            customerEmail: claim.recipientEmail,
            machineLabel: publicLabels.machineLabel,
            locationName: publicLabels.locationName,
            refundAmountCents:
              context.refund_amount_cents ?? context.payment_amount_cents,
            paymentMethod: context.payment_method,
            decisionReason: null,
          })
        : buildManagerCompletionEmail({
            context,
            machineLabel: publicLabels.machineLabel,
            locationName: publicLabels.locationName,
            locationTimezone:
              sanitizeText(location?.timezone, 80) || "UTC",
          });

      const delivery = await sendTransactionalEmail({
        to: [claim.recipientEmail],
        subject: email.subject,
        text: email.text,
        html: "html" in email && typeof email.html === "string"
          ? email.html
          : undefined,
        replyTo: claim.audience === "customer" ? getRefundReplyToEmail() : null,
        idempotencyKey: claim.deliveryKey,
      });
      await finishNotification({
        supabase,
        claim,
        status: "sent",
        providerMessageId: delivery.providerMessageId,
      });
      sent += 1;
    } catch (deliveryError) {
      failed += 1;
      console.error("refund resolution notification failed", {
        audience: claim.audience,
        attemptCount: claim.attemptCount,
        errorType:
          deliveryError instanceof Error ? deliveryError.name : typeof deliveryError,
        payloadRedacted: true,
      });
      await finishNotification({
        supabase,
        claim,
        status: "failed",
        errorCode: "email_delivery_failed",
      }).catch(() => undefined);
    }
  }

  const statuses = await readNotificationStatuses(supabase, safeCaseId);
  return {
    claimed: claims.length,
    sent,
    failed,
    ...statuses,
  };
};

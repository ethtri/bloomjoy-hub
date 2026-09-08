export type NayaxCompletionDeliveryStatus =
  | "sent"
  | "failed"
  | "delivery_unknown"
  | "deferred";

export type NayaxCompletionResult = Record<string, unknown> & {
  status: NayaxCompletionDeliveryStatus | "already_sent";
};

type DeliverNayaxCompletionOnceInput = {
  deliver: () => Promise<boolean>;
  finish: (
    status: NayaxCompletionDeliveryStatus,
  ) => Promise<NayaxCompletionResult>;
  isDeliveryUncertain: (error: unknown) => boolean;
};

type DeliverPreparedNayaxCompletionOnceInput<T> =
  & Omit<
    DeliverNayaxCompletionOnceInput,
    "deliver"
  >
  & {
    load: () => Promise<T>;
    deliverLoaded: (loaded: T) => Promise<boolean>;
  };

type DeliverNayaxCompletionWithDefiniteRetryInput =
  & DeliverNayaxCompletionOnceInput
  & {
    prepareSameMessageRetry: () => Promise<boolean>;
  };

const fallbackResult = (
  status: NayaxCompletionDeliveryStatus,
): NayaxCompletionResult => ({
  status,
  transport: "gmail_thread",
  managerCcCount: 0,
  originalThread: true,
  operationApplied: false,
  managerCompletionNoticeSent: false,
});

export type NayaxFormReceiptClaim = {
  refundCaseMessageId: string | null;
  status: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const parseNayaxFormReceiptClaim = (
  value: Record<string, unknown> | null,
  expectedCaseId: string,
): NayaxFormReceiptClaim | null => {
  if (
    !value || value.originalThread !== false ||
    value.refundCaseId !== expectedCaseId || value.payloadRedacted !== true ||
    !["queued", "already_sent", "notice_deferred"].includes(
      typeof value.status === "string" ? value.status : "",
    ) ||
    (value.status === "notice_deferred"
      ? value.transport !== null || value.refundCaseMessageId !== null
      : value.transport !== "transactional_email" ||
        typeof value.refundCaseMessageId !== "string" ||
        !UUID_PATTERN.test(value.refundCaseMessageId))
  ) return null;
  return {
    refundCaseMessageId: value.refundCaseMessageId as string | null,
    status: value.status as string,
  };
};

type FormReceiptOutboxResult = {
  messageId: string;
  outcome: "sent" | "failed" | "delivery_unknown" | "deferred";
  transport: "gmail_thread" | "transactional_email" | null;
  managerCcCount: number;
};

export const deliverNayaxFormReceiptCompletion = async ({
  claim,
  drain,
}: {
  claim: NayaxFormReceiptClaim;
  drain: (messageId: string) => Promise<FormReceiptOutboxResult[]>;
}): Promise<NayaxCompletionResult> => {
  if (claim.status === "already_sent") {
    return {
      status: "already_sent",
      transport: "transactional_email",
      managerCcCount: 0,
      originalThread: false,
      operationApplied: false,
      managerCompletionNoticeSent: false,
    };
  }
  if (!claim.refundCaseMessageId || claim.status === "notice_deferred") {
    return {
      status: "deferred",
      transport: null,
      managerCcCount: 0,
      originalThread: false,
      operationApplied: false,
      managerCompletionNoticeSent: false,
    };
  }
  const result = (await drain(claim.refundCaseMessageId)).find((candidate) =>
    candidate.messageId === claim.refundCaseMessageId
  );
  if (!result) {
    return {
      status: "delivery_unknown",
      transport: null,
      managerCcCount: 0,
      originalThread: false,
      operationApplied: false,
      managerCompletionNoticeSent: false,
    };
  }
  return {
    status: result.outcome,
    transport: result.outcome === "sent" ? result.transport : null,
    managerCcCount: result.managerCcCount,
    originalThread: false,
    operationApplied: true,
    managerCompletionNoticeSent: false,
  };
};

export const deliverNayaxCompletionOnce = async ({
  deliver,
  finish,
  isDeliveryUncertain,
}: DeliverNayaxCompletionOnceInput): Promise<NayaxCompletionResult> => {
  let deliveryReturned = false;
  try {
    const usedOriginalGmailThread = await deliver();
    if (!usedOriginalGmailThread) {
      throw new Error("original_gmail_thread_required");
    }
    deliveryReturned = true;
    return await finish("sent");
  } catch (error) {
    const failureStatus = deliveryReturned || isDeliveryUncertain(error)
      ? "delivery_unknown"
      : "failed";
    try {
      return await finish(failureStatus);
    } catch {
      return fallbackResult(failureStatus);
    }
  }
};

export const deliverPreparedNayaxCompletionOnce = async <T>({
  load,
  deliverLoaded,
  finish,
  isDeliveryUncertain,
}: DeliverPreparedNayaxCompletionOnceInput<T>) =>
  await deliverNayaxCompletionOnce({
    deliver: async () => deliverLoaded(await load()),
    finish,
    isDeliveryUncertain,
  });

export const deliverNayaxCompletionWithDefiniteRetry = async ({
  deliver,
  finish,
  isDeliveryUncertain,
  prepareSameMessageRetry,
}: DeliverNayaxCompletionWithDefiniteRetryInput) => {
  const first = await deliverNayaxCompletionOnce({
    deliver,
    finish,
    isDeliveryUncertain,
  });
  if (first.status !== "failed") return first;

  try {
    if (!await prepareSameMessageRetry()) return first;
  } catch {
    return first;
  }

  return await deliverNayaxCompletionOnce({
    deliver,
    finish,
    isDeliveryUncertain,
  });
};

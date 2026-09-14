// Completion delivery remains shared with historical refund records. Provider
// execution now lives in nayax-refund-attempt-queue.ts.
export type NayaxCompletionDelivery = {
  status: "sent" | "failed" | "delivery_unknown" | "already_sent" | "deferred";
  transport: "gmail_thread" | "transactional_email" | null;
  managerCcCount: number;
  originalThread: boolean;
  operationApplied: boolean;
  managerCompletionNoticeSent: false;
};

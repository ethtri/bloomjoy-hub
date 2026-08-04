export const REFUND_MANAGER_AGING_TEMPLATE_VERSION = "refund_manager_aging_v1";

export type RefundManagerAgingMilestone = "reminder" | "escalation";

type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const toInteger = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const getZonedDateTimeParts = (
  value: Date,
  timeZone: string,
): ZonedDateTimeParts | null => {
  if (!Number.isFinite(value.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value;
    const normalized = {
      year: toInteger(part("year")),
      month: toInteger(part("month")),
      day: toInteger(part("day")),
      hour: toInteger(part("hour")),
      minute: toInteger(part("minute")),
      second: toInteger(part("second")),
    };
    if (Object.values(normalized).some((entry) => entry === null)) return null;
    return normalized as ZonedDateTimeParts;
  } catch {
    return null;
  }
};

const dateKey = ({ year, month, day }: ZonedDateTimeParts) =>
  Date.UTC(year, month - 1, day);

const timeKey = ({ hour, minute, second }: ZonedDateTimeParts) =>
  hour * 60 * 60 + minute * 60 + second;

const isBusinessDate = (utcDateKey: number) => {
  const weekday = new Date(utcDateKey).getUTCDay();
  return weekday >= 1 && weekday <= 5;
};

/**
 * Counts completed Monday-Friday business-day anniversaries in one named
 * timezone. The local clock time is preserved, so Monday 10:00 reaches two
 * business days on Wednesday 10:00, not at midnight. Holidays are not inferred.
 */
export const refundBusinessDaysElapsed = ({
  startedAt,
  observedAt,
  timeZone,
}: {
  startedAt: Date;
  observedAt: Date;
  timeZone: string;
}) => {
  if (observedAt.getTime() < startedAt.getTime()) return 0;
  const start = getZonedDateTimeParts(startedAt, timeZone);
  const observed = getZonedDateTimeParts(observedAt, timeZone);
  if (!start || !observed) return 0;

  const startDate = dateKey(start);
  const observedDate = dateKey(observed);
  if (observedDate <= startDate) return 0;

  let elapsed = 0;
  for (
    let candidate = startDate + 24 * 60 * 60 * 1000;
    candidate <= observedDate;
    candidate += 24 * 60 * 60 * 1000
  ) {
    if (isBusinessDate(candidate)) elapsed += 1;
  }

  if (
    elapsed > 0 && isBusinessDate(observedDate) &&
    timeKey(observed) < timeKey(start)
  ) {
    elapsed -= 1;
  }
  return Math.max(0, elapsed);
};

const safeStatusLabels: Record<string, string> = {
  submitted: "New request ready for review",
  needs_review: "Manager review needed",
  correlated: "Transaction evidence ready for review",
  approved: "Approved case has a pending manager-owned step",
  card_refund_pending: "Card refund step is pending",
  cash_zelle_pending: "Cash refund step is pending",
};

const recommendedNextActions: Record<string, string> = {
  submitted:
    "Review the case evidence in the portal and choose the next safe step.",
  needs_review:
    "Review the case evidence in the portal and choose the next safe step.",
  correlated:
    "Review the matched evidence in the portal and make the manager decision.",
  approved:
    "Review the pending step in the portal; only the current mapped Machine Manager may perform an official action.",
  card_refund_pending:
    "Review the pending card-refund step in the portal; only the current mapped Machine Manager may perform it.",
  cash_zelle_pending:
    "Review the pending cash-refund step in the portal and record completion only after the manager performs the approved workflow.",
};

export const getRefundManagerSafeStatusLabel = (status: string) =>
  safeStatusLabels[status] ?? "Manager review needed";

export const getRefundManagerRecommendedNextAction = (status: string) =>
  recommendedNextActions[status] ??
    "Open the case in the portal and choose the next safe step.";

export const buildRefundManagerAgingNotice = ({
  milestone,
  publicReference,
  machineLabel,
  locationName,
  businessDayAge,
  status,
}: {
  milestone: RefundManagerAgingMilestone;
  publicReference: string;
  machineLabel: string;
  locationName: string;
  businessDayAge: number;
  status: string;
}) => {
  const age = Math.max(0, Math.floor(businessDayAge));
  const milestoneCopy = milestone === "escalation"
    ? "This refund case has been ready for manager attention for five business days and now needs prompt review."
    : "This refund case has been ready for manager attention for two business days.";
  return {
    subject: `${
      milestone === "escalation"
        ? "Refund case escalation"
        : "Refund case reminder"
    }: ${publicReference}`,
    summaryText: [
      milestoneCopy,
      "",
      `Reference: ${publicReference}`,
      `Machine: ${machineLabel}`,
      `Location: ${locationName}`,
      `Case age: ${age} business day${age === 1 ? "" : "s"}`,
      `Status: ${getRefundManagerSafeStatusLabel(status)}`,
      `Next step: ${getRefundManagerRecommendedNextAction(status)}`,
      "Only the current mapped Machine Manager may perform an official refund action in the portal.",
      "Opening the case link is navigation only. It does not approve, decline, complete, or send a refund.",
    ].join("\n"),
    templateVersion: REFUND_MANAGER_AGING_TEMPLATE_VERSION,
  };
};

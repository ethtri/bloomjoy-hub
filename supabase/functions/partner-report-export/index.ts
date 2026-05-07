import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildPartnerReportCsv,
  buildPartnerReportPdf,
  buildPartnerReportReference,
  buildPartnerReportXlsx,
  type PartnerReportExportContext,
  type PartnerReportPreview,
} from "../_shared/partner-report-export.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");
const exportBucket = "sales-report-exports";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validFormats = new Set(["pdf", "csv", "xlsx"]);
const validPeriodGrains = new Set(["reporting_week", "calendar_month"]);
const validPeriodModes = new Set([
  "weekly",
  "month_to_date",
  "completed_month",
]);

type PartnerReportPeriodGrain = "reporting_week" | "calendar_month";
type PartnerReportPeriodMode = "weekly" | "month_to_date" | "completed_month";
type PartnerReportExportFormat = "pdf" | "csv" | "xlsx";
type PartnerReportWarning = NonNullable<PartnerReportPreview["warnings"]>[number];

type PartnerPeriodPreviewRpc = {
  partnership_id?: string;
  partnership_name?: string;
  period_grain?: PartnerReportPeriodGrain;
  date_from?: string;
  date_to?: string;
  summary?: Record<string, unknown>;
  periods?: Array<Record<string, unknown>>;
  machine_periods?: Array<Record<string, unknown>>;
  warnings?: Array<{ message?: string; severity?: string; machine_id?: string | null }>;
};

type ExportRequest = {
  partnershipId: string;
  format: PartnerReportExportFormat;
  periodGrain: PartnerReportPeriodGrain;
  periodMode: PartnerReportPeriodMode;
  periodStartDate: string;
  periodEndDate: string;
  periodLabel: string;
  machineIds: string[];
  machineScopeKey: string;
  useLegacyWeeklyPreview: boolean;
};

type PartnerReportPeriod = NonNullable<PartnerReportPreview["periods"]>[number];
type PartnerReportMachine = NonNullable<PartnerReportPreview["machines"]>[number];

type PartnerReportScheduleRun = {
  id: string;
  schedule_id: string;
  partnership_id: string;
  period_grain: PartnerReportPeriodGrain;
  period_start_date: string;
  period_end_date: string;
  period_label: string;
  trigger_type: string;
  status: string;
  warning_gate_status: string;
};

type PartnerReportArtifact = {
  snapshotId: string;
  storagePath: string;
  signedUrl?: string;
  format: PartnerReportExportFormat;
  fileName: string;
  periodGrain: PartnerReportPeriodGrain;
  periodMode: PartnerReportPeriodMode;
  periodStartDate: string;
  periodEndDate: string;
  machineScopeLabel?: string;
  warnings: PartnerReportWarning[];
  generatedAt: string;
  reportReference: string;
};

const serviceSupabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  : null;

const encoder = new TextEncoder();

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const dateInputFromDate = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateFromInput = (value: string) =>
  new Date(`${value}T00:00:00.000Z`);

const addUtcDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const addUtcMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

const getWeekStartDate = (weekEndingDate: string) => {
  const date = new Date(`${weekEndingDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 6);
  return dateInputFromDate(date);
};

const formatMonthLabel = (dateInput: string) => {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateInput;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
};

const formatDateLabel = (dateInput: string) => {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateInput;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatPeriodLabel = (
  periodGrain: PartnerReportPeriodGrain,
  periodStartDate: string,
  periodEndDate: string,
  periodMode: PartnerReportPeriodMode = periodGrain === "calendar_month"
    ? "completed_month"
    : "weekly",
) => {
  if (periodMode === "month_to_date") {
    return `Month-to-date: ${formatDateLabel(periodStartDate)} through ${
      formatDateLabel(periodEndDate)
    }`;
  }

  if (
    periodGrain === "calendar_month" &&
    periodStartDate.slice(0, 7) === periodEndDate.slice(0, 7)
  ) {
    return formatMonthLabel(periodStartDate);
  }

  return `${periodStartDate} through ${periodEndDate}`;
};

const getTrendRange = (request: ExportRequest) => {
  const selectedStart = dateFromInput(request.periodStartDate);
  if (request.periodGrain === "calendar_month") {
    return {
      trendStartDate: dateInputFromDate(addUtcMonths(selectedStart, -5)),
      trendEndDate: request.periodEndDate,
    };
  }

  return {
    trendStartDate: dateInputFromDate(addUtcDays(selectedStart, -49)),
    trendEndDate: request.periodEndDate,
  };
};

const isValidDateInput = (value: string) => {
  if (!datePattern.test(value)) return false;

  const date = dateFromInput(value);
  return !Number.isNaN(date.getTime()) && dateInputFromDate(date) === value;
};

const isFirstDayOfMonth = (value: string) => value.endsWith("-01");

const isSameCalendarMonth = (left: string, right: string) =>
  left.slice(0, 7) === right.slice(0, 7);

const getMonthEndDate = (value: string) => {
  const date = dateFromInput(value);
  return dateInputFromDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
};

const normalizeUuidArray = (
  value: unknown,
): { machineIds: string[]; error?: string } => {
  if (value === undefined || value === null) return { machineIds: [] };

  if (!Array.isArray(value)) {
    return {
      machineIds: [],
      error: "machineIds must be an array of machine UUIDs.",
    };
  }

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return {
        machineIds: [],
        error: "machineIds must contain only machine UUID strings.",
      };
    }

    const machineId = entry.trim();
    if (!uuidPattern.test(machineId)) {
      return {
        machineIds: [],
        error: "machineIds must contain only valid machine UUIDs.",
      };
    }

    normalized.push(machineId);
  }

  return { machineIds: [...new Set(normalized)].sort() };
};

const getDefaultPeriodMode = (
  periodGrain: PartnerReportPeriodGrain,
): PartnerReportPeriodMode =>
  periodGrain === "calendar_month" ? "completed_month" : "weekly";

const normalizePeriodMode = (
  value: unknown,
  periodGrain: PartnerReportPeriodGrain,
): { periodMode: PartnerReportPeriodMode; error?: string } => {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!mode) return { periodMode: getDefaultPeriodMode(periodGrain) };
  if (!validPeriodModes.has(mode)) {
    return {
      periodMode: getDefaultPeriodMode(periodGrain),
      error: "periodMode must be weekly, month_to_date, or completed_month.",
    };
  }

  return { periodMode: mode as PartnerReportPeriodMode };
};

const getMachineScopeKey = (machineIds: string[]) =>
  machineIds.length > 0 ? `machines:${machineIds.join(",")}` : "all";

const resolveExportRequest = (
  raw: Record<string, unknown>,
): { request?: ExportRequest; error?: string } => {
  const partnershipId = String(raw.partnershipId ?? "").trim();
  const format = String(raw.format ?? "pdf").trim().toLowerCase();
  const rawPeriodGrain = String(raw.periodGrain ?? "").trim();
  const hasExplicitPeriod = rawPeriodGrain.length > 0;
  const periodGrain = hasExplicitPeriod ? rawPeriodGrain : "reporting_week";
  const { machineIds, error: machineIdsError } = normalizeUuidArray(
    raw.machineIds,
  );

  if (!uuidPattern.test(partnershipId)) {
    return { error: "Valid partnershipId is required." };
  }

  if (!validFormats.has(format)) {
    return { error: "format must be pdf, csv, or xlsx." };
  }

  if (machineIdsError) {
    return { error: machineIdsError };
  }

  if (!validPeriodGrains.has(periodGrain)) {
    return { error: "periodGrain must be reporting_week or calendar_month." };
  }

  if (hasExplicitPeriod) {
    const periodStartDate = String(raw.dateFrom ?? "").trim();
    const periodEndDate = String(raw.dateTo ?? "").trim();

    if (
      !isValidDateInput(periodStartDate) || !isValidDateInput(periodEndDate)
    ) {
      return { error: "Valid dateFrom and dateTo are required." };
    }

    if (periodStartDate > periodEndDate) {
      return { error: "dateFrom must be on or before dateTo." };
    }

    const normalizedPeriodGrain = periodGrain as PartnerReportPeriodGrain;
    const { periodMode, error: periodModeError } = normalizePeriodMode(
      raw.periodMode,
      normalizedPeriodGrain,
    );

    if (periodModeError) {
      return { error: periodModeError };
    }

    if (periodMode === "weekly" && normalizedPeriodGrain !== "reporting_week") {
      return { error: "weekly periodMode requires reporting_week periodGrain." };
    }

    if (
      (periodMode === "month_to_date" || periodMode === "completed_month") &&
      normalizedPeriodGrain !== "calendar_month"
    ) {
      return {
        error:
          "month_to_date and completed_month periodMode require calendar_month periodGrain.",
      };
    }

    if (periodMode === "month_to_date") {
      if (
        !isFirstDayOfMonth(periodStartDate) ||
        !isSameCalendarMonth(periodStartDate, periodEndDate)
      ) {
        return {
          error:
            "month_to_date periodMode requires dateFrom to be the first day of dateTo's month.",
        };
      }
    }

    if (periodMode === "completed_month") {
      if (
        !isFirstDayOfMonth(periodStartDate) ||
        !isSameCalendarMonth(periodStartDate, periodEndDate) ||
        periodEndDate !== getMonthEndDate(periodStartDate)
      ) {
        return {
          error:
            "completed_month periodMode requires dateFrom and dateTo to cover one full calendar month.",
        };
      }
    }

    return {
      request: {
        partnershipId,
        format: format as PartnerReportExportFormat,
        periodGrain: normalizedPeriodGrain,
        periodMode,
        periodStartDate,
        periodEndDate,
        periodLabel: formatPeriodLabel(
          normalizedPeriodGrain,
          periodStartDate,
          periodEndDate,
          periodMode,
        ),
        machineIds,
        machineScopeKey: getMachineScopeKey(machineIds),
        useLegacyWeeklyPreview: false,
      },
    };
  }

  const weekEndingDate = String(raw.weekEndingDate ?? "").trim();

  if (!datePattern.test(weekEndingDate)) {
    return { error: "Valid weekEndingDate is required." };
  }

  const periodStartDate = getWeekStartDate(weekEndingDate);

  return {
    request: {
      partnershipId,
      format: format as PartnerReportExportFormat,
      periodGrain: "reporting_week",
      periodMode: "weekly",
      periodStartDate,
      periodEndDate: weekEndingDate,
      periodLabel: formatPeriodLabel(
        "reporting_week",
        periodStartDate,
        weekEndingDate,
      ),
      machineIds: [],
      machineScopeKey: "all",
      useLegacyWeeklyPreview: true,
    },
  };
};

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "partner-report";

const formatSplitBaseLabel = (value: unknown) => {
  const splitBase = String(value ?? "net_sales").trim().toLowerCase();
  if (splitBase === "gross_sales") return "Gross sales after refunds";
  if (splitBase === "contribution_after_costs") {
    return "Contribution after configured costs";
  }
  return "Net sales";
};

const formatCalculationModelLabel = (value: unknown) => {
  const model = String(value ?? "net_split").trim().toLowerCase();
  if (model === "gross_split") return "Gross-sales share";
  if (model === "contribution_split") return "Contribution share";
  return "Net-sales share";
};

const numberValue = (value: unknown) => {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
};

const formatSharePercent = (basisPoints: unknown) => {
  const percent = numberValue(basisPoints) / 100;
  if (percent <= 0) return "";
  return Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2);
};

const formatCalculationLabel = (rule: Record<string, unknown> | null) => {
  if (!rule) {
    return "No active revenue-share rule covered this selected period.";
  }

  const feeAmount = Number(rule.fee_amount_cents ?? 0);
  const feeBasis = String(rule.fee_basis ?? "none");
  const feeLabel = String(rule.fee_label ?? "Stick cost deduction");
  const splitBaseLabel = formatSplitBaseLabel(rule.split_base);
  const calculationModelLabel = formatCalculationModelLabel(
    rule.calculation_model,
  );
  const splitBase = String(rule.split_base ?? "net_sales").trim().toLowerCase();
  const feeText = feeAmount > 0 && feeBasis === "per_stick"
    ? `$${
      (feeAmount / 100).toFixed(2)
    } ${feeLabel.toLowerCase()} per paid stick/item`
    : feeAmount > 0
    ? `$${(feeAmount / 100).toFixed(2)} ${feeLabel.toLowerCase()} (${
      feeBasis.replaceAll("_", " ")
    })`
    : "no configured deduction";
  const additionalNotes = String(rule.additional_deductions_notes ?? "").trim();
  const deductionText = splitBase === "gross_sales"
    ? `Machine taxes and ${feeText} are reported in the calculation detail, while the payout basis follows ${splitBaseLabel.toLowerCase()} under the active agreement.`
    : splitBase === "contribution_after_costs"
    ? `Gross sales are reduced by approved refunds, machine taxes, ${feeText}, and configured contribution costs before the payout basis.`
    : `Gross sales are reduced by approved refunds, machine taxes, and ${feeText} before the payout basis.`;

  return `${calculationModelLabel}: Partner Revenue Share is calculated from ${splitBaseLabel.toLowerCase()}. ${deductionText} No-pay transactions count in volume and contribute $0.${
    additionalNotes ? ` Additional notes: ${additionalNotes}` : ""
  } Approved refund adjustments reduce net sales and the selected revenue-share basis.`;
};

const getRuleExportLabels = (
  rule: Record<string, unknown> | null,
  { combineRecipientShares }: { combineRecipientShares: boolean },
) => {
  const partnerShareBasisPoints = rule
    ? combineRecipientShares
      ? numberValue(rule.fever_share_basis_points) +
        numberValue(rule.partner_share_basis_points)
      : numberValue(rule.fever_share_basis_points)
    : 0;

  return {
    feeLabel: String(rule?.fee_label ?? "Stick cost deduction"),
    costLabel: String(rule?.cost_label ?? "Costs"),
    splitBaseLabel: formatSplitBaseLabel(rule?.split_base),
    calculationModelLabel: formatCalculationModelLabel(rule?.calculation_model),
    partnerShareBasisPoints,
    partnerShareLabel: partnerShareBasisPoints > 0
      ? `${formatSharePercent(partnerShareBasisPoints)}%`
      : "",
    additionalDeductionsNotes: String(rule?.additional_deductions_notes ?? "")
      .trim() || null,
  };
};

const getBlockingWarnings = (preview: PartnerReportPreview) =>
  (preview.warnings ?? []).filter((warning) =>
    String(warning.severity ?? "blocking").toLowerCase() !== "non_blocking"
  );

const assertNoBlockingWarnings = (preview: PartnerReportPreview) => {
  const blockingWarnings = getBlockingWarnings(preview);
  if (blockingWarnings.length > 0) {
    throw new BlockingWarningsError(blockingWarnings);
  }
};

const getPayoutRecipientLabels = async (
  partnershipId: string,
): Promise<string[]> => {
  if (!serviceSupabase) return [];

  const { data: parties, error: partiesError } = await serviceSupabase
    .from("reporting_partnership_parties")
    .select("partner_id, party_role, created_at")
    .eq("partnership_id", partnershipId)
    .eq("party_role", "revenue_share_recipient")
    .order("created_at", { ascending: true });

  if (partiesError || !parties?.length) {
    return [];
  }

  const partnerIds = parties.map((party) => party.partner_id).filter(Boolean);
  const { data: partners, error: partnersError } = await serviceSupabase
    .from("reporting_partners")
    .select("id, name, legal_name")
    .in("id", partnerIds);

  if (partnersError || !partners?.length) {
    return [];
  }

  const partnerNameById = new Map(
    partners.map((partner) => [partner.id, partner.legal_name || partner.name]),
  );
  return parties
    .map((party) => partnerNameById.get(party.partner_id))
    .filter((name): name is string => Boolean(name));
};

const getActiveFinancialRule = async (
  partnershipId: string,
  periodStartDate: string,
  periodEndDate: string,
): Promise<Record<string, unknown> | null> => {
  if (!serviceSupabase) return null;

  const { data, error } = await serviceSupabase
    .from("reporting_partnership_financial_rules")
    .select("*")
    .eq("partnership_id", partnershipId)
    .eq("status", "active")
    .lte("effective_start_date", periodEndDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${periodStartDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load revenue-share rule.");
  }

  return data ?? null;
};

class MachineScopeError extends Error {
  status = 400;
}

class PreviewLoadError extends Error {
  status = 400;
}

class BlockingWarningsError extends Error {
  status = 409;
  warnings: PartnerReportWarning[];

  constructor(warnings: PartnerReportWarning[]) {
    super("Resolve blocking report review items before exporting this partner report.");
    this.warnings = warnings;
  }
}

class ScheduleRunValidationError extends Error {
  status = 400;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const getErrorStatus = (error: unknown) =>
  error instanceof MachineScopeError ||
    error instanceof PreviewLoadError ||
    error instanceof BlockingWarningsError ||
    error instanceof ScheduleRunValidationError
    ? error.status
    : 500;

const mapReportPeriod = (period: Record<string, unknown>): PartnerReportPeriod => ({
  period_start: String(period.period_start ?? ""),
  period_end: String(period.period_end ?? ""),
  order_count: Number(period.order_count ?? 0),
  item_quantity: Number(period.item_quantity ?? 0),
  gross_sales_cents: Number(period.gross_sales_cents ?? 0),
  refund_amount_cents: Number(period.refund_amount_cents ?? 0),
  tax_cents: Number(period.tax_cents ?? 0),
  fee_cents: Number(period.fee_cents ?? 0),
  cost_cents: Number(period.cost_cents ?? 0),
  net_sales_cents: Number(period.net_sales_cents ?? 0),
  split_base_cents: Number(period.split_base_cents ?? 0),
  amount_owed_cents: Number(period.amount_owed_cents ?? 0),
  bloomjoy_retained_cents: Number(period.bloomjoy_retained_cents ?? 0),
});

const mapReportPeriods = (
  data: PartnerPeriodPreviewRpc | null,
): PartnerReportPeriod[] =>
  (Array.isArray(data?.periods) ? data.periods : [])
    .map(mapReportPeriod)
    .filter((period) => period.period_start && period.period_end);

const mapReportMachine = (machine: Record<string, unknown>): PartnerReportMachine => ({
  reporting_machine_id: String(machine.reporting_machine_id ?? ""),
  period_start: String(machine.period_start ?? ""),
  period_end: String(machine.period_end ?? ""),
  machine_label: String(machine.machine_label ?? "Unnamed machine"),
  order_count: Number(machine.order_count ?? 0),
  item_quantity: Number(machine.item_quantity ?? 0),
  gross_sales_cents: Number(machine.gross_sales_cents ?? 0),
  refund_amount_cents: Number(machine.refund_amount_cents ?? 0),
  tax_cents: Number(machine.tax_cents ?? 0),
  fee_cents: Number(machine.fee_cents ?? 0),
  cost_cents: Number(machine.cost_cents ?? 0),
  net_sales_cents: Number(machine.net_sales_cents ?? 0),
  split_base_cents: Number(machine.split_base_cents ?? 0),
  amount_owed_cents: Number(machine.amount_owed_cents ?? 0),
  bloomjoy_retained_cents: Number(machine.bloomjoy_retained_cents ?? 0),
});

const mapReportMachines = (
  data: PartnerPeriodPreviewRpc | null,
): PartnerReportMachine[] =>
  (Array.isArray(data?.machine_periods) ? data.machine_periods : [])
    .map(mapReportMachine)
    .filter((machine) =>
      machine.reporting_machine_id && machine.period_start && machine.period_end
    );

const totalKeys = [
  "order_count",
  "item_quantity",
  "gross_sales_cents",
  "refund_amount_cents",
  "tax_cents",
  "fee_cents",
  "cost_cents",
  "net_sales_cents",
  "split_base_cents",
  "amount_owed_cents",
  "bloomjoy_retained_cents",
] as const;

const sumReportTotals = (
  records: Array<PartnerReportMachine | PartnerReportPeriod>,
): PartnerReportPeriod => {
  const totals = Object.fromEntries(totalKeys.map((key) => [key, 0])) as Record<
    typeof totalKeys[number],
    number
  >;

  records.forEach((record) => {
    totalKeys.forEach((key) => {
      totals[key] += Number(record[key] ?? 0);
    });
  });

  return totals;
};

const periodMatchesRequest = (
  period: Pick<PartnerReportPeriod, "period_start" | "period_end">,
  request: ExportRequest,
) => {
  if (request.periodMode === "month_to_date") {
    return period.period_start === request.periodStartDate;
  }

  return period.period_start === request.periodStartDate &&
    period.period_end === request.periodEndDate;
};

const normalizePeriodForRequest = <T extends PartnerReportPeriod | PartnerReportMachine>(
  period: T,
  request: ExportRequest,
): T => {
  if (
    request.periodMode !== "month_to_date" ||
    period.period_start !== request.periodStartDate
  ) {
    return period;
  }

  return {
    ...period,
    period_end: request.periodEndDate,
  };
};

const aggregateMachinePeriods = (
  machinePeriods: PartnerReportMachine[],
  machineIds: string[],
  request: ExportRequest,
): PartnerReportPeriod[] => {
  const scopedMachineIds = new Set(machineIds);
  const periodsByWindow = new Map<string, PartnerReportMachine[]>();

  machinePeriods
    .filter((period) => scopedMachineIds.has(period.reporting_machine_id ?? ""))
    .forEach((period) => {
      const normalized = normalizePeriodForRequest(period, request);
      const key = `${normalized.period_start ?? ""}:${normalized.period_end ?? ""}`;
      const periods = periodsByWindow.get(key) ?? [];
      periods.push(normalized);
      periodsByWindow.set(key, periods);
    });

  return [...periodsByWindow.values()]
    .map((periods) => ({
      period_start: periods[0]?.period_start ?? "",
      period_end: periods[0]?.period_end ?? "",
      ...sumReportTotals(periods),
    }))
    .filter((period) => period.period_start && period.period_end)
    .sort((left, right) =>
      String(left.period_start).localeCompare(String(right.period_start))
    );
};

const getMachineScopeLabel = (machines: PartnerReportMachine[]) => {
  const labels = [...new Set(
    machines
      .map((machine) => String(machine.machine_label ?? "").trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

  return labels.join(" + ");
};

const filterWarningsForMachineScope = (
  warnings: PartnerPeriodPreviewRpc["warnings"],
  machineIds: string[],
) => {
  if (!machineIds.length) return warnings ?? [];

  const scopedMachineIds = new Set(machineIds);
  return (warnings ?? []).filter((warning) =>
    !warning.machine_id || scopedMachineIds.has(String(warning.machine_id))
  );
};

const mapPeriodPreviewToPartnerReportPreview = (
  data: PartnerPeriodPreviewRpc | null,
  request: ExportRequest,
): PartnerReportPreview => {
  const summary = data?.summary ?? {};
  const reportMachinePeriods = mapReportMachines(data);
  const currentMachinePeriods = reportMachinePeriods
    .filter((period) => periodMatchesRequest(period, request))
    .map((period) => normalizePeriodForRequest(period, request));
  const requestedMachineIds = new Set(request.machineIds);

  if (request.machineIds.length > 0) {
    const availableMachineIds = new Set(
      currentMachinePeriods.map((period) => period.reporting_machine_id),
    );
    const missingMachineIds = request.machineIds.filter((machineId) =>
      !availableMachineIds.has(machineId)
    );

    if (missingMachineIds.length > 0) {
      throw new MachineScopeError(
        "Requested machine is not available for this partnership, period, or admin scope.",
      );
    }
  }

  const scopedMachinePeriods = request.machineIds.length > 0
    ? currentMachinePeriods.filter((period) =>
      requestedMachineIds.has(period.reporting_machine_id ?? "")
    )
    : currentMachinePeriods;
  const scopedPeriods = request.machineIds.length > 0
    ? aggregateMachinePeriods(reportMachinePeriods, request.machineIds, request)
    : mapReportPeriods(data).map((period) =>
      normalizePeriodForRequest(period, request)
    );
  const scopedSummary = request.machineIds.length > 0
    ? sumReportTotals(scopedMachinePeriods)
    : {
      order_count: Number(summary.order_count ?? 0),
      item_quantity: Number(summary.item_quantity ?? 0),
      gross_sales_cents: Number(summary.gross_sales_cents ?? 0),
      refund_amount_cents: Number(summary.refund_amount_cents ?? 0),
      tax_cents: Number(summary.tax_cents ?? 0),
      fee_cents: Number(summary.fee_cents ?? 0),
      cost_cents: Number(summary.cost_cents ?? 0),
      net_sales_cents: Number(summary.net_sales_cents ?? 0),
      split_base_cents: Number(summary.split_base_cents ?? 0),
      amount_owed_cents: Number(summary.amount_owed_cents ?? 0),
      bloomjoy_retained_cents: Number(summary.bloomjoy_retained_cents ?? 0),
    };

  return {
    partnershipId: String(data?.partnership_id ?? request.partnershipId),
    partnershipName: data?.partnership_name,
    periodGrain: request.periodGrain,
    periodMode: request.periodMode,
    periodStartDate: request.periodStartDate,
    periodEndDate: request.periodEndDate,
    periodLabel: request.periodLabel,
    machineScopeLabel: request.machineIds.length > 0
      ? getMachineScopeLabel(scopedMachinePeriods) || "Selected machine"
      : undefined,
    weekStartDate: request.periodGrain === "reporting_week"
      ? request.periodStartDate
      : undefined,
    weekEndingDate: request.periodGrain === "reporting_week"
      ? request.periodEndDate
      : undefined,
    summary: scopedSummary,
    periods: scopedPeriods,
    machines: scopedMachinePeriods,
    warnings: filterWarningsForMachineScope(data?.warnings, request.machineIds).map((warning) => ({
      message: warning.message,
      severity: warning.severity,
      machine_id: warning.machine_id ?? null,
    })),
  };
};

const loadTrendPeriods = async ({
  previewSupabase,
  periodPreviewRpcName,
  request,
}: {
  previewSupabase: SupabaseClient;
  periodPreviewRpcName: string;
  request: ExportRequest;
}): Promise<PartnerReportPeriod[]> => {
  const { trendStartDate, trendEndDate } = getTrendRange(request);
  const { data, error } = await previewSupabase.rpc(
    periodPreviewRpcName,
    {
      p_partnership_id: request.partnershipId,
      p_date_from: trendStartDate,
      p_date_to: trendEndDate,
      p_period_grain: request.periodGrain,
    },
  );

  if (error) {
    console.warn("partner-report-export trend preview unavailable", error);
    return [];
  }

  const previewData = (data ?? {}) as PartnerPeriodPreviewRpc;
  const expectedCount = request.periodGrain === "calendar_month" ? 6 : 8;
  const periods = request.machineIds.length > 0
    ? aggregateMachinePeriods(
      mapReportMachines(previewData),
      request.machineIds,
      request,
    )
    : mapReportPeriods(previewData).map((period) =>
      normalizePeriodForRequest(period, request)
    );

  return periods
    .filter((period) => period.period_end && period.period_end <= request.periodEndDate)
    .slice(-expectedCount);
};

const loadPartnerReportPreview = async ({
  previewSupabase,
  periodPreviewRpcName,
  request,
}: {
  previewSupabase: SupabaseClient;
  periodPreviewRpcName: string;
  request: ExportRequest;
}): Promise<PartnerReportPreview> => {
  const { data, error } = request.useLegacyWeeklyPreview
    ? await previewSupabase.rpc(
      "admin_preview_partner_weekly_report",
      {
        p_partnership_id: request.partnershipId,
        p_week_ending_date: request.periodEndDate,
      },
    )
    : await previewSupabase.rpc(
      periodPreviewRpcName,
      {
        p_partnership_id: request.partnershipId,
        p_date_from: request.periodStartDate,
        p_date_to: request.periodEndDate,
        p_period_grain: request.periodGrain,
      },
    );

  if (error) {
    throw new PreviewLoadError(
      error.message || "Unable to preview partner report.",
    );
  }

  return request.useLegacyWeeklyPreview
    ? ({
      ...((data ?? {}) as PartnerReportPreview),
      periodGrain: "reporting_week",
      periodMode: request.periodMode,
      periodStartDate: request.periodStartDate,
      periodEndDate: request.periodEndDate,
      periodLabel: request.periodLabel,
    } satisfies PartnerReportPreview)
    : mapPeriodPreviewToPartnerReportPreview(
      (data ?? {}) as PartnerPeriodPreviewRpc,
      request,
    );
};

const getOrCreateSnapshot = async ({
  partnershipId,
  periodGrain,
  periodStartDate,
  periodEndDate,
  machineScopeKey,
  userId,
  summaryJson,
}: {
  partnershipId: string;
  periodGrain: PartnerReportPeriodGrain;
  periodStartDate: string;
  periodEndDate: string;
  machineScopeKey: string;
  userId: string | null;
  summaryJson: Record<string, unknown>;
}) => {
  if (!serviceSupabase) {
    throw new Error("Partner report export is not configured.");
  }

  const { data: existing, error: existingError } = await serviceSupabase
    .from("partner_report_snapshots")
    .select("id, summary_json")
    .eq("partnership_id", partnershipId)
    .eq("period_grain", periodGrain)
    .eq("period_start_date", periodStartDate)
    .eq("period_end_date", periodEndDate)
    .eq("machine_scope_key", machineScopeKey)
    .eq("status", "draft")
    .maybeSingle();

  if (existingError) {
    throw new Error(
      existingError.message || "Unable to load partner report snapshot.",
    );
  }

  if (existing?.id) {
    const { data: updated, error: updateError } = await serviceSupabase
      .from("partner_report_snapshots")
      .update({
        generated_at: new Date().toISOString(),
        ...(userId ? { generated_by: userId } : {}),
        week_ending_date: periodEndDate,
        period_grain: periodGrain,
        period_start_date: periodStartDate,
        period_end_date: periodEndDate,
        machine_scope_key: machineScopeKey,
        summary_json: {
          ...((existing.summary_json as Record<string, unknown> | null) ?? {}),
          ...summaryJson,
        },
      })
      .eq("id", existing.id)
      .select("id, summary_json")
      .single();

    if (updateError || !updated) {
      throw new Error(
        updateError?.message || "Unable to update partner report snapshot.",
      );
    }

    return updated;
  }

  const { data: inserted, error: insertError } = await serviceSupabase
    .from("partner_report_snapshots")
    .insert({
      partnership_id: partnershipId,
      week_ending_date: periodEndDate,
      period_grain: periodGrain,
      period_start_date: periodStartDate,
      period_end_date: periodEndDate,
      machine_scope_key: machineScopeKey,
      status: "draft",
      generated_by: userId,
      summary_json: summaryJson,
    })
    .select("id, summary_json")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      insertError?.message || "Unable to create partner report snapshot.",
    );
  }

  return inserted;
};

const buildPartnerReportArtifact = async ({
  request,
  preview,
  previewSupabase,
  periodPreviewRpcName,
  actorUserId,
  createSignedUrl,
}: {
  request: ExportRequest;
  preview: PartnerReportPreview;
  previewSupabase: SupabaseClient;
  periodPreviewRpcName: string;
  actorUserId: string | null;
  createSignedUrl: boolean;
}): Promise<PartnerReportArtifact> => {
  if (!serviceSupabase) {
    throw new Error("Partner report export is not configured.");
  }

  assertNoBlockingWarnings(preview);

  const generatedAt = new Date().toISOString();
  const [payoutRecipientLabels, financialRule, trendPeriods] = await Promise.all([
    getPayoutRecipientLabels(request.partnershipId),
    getActiveFinancialRule(
      request.partnershipId,
      request.periodStartDate,
      request.periodEndDate,
    ),
    request.format === "pdf" || request.format === "xlsx" ||
      request.machineIds.length > 0
      ? loadTrendPeriods({ previewSupabase, periodPreviewRpcName, request })
      : Promise.resolve([]),
  ]);
  const calculationLabel = formatCalculationLabel(financialRule);
  const exportPayoutRecipientLabels = request.useLegacyWeeklyPreview
    ? payoutRecipientLabels
    : payoutRecipientLabels.length > 1
    ? [payoutRecipientLabels.join(" + ")]
    : payoutRecipientLabels;
  const ruleExportLabels = getRuleExportLabels(financialRule, {
    combineRecipientShares: !request.useLegacyWeeklyPreview,
  });
  const exportPreview = trendPeriods.length > 0
    ? { ...preview, periods: trendPeriods }
    : preview;
  const snapshot = await getOrCreateSnapshot({
    partnershipId: request.partnershipId,
    periodGrain: request.periodGrain,
    periodStartDate: request.periodStartDate,
    periodEndDate: request.periodEndDate,
    machineScopeKey: request.machineScopeKey,
    userId: actorUserId,
    summaryJson: {
      preview: exportPreview,
      calculationLabel,
      payoutRecipientLabels: exportPayoutRecipientLabels,
      ...ruleExportLabels,
      generatedAt,
      periodGrain: request.periodGrain,
      periodStartDate: request.periodStartDate,
      periodEndDate: request.periodEndDate,
      periodLabel: request.periodLabel,
      periodMode: request.periodMode,
      machineScopeKey: request.machineScopeKey,
      machineIds: request.machineIds,
      machineScopeLabel: exportPreview.machineScopeLabel,
    },
  });
  const reportReference = buildPartnerReportReference(snapshot.id, exportPreview);
  const context: PartnerReportExportContext = {
    preview: exportPreview,
    payoutRecipientLabels: exportPayoutRecipientLabels,
    calculationLabel,
    generatedAt,
    snapshotId: snapshot.id,
    ...ruleExportLabels,
  };
  const fileBytes = request.format === "pdf"
    ? await buildPartnerReportPdf(context)
    : request.format === "xlsx"
    ? buildPartnerReportXlsx(context)
    : encoder.encode(buildPartnerReportCsv(context));
  const contentType = request.format === "pdf"
    ? "application/pdf"
    : request.format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
  const periodSlug = request.periodGrain === "calendar_month"
    ? request.periodMode === "month_to_date"
      ? `${request.periodStartDate}-to-${request.periodEndDate}`
      : request.periodStartDate.slice(0, 7)
    : request.periodEndDate;
  const modeSlug = request.periodMode === "month_to_date"
    ? "month-to-date"
    : request.periodGrain === "calendar_month"
    ? "monthly"
    : "weekly";
  const machineSlug = request.machineIds.length > 0
    ? `-${slugify(exportPreview.machineScopeLabel ?? "selected-machine")}`
    : "";
  const fileName = `${slugify(exportPreview.partnershipName ?? "partner-report")}-${
    modeSlug
  }-${periodSlug}${machineSlug}.${request.format}`;
  const storagePath =
    `partner-reports/${request.partnershipId}/${request.periodGrain}/${snapshot.id}/${fileName}`;

  const { error: uploadError } = await serviceSupabase.storage
    .from(exportBucket)
    .upload(
      storagePath,
      new Blob([toBlobPart(fileBytes)], { type: contentType }),
      {
        contentType,
        upsert: true,
      },
    );

  if (uploadError) {
    if (
      (request.format === "csv" || request.format === "xlsx") &&
      uploadError.message?.toLowerCase().includes("mime")
    ) {
      throw new Error(
        request.format === "xlsx"
          ? "XLSX export storage is not configured. Apply the latest reporting export migration and retry."
          : "CSV export storage is not configured for text/csv. Apply the latest reporting export migration and retry.",
      );
    }
    throw new Error(
      uploadError.message || "Unable to upload partner report.",
    );
  }

  const nextSummaryJson = {
    ...((snapshot.summary_json as Record<string, unknown> | null) ?? {}),
    preview: exportPreview,
    calculationLabel,
    payoutRecipientLabels: exportPayoutRecipientLabels,
    snapshotId: snapshot.id,
    reportReference,
    ...ruleExportLabels,
    periodGrain: request.periodGrain,
    periodStartDate: request.periodStartDate,
    periodEndDate: request.periodEndDate,
    periodLabel: request.periodLabel,
    periodMode: request.periodMode,
    machineScopeKey: request.machineScopeKey,
    machineIds: request.machineIds,
    machineScopeLabel: exportPreview.machineScopeLabel,
    exports: {
      ...(((snapshot.summary_json as Record<string, unknown> | null)
        ?.exports as Record<string, unknown> | undefined) ?? {}),
      [request.format]: {
        storagePath,
        generatedAt,
        fileName,
      },
    },
  };

  const { error: snapshotUpdateError } = await serviceSupabase
    .from("partner_report_snapshots")
    .update({
      export_storage_path: storagePath,
      week_ending_date: request.periodEndDate,
      period_grain: request.periodGrain,
      period_start_date: request.periodStartDate,
      period_end_date: request.periodEndDate,
      machine_scope_key: request.machineScopeKey,
      summary_json: nextSummaryJson,
      generated_at: generatedAt,
    })
    .eq("id", snapshot.id);

  if (snapshotUpdateError) {
    throw new Error(
      snapshotUpdateError.message ||
        "Unable to update partner report snapshot.",
    );
  }

  let signedUrl: string | undefined;
  if (createSignedUrl) {
    const { data: signedUrlData, error: signedUrlError } = await serviceSupabase
      .storage
      .from(exportBucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(
        signedUrlError?.message || "Unable to sign partner report export.",
      );
    }

    signedUrl = signedUrlData.signedUrl;
  }

  return {
    snapshotId: snapshot.id,
    storagePath,
    signedUrl,
    format: request.format,
    fileName,
    periodGrain: request.periodGrain,
    periodMode: request.periodMode,
    periodStartDate: request.periodStartDate,
    periodEndDate: request.periodEndDate,
    machineScopeLabel: exportPreview.machineScopeLabel,
    warnings: exportPreview.warnings ?? [],
    generatedAt,
    reportReference,
  };
};

const scheduleRunToExportRequest = (
  run: PartnerReportScheduleRun,
): ExportRequest => {
  if (run.trigger_type === "dry_run") {
    throw new ScheduleRunValidationError(
      "Dry-run schedule records validate warnings only and do not generate PDF artifacts.",
    );
  }

  if (!validPeriodGrains.has(run.period_grain)) {
    throw new ScheduleRunValidationError(
      "Schedule run period grain is invalid.",
    );
  }

  if (
    !isValidDateInput(run.period_start_date) ||
    !isValidDateInput(run.period_end_date)
  ) {
    throw new ScheduleRunValidationError(
      "Schedule run date range is invalid.",
    );
  }

  const periodMode = getDefaultPeriodMode(run.period_grain);
  return {
    partnershipId: run.partnership_id,
    format: "pdf",
    periodGrain: run.period_grain,
    periodMode,
    periodStartDate: run.period_start_date,
    periodEndDate: run.period_end_date,
    periodLabel: run.period_label ||
      formatPeriodLabel(
        run.period_grain,
        run.period_start_date,
        run.period_end_date,
        periodMode,
      ),
    machineIds: [],
    machineScopeKey: "all",
    useLegacyWeeklyPreview: false,
  };
};

const updateScheduleRun = async (
  runId: string,
  values: Record<string, unknown>,
) => {
  if (!serviceSupabase) {
    throw new Error("Partner report export is not configured.");
  }

  const { data, error } = await serviceSupabase
    .from("partner_report_schedule_runs")
    .update(values)
    .eq("id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || "Unable to update partner report schedule run.",
    );
  }

  return data as PartnerReportScheduleRun;
};

const releaseScheduleRun = async (
  runId: string,
  workerKey: string,
  status: string,
  errorCode: string | null = null,
  errorMessage: string | null = null,
) => {
  if (!serviceSupabase) {
    throw new Error("Partner report export is not configured.");
  }

  const { data, error } = await serviceSupabase.rpc(
    "partner_report_schedule_release_run",
    {
      p_run_id: runId,
      p_worker_key: workerKey,
      p_status: status,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    },
  );

  if (error || !data) {
    throw new Error(
      error?.message || "Unable to release partner report schedule run.",
    );
  }

  return data as PartnerReportScheduleRun;
};

const getScheduleRunId = (raw: Record<string, unknown>) =>
  String(raw.scheduleRunId ?? raw.runId ?? "").trim();

const isScheduledPdfRequest = (raw: Record<string, unknown>) => {
  const mode = String(raw.mode ?? raw.action ?? "").trim().toLowerCase();
  return Boolean(getScheduleRunId(raw)) ||
    mode === "scheduled_pdf" ||
    mode === "generate_scheduled_pdf";
};

const handleScheduledPdfExport = async (
  req: Request,
  raw: Record<string, unknown>,
) => {
  if (!schedulerSecret) {
    return jsonResponse(
      { error: "REPORT_SCHEDULER_SECRET is not configured." },
      500,
    );
  }

  if (req.headers.get("Authorization") !== `Bearer ${schedulerSecret}`) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  if (!serviceSupabase) {
    return jsonResponse(
      { error: "Partner report export is not configured." },
      500,
    );
  }

  const scheduleRunId = getScheduleRunId(raw);
  if (!uuidPattern.test(scheduleRunId)) {
    return jsonResponse({ error: "Valid scheduleRunId is required." }, 400);
  }

  const workerKey = String(raw.workerKey ?? "partner-report-export").trim() ||
    "partner-report-export";

  const { data: claimedRunData, error: claimError } = await serviceSupabase.rpc(
    "partner_report_schedule_claim_run",
    {
      p_run_id: scheduleRunId,
      p_worker_key: workerKey,
      p_lease_seconds: 600,
    },
  );

  if (claimError || !claimedRunData) {
    return jsonResponse(
      {
        error: claimError?.message ||
          "Partner report schedule run is not claimable.",
      },
      409,
    );
  }

  const run = claimedRunData as PartnerReportScheduleRun;

  try {
    const request = scheduleRunToExportRequest(run);

    await updateScheduleRun(run.id, {
      status: "checking_warnings",
      warning_gate_status: "not_checked",
      warnings_json: [],
      error_code: null,
      error_message: null,
    });

    const preview = await loadPartnerReportPreview({
      previewSupabase: serviceSupabase,
      periodPreviewRpcName: "partner_report_scheduler_preview_partner_period_report",
      request,
    });
    const warnings = preview.warnings ?? [];
    const blockingWarnings = getBlockingWarnings(preview);

    if (blockingWarnings.length > 0) {
      await updateScheduleRun(run.id, {
        warning_gate_status: "blocked",
        warnings_json: warnings,
        snapshot_id: null,
        artifact_storage_path: null,
        artifact_format: null,
        artifact_generated_at: null,
      });
      await releaseScheduleRun(
        run.id,
        workerKey,
        "blocked",
        "blocking_warnings",
        "Resolve blocking report review items before scheduled PDF generation.",
      );

      return jsonResponse({
        runId: run.id,
        scheduleId: run.schedule_id,
        status: "blocked",
        warningGateStatus: "blocked",
        blockingWarningCount: blockingWarnings.length,
        warnings,
      });
    }

    await updateScheduleRun(run.id, {
      status: "generating",
      warning_gate_status: "passed",
      warnings_json: warnings,
      error_code: null,
      error_message: null,
    });

    const artifact = await buildPartnerReportArtifact({
      request,
      preview,
      previewSupabase: serviceSupabase,
      periodPreviewRpcName: "partner_report_scheduler_preview_partner_period_report",
      actorUserId: null,
      createSignedUrl: false,
    });

    await updateScheduleRun(run.id, {
      snapshot_id: artifact.snapshotId,
      artifact_storage_path: artifact.storagePath,
      artifact_format: "pdf",
      artifact_generated_at: artifact.generatedAt,
      warning_gate_status: "passed",
      warnings_json: artifact.warnings,
      error_code: null,
      error_message: null,
    });
    await releaseScheduleRun(run.id, workerKey, "artifact_ready");

    return jsonResponse({
      runId: run.id,
      scheduleId: run.schedule_id,
      status: "artifact_ready",
      warningGateStatus: "passed",
      snapshotId: artifact.snapshotId,
      storagePath: artifact.storagePath,
      format: artifact.format,
      fileName: artifact.fileName,
      periodGrain: artifact.periodGrain,
      periodMode: artifact.periodMode,
      periodStartDate: artifact.periodStartDate,
      periodEndDate: artifact.periodEndDate,
      machineScopeLabel: artifact.machineScopeLabel,
      warnings: artifact.warnings,
    });
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Unable to generate scheduled partner report PDF.",
    );

    try {
      await releaseScheduleRun(
        run.id,
        workerKey,
        "failed",
        error instanceof ScheduleRunValidationError
          ? "invalid_schedule_run"
          : "artifact_generation_failed",
        message,
      );
    } catch (releaseError) {
      console.error("partner-report-export schedule run release error", releaseError);
    }

    return jsonResponse(
      { runId: run.id, status: "failed", error: message },
      getErrorStatus(error),
    );
  }
};

const handleManualExport = async (
  req: Request,
  raw: Record<string, unknown>,
) => {
  if (!supabaseUrl || !supabaseAnonKey || !serviceSupabase) {
    return jsonResponse(
      { error: "Partner report export is not configured." },
      500,
    );
  }

  const accessToken = resolveSupabaseAccessToken(req);
  if (!accessToken) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { data: authData, error: authError } = await serviceSupabase.auth
    .getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { request, error: requestError } = resolveExportRequest(raw);

  if (!request) {
    return jsonResponse(
      { error: requestError ?? "Invalid export request." },
      400,
    );
  }

  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const preview = await loadPartnerReportPreview({
    previewSupabase: userSupabase,
    periodPreviewRpcName: "admin_preview_partner_period_report",
    request,
  });
  const artifact = await buildPartnerReportArtifact({
    request,
    preview,
    previewSupabase: userSupabase,
    periodPreviewRpcName: "admin_preview_partner_period_report",
    actorUserId: user.id,
    createSignedUrl: true,
  });

  return jsonResponse({
    snapshotId: artifact.snapshotId,
    storagePath: artifact.storagePath,
    signedUrl: artifact.signedUrl,
    format: artifact.format,
    fileName: artifact.fileName,
    periodGrain: artifact.periodGrain,
    periodMode: artifact.periodMode,
    periodStartDate: artifact.periodStartDate,
    periodEndDate: artifact.periodEndDate,
    machineScopeLabel: artifact.machineScopeLabel,
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const raw = body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};

    return isScheduledPdfRequest(raw)
      ? await handleScheduledPdfExport(req, raw)
      : await handleManualExport(req, raw);
  } catch (error) {
    console.error("partner-report-export error", error);
    return jsonResponse(
      {
        error: getErrorMessage(error, "Unable to export partner report."),
      },
      getErrorStatus(error),
    );
  }
});

import {
  PDFDocument,
  type PDFImage,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "https://esm.sh/pdf-lib@1.17.1";

type PartnerReportSummary = {
  order_count?: number;
  item_quantity?: number;
  gross_sales_cents?: number;
  refund_amount_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  cost_cents?: number;
  net_sales_cents?: number;
  split_base_cents?: number;
  amount_owed_cents?: number;
  bloomjoy_retained_cents?: number;
  fever_profit_cents?: number;
  partner_profit_cents?: number;
  bloomjoy_profit_cents?: number;
};

type PartnerReportMachine = {
  machine_label?: string;
  order_count?: number;
  item_quantity?: number;
  gross_sales_cents?: number;
  refund_amount_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  cost_cents?: number;
  net_sales_cents?: number;
  split_base_cents?: number;
  amount_owed_cents?: number;
  bloomjoy_retained_cents?: number;
};

type PartnerReportPeriod = PartnerReportSummary & {
  period_start?: string;
  period_end?: string;
};

type PartnerReportWarning = {
  message?: string;
  severity?: string;
};

export type PartnerReportPreview = {
  partnershipId?: string;
  partnershipName?: string;
  periodGrain?: "reporting_week" | "calendar_month";
  periodStartDate?: string;
  periodEndDate?: string;
  periodLabel?: string;
  weekStartDate?: string;
  weekEndingDate?: string;
  summary?: PartnerReportSummary;
  machines?: PartnerReportMachine[];
  periods?: PartnerReportPeriod[];
  warnings?: PartnerReportWarning[];
};

export type PartnerReportExportContext = {
  preview: PartnerReportPreview;
  payoutRecipientLabels: string[];
  calculationLabel: string;
  generatedAt: string;
  snapshotId: string;
  feeLabel?: string;
  costLabel?: string;
  splitBaseLabel?: string;
  calculationModelLabel?: string;
  partnerShareBasisPoints?: number;
  partnerShareLabel?: string;
  additionalDeductionsNotes?: string | null;
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type PdfAssets = {
  logo?: PDFImage;
};

type DrawTextOptions = {
  x: number;
  y: number;
  size?: number;
  font?: PDFFont;
  color?: RGB;
  maxWidth?: number;
  lineHeight?: number;
};

const COLORS = {
  page: rgb(0.995, 0.985, 0.99),
  white: rgb(1, 1, 1),
  ink: rgb(0.05, 0.08, 0.16),
  muted: rgb(0.35, 0.39, 0.48),
  softText: rgb(0.49, 0.53, 0.61),
  coral: rgb(0.88, 0.2, 0.42),
  coralDark: rgb(0.68, 0.12, 0.28),
  blush: rgb(0.99, 0.9, 0.94),
  blushLight: rgb(1, 0.96, 0.98),
  border: rgb(0.9, 0.86, 0.89),
  borderStrong: rgb(0.78, 0.78, 0.84),
  sage: rgb(0.25, 0.48, 0.34),
  sageLight: rgb(0.9, 0.96, 0.92),
  amber: rgb(0.9, 0.54, 0.1),
  amberLight: rgb(1, 0.95, 0.86),
  slatePanel: rgb(0.12, 0.15, 0.22),
  slateSoft: rgb(0.2, 0.23, 0.31),
};

const BLOOMJOY_LOGO_PNG_BASE64 =
  "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";

const BLOOMJOY_LOGO_SAFE_PNG_BASE64 =
  "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";

const BLOOMJOY_LOGO_ASSET_BASE64 =
  BLOOMJOY_LOGO_SAFE_PNG_BASE64 || BLOOMJOY_LOGO_PNG_BASE64;

const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));


const csvCell = (value: unknown): string => {
  const text = neutralizeProviderCopy(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvRow = (values: unknown[]) => values.map(csvCell).join(",");

const neutralizeProviderCopy = (value: unknown): string =>
  String(value ?? "")
    .replace(/sunze-sales-ingest/gi, "sales import endpoint")
    .replace(/sunze-sales-sync/gi, "sales import workflow")
    .replace(/sunze-orders/gi, "provider import")
    .replace(/sunze_browser/gi, "sales import")
    .replace(/\bsunze-[a-z0-9-]+\b/gi, "sales source")
    .replace(/\b[a-z0-9_]*sunze[a-z0-9_]*\b/gi, "sales source")
    .replace(/\bSunze\b/gi, "sales source");

const toAscii = (value: unknown): string =>
  neutralizeProviderCopy(value)
    .normalize("NFKD")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();

const numberValue = (value: unknown): number => {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
};

const formatCurrency = (cents: unknown): string =>
  `$${
    (Math.round(numberValue(cents)) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;

const formatCompactCurrency = (cents: unknown): string => {
  const dollars = Math.round(numberValue(cents)) / 100;
  const absolute = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}k`;
  return `${sign}$${absolute.toFixed(0)}`;
};

const formatDeduction = (cents: unknown): string => {
  const amount = numberValue(cents);
  return amount > 0 ? `-${formatCurrency(amount)}` : formatCurrency(0);
};

const formatInteger = (value: unknown): string =>
  Math.round(numberValue(value)).toLocaleString("en-US");

const formatGeneratedAt = (value: unknown): string => {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return toAscii(value);

  return toAscii(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date));
};

const formatPreparedAt = (value: unknown): string =>
  `Prepared ${formatGeneratedAt(value)}`;

const formatDateLong = (value: unknown): string => {
  const date = new Date(`${String(value ?? "")}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return toAscii(value);

  return toAscii(new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date));
};

const formatDateShort = (value: unknown): string => {
  const date = new Date(`${String(value ?? "")}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return toAscii(value);

  return toAscii(new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date));
};

const getPartnerPayoutLabel = (labels: string[]) =>
  labels[0] ?? "Partner payout";

const getReportTitle = (preview: PartnerReportPreview) =>
  preview.periodGrain === "calendar_month"
    ? "Bloomjoy Partner Monthly Report"
    : "Bloomjoy Partner Weekly Report";

const getPeriodKindLabel = (preview: PartnerReportPreview) =>
  preview.periodGrain === "calendar_month"
    ? "Selected reporting month"
    : "Selected reporting week";

const getReportPeriodLabel = (preview: PartnerReportPreview) =>
  preview.periodLabel ??
    (preview.periodStartDate && preview.periodEndDate
      ? `${preview.periodStartDate} through ${preview.periodEndDate}`
      : `${preview.weekStartDate ?? ""} through ${
        preview.weekEndingDate ?? ""
      }`);

const getFriendlyPeriodLabel = (preview: PartnerReportPreview) => {
  if (!preview.periodStartDate || !preview.periodEndDate) {
    return getReportPeriodLabel(preview);
  }

  if (
    preview.periodGrain === "calendar_month" &&
    preview.periodStartDate.slice(0, 7) === preview.periodEndDate.slice(0, 7)
  ) {
    const date = new Date(`${preview.periodStartDate}T00:00:00.000Z`);
    return toAscii(new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(date));
  }

  return `${formatDateLong(preview.periodStartDate)} - ${
    formatDateLong(preview.periodEndDate)
  }`;
};

const getTrendPeriods = (preview: PartnerReportPreview): PartnerReportPeriod[] =>
  [...(preview.periods ?? [])]
    .filter((period) => period.period_start && period.period_end)
    .sort((left, right) =>
      String(left.period_start).localeCompare(String(right.period_start))
    );

const findSelectedTrendPeriod = (
  preview: PartnerReportPreview,
): PartnerReportPeriod | undefined => {
  const periods = getTrendPeriods(preview);
  return periods.find((period) =>
    period.period_start === preview.periodStartDate &&
    period.period_end === preview.periodEndDate
  ) ?? periods[periods.length - 1];
};

const findPreviousTrendPeriod = (
  preview: PartnerReportPreview,
): PartnerReportPeriod | undefined => {
  const periods = getTrendPeriods(preview);
  const selectedIndex = periods.findIndex((period) =>
    period.period_start === preview.periodStartDate &&
    period.period_end === preview.periodEndDate
  );
  if (selectedIndex > 0) return periods[selectedIndex - 1];
  return periods.length > 1 ? periods[periods.length - 2] : undefined;
};

const formatPercentChangeValue = (current: unknown, previous: unknown): string => {
  const currentValue = numberValue(current);
  const previousValue = numberValue(previous);
  if (previousValue === 0) {
    return currentValue > 0 ? "new activity" : "no change";
  }

  const change = ((currentValue - previousValue) / previousValue) * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
};

const formatSignedCurrencyChange = (current: unknown, previous: unknown): string => {
  const delta = numberValue(current) - numberValue(previous);
  const formatted = formatCurrency(Math.abs(delta));
  if (delta > 0) return `+${formatted}`;
  if (delta < 0) return `-${formatted}`;
  return "$0.00";
};

const formatPriorPeriodHeroLine = (
  current: unknown,
  previous: unknown,
): string => {
  if (typeof previous === "undefined") {
    return "No prior period comparison available";
  }

  return `Prior period ${formatCurrency(previous)}; change ${
    formatSignedCurrencyChange(current, previous)
  } (${formatPercentChangeValue(current, previous)})`;
};

const formatTrendMetricLine = (
  label: string,
  current: unknown,
  previous: unknown,
): string => {
  if (typeof previous === "undefined") {
    return `${label}: ${formatCurrency(current)} for the selected period`;
  }

  return `${label}: ${formatCurrency(current)} vs ${
    formatCurrency(previous)
  } prior (${formatSignedCurrencyChange(current, previous)}, ${
    formatPercentChangeValue(current, previous)
  })`;
};

const formatBasisPointsPercent = (basisPoints: unknown): string => {
  const value = numberValue(basisPoints);
  if (value <= 0) return "";
  const percent = value / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
};

const getPartnerShareLabel = (context: PartnerReportExportContext): string =>
  context.partnerShareLabel ?? formatBasisPointsPercent(context.partnerShareBasisPoints);

const formatUnitsSoldDetail = (summary: PartnerReportSummary): string => {
  const units = numberValue(summary.item_quantity);
  if (units > 0) return `${formatInteger(units)} units sold`;
  return `${formatInteger(summary.order_count)} transactions`;
};

const getSplitBaseKind = (splitBaseLabel: string): "gross" | "contribution" | "net" => {
  const normalized = splitBaseLabel.toLowerCase();
  if (normalized.includes("gross sales")) return "gross";
  if (normalized.includes("contribution")) return "contribution";
  return "net";
};

const formatTrendPeriodLabel = (
  period: PartnerReportPeriod,
  preview: PartnerReportPreview,
): string => {
  if (preview.periodGrain === "calendar_month" && period.period_start) {
    const date = new Date(`${period.period_start}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) {
      return toAscii(new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
      }).format(date));
    }
  }

  return formatDateShort(period.period_end ?? period.period_start);
};

const hasCombinedPartnerPayout = (summary: PartnerReportSummary) =>
  typeof summary.amount_owed_cents !== "undefined";

const getPrimaryPartnerPayoutCents = (summary: PartnerReportSummary) =>
  hasCombinedPartnerPayout(summary)
    ? summary.amount_owed_cents
    : summary.fever_profit_cents;

const getBloomjoyRetainedCents = (summary: PartnerReportSummary) =>
  typeof summary.bloomjoy_retained_cents !== "undefined"
    ? summary.bloomjoy_retained_cents
    : summary.bloomjoy_profit_cents;

const getMachinePartnerPayoutCents = (machine: PartnerReportMachine) =>
  typeof machine.amount_owed_cents !== "undefined"
    ? machine.amount_owed_cents
    : 0;

const getMachineBloomjoyRetainedCents = (machine: PartnerReportMachine) =>
  typeof machine.bloomjoy_retained_cents !== "undefined"
    ? machine.bloomjoy_retained_cents
    : 0;

export const buildPartnerReportReference = (
  snapshotId: string,
  preview: PartnerReportPreview,
) => {
  const periodPrefix = preview.periodGrain === "calendar_month" ? "M" : "W";
  const periodEnd = toAscii(preview.periodEndDate ?? preview.weekEndingDate)
    .replaceAll("-", "")
    .slice(0, 8) || "PERIOD";
  const shortId = toAscii(snapshotId).replaceAll("-", "").slice(0, 8)
    .toUpperCase() || "REPORT";

  return `BJ-${periodPrefix}-${periodEnd}-${shortId}`;
};

export const buildPartnerReportCsv = ({
  preview,
  payoutRecipientLabels,
  calculationLabel,
  generatedAt,
  snapshotId,
  feeLabel = "Stick cost deduction",
  costLabel = "Costs",
  additionalDeductionsNotes,
}: PartnerReportExportContext): string => {
  const summary = preview.summary ?? {};
  const generatedAtLabel = formatGeneratedAt(generatedAt);
  const reportTitle = getReportTitle(preview);
  const periodLabel = getReportPeriodLabel(preview);
  const rows = [
    csvRow([reportTitle]),
    csvRow(["Partnership", preview.partnershipName ?? ""]),
    csvRow(["Period", periodLabel]),
    csvRow(["Generated", generatedAtLabel]),
    csvRow(["Snapshot ID", snapshotId]),
    csvRow(["Calculation", calculationLabel]),
    ...(additionalDeductionsNotes
      ? [csvRow(["Deduction notes", additionalDeductionsNotes])]
      : []),
    "",
    csvRow(["Summary"]),
    csvRow(["Metric", "Value"]),
    csvRow(["Orders", formatInteger(summary.order_count)]),
    csvRow(["Sticks/items", formatInteger(summary.item_quantity)]),
    csvRow(["Gross sales", formatCurrency(summary.gross_sales_cents)]),
    csvRow(["Refund impact", `-${formatCurrency(summary.refund_amount_cents)}`]),
    csvRow(["Machine taxes", formatCurrency(summary.tax_cents)]),
    csvRow([feeLabel, formatCurrency(summary.fee_cents)]),
    csvRow([costLabel, formatCurrency(summary.cost_cents)]),
    csvRow(["Net sales", formatCurrency(summary.net_sales_cents)]),
    csvRow([
      getPartnerPayoutLabel(payoutRecipientLabels),
      formatCurrency(getPrimaryPartnerPayoutCents(summary)),
    ]),
    ...(!hasCombinedPartnerPayout(summary) && payoutRecipientLabels[1]
      ? [
        csvRow([
          payoutRecipientLabels[1],
          formatCurrency(summary.partner_profit_cents),
        ]),
      ]
      : []),
    csvRow([
      "Bloomjoy retained",
      formatCurrency(getBloomjoyRetainedCents(summary)),
    ]),
    "",
    csvRow(["Machine Rollup"]),
    csvRow([
      "Machine",
      "Orders",
      "Sticks/items",
      "Gross sales",
      "Refund impact",
      "Machine taxes",
      feeLabel,
      costLabel,
      "Net sales",
    ]),
    ...((preview.machines ?? []).map((machine) =>
      csvRow([
        machine.machine_label ?? "",
        formatInteger(machine.order_count),
        formatInteger(machine.item_quantity),
        formatCurrency(machine.gross_sales_cents),
        `-${formatCurrency(machine.refund_amount_cents)}`,
        formatCurrency(machine.tax_cents),
        formatCurrency(machine.fee_cents),
        formatCurrency(machine.cost_cents),
        formatCurrency(machine.net_sales_cents),
      ])
    )),
  ];

  const warnings = preview.warnings ?? [];
  if (warnings.length > 0) {
    rows.push("", csvRow(["Warnings"]));
    warnings.forEach((warning) => rows.push(csvRow([warning.message ?? ""])));
  }

  return `${rows.join("\n")}\n`;
};

const drawText = (
  page: PDFPage,
  fonts: PdfFonts,
  text: unknown,
  {
    x,
    y,
    size = 9,
    font = fonts.regular,
    color = COLORS.ink,
    maxWidth,
    lineHeight = size + 3,
  }: DrawTextOptions,
) => {
  const lines = maxWidth
    ? wrapTextToWidth(text, font, size, maxWidth)
    : [toAscii(text)];

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });

  return y - Math.max(lines.length - 1, 0) * lineHeight;
};

const wrapTextToWidth = (
  value: unknown,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const text = toAscii(value);
  if (!text) return [""];

  const lines: string[] = [];
  let current = "";

  text.split(/\s+/).forEach((word) => {
    const chunks: string[] = [];
    let chunk = "";

    Array.from(word).forEach((character) => {
      const nextChunk = `${chunk}${character}`;
      if (font.widthOfTextAtSize(nextChunk, size) <= maxWidth || !chunk) {
        chunk = nextChunk;
        return;
      }
      chunks.push(chunk);
      chunk = character;
    });
    if (chunk) chunks.push(chunk);

    chunks.forEach((part) => {
      const candidate = current ? `${current} ${part}` : part;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        return;
      }

      if (current) lines.push(current);
      current = part;
    });
  });

  if (current) lines.push(current);
  return lines;
};

const drawRightAlignedText = (
  page: PDFPage,
  font: PDFFont,
  text: unknown,
  xRight: number,
  y: number,
  size: number,
  color = COLORS.ink,
) => {
  const normalized = toAscii(text);
  page.drawText(normalized, {
    x: xRight - font.widthOfTextAtSize(normalized, size),
    y,
    size,
    font,
    color,
  });
};

const drawCenteredText = (
  page: PDFPage,
  font: PDFFont,
  text: unknown,
  centerX: number,
  y: number,
  size: number,
  color = COLORS.ink,
) => {
  const normalized = toAscii(text);
  page.drawText(normalized, {
    x: centerX - font.widthOfTextAtSize(normalized, size) / 2,
    y,
    size,
    font,
    color,
  });
};

const drawCard = (
  page: PDFPage,
  fonts: PdfFonts,
  {
    x,
    y,
    width,
    height,
    label,
    value,
    detail,
    emphasis = false,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    value: string;
    detail?: string;
    emphasis?: boolean;
  },
) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: emphasis ? COLORS.slatePanel : COLORS.white,
    borderColor: emphasis ? COLORS.slatePanel : COLORS.border,
    borderWidth: 0.7,
  });
  page.drawRectangle({
    x,
    y: y + height - 4,
    width,
    height: 4,
    color: emphasis ? COLORS.coral : COLORS.blush,
  });

  drawText(page, fonts, label.toUpperCase(), {
    x: x + 14,
    y: y + height - 20,
    size: 7.5,
    font: fonts.bold,
    color: emphasis ? COLORS.blush : COLORS.muted,
    maxWidth: width - 28,
  });
  drawText(page, fonts, value, {
    x: x + 14,
    y: y + height - 44,
    size: emphasis ? 18 : 14,
    font: fonts.bold,
    color: emphasis ? COLORS.white : COLORS.ink,
    maxWidth: width - 28,
  });
  if (detail) {
    drawText(page, fonts, detail, {
      x: x + 14,
      y: y + 14,
      size: 7.5,
      color: emphasis ? rgb(0.84, 0.87, 0.92) : COLORS.softText,
      maxWidth: width - 28,
      lineHeight: 9,
    });
  }
};

const drawHeader = (
  page: PDFPage,
  fonts: PdfFonts,
  assets: PdfAssets,
  {
    title,
    partnerName,
    periodLabel,
    reportReference,
    generatedAt,
  }: {
    title: string;
    partnerName: string;
    periodLabel: string;
    reportReference: string;
    generatedAt: string;
  },
) => {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.page });
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: COLORS.coral });
  if (assets.logo) {
    page.drawImage(assets.logo, {
      x: 40,
      y: height - 59,
      width: 34,
      height: 34,
    });
  } else {
    page.drawCircle({ x: 57, y: height - 42, size: 13, color: COLORS.coral });
  }
  drawText(page, fonts, "BLOOMJOY", {
    x: 82,
    y: height - 36,
    size: 10,
    font: fonts.bold,
    color: COLORS.ink,
  });
  drawText(page, fonts, title, {
    x: 82,
    y: height - 51,
    size: 8,
    color: COLORS.muted,
  });
  drawRightAlignedText(page, fonts.bold, reportReference, width - 42, height - 35, 8, COLORS.ink);
  drawRightAlignedText(page, fonts.regular, generatedAt, width - 42, height - 50, 7.5, COLORS.muted);

  page.drawLine({
    start: { x: 42, y: height - 72 },
    end: { x: width - 42, y: height - 72 },
    thickness: 0.6,
    color: COLORS.border,
  });

  drawText(page, fonts, partnerName, {
    x: 42,
    y: height - 96,
    size: 19,
    font: fonts.bold,
    color: COLORS.ink,
    maxWidth: width - 84,
    lineHeight: 21,
  });
  drawText(page, fonts, periodLabel, {
    x: 42,
    y: height - 118,
    size: 9,
    color: COLORS.muted,
    maxWidth: width - 84,
  });
};

const drawFooter = (
  page: PDFPage,
  fonts: PdfFonts,
  reportReference: string,
  pageNumber: number,
  pageCount: number,
) => {
  const { width } = page.getSize();
  page.drawLine({
    start: { x: 36, y: 32 },
    end: { x: width - 36, y: 32 },
    thickness: 0.5,
    color: COLORS.border,
  });
  drawText(page, fonts, `Report reference ${reportReference}`, {
    x: 36,
    y: 18,
    size: 7,
    color: COLORS.softText,
  });
  drawRightAlignedText(
    page,
    fonts.regular,
    `Page ${pageNumber} of ${pageCount}`,
    width - 36,
    18,
    7,
    COLORS.softText,
  );
};

const drawBridgeSegment = (
  page: PDFPage,
  fonts: PdfFonts,
  {
    x,
    y,
    width,
    label,
    value,
    color,
  }: {
    x: number;
    y: number;
    width: number;
    label: string;
    value: string;
    color: RGB;
  },
) => {
  const safeWidth = Math.max(width, 8);
  page.drawRectangle({ x, y, width: safeWidth, height: 13, color });
  drawText(page, fonts, label, {
    x,
    y: y - 12,
    size: 7,
    font: fonts.bold,
    color: COLORS.muted,
    maxWidth: Math.max(safeWidth + 28, 70),
    lineHeight: 8,
  });
  drawText(page, fonts, value, {
    x,
    y: y - 30,
    size: 8,
    font: fonts.bold,
    color: COLORS.ink,
    maxWidth: Math.max(safeWidth + 28, 70),
  });
};

const drawTrendPanel = (
  page: PDFPage,
  fonts: PdfFonts,
  preview: PartnerReportPreview,
  {
    x,
    y,
    width,
    height,
  }: { x: number; y: number; width: number; height: number },
) => {
  const periods = getTrendPeriods(preview);
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });

  drawText(page, fonts, "Trend over time", {
    x: x + 16,
    y: y + height - 22,
    size: 11,
    font: fonts.bold,
  });

  if (periods.length < 2) {
    drawText(page, fonts, "No prior period data available for this selected report period.", {
      x: x + 16,
      y: y + height - 48,
      size: 8.5,
      color: COLORS.muted,
      maxWidth: width - 32,
    });
    return;
  }

  const selected = findSelectedTrendPeriod(preview);
  const previous = findPreviousTrendPeriod(preview);
  const selectedNetSales = selected?.net_sales_cents;
  const previousNetSales = previous?.net_sales_cents;
  drawText(page, fonts, formatTrendMetricLine("Net sales", selectedNetSales, previousNetSales), {
    x: x + 16,
    y: y + height - 39,
    size: 7.5,
    color: COLORS.muted,
    maxWidth: width - 190,
    lineHeight: 9,
  });

  const chartX = x + 20;
  const chartY = y + 24;
  const chartHeight = 34;
  const chartWidth = width - 40;
  const maxNetValue = Math.max(
    ...periods.map((period) => numberValue(period.net_sales_cents)),
    1,
  );
  const gap = Math.max(periods.length > 1 ? 8 : 0, 0);
  const slotWidth = (chartWidth - gap * (periods.length - 1)) / periods.length;
  const barWidth = Math.min(34, Math.max(16, slotWidth * 0.66));

  page.drawLine({
    start: { x: chartX, y: chartY },
    end: { x: chartX + chartWidth, y: chartY },
    thickness: 0.5,
    color: COLORS.border,
  });

  periods.forEach((period, index) => {
    const slotX = chartX + index * (slotWidth + gap);
    const barX = slotX + (slotWidth - barWidth) / 2;
    const isSelected = period.period_start === preview.periodStartDate &&
      period.period_end === preview.periodEndDate;
    const netHeight = Math.max(
      (numberValue(period.net_sales_cents) / maxNetValue) * chartHeight,
      numberValue(period.net_sales_cents) > 0 ? 3 : 0,
    );

    page.drawRectangle({
      x: barX,
      y: chartY,
      width: barWidth,
      height: netHeight,
      color: isSelected ? COLORS.sage : COLORS.sageLight,
      borderColor: isSelected ? COLORS.sage : COLORS.border,
      borderWidth: 0.35,
    });
    drawCenteredText(
      page,
      isSelected ? fonts.bold : fonts.regular,
      formatCompactCurrency(period.net_sales_cents),
      barX + barWidth / 2,
      chartY + netHeight + 5,
      6.4,
      isSelected ? COLORS.ink : COLORS.muted,
    );
    drawText(page, fonts, formatTrendPeriodLabel(period, preview), {
      x: slotX,
      y: y + 14,
      size: 6.5,
      color: isSelected ? COLORS.ink : COLORS.softText,
      font: isSelected ? fonts.bold : fonts.regular,
      maxWidth: slotWidth,
    });
  });

  page.drawRectangle({ x: x + width - 96, y: y + height - 24, width: 8, height: 8, color: COLORS.sage });
  drawText(page, fonts, "Net sales", {
    x: x + width - 84,
    y: y + height - 23,
    size: 7,
    color: COLORS.muted,
  });
};

const drawDashboardPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  assets: PdfAssets,
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const {
    preview,
    generatedAt,
    feeLabel = "Stick cost deduction",
    costLabel = "Costs",
    splitBaseLabel = "Net sales",
  } = context;
  const summary = preview.summary ?? {};
  const page = pdfDoc.addPage([612, 792]);
  const partnerName = toAscii(preview.partnershipName ?? "Partner report");
  const periodLabel = getFriendlyPeriodLabel(preview);
  const generatedAtLabel = formatPreparedAt(generatedAt);
  const netSalesCents = numberValue(summary.net_sales_cents);
  const payoutCents = numberValue(getPrimaryPartnerPayoutCents(summary));
  const previousPeriod = findPreviousTrendPeriod(preview);
  const netSalesMovement = formatPriorPeriodHeroLine(
    netSalesCents,
    previousPeriod?.net_sales_cents,
  );
  const payoutMovement = formatPriorPeriodHeroLine(
    payoutCents,
    previousPeriod ? getPrimaryPartnerPayoutCents(previousPeriod) : undefined,
  );
  const taxAndDeductions = numberValue(summary.tax_cents) +
    numberValue(summary.fee_cents) +
    numberValue(summary.cost_cents);
  const splitBaseKind = getSplitBaseKind(splitBaseLabel);

  drawHeader(page, fonts, assets, {
    title: getReportTitle(preview),
    partnerName,
    periodLabel: `${getPeriodKindLabel(preview)}: ${periodLabel}`,
    reportReference,
    generatedAt: generatedAtLabel,
  });

  page.drawRectangle({ x: 42, y: 514, width: 528, height: 140, color: COLORS.slatePanel });
  page.drawRectangle({ x: 42, y: 514, width: 6, height: 140, color: COLORS.coral });
  drawText(page, fonts, "Net sales", {
    x: 68,
    y: 624,
    size: 10,
    font: fonts.bold,
    color: rgb(0.86, 0.88, 0.93),
  });
  drawText(page, fonts, formatCurrency(netSalesCents), {
    x: 68,
    y: 585,
    size: 29,
    font: fonts.bold,
    color: COLORS.white,
    maxWidth: 178,
  });
  drawText(page, fonts, netSalesMovement, {
    x: 68,
    y: 552,
    size: 8,
    color: rgb(0.86, 0.88, 0.93),
    maxWidth: 178,
    lineHeight: 10,
  });
  drawText(page, fonts, "Amount owed", {
    x: 328,
    y: 624,
    size: 10,
    font: fonts.bold,
    color: rgb(0.86, 0.88, 0.93),
  });
  drawText(page, fonts, formatCurrency(payoutCents), {
    x: 328,
    y: 585,
    size: 29,
    font: fonts.bold,
    color: COLORS.white,
    maxWidth: 178,
  });
  drawText(page, fonts, payoutMovement, {
    x: 328,
    y: 552,
    size: 8,
    color: rgb(0.86, 0.88, 0.93),
    maxWidth: 178,
    lineHeight: 10,
  });
  const cardY = 404;
  const cardGap = 10;
  const cardWidth = (528 - cardGap * 3) / 4;
  drawCard(page, fonts, {
    x: 42,
    y: cardY,
    width: cardWidth,
    height: 82,
    label: "Gross sales",
    value: formatCurrency(summary.gross_sales_cents),
    detail: formatUnitsSoldDetail(summary),
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap),
    y: cardY,
    width: cardWidth,
    height: 82,
    label: "Refund impact",
    value: formatDeduction(summary.refund_amount_cents),
    detail: "Approved adjustments only",
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap) * 2,
    y: cardY,
    width: cardWidth,
    height: 82,
    label: "Net sales",
    value: formatCurrency(summary.net_sales_cents),
    detail: "After refunds, taxes, and configured deductions",
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap) * 3,
    y: cardY,
    width: cardWidth,
    height: 82,
    label: "Amount owed",
    value: formatCurrency(payoutCents),
    detail: "Partner payout for this period",
    emphasis: true,
  });

  drawTrendPanel(page, fonts, preview, { x: 42, y: 246, width: 528, height: 116 });

  drawText(page, fonts, "Sales-to-payout bridge", {
    x: 42,
    y: 208,
    size: 13,
    font: fonts.bold,
  });
  drawText(page, fonts, splitBaseKind === "gross"
    ? "The selected period's sales, refund impact, agreement payout basis, and partner payout."
    : "The selected period's settlement math, from recorded sales to partner payout.", {
    x: 42,
    y: 192,
    size: 8.5,
    color: COLORS.muted,
    maxWidth: 528,
  });

  const bridgeBase = Math.max(
    numberValue(summary.gross_sales_cents),
    numberValue(summary.net_sales_cents),
    numberValue(summary.split_base_cents),
    payoutCents,
    1,
  );
  const bridgeSegments = [
    {
      label: "Gross sales",
      value: formatCurrency(summary.gross_sales_cents),
      cents: numberValue(summary.gross_sales_cents),
      color: COLORS.sage,
    },
    {
      label: "Refunds",
      value: formatDeduction(summary.refund_amount_cents),
      cents: numberValue(summary.refund_amount_cents),
      color: COLORS.amber,
    },
    ...(splitBaseKind === "gross" ? [] : [
      {
        label: "Tax + deductions",
        value: formatDeduction(taxAndDeductions),
        cents: taxAndDeductions,
        color: COLORS.softText,
      },
    ]),
    {
      label: "Payout basis",
      value: formatCurrency(summary.split_base_cents ?? summary.net_sales_cents),
      cents: numberValue(summary.split_base_cents ?? summary.net_sales_cents),
      color: COLORS.slateSoft,
    },
    {
      label: "Amount owed",
      value: formatCurrency(payoutCents),
      cents: payoutCents,
      color: COLORS.coral,
    },
  ];
  const segmentGap = bridgeSegments.length > 4 ? 14 : 22;
  const segmentWidth = bridgeSegments.length > 4 ? 92 : 112;
  bridgeSegments.forEach((segment, index) => {
    const x = 42 + index * (segmentWidth + segmentGap);
    const scaledWidth = Math.max((Math.abs(segment.cents) / bridgeBase) * segmentWidth, 12);
    drawBridgeSegment(page, fonts, {
      x,
      y: 154,
      width: scaledWidth,
      label: segment.label,
      value: segment.value,
      color: segment.color,
    });
  });

  const deductionNote = splitBaseKind === "gross"
    ? `${feeLabel}${costLabel === "Costs" ? "" : ` and ${costLabel}`} details appear in calculation support; this agreement's payout basis is ${splitBaseLabel.toLowerCase()}.`
    : `${feeLabel}${costLabel === "Costs" ? "" : ` and ${costLabel}`} details appear in the calculation support section.`;
  drawText(page, fonts, deductionNote, {
    x: 42,
    y: 88,
    size: 8,
    color: COLORS.softText,
    maxWidth: 528,
  });
};

const drawCalculationRow = (
  page: PDFPage,
  fonts: PdfFonts,
  {
    y,
    label,
    formula,
    value,
    emphasis = false,
  }: {
    y: number;
    label: string;
    formula: string;
    value: string;
    emphasis?: boolean;
  },
) => {
  const rowHeight = emphasis ? 34 : 28;
  page.drawRectangle({
    x: 42,
    y: y - rowHeight + 10,
    width: 528,
    height: rowHeight,
    color: emphasis ? COLORS.blushLight : COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.5,
  });
  drawText(page, fonts, label, {
    x: 58,
    y: y,
    size: emphasis ? 10 : 8.5,
    font: emphasis ? fonts.bold : fonts.regular,
    maxWidth: 170,
  });
  drawText(page, fonts, formula, {
    x: 235,
    y,
    size: 7.5,
    color: COLORS.muted,
    maxWidth: 205,
    lineHeight: 9,
  });
  drawRightAlignedText(
    page,
    emphasis ? fonts.bold : fonts.regular,
    value,
    552,
    y,
    emphasis ? 10 : 8.5,
    emphasis ? COLORS.coralDark : COLORS.ink,
  );
};

const drawDetailPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  assets: PdfAssets,
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const {
    preview,
    payoutRecipientLabels,
    calculationLabel,
    generatedAt,
    feeLabel = "Stick cost deduction",
    costLabel = "Costs",
    splitBaseLabel = "Net sales",
    calculationModelLabel = "Partner share",
    additionalDeductionsNotes,
  } = context;
  const summary = preview.summary ?? {};
  const page = pdfDoc.addPage([612, 792]);
  const periodLabel = getFriendlyPeriodLabel(preview);
  const partnerLabel = getPartnerPayoutLabel(payoutRecipientLabels);
  const payoutCents = getPrimaryPartnerPayoutCents(summary);
  const partnerShare = getPartnerShareLabel(context);
  const partnerShareFormula = partnerShare
    ? `${partnerShare} of ${splitBaseLabel.toLowerCase()}.`
    : `Calculated from ${splitBaseLabel.toLowerCase()} using the active agreement terms.`;

  drawHeader(page, fonts, assets, {
    title: "Calculation support",
    partnerName: "How the settlement was calculated",
    periodLabel: `${getPeriodKindLabel(preview)}: ${periodLabel}`,
    reportReference,
    generatedAt: formatPreparedAt(generatedAt),
  });

  drawText(page, fonts, "Settlement math", {
    x: 42,
    y: 620,
    size: 13,
    font: fonts.bold,
  });
  drawText(page, fonts, "A transparent calculation trail using recorded sales, approved refunds, and the active agreement terms for this selected period.", {
    x: 42,
    y: 604,
    size: 8.5,
    color: COLORS.muted,
    maxWidth: 505,
  });

  const taxAndDeductions = numberValue(summary.tax_cents) +
    numberValue(summary.fee_cents) +
    numberValue(summary.cost_cents);
  const additionalCostCents = numberValue(summary.cost_cents);
  const rows = [
    {
      label: "Gross sales",
      formula: "Recorded sales for machines assigned to this partnership during the selected period.",
      value: formatCurrency(summary.gross_sales_cents),
    },
    {
      label: "Less refund impact",
      formula: "Approved refund adjustments matched to this period and these machines.",
      value: formatDeduction(summary.refund_amount_cents),
    },
    {
      label: "Less machine taxes",
      formula: "Machine taxes applied under the active agreement.",
      value: formatDeduction(summary.tax_cents),
    },
    {
      label: `Less ${feeLabel}`,
      formula: "Contract-specific item or transaction deduction applied before the split.",
      value: formatDeduction(summary.fee_cents),
    },
    {
      label: additionalCostCents === 0
        ? costLabel === "Costs"
          ? "Additional costs"
          : costLabel
        : costLabel === "Costs"
        ? "Less additional costs"
        : `Less ${costLabel}`,
      formula: additionalCostCents === 0
        ? "No additional costs applied for this selected period."
        : "Additional agreement-specific costs applied before the split.",
      value: additionalCostCents === 0
        ? formatCurrency(0)
        : formatDeduction(summary.cost_cents),
    },
    {
      label: "Net sales",
      formula: "Gross sales minus approved refunds, machine taxes, and configured deductions.",
      value: formatCurrency(summary.net_sales_cents),
      emphasis: true,
    },
    {
      label: "Payout basis",
      formula: `Configured agreement basis: ${splitBaseLabel}.`,
      value: formatCurrency(summary.split_base_cents ?? summary.net_sales_cents),
      emphasis: true,
    },
    {
      label: partnerLabel,
      formula: partnerShareFormula,
      value: formatCurrency(payoutCents),
      emphasis: true,
    },
    {
      label: "Bloomjoy retained",
      formula: "Bloomjoy share retained after the partner payout.",
      value: formatCurrency(getBloomjoyRetainedCents(summary)),
    },
  ];

  let rowY = 574;
  rows.forEach((row) => {
    drawCalculationRow(page, fonts, { y: rowY, ...row });
    rowY -= row.emphasis ? 38 : 32;
  });

  page.drawRectangle({
    x: 42,
    y: 150,
    width: 528,
    height: 112,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  drawText(page, fonts, "Calculation notes", {
    x: 60,
    y: 238,
    size: 11,
    font: fonts.bold,
  });
  const assumptions = [
    `${getPeriodKindLabel(preview)} uses ${periodLabel}.`,
    partnerShare
      ? `Agreement basis: ${splitBaseLabel}; amount owed is ${partnerShare} of that basis.`
      : `Agreement basis: ${splitBaseLabel} (${calculationModelLabel}).`,
    "No-pay transactions are counted in operating volume and contribute $0 to sales.",
    "Refund impact includes approved adjustments applied to this selected period.",
    `Tax plus agreement deductions total ${formatCurrency(taxAndDeductions)} for this report.`,
  ].filter(Boolean);
  assumptions.forEach((assumption, index) => {
    page.drawCircle({ x: 64, y: 217 - index * 15, size: 2, color: COLORS.coral });
    drawText(page, fonts, assumption, {
      x: 74,
      y: 213 - index * 15,
      size: 8,
      color: COLORS.muted,
      maxWidth: 468,
      lineHeight: 9,
    });
  });

  const notes = [
    calculationLabel,
    additionalDeductionsNotes ? `Additional deduction notes: ${additionalDeductionsNotes}` : "",
  ].filter(Boolean).join(" ");
  if (notes) {
    drawText(page, fonts, "Agreement note", {
      x: 42,
      y: 118,
      size: 9,
      font: fonts.bold,
    });
    drawText(page, fonts, notes, {
      x: 42,
      y: 102,
      size: 7.5,
      color: COLORS.muted,
      maxWidth: 528,
      lineHeight: 9,
    });
  }
};

const drawAppendixHeader = (
  page: PDFPage,
  fonts: PdfFonts,
  assets: PdfAssets,
  {
    periodLabel,
    reportReference,
    generatedAt,
  }: {
    periodLabel: string;
    reportReference: string;
    generatedAt: string;
  },
) => {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLORS.page });
  page.drawRectangle({ x: 0, y: height - 9, width, height: 9, color: COLORS.coral });
  if (assets.logo) {
    page.drawImage(assets.logo, {
      x: 28,
      y: height - 48,
      width: 28,
      height: 28,
    });
  }
  drawText(page, fonts, "Machine detail", {
    x: assets.logo ? 66 : 30,
    y: height - 34,
    size: 16,
    font: fonts.bold,
  });
  drawText(page, fonts, periodLabel, {
    x: assets.logo ? 66 : 30,
    y: height - 50,
    size: 8,
    color: COLORS.muted,
  });
  drawRightAlignedText(page, fonts.bold, reportReference, width - 30, height - 34, 8, COLORS.ink);
  drawRightAlignedText(page, fonts.regular, generatedAt, width - 30, height - 48, 7, COLORS.muted);
};

const drawAppendixTableHeader = (
  page: PDFPage,
  fonts: PdfFonts,
  y: number,
  columns: Array<{ label: string; x: number; width: number; align?: "right" }>,
) => {
  page.drawRectangle({
    x: 30,
    y: y - 14,
    width: 732,
    height: 22,
    color: COLORS.slatePanel,
  });
  columns.forEach((column) => {
    const lines = wrapTextToWidth(column.label, fonts.bold, 6.5, column.width);
    lines.slice(0, 2).forEach((line, index) => {
      if (column.align === "right") {
        drawRightAlignedText(page, fonts.bold, line, column.x + column.width, y - index * 8, 6.5, COLORS.white);
        return;
      }
      drawText(page, fonts, line, {
        x: column.x,
        y: y - index * 8,
        size: 6.5,
        font: fonts.bold,
        color: COLORS.white,
      });
    });
  });
};

const drawAppendixPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  assets: PdfAssets,
  periodLabel: string,
  reportReference: string,
  generatedAt: string,
) => {
  const page = pdfDoc.addPage([792, 612]);
  drawAppendixHeader(page, fonts, assets, { periodLabel, reportReference, generatedAt });
  return page;
};

const drawMachineAppendix = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  assets: PdfAssets,
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const { preview, generatedAt, feeLabel = "Deductions" } = context;
  const periodLabel = `${getPeriodKindLabel(preview)}: ${getFriendlyPeriodLabel(preview)}`;
  const generatedAtLabel = formatPreparedAt(generatedAt);
  const machines = preview.machines ?? [];
  const columns = [
    { label: "Machine", x: 34, width: 128 },
    { label: "Orders", x: 170, width: 34, align: "right" as const },
    { label: "Items", x: 211, width: 34, align: "right" as const },
    { label: "Gross sales", x: 252, width: 64, align: "right" as const },
    { label: "Refund impact", x: 324, width: 62, align: "right" as const },
    { label: "Tax + deductions", x: 394, width: 72, align: "right" as const },
    { label: "Net sales", x: 474, width: 60, align: "right" as const },
    { label: "Payout basis", x: 542, width: 60, align: "right" as const },
    { label: "Amount owed", x: 608, width: 62, align: "right" as const },
    { label: "Bloomjoy retained", x: 676, width: 82, align: "right" as const },
  ];

  let page = drawAppendixPage(pdfDoc, fonts, assets, periodLabel, reportReference, generatedAtLabel);
  let y = 526;
  drawText(page, fonts, `Detailed machine rollup. Machine labels are shown as partner-facing names. ${feeLabel} is combined with tax in the tax + deductions column.`, {
    x: 30,
    y,
    size: 8,
    color: COLORS.muted,
    maxWidth: 720,
  });
  y -= 36;
  drawAppendixTableHeader(page, fonts, y, columns);
  y -= 28;

  if (machines.length === 0) {
    page.drawRectangle({
      x: 30,
      y: 408,
      width: 732,
      height: 60,
      color: COLORS.white,
      borderColor: COLORS.border,
      borderWidth: 0.7,
    });
    drawText(page, fonts, "No machine activity is included in this report period.", {
      x: 48,
      y: 440,
      size: 10,
      font: fonts.bold,
      color: COLORS.muted,
    });
    return;
  }

  machines.forEach((machine, index) => {
    const labelLines = wrapTextToWidth(machine.machine_label ?? "Unnamed machine", fonts.regular, 7, columns[0].width);
    const rowHeight = Math.max(28, labelLines.length * 9 + 12);

    if (y - rowHeight < 54) {
      page = drawAppendixPage(pdfDoc, fonts, assets, periodLabel, reportReference, generatedAtLabel);
      y = 526;
      drawAppendixTableHeader(page, fonts, y, columns);
      y -= 28;
    }

    page.drawRectangle({
      x: 30,
      y: y - rowHeight + 8,
      width: 732,
      height: rowHeight,
      color: index % 2 === 0 ? COLORS.white : COLORS.blushLight,
      borderColor: COLORS.border,
      borderWidth: 0.35,
    });

    labelLines.forEach((line, lineIndex) => {
      drawText(page, fonts, line, {
        x: columns[0].x,
        y: y - lineIndex * 9,
        size: 7,
        color: COLORS.ink,
      });
    });

    const taxAndDeductions = numberValue(machine.tax_cents) +
      numberValue(machine.fee_cents) +
      numberValue(machine.cost_cents);
    const values = [
      formatInteger(machine.order_count),
      formatInteger(machine.item_quantity),
      formatCurrency(machine.gross_sales_cents),
      formatDeduction(machine.refund_amount_cents),
      formatDeduction(taxAndDeductions),
      formatCurrency(machine.net_sales_cents),
      formatCurrency(machine.split_base_cents ?? machine.net_sales_cents),
      formatCurrency(getMachinePartnerPayoutCents(machine)),
      formatCurrency(getMachineBloomjoyRetainedCents(machine)),
    ];

    values.forEach((value, valueIndex) => {
      const column = columns[valueIndex + 1];
      drawRightAlignedText(page, fonts.regular, value, column.x + column.width, y, 6.7, COLORS.ink);
    });

    y -= rowHeight;
  });

  const summary = preview.summary ?? {};
  const totalRowHeight = 30;
  if (y - totalRowHeight < 54) {
    page = drawAppendixPage(pdfDoc, fonts, assets, periodLabel, reportReference, generatedAtLabel);
    y = 526;
    drawAppendixTableHeader(page, fonts, y, columns);
    y -= 28;
  }

  page.drawRectangle({
    x: 30,
    y: y - totalRowHeight + 8,
    width: 732,
    height: totalRowHeight,
    color: COLORS.slatePanel,
    borderColor: COLORS.slatePanel,
    borderWidth: 0.35,
  });
  drawText(page, fonts, "Total", {
    x: columns[0].x,
    y,
    size: 7.2,
    font: fonts.bold,
    color: COLORS.white,
  });
  const totalTaxAndDeductions = numberValue(summary.tax_cents) +
    numberValue(summary.fee_cents) +
    numberValue(summary.cost_cents);
  [
    formatInteger(summary.order_count),
    formatInteger(summary.item_quantity),
    formatCurrency(summary.gross_sales_cents),
    formatDeduction(summary.refund_amount_cents),
    formatDeduction(totalTaxAndDeductions),
    formatCurrency(summary.net_sales_cents),
    formatCurrency(summary.split_base_cents ?? summary.net_sales_cents),
    formatCurrency(getPrimaryPartnerPayoutCents(summary)),
    formatCurrency(getBloomjoyRetainedCents(summary)),
  ].forEach((value, valueIndex) => {
    const column = columns[valueIndex + 1];
    drawRightAlignedText(page, fonts.bold, value, column.x + column.width, y, 6.8, COLORS.white);
  });
};

export const buildPartnerReportPdf = async (
  context: PartnerReportExportContext,
): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const assets: PdfAssets = {
    logo: await pdfDoc.embedPng(decodeBase64(BLOOMJOY_LOGO_ASSET_BASE64)),
  };
  const reportReference = buildPartnerReportReference(
    context.snapshotId,
    context.preview,
  );
  drawDashboardPage(pdfDoc, fonts, assets, context, reportReference);
  drawDetailPage(pdfDoc, fonts, assets, context, reportReference);
  drawMachineAppendix(pdfDoc, fonts, assets, context, reportReference);

  const pages = pdfDoc.getPages();
  pages.forEach((page, index) => {
    drawFooter(
      page,
      fonts,
      reportReference,
      index + 1,
      pages.length,
    );
  });

  return pdfDoc.save();
};

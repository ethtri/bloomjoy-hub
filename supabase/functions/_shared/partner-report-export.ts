import {
  PDFDocument,
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
  additionalDeductionsNotes?: string | null;
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
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
  page.drawCircle({ x: 48, y: height - 42, size: 13, color: COLORS.coral });
  drawText(page, fonts, "B", {
    x: 43.5,
    y: height - 47,
    size: 13,
    font: fonts.bold,
    color: COLORS.white,
  });
  drawText(page, fonts, "BLOOMJOY", {
    x: 68,
    y: height - 36,
    size: 10,
    font: fonts.bold,
    color: COLORS.ink,
  });
  drawText(page, fonts, title, {
    x: 68,
    y: height - 51,
    size: 8,
    color: COLORS.muted,
  });
  drawRightAlignedText(page, fonts.bold, reportReference, width - 42, height - 35, 8, COLORS.ink);
  drawRightAlignedText(page, fonts.regular, `Generated ${generatedAt}`, width - 42, height - 50, 7.5, COLORS.muted);

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
  periodLabel: string,
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
  drawText(page, fonts, periodLabel, {
    x: width / 2 - 110,
    y: 18,
    size: 7,
    color: COLORS.softText,
    maxWidth: 220,
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

const drawDashboardPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const { preview, payoutRecipientLabels, generatedAt, feeLabel = "Stick cost deduction", costLabel = "Costs" } = context;
  const summary = preview.summary ?? {};
  const page = pdfDoc.addPage([612, 792]);
  const partnerName = toAscii(preview.partnershipName ?? "Partner report");
  const periodLabel = getFriendlyPeriodLabel(preview);
  const generatedAtLabel = formatGeneratedAt(generatedAt);
  const partnerLabel = getPartnerPayoutLabel(payoutRecipientLabels);
  const payoutCents = numberValue(getPrimaryPartnerPayoutCents(summary));
  const bloomjoyCents = numberValue(getBloomjoyRetainedCents(summary));
  const taxAndDeductions = numberValue(summary.tax_cents) +
    numberValue(summary.fee_cents) +
    numberValue(summary.cost_cents);

  drawHeader(page, fonts, {
    title: getReportTitle(preview),
    partnerName,
    periodLabel: `${getPeriodKindLabel(preview)}: ${periodLabel}`,
    reportReference,
    generatedAt: generatedAtLabel,
  });

  page.drawRectangle({ x: 42, y: 522, width: 528, height: 128, color: COLORS.slatePanel });
  page.drawRectangle({ x: 42, y: 522, width: 6, height: 128, color: COLORS.coral });
  drawText(page, fonts, "Amount owed", {
    x: 68,
    y: 618,
    size: 10,
    font: fonts.bold,
    color: rgb(0.86, 0.88, 0.93),
  });
  drawText(page, fonts, formatCurrency(payoutCents), {
    x: 68,
    y: 574,
    size: 34,
    font: fonts.bold,
    color: COLORS.white,
  });
  drawText(page, fonts, `${partnerLabel} for ${periodLabel}`, {
    x: 68,
    y: 546,
    size: 9,
    color: rgb(0.86, 0.88, 0.93),
    maxWidth: 250,
  });
  drawText(page, fonts, "Settlement packet", {
    x: 390,
    y: 618,
    size: 10,
    font: fonts.bold,
    color: rgb(0.86, 0.88, 0.93),
  });
  drawText(page, fonts, "Designed for partner review: the dashboard shows the answer, and the following pages show the calculation support.", {
    x: 390,
    y: 592,
    size: 8.5,
    color: rgb(0.86, 0.88, 0.93),
    maxWidth: 150,
    lineHeight: 11,
  });
  drawText(page, fonts, `Report reference ${reportReference}`, {
    x: 390,
    y: 540,
    size: 8,
    color: rgb(0.86, 0.88, 0.93),
    maxWidth: 150,
  });

  const cardY = 386;
  const cardWidth = 125;
  const cardGap = 10;
  drawCard(page, fonts, {
    x: 42,
    y: cardY,
    width: cardWidth,
    height: 94,
    label: "Gross sales",
    value: formatCurrency(summary.gross_sales_cents),
    detail: `${formatInteger(summary.order_count)} transactions`,
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap),
    y: cardY,
    width: cardWidth,
    height: 94,
    label: "Refund impact",
    value: formatDeduction(summary.refund_amount_cents),
    detail: "Approved adjustments only",
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap) * 2,
    y: cardY,
    width: cardWidth,
    height: 94,
    label: "Payout basis",
    value: formatCurrency(summary.split_base_cents ?? summary.net_sales_cents),
    detail: "After tax and deductions",
  });
  drawCard(page, fonts, {
    x: 42 + (cardWidth + cardGap) * 3,
    y: cardY,
    width: cardWidth,
    height: 94,
    label: "Bloomjoy retained",
    value: formatCurrency(bloomjoyCents),
    detail: "Remaining share after payout",
  });

  drawText(page, fonts, "Sales-to-payout bridge", {
    x: 42,
    y: 330,
    size: 13,
    font: fonts.bold,
  });
  drawText(page, fonts, "How gross sales become the partner settlement amount.", {
    x: 42,
    y: 314,
    size: 8.5,
    color: COLORS.muted,
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
    {
      label: "Tax + deductions",
      value: formatDeduction(taxAndDeductions),
      cents: taxAndDeductions,
      color: COLORS.softText,
    },
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
  const segmentGap = 14;
  const segmentWidth = 92;
  bridgeSegments.forEach((segment, index) => {
    const x = 42 + index * (segmentWidth + segmentGap);
    const scaledWidth = Math.max((Math.abs(segment.cents) / bridgeBase) * segmentWidth, 12);
    drawBridgeSegment(page, fonts, {
      x,
      y: 278,
      width: scaledWidth,
      label: segment.label,
      value: segment.value,
      color: segment.color,
    });
  });

  page.drawRectangle({
    x: 42,
    y: 122,
    width: 250,
    height: 92,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  drawText(page, fonts, "What this period shows", {
    x: 60,
    y: 188,
    size: 11,
    font: fonts.bold,
  });
  drawText(page, fonts, `${formatInteger(summary.item_quantity)} paid or counted items across ${formatInteger(summary.order_count)} transactions produced ${formatCurrency(summary.net_sales_cents)} in net sales after refunds, taxes, and configured deductions.`, {
    x: 60,
    y: 168,
    size: 8.5,
    color: COLORS.muted,
    maxWidth: 210,
    lineHeight: 11,
  });

  page.drawRectangle({
    x: 310,
    y: 122,
    width: 260,
    height: 92,
    color: COLORS.blushLight,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  drawText(page, fonts, "Review confidence", {
    x: 328,
    y: 188,
    size: 11,
    font: fonts.bold,
  });
  drawText(page, fonts, "The report was generated after required data checks passed. The appendix shows the machine-level proof behind the totals.", {
    x: 328,
    y: 168,
    size: 8.5,
    color: COLORS.muted,
    maxWidth: 218,
    lineHeight: 11,
  });

  drawText(page, fonts, `${feeLabel}${costLabel === "Costs" ? "" : ` and ${costLabel}`} details appear in the calculation support section.`, {
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
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const { preview, payoutRecipientLabels, calculationLabel, generatedAt, feeLabel = "Stick cost deduction", costLabel = "Costs", additionalDeductionsNotes } = context;
  const summary = preview.summary ?? {};
  const page = pdfDoc.addPage([612, 792]);
  const periodLabel = getFriendlyPeriodLabel(preview);
  const partnerLabel = getPartnerPayoutLabel(payoutRecipientLabels);
  const payoutCents = getPrimaryPartnerPayoutCents(summary);

  drawHeader(page, fonts, {
    title: "Calculation support",
    partnerName: "How the settlement was calculated",
    periodLabel: `${getPeriodKindLabel(preview)}: ${periodLabel}`,
    reportReference,
    generatedAt: formatGeneratedAt(generatedAt),
  });

  drawText(page, fonts, "Settlement math", {
    x: 42,
    y: 620,
    size: 13,
    font: fonts.bold,
  });
  drawText(page, fonts, "This page explains the numbers in business terms so the settlement can be reviewed without internal system context.", {
    x: 42,
    y: 604,
    size: 8.5,
    color: COLORS.muted,
    maxWidth: 505,
  });

  const taxAndDeductions = numberValue(summary.tax_cents) +
    numberValue(summary.fee_cents) +
    numberValue(summary.cost_cents);
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
      formula: "Machine tax assumptions applied before the payout split.",
      value: formatDeduction(summary.tax_cents),
    },
    {
      label: `Less ${feeLabel}`,
      formula: "Contract-specific item or transaction deduction applied before the split.",
      value: formatDeduction(summary.fee_cents),
    },
    {
      label: costLabel === "Costs" ? "Less additional costs" : `Less ${costLabel}`,
      formula: "Additional agreement-specific costs, if any, applied before the split.",
      value: formatDeduction(summary.cost_cents),
    },
    {
      label: "Net sales",
      formula: "Gross sales minus refunds, taxes, and configured deductions.",
      value: formatCurrency(summary.net_sales_cents),
      emphasis: true,
    },
    {
      label: "Payout basis",
      formula: "The amount eligible for partner-share allocation under the agreement.",
      value: formatCurrency(summary.split_base_cents ?? summary.net_sales_cents),
      emphasis: true,
    },
    {
      label: partnerLabel,
      formula: "Partner share calculated from the payout basis and active agreement terms.",
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
  drawText(page, fonts, "Assumptions and treatments", {
    x: 60,
    y: 238,
    size: 11,
    font: fonts.bold,
  });
  const assumptions = [
    `${getPeriodKindLabel(preview)} uses ${periodLabel}.`,
    "No-pay transactions are counted in operating volume and contribute $0 to sales.",
    "Refund impact includes approved adjustments available at generation time.",
    `Tax plus agreement deductions total ${formatDeduction(taxAndDeductions)} for this report.`,
  ];
  assumptions.forEach((assumption, index) => {
    page.drawCircle({ x: 64, y: 217 - index * 17, size: 2, color: COLORS.coral });
    drawText(page, fonts, assumption, {
      x: 74,
      y: 213 - index * 17,
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
  drawText(page, fonts, "Machine appendix", {
    x: 30,
    y: height - 34,
    size: 16,
    font: fonts.bold,
  });
  drawText(page, fonts, periodLabel, {
    x: 30,
    y: height - 50,
    size: 8,
    color: COLORS.muted,
  });
  drawRightAlignedText(page, fonts.bold, reportReference, width - 30, height - 34, 8, COLORS.ink);
  drawRightAlignedText(page, fonts.regular, `Generated ${generatedAt}`, width - 30, height - 48, 7, COLORS.muted);
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
  periodLabel: string,
  reportReference: string,
  generatedAt: string,
) => {
  const page = pdfDoc.addPage([792, 612]);
  drawAppendixHeader(page, fonts, { periodLabel, reportReference, generatedAt });
  return page;
};

const drawMachineAppendix = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  context: PartnerReportExportContext,
  reportReference: string,
) => {
  const { preview, generatedAt, feeLabel = "Deductions" } = context;
  const periodLabel = `${getPeriodKindLabel(preview)}: ${getFriendlyPeriodLabel(preview)}`;
  const generatedAtLabel = formatGeneratedAt(generatedAt);
  const machines = preview.machines ?? [];
  const columns = [
    { label: "Machine", x: 34, width: 145 },
    { label: "Orders", x: 190, width: 38, align: "right" as const },
    { label: "Items", x: 236, width: 42, align: "right" as const },
    { label: "Gross sales", x: 286, width: 66, align: "right" as const },
    { label: "Refund impact", x: 360, width: 66, align: "right" as const },
    { label: "Tax + deductions", x: 434, width: 78, align: "right" as const },
    { label: "Net sales", x: 520, width: 62, align: "right" as const },
    { label: "Payout basis", x: 590, width: 62, align: "right" as const },
    { label: "Amount owed", x: 660, width: 58, align: "right" as const },
    { label: "Bloomjoy", x: 724, width: 38, align: "right" as const },
  ];

  let page = drawAppendixPage(pdfDoc, fonts, periodLabel, reportReference, generatedAtLabel);
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
      page = drawAppendixPage(pdfDoc, fonts, periodLabel, reportReference, generatedAtLabel);
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
};

export const buildPartnerReportPdf = async (
  context: PartnerReportExportContext,
): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const reportReference = buildPartnerReportReference(
    context.snapshotId,
    context.preview,
  );
  const periodLabel = `${getPeriodKindLabel(context.preview)}: ${
    getFriendlyPeriodLabel(context.preview)
  }`;

  drawDashboardPage(pdfDoc, fonts, context, reportReference);
  drawDetailPage(pdfDoc, fonts, context, reportReference);
  drawMachineAppendix(pdfDoc, fonts, context, reportReference);

  const pages = pdfDoc.getPages();
  pages.forEach((page, index) => {
    drawFooter(
      page,
      fonts,
      reportReference,
      periodLabel,
      index + 1,
      pages.length,
    );
  });

  return pdfDoc.save();
};

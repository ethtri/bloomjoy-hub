import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "https://esm.sh/pdf-lib@1.17.1";

export type SalesReportPdfRow = {
  period_start?: string;
  periodStart?: string;
  machine_label?: string;
  machineLabel?: string;
  location_name?: string;
  locationName?: string;
  payment_method?: string;
  paymentMethod?: string;
  net_sales_cents?: number;
  netSalesCents?: number;
  refund_amount_cents?: number;
  refundAmountCents?: number;
  gross_sales_cents?: number;
  grossSalesCents?: number;
  transaction_count?: number;
  transactionCount?: number;
};

export type SalesReportPdfSummary = {
  netSalesCents: number;
  refundAmountCents: number;
  grossSalesCents: number;
  transactionCount: number;
};

type SalesReportPdfContext = {
  title?: string;
  subtitle?: string;
  dateFrom?: string;
  dateTo?: string;
  grain?: string;
  generatedAt?: string;
  snapshotId?: string;
  reportReference?: string;
  machineScopeLabel?: string;
  locationScopeLabel?: string;
  paymentScopeLabel?: string;
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

type MachineRollup = {
  label: string;
  location: string;
  netSalesCents: number;
  refundAmountCents: number;
  grossSalesCents: number;
  transactionCount: number;
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
  sage: rgb(0.25, 0.48, 0.34),
  sageLight: rgb(0.9, 0.96, 0.92),
  slatePanel: rgb(0.12, 0.15, 0.22),
} as const;

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

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
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
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

const formatDeductionCurrency = (cents: unknown): string => {
  const value = Math.abs(numberValue(cents));
  return value > 0 ? `-${formatCurrency(value)}` : "$0.00";
};

const formatInteger = (value: unknown): string =>
  Math.round(numberValue(value)).toLocaleString("en-US");

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

const formatPaymentMethod = (value: unknown): string => {
  const method = toAscii(value).toLowerCase();
  if (method === "credit") return "Card";
  if (method === "cash") return "Cash";
  if (method === "other") return "Other";
  return "Unknown";
};

const formatGrain = (value: unknown): string => {
  const grain = toAscii(value).toLowerCase();
  if (grain === "day") return "Daily";
  if (grain === "month") return "Monthly";
  return "Weekly";
};

const readPeriodStart = (row: SalesReportPdfRow): string =>
  toAscii(row.period_start ?? row.periodStart);

const readMachineLabel = (row: SalesReportPdfRow): string =>
  toAscii(row.machine_label ?? row.machineLabel) || "Unnamed machine";

const readLocationName = (row: SalesReportPdfRow): string =>
  toAscii(row.location_name ?? row.locationName) || "Unknown location";

const readPaymentMethod = (row: SalesReportPdfRow): string =>
  toAscii(row.payment_method ?? row.paymentMethod) || "unknown";

const readNetSalesCents = (row: SalesReportPdfRow): number =>
  numberValue(row.net_sales_cents ?? row.netSalesCents);

const readRefundAmountCents = (row: SalesReportPdfRow): number =>
  numberValue(row.refund_amount_cents ?? row.refundAmountCents);

const readGrossSalesCents = (row: SalesReportPdfRow): number =>
  numberValue(row.gross_sales_cents ?? row.grossSalesCents);

const readTransactionCount = (row: SalesReportPdfRow): number =>
  numberValue(row.transaction_count ?? row.transactionCount);

export const summarizeSalesReportPdfRows = (
  rows: SalesReportPdfRow[]
): SalesReportPdfSummary =>
  rows.reduce<SalesReportPdfSummary>(
    (summary, row) => ({
      netSalesCents: summary.netSalesCents + readNetSalesCents(row),
      refundAmountCents: summary.refundAmountCents + readRefundAmountCents(row),
      grossSalesCents: summary.grossSalesCents + readGrossSalesCents(row),
      transactionCount: summary.transactionCount + readTransactionCount(row),
    }),
    {
      netSalesCents: 0,
      refundAmountCents: 0,
      grossSalesCents: 0,
      transactionCount: 0,
    }
  );

export const buildSalesReportReference = (snapshotId: string, dateTo?: string): string => {
  const periodEnd = toAscii(dateTo).replaceAll("-", "").slice(0, 8) || "PERIOD";
  const shortId = toAscii(snapshotId).replaceAll("-", "").slice(0, 8).toUpperCase() ||
    "REPORT";

  return `BJ-OP-${periodEnd}-${shortId}`;
};

const uniqueLabels = (values: string[]): string[] =>
  [...new Set(values.map(toAscii).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );

const buildMachineRollups = (rows: SalesReportPdfRow[]): MachineRollup[] => {
  const rollups = new Map<string, MachineRollup>();

  rows.forEach((row) => {
    const label = readMachineLabel(row);
    const current = rollups.get(label) ?? {
      label,
      location: readLocationName(row),
      netSalesCents: 0,
      refundAmountCents: 0,
      grossSalesCents: 0,
      transactionCount: 0,
    };

    current.netSalesCents += readNetSalesCents(row);
    current.refundAmountCents += readRefundAmountCents(row);
    current.grossSalesCents += readGrossSalesCents(row);
    current.transactionCount += readTransactionCount(row);
    rollups.set(label, current);
  });

  return [...rollups.values()].sort((left, right) =>
    right.netSalesCents - left.netSalesCents || left.label.localeCompare(right.label)
  );
};

const wrapText = (font: PDFFont, text: string, size: number, maxWidth: number): string[] => {
  const words = toAscii(text).split(" ").filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
      return;
    }
    lines.push(line);
    line = word;
  });

  if (line) lines.push(line);
  return lines;
};

const drawText = (
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  {
    x,
    y,
    size = 10,
    font = fonts.regular,
    color = COLORS.ink,
    maxWidth,
    lineHeight = size + 4,
  }: DrawTextOptions,
): number => {
  const lines = maxWidth ? wrapText(font, text, size, maxWidth) : [toAscii(text)];
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color,
    });
  });

  return y - Math.max(0, lines.length - 1) * lineHeight;
};

const drawCard = (
  page: PDFPage,
  { x, y, width, height, fill = COLORS.white }: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: RGB;
  },
) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fill,
    borderColor: COLORS.border,
    borderWidth: 0.8,
  });
};

const drawBrandHeader = (
  page: PDFPage,
  fonts: PdfFonts,
  title: string,
  subtitle: string,
  reportReference: string,
) => {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 122,
    width: PAGE_WIDTH,
    height: 122,
    color: COLORS.slatePanel,
  });
  page.drawCircle({ x: MARGIN + 16, y: PAGE_HEIGHT - 40, size: 14, color: COLORS.coral });
  page.drawCircle({ x: MARGIN + 23, y: PAGE_HEIGHT - 35, size: 5, color: COLORS.blushLight });
  page.drawText("Bloomjoy", {
    x: MARGIN + 40,
    y: PAGE_HEIGHT - 45,
    size: 16,
    font: fonts.bold,
    color: COLORS.white,
  });
  page.drawText("Operator reporting", {
    x: MARGIN + 40,
    y: PAGE_HEIGHT - 61,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.blush,
  });
  page.drawText(reportReference, {
    x: PAGE_WIDTH - MARGIN - fonts.bold.widthOfTextAtSize(reportReference, 8.5),
    y: PAGE_HEIGHT - 45,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.blush,
  });
  const titleBottomY = drawText(page, fonts, title, {
    x: MARGIN,
    y: PAGE_HEIGHT - 86,
    size: 24,
    font: fonts.bold,
    color: COLORS.white,
    maxWidth: 500,
    lineHeight: 26,
  });
  drawText(page, fonts, subtitle, {
    x: MARGIN,
    y: titleBottomY - 18,
    size: 9.5,
    color: COLORS.blush,
    maxWidth: 430,
  });
};

const drawFooter = (
  page: PDFPage,
  fonts: PdfFonts,
  pageNumber: number,
  reportReference: string,
) => {
  page.drawLine({
    start: { x: MARGIN, y: 34 },
    end: { x: PAGE_WIDTH - MARGIN, y: 34 },
    thickness: 0.7,
    color: COLORS.border,
  });
  page.drawText("Bloomjoy Hub report export", {
    x: MARGIN,
    y: 20,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.softText,
  });
  page.drawText(`${reportReference}  |  Page ${pageNumber}`, {
    x: PAGE_WIDTH - MARGIN - 180,
    y: 20,
    size: 7.5,
    font: fonts.regular,
    color: COLORS.softText,
  });
};

const drawMetricCard = (
  page: PDFPage,
  fonts: PdfFonts,
  {
    x,
    y,
    width,
    label,
    value,
    detail,
    emphasis = false,
  }: {
    x: number;
    y: number;
    width: number;
    label: string;
    value: string;
    detail: string;
    emphasis?: boolean;
  },
) => {
  drawCard(page, { x, y, width, height: 78, fill: emphasis ? COLORS.blushLight : COLORS.white });
  page.drawText(label, {
    x: x + 13,
    y: y + 52,
    size: 8,
    font: fonts.bold,
    color: COLORS.muted,
  });
  drawText(page, fonts, value, {
    x: x + 13,
    y: y + 30,
    size: value.length > 12 ? 14 : 17,
    font: fonts.bold,
    color: emphasis ? COLORS.coralDark : COLORS.ink,
    maxWidth: width - 26,
  });
  drawText(page, fonts, detail, {
    x: x + 13,
    y: y + 13,
    size: 7.5,
    color: COLORS.softText,
    maxWidth: width - 26,
  });
};

const drawKeyValue = (
  page: PDFPage,
  fonts: PdfFonts,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) => {
  page.drawText(label, {
    x,
    y,
    size: 7.5,
    font: fonts.bold,
    color: COLORS.softText,
  });
  drawText(page, fonts, value || "Not limited", {
    x,
    y: y - 14,
    size: 9,
    font: fonts.bold,
    color: COLORS.ink,
    maxWidth: width,
  });
};

const drawTableText = (
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  x: number,
  y: number,
  width: number,
  options: { size?: number; align?: "left" | "right"; bold?: boolean; color?: RGB } = {},
) => {
  const size = options.size ?? 8;
  const font = options.bold ? fonts.bold : fonts.regular;
  const normalized = toAscii(text);
  const clipped = font.widthOfTextAtSize(normalized, size) <= width
    ? normalized
    : `${normalized.slice(0, Math.max(1, Math.floor(width / (size * 0.48)) - 1))}...`;
  const textWidth = font.widthOfTextAtSize(clipped, size);
  page.drawText(clipped, {
    x: options.align === "right" ? x + width - textWidth : x,
    y,
    size,
    font,
    color: options.color ?? COLORS.ink,
  });
};

const drawDashboardPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  rows: SalesReportPdfRow[],
  summary: SalesReportPdfSummary,
  context: Required<SalesReportPdfContext>,
  machineRollups: MachineRollup[],
) => {
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLORS.page });
  drawBrandHeader(page, fonts, context.title, context.subtitle, context.reportReference);

  const periodLabel = `${formatDateLong(context.dateFrom)} - ${formatDateLong(context.dateTo)}`;
  const generatedLabel = formatGeneratedAt(context.generatedAt);
  const averageOrderCents = summary.transactionCount > 0
    ? Math.round(summary.netSalesCents / summary.transactionCount)
    : 0;

  let y = PAGE_HEIGHT - 222;
  const metricGap = 10;
  const metricWidth = (CONTENT_WIDTH - metricGap * 3) / 4;
  drawMetricCard(page, fonts, {
    x: MARGIN,
    y,
    width: metricWidth,
    label: "Net sales",
    value: formatCurrency(summary.netSalesCents),
    detail: `${formatCurrency(averageOrderCents)} avg order`,
    emphasis: true,
  });
  drawMetricCard(page, fonts, {
    x: MARGIN + (metricWidth + metricGap),
    y,
    width: metricWidth,
    label: "Gross sales",
    value: formatCurrency(summary.grossSalesCents),
    detail: "Before refund impact",
  });
  drawMetricCard(page, fonts, {
    x: MARGIN + (metricWidth + metricGap) * 2,
    y,
    width: metricWidth,
    label: "Refund impact",
    value: formatDeductionCurrency(summary.refundAmountCents),
    detail: "Approved adjustments",
  });
  drawMetricCard(page, fonts, {
    x: MARGIN + (metricWidth + metricGap) * 3,
    y,
    width: metricWidth,
    label: "Transactions",
    value: formatInteger(summary.transactionCount),
    detail: `${formatInteger(rows.length)} report rows`,
  });

  y -= 176;
  const storyHeight = 150;
  drawCard(page, { x: MARGIN, y, width: CONTENT_WIDTH, height: storyHeight });
  page.drawText("Executive summary", {
    x: MARGIN + 18,
    y: y + storyHeight - 28,
    size: 14,
    font: fonts.bold,
    color: COLORS.ink,
  });
  drawText(
    page,
    fonts,
    "This report summarizes the selected operator machine scope from Bloomjoy Hub reporting data. Totals include approved refund adjustments and are prepared for management or partner review without raw payment identifiers, source-order rows, or provider workbooks.",
    {
      x: MARGIN + 18,
      y: y + storyHeight - 50,
      size: 9.3,
      color: COLORS.muted,
      maxWidth: CONTENT_WIDTH - 36,
      lineHeight: 13,
    },
  );

  const scopeY = y + 54;
  const scopeWidth = (CONTENT_WIDTH - 36) / 3;
  drawKeyValue(page, fonts, "Reporting period", periodLabel, MARGIN + 18, scopeY, scopeWidth);
  drawKeyValue(
    page,
    fonts,
    "Machine scope",
    context.machineScopeLabel,
    MARGIN + 18 + scopeWidth,
    scopeY,
    scopeWidth,
  );
  drawKeyValue(
    page,
    fonts,
    "Generated",
    generatedLabel,
    MARGIN + 18 + scopeWidth * 2,
    scopeY,
    scopeWidth,
  );
  drawKeyValue(page, fonts, "View", formatGrain(context.grain), MARGIN + 18, scopeY - 42, scopeWidth);
  drawKeyValue(
    page,
    fonts,
    "Payment scope",
    context.paymentScopeLabel,
    MARGIN + 18 + scopeWidth,
    scopeY - 42,
    scopeWidth,
  );
  drawKeyValue(
    page,
    fonts,
    "Report reference",
    context.reportReference,
    MARGIN + 18 + scopeWidth * 2,
    scopeY - 42,
    scopeWidth,
  );

  y -= 220;
  drawCard(page, { x: MARGIN, y, width: CONTENT_WIDTH, height: 178 });
  page.drawText("Machine rollup", {
    x: MARGIN + 18,
    y: y + 150,
    size: 14,
    font: fonts.bold,
    color: COLORS.ink,
  });
  page.drawText("Top machines by net sales for the selected period.", {
    x: MARGIN + 18,
    y: y + 134,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const tableTop = y + 108;
  const columns = [
    { label: "Machine", x: MARGIN + 18, width: 188, align: "left" as const },
    { label: "Gross", x: MARGIN + 238, width: 68, align: "right" as const },
    { label: "Refunds", x: MARGIN + 318, width: 68, align: "right" as const },
    { label: "Net", x: MARGIN + 398, width: 68, align: "right" as const },
    { label: "Txns", x: MARGIN + 478, width: 48, align: "right" as const },
  ];
  page.drawRectangle({
    x: MARGIN + 12,
    y: tableTop - 8,
    width: CONTENT_WIDTH - 24,
    height: 22,
    color: COLORS.blushLight,
  });
  columns.forEach((column) =>
    drawTableText(page, fonts, column.label, column.x, tableTop, column.width, {
      bold: true,
      size: 7.6,
      color: COLORS.coralDark,
      align: column.align,
    })
  );

  const visibleRollups = machineRollups.slice(0, 5);
  if (visibleRollups.length === 0) {
    drawText(page, fonts, "No machine activity is included in this report period.", {
      x: MARGIN + 18,
      y: tableTop - 34,
      size: 9,
      color: COLORS.muted,
      maxWidth: CONTENT_WIDTH - 36,
    });
  } else {
    visibleRollups.forEach((machine, index) => {
      const rowY = tableTop - 28 - index * 20;
      if (index % 2 === 1) {
        page.drawRectangle({
          x: MARGIN + 12,
          y: rowY - 6,
          width: CONTENT_WIDTH - 24,
          height: 18,
          color: rgb(1, 0.985, 0.992),
        });
      }
      drawTableText(page, fonts, machine.label, columns[0].x, rowY, columns[0].width, {
        bold: true,
      });
      drawTableText(
        page,
        fonts,
        formatCurrency(machine.grossSalesCents),
        columns[1].x,
        rowY,
        columns[1].width,
        { align: "right" },
      );
      drawTableText(
        page,
        fonts,
        formatDeductionCurrency(machine.refundAmountCents),
        columns[2].x,
        rowY,
        columns[2].width,
        { align: "right", color: COLORS.muted },
      );
      drawTableText(
        page,
        fonts,
        formatCurrency(machine.netSalesCents),
        columns[3].x,
        rowY,
        columns[3].width,
        { align: "right", bold: true },
      );
      drawTableText(
        page,
        fonts,
        formatInteger(machine.transactionCount),
        columns[4].x,
        rowY,
        columns[4].width,
        { align: "right" },
      );
    });
  }

  const noteY = y + 18;
  page.drawRectangle({
    x: MARGIN,
    y: 58,
    width: CONTENT_WIDTH,
    height: 48,
    color: COLORS.sageLight,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  drawText(page, fonts, "Warning state", {
    x: MARGIN + 14,
    y: 87,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.sage,
  });
  drawText(page, fonts, rows.length === 0
    ? "No sales rows were returned for this selected period and scope."
    : "No blocking export warnings were returned. Use the appendix for row-level reconciliation.",
  {
    x: MARGIN + 14,
    y: 72,
    size: 8.2,
    color: COLORS.muted,
    maxWidth: CONTENT_WIDTH - 28,
  });
  drawText(page, fonts, `${formatInteger(Math.max(0, machineRollups.length - visibleRollups.length))} additional machine rollups continue in row-level detail when applicable.`, {
    x: MARGIN + 18,
    y: noteY,
    size: 7,
    color: COLORS.softText,
    maxWidth: CONTENT_WIDTH - 36,
  });

  drawFooter(page, fonts, 1, context.reportReference);
};

const drawAppendixHeader = (
  page: PDFPage,
  fonts: PdfFonts,
  title: string,
  reportReference: string,
) => {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLORS.page });
  page.drawText(title, {
    x: MARGIN,
    y: PAGE_HEIGHT - 54,
    size: 18,
    font: fonts.bold,
    color: COLORS.ink,
  });
  page.drawText(reportReference, {
    x: PAGE_WIDTH - MARGIN - fonts.bold.widthOfTextAtSize(reportReference, 8.5),
    y: PAGE_HEIGHT - 50,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.coralDark,
  });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 72 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 72 },
    thickness: 0.8,
    color: COLORS.border,
  });
};

const drawReportRowsPage = (
  pdfDoc: PDFDocument,
  fonts: PdfFonts,
  rows: SalesReportPdfRow[],
  context: Required<SalesReportPdfContext>,
  pageNumber: number,
): number => {
  const rowsPerPage = 26;
  let currentPageNumber = pageNumber;

  for (let offset = 0; offset < rows.length || offset === 0; offset += rowsPerPage) {
    const pageRows = rows.slice(offset, offset + rowsPerPage);
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawAppendixHeader(page, fonts, "Report row appendix", context.reportReference);
    page.drawText("Period", { x: MARGIN, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Machine", { x: MARGIN + 70, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Payment", { x: MARGIN + 228, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Net", { x: MARGIN + 310, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Refunds", { x: MARGIN + 384, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Gross", { x: MARGIN + 458, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawText("Txns", { x: MARGIN + 520, y: PAGE_HEIGHT - 98, size: 7.5, font: fonts.bold, color: COLORS.coralDark });
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - 108 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 108 },
      thickness: 0.8,
      color: COLORS.border,
    });

    if (pageRows.length === 0) {
      drawText(page, fonts, "No row-level sales activity is included in this report period.", {
        x: MARGIN,
        y: PAGE_HEIGHT - 136,
        size: 9,
        color: COLORS.muted,
        maxWidth: CONTENT_WIDTH,
      });
    }

    pageRows.forEach((row, index) => {
      const y = PAGE_HEIGHT - 132 - index * 22;
      if (index % 2 === 1) {
        page.drawRectangle({
          x: MARGIN - 4,
          y: y - 6,
          width: CONTENT_WIDTH + 8,
          height: 18,
          color: rgb(1, 0.985, 0.992),
        });
      }
      drawTableText(page, fonts, formatDateShort(readPeriodStart(row)), MARGIN, y, 62, { size: 7.8 });
      drawTableText(page, fonts, readMachineLabel(row), MARGIN + 70, y, 148, {
        size: 7.8,
        bold: true,
      });
      drawTableText(
        page,
        fonts,
        formatPaymentMethod(readPaymentMethod(row)),
        MARGIN + 228,
        y,
        56,
        { size: 7.8, color: COLORS.muted },
      );
      drawTableText(page, fonts, formatCurrency(readNetSalesCents(row)), MARGIN + 298, y, 66, {
        size: 7.8,
        align: "right",
        bold: true,
      });
      drawTableText(
        page,
        fonts,
        formatDeductionCurrency(readRefundAmountCents(row)),
        MARGIN + 372,
        y,
        66,
        { size: 7.8, align: "right", color: COLORS.muted },
      );
      drawTableText(page, fonts, formatCurrency(readGrossSalesCents(row)), MARGIN + 446, y, 66, {
        size: 7.8,
        align: "right",
      });
      drawTableText(page, fonts, formatInteger(readTransactionCount(row)), MARGIN + 512, y, 44, {
        size: 7.8,
        align: "right",
      });
    });

    drawFooter(page, fonts, currentPageNumber, context.reportReference);
    currentPageNumber += 1;
    if (pageRows.length < rowsPerPage) break;
  }

  return currentPageNumber;
};

const normalizeContext = (
  context: SalesReportPdfContext,
  rows: SalesReportPdfRow[],
): Required<SalesReportPdfContext> => {
  const dateFrom = context.dateFrom || readPeriodStart(rows[0]) || "";
  const dateTo = context.dateTo || dateFrom;
  const snapshotId = context.snapshotId || "report";
  const machineLabels = uniqueLabels(rows.map(readMachineLabel));
  const locationLabels = uniqueLabels(rows.map(readLocationName));
  const paymentLabels = uniqueLabels(rows.map((row) => formatPaymentMethod(readPaymentMethod(row))));

  return {
    title: toAscii(context.title) || "Bloomjoy Operator Sales Report",
    subtitle: toAscii(context.subtitle) ||
      "Partner-ready performance report for assigned machines.",
    dateFrom,
    dateTo,
    grain: context.grain || "week",
    generatedAt: context.generatedAt || new Date().toISOString(),
    snapshotId,
    reportReference: context.reportReference || buildSalesReportReference(snapshotId, dateTo),
    machineScopeLabel: context.machineScopeLabel ||
      (machineLabels.length === 1
        ? machineLabels[0]
        : machineLabels.length > 1
        ? `${machineLabels.length} selected machines`
        : "All accessible machines"),
    locationScopeLabel: context.locationScopeLabel ||
      (locationLabels.length === 1
        ? locationLabels[0]
        : locationLabels.length > 1
        ? `${locationLabels.length} reporting locations`
        : "All accessible locations"),
    paymentScopeLabel: context.paymentScopeLabel ||
      (paymentLabels.length > 0 ? paymentLabels.join(", ") : "All payment methods"),
  };
};

export const buildSalesReportPdf = async ({
  title,
  subtitle,
  rows,
  summary,
  dateFrom,
  dateTo,
  grain,
  generatedAt,
  snapshotId,
  reportReference,
  machineScopeLabel,
  locationScopeLabel,
  paymentScopeLabel,
}: SalesReportPdfContext & {
  rows: SalesReportPdfRow[];
  summary?: SalesReportPdfSummary;
}): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const finalSummary = summary ?? summarizeSalesReportPdfRows(rows);
  const context = normalizeContext(
    {
      title,
      subtitle,
      dateFrom,
      dateTo,
      grain,
      generatedAt,
      snapshotId,
      reportReference,
      machineScopeLabel,
      locationScopeLabel,
      paymentScopeLabel,
    },
    rows,
  );
  const machineRollups = buildMachineRollups(rows);

  drawDashboardPage(pdfDoc, fonts, rows, finalSummary, context, machineRollups);
  drawReportRowsPage(pdfDoc, fonts, rows, context, 2);

  return pdfDoc.save();
};

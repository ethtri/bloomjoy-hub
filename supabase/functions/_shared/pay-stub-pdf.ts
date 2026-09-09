import {
  PDFDocument,
  PDFPage,
  PDFFont,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

export const PAY_STUB_PDF_GENERATOR_VERSION = "bloomjoy-pay-stub-pdf-v2";

export type PayStubMachineSegment = {
  segmentStartDate: string;
  segmentEndDate: string;
  taxRatePercent: number | null;
  commissionBasisPoints: number | null;
  grossSalesCents: number;
  refundAdjustmentCents: number;
  taxCents: number;
  commissionableSalesCents: number;
  commissionEarningsCents: number;
};

export type PayStubMachine = {
  machineId: string;
  machineLabel: string;
  locationName: string;
  grossSalesCents: number;
  refundAdjustmentCents: number;
  taxCents: number;
  commissionableSalesCents: number;
  commissionEarningsCents: number;
  commissionSegments: PayStubMachineSegment[];
};

export type PayStubShiftRateLine = {
  machineId?: string | null;
  machineLabel?: string | null;
  locationName?: string | null;
  shiftRateCents: number | null;
  paidShifts: number;
  actualDurationMinutes: number;
  shiftEarningsCents: number;
};

export type PayStubPayload = {
  schemaVersion: "operator-pay-stub-v2";
  statementNumber: string;
  statementLabel: string;
  version: number;
  statementDate: string;
  entity: {
    name: string;
    legalName?: string | null;
    contactEmail?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    };
  };
  contractor: {
    displayName: string;
    workerIdentifier?: string | null;
    positionTitle?: string | null;
  };
  period: { periodStartDate: string; periodEndDate: string };
  current: {
    actualMinutes: number;
    paidShifts: number;
    shiftEarningsCents: number;
    commissionableSalesCents: number;
    commissionEarningsCents: number;
    bonusCents: number;
    supplyCreditCents: number;
    expenseReimbursementCents: number;
    totalEarningsCents: number;
  };
  yearToDate: {
    paidShifts: number;
    shiftEarningsCents: number;
    commissionableSalesCents: number;
    commissionEarningsCents: number;
    bonusCents: number;
    supplyCreditCents: number;
    expenseReimbursementCents: number;
    totalEarningsCents: number;
  };
  shiftRateLines?: PayStubShiftRateLine[];
  machines: PayStubMachine[];
  classificationNotice: string;
};

const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 44;
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.39, 0.42, 0.48);
const BORDER = rgb(0.87, 0.86, 0.84);
const BLUSH = rgb(0.98, 0.91, 0.92);
const CORAL = rgb(0.72, 0.25, 0.25);
const PAPER = rgb(0.99, 0.985, 0.975);
const WHITE = rgb(1, 1, 1);

type Fonts = { regular: PDFFont; bold: PDFFont };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const date = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
};

const period = (start: string, end: string) => `${date(start)} - ${date(end)}`;

const text = (
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size = 9,
  color = INK,
) => page.drawText(value || "—", { x, y, size, font, color });

const rightText = (
  page: PDFPage,
  font: PDFFont,
  value: string,
  right: number,
  y: number,
  size = 9,
  color = INK,
) => text(page, font, value, right - font.widthOfTextAtSize(value, size), y, size, color);

const header = (page: PDFPage, fonts: Fonts, payload: PayStubPayload, pageTitle: string) => {
  page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: PAPER });
  page.drawRectangle({ x: 0, y: HEIGHT - 112, width: WIDTH, height: 112, color: INK });
  text(page, fonts.bold, payload.entity.name || "Bloomjoy", MARGIN, HEIGHT - 46, 18, WHITE);
  text(page, fonts.regular, pageTitle, MARGIN, HEIGHT - 71, 11, BLUSH);
  rightText(page, fonts.bold, payload.statementNumber, WIDTH - MARGIN, HEIGHT - 45, 8.5, BLUSH);
  rightText(page, fonts.regular, `Page ${pageTitle === "Pay Stub" ? "1" : "2"}`, WIDTH - MARGIN, HEIGHT - 65, 8, WHITE);
};

const footer = (page: PDFPage, fonts: Fonts, payload: PayStubPayload) => {
  page.drawLine({ start: { x: MARGIN, y: 35 }, end: { x: WIDTH - MARGIN, y: 35 }, thickness: 0.7, color: BORDER });
  text(page, fonts.regular, "Bloomjoy Hub · Pay Stub record only · No payment execution", MARGIN, 20, 7.5, MUTED);
  rightText(page, fonts.regular, `v${payload.version}`, WIDTH - MARGIN, 20, 7.5, MUTED);
};

const card = (page: PDFPage, x: number, y: number, width: number, height: number) =>
  page.drawRectangle({ x, y, width, height, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });

const row = (
  page: PDFPage,
  fonts: Fonts,
  label: string,
  current: string,
  ytd: string,
  y: number,
  shaded = false,
) => {
  if (shaded) page.drawRectangle({ x: MARGIN + 10, y: y - 6, width: WIDTH - MARGIN * 2 - 20, height: 22, color: PAPER });
  text(page, fonts.regular, label, MARGIN + 18, y, 9);
  rightText(page, fonts.regular, current, WIDTH - MARGIN - 112, y, 9);
  rightText(page, fonts.regular, ytd, WIDTH - MARGIN - 18, y, 9);
};

const drawSummaryPage = (pdf: PDFDocument, fonts: Fonts, payload: PayStubPayload) => {
  const page = pdf.addPage([WIDTH, HEIGHT]);
  header(page, fonts, payload, "Pay Stub");

  card(page, MARGIN, 598, WIDTH - MARGIN * 2, 62);
  text(page, fonts.bold, payload.contractor.displayName, MARGIN + 16, 636, 14);
  text(page, fonts.regular, payload.contractor.positionTitle || "Technician", MARGIN + 16, 617, 8.5, MUTED);
  rightText(page, fonts.bold, period(payload.period.periodStartDate, payload.period.periodEndDate), WIDTH - MARGIN - 16, 636, 9);
  rightText(page, fonts.regular, `Statement date ${date(payload.statementDate)}`, WIDTH - MARGIN - 16, 617, 8.5, MUTED);

  card(page, MARGIN, 492, WIDTH - MARGIN * 2, 84);
  text(page, fonts.regular, "TOTAL EARNINGS", MARGIN + 16, 550, 8, MUTED);
  text(page, fonts.bold, money(payload.current.totalEarningsCents), MARGIN + 16, 518, 25, CORAL);
  rightText(page, fonts.regular, `${payload.current.paidShifts} paid shifts`, WIDTH - MARGIN - 16, 541, 9, MUTED);
  rightText(page, fonts.regular, `${Math.round(payload.current.actualMinutes / 6) / 10} actual hours`, WIDTH - MARGIN - 16, 522, 9, MUTED);

  card(page, MARGIN, 264, WIDTH - MARGIN * 2, 206);
  text(page, fonts.bold, "Earnings", MARGIN + 16, 443, 13);
  text(page, fonts.bold, "CURRENT", WIDTH - MARGIN - 160, 443, 7.5, MUTED);
  text(page, fonts.bold, "YEAR TO DATE", WIDTH - MARGIN - 92, 443, 7.5, MUTED);
  row(page, fonts, "Paid shifts", `${payload.current.paidShifts}`, `${payload.yearToDate.paidShifts}`, 414);
  row(page, fonts, "Shift pay", money(payload.current.shiftEarningsCents), money(payload.yearToDate.shiftEarningsCents), 386, true);
  row(page, fonts, "Commission", money(payload.current.commissionEarningsCents), money(payload.yearToDate.commissionEarningsCents), 358);
  row(page, fonts, "Bonus", money(payload.current.bonusCents), money(payload.yearToDate.bonusCents), 330, true);
  row(page, fonts, "Supply credit", money(payload.current.supplyCreditCents), money(payload.yearToDate.supplyCreditCents), 302);
  row(page, fonts, "Expense reimbursement", money(payload.current.expenseReimbursementCents), money(payload.yearToDate.expenseReimbursementCents), 276, true);

  card(page, MARGIN, 126, WIDTH - MARGIN * 2, 116);
  text(page, fonts.bold, "How commission was calculated", MARGIN + 16, 216, 11);
  text(page, fonts.regular, "Sales - refunds - estimated sales tax = commissionable sales", MARGIN + 16, 192, 9, MUTED);
  text(page, fonts.regular, `${money(payload.current.commissionableSalesCents)} commissionable sales`, MARGIN + 16, 170, 9);
  text(page, fonts.regular, "See the appendix for the rate and calculation by machine.", MARGIN + 16, 149, 8.5, MUTED);

  text(page, fonts.regular, payload.classificationNotice, MARGIN, 70, 7.5, MUTED);
  footer(page, fonts, payload);
};

const drawAppendix = (pdf: PDFDocument, fonts: Fonts, payload: PayStubPayload) => {
  const page = pdf.addPage([WIDTH, HEIGHT]);
  header(page, fonts, payload, "Pay details");
  text(page, fonts.bold, "Started-hour pay by machine", MARGIN, 650, 10);
  const shiftLines = payload.shiftRateLines ?? [];
  shiftLines.slice(0, 3).forEach((line, index) => {
    const y = 630 - index * 18;
    text(page, fonts.regular, (line.machineLabel || "All assigned machines").slice(0, 34), MARGIN, y, 8);
    rightText(page, fonts.regular, `${line.paidShifts} × ${line.shiftRateCents == null ? "rate missing" : money(line.shiftRateCents)}`, 474, y, 8);
    rightText(page, fonts.bold, money(line.shiftEarningsCents), WIDTH - MARGIN, y, 8, CORAL);
  });
  if (shiftLines.length > 3) {
    text(page, fonts.regular, `+ ${shiftLines.length - 3} more machine rate${shiftLines.length === 4 ? "" : "s"}`, MARGIN, 576, 7, MUTED);
  }

  text(page, fonts.bold, "Commission appendix", MARGIN, 552, 10);
  text(page, fonts.regular, "Sales - refunds - estimated sales tax = commissionable sales.", MARGIN, 536, 8, MUTED);
  const columns = [
    { label: "MACHINE / PERIOD", x: MARGIN, width: 158, right: false },
    { label: "SALES", x: 252, width: 58, right: true },
    { label: "REFUNDS", x: 316, width: 58, right: true },
    { label: "TAX", x: 380, width: 58, right: true },
    { label: "BASIS", x: 444, width: 58, right: true },
    { label: "COMMISSION", x: 508, width: 60, right: true },
  ];
  columns.forEach((column) => column.right
    ? rightText(page, fonts.bold, column.label, column.x + column.width, 514, 6.8, MUTED)
    : text(page, fonts.bold, column.label, column.x, 514, 6.8, MUTED));
  page.drawLine({ start: { x: MARGIN, y: 503 }, end: { x: WIDTH - MARGIN, y: 503 }, thickness: 0.8, color: BORDER });

  const lines = payload.machines.flatMap((machine) =>
    (machine.commissionSegments?.length ? machine.commissionSegments : [{
      segmentStartDate: payload.period.periodStartDate,
      segmentEndDate: payload.period.periodEndDate,
      taxRatePercent: null,
      commissionBasisPoints: null,
      grossSalesCents: machine.grossSalesCents,
      refundAdjustmentCents: machine.refundAdjustmentCents,
      taxCents: machine.taxCents,
      commissionableSalesCents: machine.commissionableSalesCents,
      commissionEarningsCents: machine.commissionEarningsCents,
    }]).map((segment) => ({ machine, segment }))
  );

  lines.slice(0, 14).forEach(({ machine, segment }, index) => {
    const y = 477 - index * 29;
    if (index % 2 === 1) page.drawRectangle({ x: MARGIN - 4, y: y - 8, width: WIDTH - MARGIN * 2 + 8, height: 25, color: PAPER });
    text(page, fonts.bold, machine.machineLabel.slice(0, 25), MARGIN, y + 4, 8);
    text(page, fonts.regular, `${machine.locationName.slice(0, 18)} | ${date(segment.segmentStartDate)}-${date(segment.segmentEndDate)}`, MARGIN, y - 7, 6.7, MUTED);
    rightText(page, fonts.regular, money(segment.grossSalesCents), 310, y, 7.6);
    rightText(page, fonts.regular, money(segment.refundAdjustmentCents), 374, y, 7.6);
    rightText(page, fonts.regular, money(segment.taxCents), 438, y + 4, 7.6);
    rightText(page, fonts.regular, segment.taxRatePercent == null ? "rate missing" : `${segment.taxRatePercent}%`, 438, y - 7, 6.5, MUTED);
    rightText(page, fonts.regular, money(segment.commissionableSalesCents), 502, y, 7.6);
    rightText(page, fonts.bold, money(segment.commissionEarningsCents), 568, y + 4, 7.6, CORAL);
    rightText(page, fonts.regular, segment.commissionBasisPoints == null ? "rate missing" : `${segment.commissionBasisPoints / 100}%`, 568, y - 7, 6.5, MUTED);
  });

  const gross = payload.machines.reduce((sum, machine) => sum + machine.grossSalesCents, 0);
  const refunds = payload.machines.reduce((sum, machine) => sum + machine.refundAdjustmentCents, 0);
  const tax = payload.machines.reduce((sum, machine) => sum + machine.taxCents, 0);
  const basis = payload.machines.reduce((sum, machine) => sum + machine.commissionableSalesCents, 0);
  const commission = payload.machines.reduce((sum, machine) => sum + machine.commissionEarningsCents, 0);
  page.drawLine({ start: { x: MARGIN, y: 72 }, end: { x: WIDTH - MARGIN, y: 72 }, thickness: 1.1, color: INK });
  text(page, fonts.bold, "TOTAL", MARGIN, 54, 8);
  rightText(page, fonts.bold, money(gross), 310, 54, 8);
  rightText(page, fonts.bold, money(refunds), 374, 54, 8);
  rightText(page, fonts.bold, money(tax), 438, 54, 8);
  rightText(page, fonts.bold, money(basis), 502, 54, 8);
  rightText(page, fonts.bold, money(commission), 568, 54, 8, CORAL);
  footer(page, fonts, payload);
};

export const buildPayStubPdf = async (payload: PayStubPayload): Promise<Uint8Array> => {
  if (payload.schemaVersion !== "operator-pay-stub-v2") {
    throw new Error("Unsupported Pay Stub payload version");
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${payload.statementLabel} · ${payload.contractor.displayName}`);
  pdf.setSubject(PAY_STUB_PDF_GENERATOR_VERSION);
  pdf.setCreator("Bloomjoy Hub");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  drawSummaryPage(pdf, fonts, payload);
  drawAppendix(pdf, fonts, payload);
  return pdf.save();
};

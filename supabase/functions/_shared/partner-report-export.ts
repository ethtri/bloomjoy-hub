type PartnerReportSummary = {
  order_count?: number;
  item_quantity?: number;
  gross_sales_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  cost_cents?: number;
  net_sales_cents?: number;
  split_base_cents?: number;
  fever_profit_cents?: number;
  partner_profit_cents?: number;
  bloomjoy_profit_cents?: number;
};

type PartnerReportMachine = {
  machine_label?: string;
  order_count?: number;
  item_quantity?: number;
  gross_sales_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  cost_cents?: number;
  net_sales_cents?: number;
};

export type PartnerReportPreview = {
  partnershipId?: string;
  partnershipName?: string;
  weekStartDate?: string;
  weekEndingDate?: string;
  summary?: PartnerReportSummary;
  machines?: PartnerReportMachine[];
  warnings?: Array<{ message?: string }>;
};

export type PartnerReportExportContext = {
  preview: PartnerReportPreview;
  payoutRecipientLabels: string[];
  calculationLabel: string;
  generatedAt: string;
};

const encoder = new TextEncoder();

const toAscii = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const escapePdfText = (value: string): string =>
  toAscii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(
    /\)/g,
    "\\)",
  );

const truncate = (value: unknown, length: number): string => {
  const normalized = toAscii(value);
  return normalized.length > length
    ? `${normalized.slice(0, length - 1)}`
    : normalized;
};

const truncateWithDots = (value: unknown, length: number): string => {
  const normalized = toAscii(value);
  if (normalized.length <= length) return normalized;
  if (length <= 3) return normalized.slice(0, length);
  return `${normalized.slice(0, length - 3)}...`;
};

const wrapText = (
  value: unknown,
  maxLineLength: number,
  maxLines: number,
): string[] => {
  const normalized = toAscii(value);
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";

  normalized.split(/\s+/).forEach((word) => {
    const chunks = word.length > maxLineLength
      ? word.match(new RegExp(`.{1,${maxLineLength}}`, "g")) ?? [word]
      : [word];

    chunks.forEach((chunk) => {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (candidate.length <= maxLineLength) {
        current = candidate;
        return;
      }

      if (current) lines.push(current);
      current = chunk;
    });
  });

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;

  const visibleLines = lines.slice(0, maxLines);
  visibleLines[maxLines - 1] = truncateWithDots(
    visibleLines[maxLines - 1],
    maxLineLength,
  );
  return visibleLines;
};

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

const formatInteger = (value: unknown): string =>
  Math.round(numberValue(value)).toLocaleString("en-US");

const formatGeneratedAt = (value: unknown): string => {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return toAscii(value);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

const csvCell = (value: unknown): string => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csvRow = (values: unknown[]) => values.map(csvCell).join(",");

const getPartnerPayoutLabel = (labels: string[]) =>
  labels[0] ?? "Partner payout";

export const buildPartnerReportCsv = ({
  preview,
  payoutRecipientLabels,
  calculationLabel,
  generatedAt,
}: PartnerReportExportContext): string => {
  const summary = preview.summary ?? {};
  const generatedAtLabel = formatGeneratedAt(generatedAt);
  const rows = [
    csvRow(["Bloomjoy Partner Weekly Report"]),
    csvRow(["Partnership", preview.partnershipName ?? ""]),
    csvRow([
      "Week",
      `${preview.weekStartDate ?? ""} through ${preview.weekEndingDate ?? ""}`,
    ]),
    csvRow(["Generated", generatedAtLabel]),
    csvRow(["Calculation", calculationLabel]),
    "",
    csvRow(["Summary"]),
    csvRow(["Metric", "Value"]),
    csvRow(["Orders", formatInteger(summary.order_count)]),
    csvRow(["Sticks/items", formatInteger(summary.item_quantity)]),
    csvRow(["Gross sales", formatCurrency(summary.gross_sales_cents)]),
    csvRow(["Machine taxes", formatCurrency(summary.tax_cents)]),
    csvRow(["Stick cost deduction", formatCurrency(summary.fee_cents)]),
    csvRow(["Costs", formatCurrency(summary.cost_cents)]),
    csvRow(["Net sales", formatCurrency(summary.net_sales_cents)]),
    csvRow([
      getPartnerPayoutLabel(payoutRecipientLabels),
      formatCurrency(summary.fever_profit_cents),
    ]),
    ...(payoutRecipientLabels[1]
      ? [
        csvRow([
          payoutRecipientLabels[1],
          formatCurrency(summary.partner_profit_cents),
        ]),
      ]
      : []),
    csvRow([
      "Bloomjoy retained",
      formatCurrency(summary.bloomjoy_profit_cents),
    ]),
    "",
    csvRow(["Machine Rollup"]),
    csvRow([
      "Machine",
      "Orders",
      "Sticks/items",
      "Gross sales",
      "Machine taxes",
      "Stick cost deduction",
      "Costs",
      "Net sales",
    ]),
    ...((preview.machines ?? []).map((machine) =>
      csvRow([
        machine.machine_label ?? "",
        formatInteger(machine.order_count),
        formatInteger(machine.item_quantity),
        formatCurrency(machine.gross_sales_cents),
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

type PdfLine = {
  text: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  color?: "dark" | "muted" | "pink";
};

const pdfText = (
  { text, x, y, size = 9, bold = false, color = "dark" }: PdfLine,
) => {
  const colorCommand = color === "pink"
    ? "0.88 0.20 0.42 rg"
    : color === "muted"
    ? "0.35 0.39 0.48 rg"
    : "0.05 0.08 0.16 rg";
  return `BT\n${colorCommand}\n/${
    bold ? "F2" : "F1"
  } ${size} Tf\n${x} ${y} Td\n(${escapePdfText(text)}) Tj\nET`;
};

const pdfLine = (x1: number, y: number, x2: number) =>
  `q\n0.88 0.90 0.94 RG\n0.7 w\n${x1} ${y} m\n${x2} ${y} l\nS\nQ`;

const pdfBox = (x: number, y: number, width: number, height: number) =>
  `q\n0.98 0.98 0.99 rg\n${x} ${y} ${width} ${height} re\nf\n0.90 0.91 0.94 RG\n0.7 w\n${x} ${y} ${width} ${height} re\nS\nQ`;

const createPage = (lines: string[]) => lines.join("\n");

export const buildPartnerReportPdf = ({
  preview,
  payoutRecipientLabels,
  calculationLabel,
  generatedAt,
}: PartnerReportExportContext): Uint8Array => {
  const summary = preview.summary ?? {};
  const machines = preview.machines ?? [];
  const warnings = preview.warnings ?? [];
  const pages: string[] = [];
  const partnerLabel = getPartnerPayoutLabel(payoutRecipientLabels);
  const additionalPartnerLabel = payoutRecipientLabels[1];
  const generatedAtLabel = formatGeneratedAt(generatedAt);
  const machineChunks: PartnerReportMachine[][] = [];
  const firstPageMachineCount = warnings.length > 0 ? 12 : 14;

  if (machines.length === 0) {
    machineChunks.push([]);
  } else {
    machineChunks.push(machines.slice(0, firstPageMachineCount));
  }
  for (
    let index = firstPageMachineCount;
    index < machines.length;
    index += 22
  ) {
    machineChunks.push(machines.slice(index, index + 22));
  }

  machineChunks.forEach((chunk, pageIndex) => {
    const lines: string[] = [];
    lines.push("q\n0.88 0.20 0.42 rg\n0 748 612 44 re\nf\nQ");
    lines.push(
      pdfText({
        text: "Bloomjoy Partner Weekly Report",
        x: 44,
        y: 766,
        size: 17,
        bold: true,
        color: "dark",
      }),
    );
    lines.push(
      pdfText({
        text: toAscii(preview.partnershipName ?? "Partner report"),
        x: 44,
        y: 728,
        size: 14,
        bold: true,
      }),
    );
    lines.push(
      pdfText({
        text: `${preview.weekStartDate ?? ""} through ${
          preview.weekEndingDate ?? ""
        }`,
        x: 44,
        y: 712,
        size: 9,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: `Generated ${generatedAtLabel}`,
        x: 384,
        y: 728,
        size: 8,
        color: "muted",
      }),
    );

    if (pageIndex === 0) {
      const cards = [
        ["Orders", formatInteger(summary.order_count)],
        ["Sticks/items", formatInteger(summary.item_quantity)],
        ["Gross sales", formatCurrency(summary.gross_sales_cents)],
        ["Machine taxes", formatCurrency(summary.tax_cents)],
        ["Stick cost deduction", formatCurrency(summary.fee_cents)],
        ["Net sales", formatCurrency(summary.net_sales_cents)],
        [partnerLabel, formatCurrency(summary.fever_profit_cents)],
        ["Bloomjoy retained", formatCurrency(summary.bloomjoy_profit_cents)],
      ];
      if (additionalPartnerLabel) {
        cards.splice(7, 0, [
          additionalPartnerLabel,
          formatCurrency(summary.partner_profit_cents),
        ]);
      }
      cards.slice(0, 8).forEach(([label, value], index) => {
        const x = 44 + (index % 4) * 132;
        const y = 656 - Math.floor(index / 4) * 62;
        lines.push(pdfBox(x, y, 118, 46));
        wrapText(label.toUpperCase(), 18, 2).forEach((labelLine, lineIndex) => {
          lines.push(
            pdfText({
              text: labelLine,
              x: x + 9,
              y: y + 31 - lineIndex * 8,
              size: 6.5,
              color: "muted",
              bold: true,
            }),
          );
        });
        lines.push(
          pdfText({ text: value, x: x + 9, y: y + 13, size: 12, bold: true }),
        );
      });
      lines.push(
        pdfText({
          text: "Calculation basis",
          x: 44,
          y: 518,
          size: 10,
          bold: true,
        }),
      );
      wrapText(calculationLabel, 104, 2).forEach((calculationLine, index) => {
        lines.push(
          pdfText({
            text: calculationLine,
            x: 44,
            y: 504 - index * 12,
            size: 8,
            color: "muted",
          }),
        );
      });
    }

    const tableTop = pageIndex === 0 ? 454 : 676;
    lines.push(
      pdfText({
        text: "Machine rollup",
        x: 44,
        y: tableTop,
        size: 11,
        bold: true,
      }),
    );
    lines.push(pdfLine(44, tableTop - 8, 568));
    lines.push(
      pdfText({
        text: "Machine",
        x: 44,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Orders",
        x: 252,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Items",
        x: 300,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Gross",
        x: 345,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Tax",
        x: 414,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Stick cost",
        x: 468,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );
    lines.push(
      pdfText({
        text: "Net",
        x: 536,
        y: tableTop - 24,
        size: 7,
        bold: true,
        color: "muted",
      }),
    );

    const tableRows = chunk.length ? chunk : [];
    tableRows.forEach((machine, index) => {
      const y = tableTop - 44 - index * 24;
      lines.push(pdfLine(44, y - 8, 568));
      lines.push(
        pdfText({
          text: truncate(machine.machine_label ?? "", 31),
          x: 44,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatInteger(machine.order_count),
          x: 252,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatInteger(machine.item_quantity),
          x: 300,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatCurrency(machine.gross_sales_cents),
          x: 345,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatCurrency(machine.tax_cents),
          x: 414,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatCurrency(machine.fee_cents),
          x: 468,
          y,
          size: 8,
        }),
      );
      lines.push(
        pdfText({
          text: formatCurrency(machine.net_sales_cents),
          x: 536,
          y,
          size: 8,
        }),
      );
    });

    if (pageIndex === 0 && warnings.length > 0) {
      const warningY = 94;
      lines.push(
        pdfText({
          text: "Warnings",
          x: 44,
          y: warningY,
          size: 10,
          bold: true,
          color: "pink",
        }),
      );
      warnings.slice(0, 3).forEach((warning, index) => {
        lines.push(
          pdfText({
            text: truncate(warning.message ?? "", 94),
            x: 44,
            y: warningY - 16 - index * 13,
            size: 8,
            color: "muted",
          }),
        );
      });
    }

    lines.push(
      pdfText({
        text: `Page ${pageIndex + 1} of ${machineChunks.length}`,
        x: 508,
        y: 34,
        size: 8,
        color: "muted",
      }),
    );
    pages.push(createPage(lines));
  });

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${
      pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")
    }] /Count ${pages.length} >>`,
  ];

  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${
        3 + pages.length * 2
      } 0 R /F2 ${
        4 + pages.length * 2
      } 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${
        encoder.encode(page).length
      } >>\nstream\n${page}\nendstream`,
    );
  });

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
};

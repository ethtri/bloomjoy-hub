// Native report observations are not payment instructions or terminal receipts.
// Contract: first delivered TGpaci CSV, 2026-09-03 (#973).
export const NAYAX_REPORT_MAX_BYTES = 5 * 1024 * 1024;
export const NAYAX_REPORT_HEADERS = [
  "transaction_id",
  "original_transaction_id",
  "site_id",
  "actor_id",
  "actor_hierarchy",
  "machine_id",
  "machine_name",
  "operator_identifier",
  "currency",
  "auValue",
  "seValue",
  "payed_value",
  "machineAuTime",
  "machineSeTime",
  "auTime",
  "seTime",
  "updated_dt",
  "tran_status_id",
  "tran_status_name",
];
export const NAYAX_REPORT_EXTRA_HEADERS = ["payment_method_id_enc"];
const bad = () => new Error("nayax_report_contract_invalid");
const identifier = (value: string) => {
  if (!/^\d{1,30}$/.test(value)) throw bad();
  return value;
};

export function parseNayaxReportCsv(text: string): Record<string, string>[] {
  if (new TextEncoder().encode(text).length > NAYAX_REPORT_MAX_BYTES) {
    throw bad();
  }
  const lines: string[][] = [];
  let line: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw bad();
      quoted = true;
      continue;
    }
    if (c === "," || c === "\r" || c === "\n") {
      line.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (line.some(Boolean)) lines.push(line);
        line = [];
      }
      continue;
    }
    if (closed) throw bad();
    cell += c;
  }
  if (quoted) throw bad();
  line.push(cell);
  if (line.some(Boolean)) lines.push(line);
  const headers = lines.shift();
  if (
    !headers || new Set(headers).size !== headers.length ||
    NAYAX_REPORT_HEADERS.some((h) => !headers.includes(h)) ||
    headers.some((h) =>
      ![...NAYAX_REPORT_HEADERS, ...NAYAX_REPORT_EXTRA_HEADERS].includes(h)
    ) || lines.length > 10000
  ) throw bad();
  return lines.map((values) => {
    if (values.length !== headers.length) throw bad();
    return Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]));
  });
}

export function reportMoneyCents(value: string) {
  const m = value.match(/^(-?)(\d{1,8})(?:\.(\d{1,4}))?$/);
  if (!m) throw bad();
  const fraction = (m[3] ?? "").padEnd(4, "0");
  if (fraction.slice(2) !== "00") throw bad();
  const n = (Number(m[2]) * 100 + Number(fraction.slice(0, 2))) *
    (m[1] ? -1 : 1);
  if (!Number.isSafeInteger(n)) throw bad();
  return n;
}
export function reportTimestamp(value: string, utc: boolean) {
  if (!value) return null;
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw bad();
  const [, day, month, year, hour, minute, second] = m;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const parsed = new Date(`${iso}Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== iso
  ) throw bad();
  return utc ? `${iso}Z` : iso;
}
export async function reportDigest(value: string | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  ).map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function normalizeNayaxScheduledReport(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > NAYAX_REPORT_MAX_BYTES) throw bad();
  const rows = parseNayaxReportCsv(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const observations: Array<Record<string, string | number | null>> = [];
  const identities = new Map<string, string>();
  const actorCounts: Record<string, number> = {};
  for (const row of rows) {
    const actorId = identifier(row.actor_id);
    actorCounts[actorId] = (actorCounts[actorId] ?? 0) + 1;
    // Both actors were present in the actual parent delivery. Other actors await mapping evidence.
    if (!["2001508696", "2003563806"].includes(actorId)) throw bad();
    const normalized = {
      transactionId: identifier(row.transaction_id),
      originalTransactionId: row.original_transaction_id
        ? identifier(row.original_transaction_id)
        : null,
      siteId: identifier(row.site_id),
      actorId,
      providerMachineId: identifier(row.machine_id),
      currencyCode: row.currency,
      authorizationAmountCents: reportMoneyCents(row.auValue),
      settlementAmountCents: reportMoneyCents(row.seValue),
      // Nayax leaves payed_value blank on some rows without a current refund
      // signal. Keep it unknown rather than inventing a zero amount.
      // Refund-like rows still fail closed below.
      paidAmountCents: row.payed_value
        ? reportMoneyCents(row.payed_value)
        : null,
      machineAuthorizedAt: reportTimestamp(row.machineAuTime, false),
      machineSettledAt: reportTimestamp(row.machineSeTime, false),
      authorizedAt: reportTimestamp(row.auTime, true),
      providerSettledAt: reportTimestamp(row.seTime, true),
      updatedAt: reportTimestamp(row.updated_dt, true),
      providerStatus: row.tran_status_id
        ? Number(identifier(row.tran_status_id))
        : null,
      providerStatusName: row.tran_status_name || null,
      paymentMethodId: row.payment_method_id_enc
        ? identifier(row.payment_method_id_enc)
        : null,
    };
    if (
      !/^[A-Z]{3}$/.test(normalized.currencyCode) ||
      row.tran_status_name.length > 100
    ) throw bad();
    if (
      normalized.paidAmountCents === null &&
      (normalized.originalTransactionId !== null ||
        normalized.authorizationAmountCents < 0 ||
        normalized.settlementAmountCents < 0 ||
        [62, 63].includes(normalized.providerStatus ?? 0))
    ) throw bad();
    const identity =
      `${actorId}:${normalized.siteId}:${normalized.transactionId}`;
    const digest = await reportDigest(JSON.stringify(normalized));
    if (identities.has(identity) && identities.get(identity) !== digest) {
      throw bad();
    }
    identities.set(identity, digest);
    if (
      normalized.originalTransactionId ||
      (normalized.paidAmountCents !== null &&
        normalized.paidAmountCents < 0) ||
      [62, 63].includes(normalized.providerStatus ?? 0)
    ) {
      if (!observations.some((o) => o.observationDigest === digest)) {
        observations.push({ ...normalized, observationDigest: digest });
      }
    }
  }
  return {
    fileDigest: await reportDigest(bytes),
    byteCount: bytes.length,
    rowCount: rows.length,
    actorCounts,
    observations,
    terminalEvidenceProven: false as const,
    reportingPeriod: null,
    settlementTimePrecision: "unknown" as const,
  };
}

export function requireNayaxReportDownloadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw bad();
  }
  if (
    url.protocol !== "https:" || url.hostname !== "my.nayax.com" || url.port ||
    url.username || url.password || url.hash ||
    url.pathname !== "/core/reports/download" ||
    [...url.searchParams.keys()].join() !== "file" ||
    !/^[-_A-Za-z0-9]{16,2048}$/.test(url.searchParams.get("file") ?? "")
  ) throw bad();
  return url.toString();
}
export async function downloadNayaxScheduledReport(
  url: string,
  fetcher: typeof fetch = fetch,
) {
  // No cookies/Authorization, no redirects to an unverified download host, no URL logging.
  const response = await fetcher(requireNayaxReportDownloadUrl(url), {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || !response.body) {
    throw new Error("nayax_report_download_unavailable");
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > NAYAX_REPORT_MAX_BYTES) throw bad();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > NAYAX_REPORT_MAX_BYTES) throw bad();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  normalizeRefundGoogleFormResponse,
  REFUND_GOOGLE_FORM_CONTRACT_VERSION,
  refundGoogleFormValuesToRows,
  validateRefundGoogleFormHeaders,
} from "../_shared/refund-google-form.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = Deno.env.get("REFUND_GOOGLE_FORM_SYNC_SECRET");
const syncEnabled = Deno.env.get("REFUND_GOOGLE_FORM_SYNC_ENABLED") === "true";
const sheetId = Deno.env.get("REFUND_GOOGLE_FORM_SHEET_ID");
const sheetRange = Deno.env.get("REFUND_GOOGLE_FORM_SHEET_RANGE") || "'Form Responses 1'!A:K";
const sourceSalt = Deno.env.get("REFUND_GOOGLE_FORM_SOURCE_SALT");
const sourceStartAtRaw = Deno.env.get("REFUND_GOOGLE_FORM_START_AT");
const googleServiceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
const encoder = new TextEncoder();
const defaultRowLimit = 50;
const maxRowLimit = 100;

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
  : null;

type GoogleServiceAccount = {
  client_email?: string;
  private_key?: string;
};

type IngestResult = {
  created?: boolean;
  updated?: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  importStatus?: string;
  reason?: string | null;
};

type SyncCounts = {
  rowsSeen: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsDuplicate: number;
  rowsQuarantined: number;
  rowsRejected: number;
  rowsSkipped: number;
  rowsFailed: number;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength = 240) =>
  String(value ?? "").trim().slice(0, maxLength);

const parseBoolean = (value: unknown) => value === true || String(value ?? "").toLowerCase() === "true";

const parseNonNegativeInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const parsePositiveInteger = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
};

const base64Url = (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const binary = [...bytes].map((byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const pemToArrayBuffer = (pem: string) => {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const createGoogleAccessToken = async () => {
  if (!googleServiceAccountJson) throw new Error("google_credentials_missing");

  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(googleServiceAccountJson) as GoogleServiceAccount;
  } catch {
    throw new Error("google_credentials_invalid");
  }

  const clientEmail = sanitizeText(credentials.client_email, 320);
  const privateKey = sanitizeText(credentials.private_key, 10000);
  const tokenUri = "https://oauth2.googleapis.com/token";
  if (!clientEmail || !privateKey) throw new Error("google_credentials_incomplete");

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: tokenUri,
    exp: now + 3600,
    iat: now,
  }))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsignedJwt)),
  );
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${base64Url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error("google_authentication_failed");
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const token = sanitizeText(body.access_token, 4096);
  if (!token) throw new Error("google_access_token_missing");
  return token;
};

const fetchSheet = async () => {
  if (!sheetId) throw new Error("sheet_id_missing");
  const titleMatch = sheetRange.match(/^(?:'((?:[^']|'')+)'|([^!]+))!/);
  const sheetTitle = sanitizeText((titleMatch?.[1] ?? titleMatch?.[2] ?? "").replace(/''/g, "'"), 240);
  if (!sheetTitle) throw new Error("sheet_range_must_name_tab");
  const token = await createGoogleAccessToken();
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`);
  metadataUrl.searchParams.set("fields", "properties(timeZone),sheets(properties(title))");
  const escapedSheetTitle = sheetTitle.replace(/'/g, "''");
  const headerRange = `'${escapedSheetTitle}'!1:1`;
  const headerUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(headerRange)}`,
  );
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(sheetRange)}`,
  );
  for (const url of [headerUrl, valuesUrl]) {
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");
  }

  const [metadataResponse, headerResponse, valuesResponse] = await Promise.all([
    fetch(metadataUrl, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(headerUrl, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(valuesUrl, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (!metadataResponse.ok) throw new Error("sheet_metadata_fetch_failed");
  if (!headerResponse.ok) throw new Error("sheet_header_fetch_failed");
  if (!valuesResponse.ok) throw new Error("sheet_values_fetch_failed");

  const metadata = await metadataResponse.json().catch(() => ({})) as Record<string, unknown>;
  const properties = (metadata.properties ?? {}) as Record<string, unknown>;
  const timezone = sanitizeText(properties.timeZone, 120);
  if (!timezone) throw new Error("sheet_timezone_missing");
  const sheets = Array.isArray(metadata.sheets) ? metadata.sheets as Array<Record<string, unknown>> : [];
  const matchingTitles = sheets.filter((sheet) => {
    const sheetProperties = (sheet.properties ?? {}) as Record<string, unknown>;
    return sanitizeText(sheetProperties.title, 240) === sheetTitle;
  });
  if (matchingTitles.length !== 1) throw new Error("sheet_tab_not_found");

  const headerBody = await headerResponse.json().catch(() => ({})) as Record<string, unknown>;
  const headerValues = Array.isArray(headerBody.values) ? headerBody.values as unknown[][] : [];
  const body = await valuesResponse.json().catch(() => ({})) as Record<string, unknown>;
  const values = Array.isArray(body.values) ? body.values as unknown[][] : [];
  return { timezone, headerValues, values };
};

const hmacHex = async (purpose: string, value: string) => {
  if (!sourceSalt || sourceSalt.length < 32) throw new Error("source_salt_missing_or_short");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sourceSalt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}|${value}`)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const parseStartBoundary = () => {
  if (!sourceStartAtRaw) return null;
  const date = new Date(sourceStartAtRaw);
  if (!Number.isFinite(date.getTime())) throw new Error("source_start_boundary_invalid");
  return date.toISOString();
};

const emptyCounts = (): SyncCounts => ({
  rowsSeen: 0,
  rowsImported: 0,
  rowsUpdated: 0,
  rowsDuplicate: 0,
  rowsQuarantined: 0,
  rowsRejected: 0,
  rowsSkipped: 0,
  rowsFailed: 0,
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!syncSecret) return jsonResponse({ error: "sync_secret_not_configured" }, 500);
  if (req.headers.get("Authorization") !== `Bearer ${syncSecret}`) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const dryRun = parseBoolean(body.dryRun ?? body.dry_run);
  const rowOffset = parseNonNegativeInteger(body.rowOffset ?? body.row_offset, 0);
  const rowLimit = parsePositiveInteger(body.rowLimit ?? body.row_limit, defaultRowLimit, maxRowLimit);
  const requestedTrigger = sanitizeText(body.triggerSource ?? body.trigger_source, 40).toLowerCase();
  const triggerSource = ["scheduled", "manual", "synthetic_test"].includes(requestedTrigger)
    ? requestedTrigger
    : "manual";
  const runKey = sanitizeText(body.runKey ?? body.run_key, 240) || crypto.randomUUID();
  const counts = emptyCounts();
  let runId: string | null = null;

  if (!dryRun && !syncEnabled) {
    return jsonResponse({
      status: "disabled",
      source: "sms_google_form",
      dryRun: false,
      contractVersion: REFUND_GOOGLE_FORM_CONTRACT_VERSION,
    });
  }
  if (!dryRun && !supabase) return jsonResponse({ error: "supabase_not_configured" }, 500);
  if (!dryRun && !sourceStartAtRaw) {
    return jsonResponse({ error: "source_start_boundary_not_configured" }, 500);
  }

  try {
    const sourceStartAt = parseStartBoundary();

    if (!dryRun && supabase) {
      const { data, error } = await supabase.rpc("service_start_refund_google_form_sync", {
        p_run_key: runKey,
        p_trigger_source: triggerSource,
        p_source_version: REFUND_GOOGLE_FORM_CONTRACT_VERSION,
        p_started_at: new Date().toISOString(),
      });
      if (error) throw new Error("run_claim_failed");
      const claim = data as { claimed?: boolean; runId?: string; status?: string } | null;
      runId = claim?.runId ?? null;
      if (!claim?.claimed) {
        return jsonResponse({
          status: "duplicate_suppressed",
          source: "sms_google_form",
          runId,
          priorStatus: claim?.status ?? null,
          dryRun: false,
        });
      }
    }

    const fetched = await fetchSheet();
    const headerContract = validateRefundGoogleFormHeaders(fetched.headerValues);
    if (!headerContract.valid) throw new Error("sheet_contract_mismatch");

    const allRows = refundGoogleFormValuesToRows(fetched.values);
    const effectiveOffset = Math.min(rowOffset, allRows.length);
    const rows = allRows.slice(effectiveOffset, effectiveOffset + rowLimit);

    for (const row of rows) {
      counts.rowsSeen += 1;
      const normalized = normalizeRefundGoogleFormResponse(row);

      if (dryRun) {
        if (normalized.invalidFields.length > 0) counts.rowsRejected += 1;
        else if (normalized.missingFields.length > 0) counts.rowsQuarantined += 1;
        else counts.rowsImported += 1;
        continue;
      }

      try {
        const sourceKeyHash = await hmacHex("source-row", `${sheetId}|${row.rowNumber}`);
        const payloadFingerprint = await hmacHex("payload", normalized.fingerprintMaterial);
        const { data, error } = await supabase!.rpc("service_ingest_refund_google_form_response", {
          p_run_id: runId,
          p_source_response_key_hash: sourceKeyHash,
          p_source_payload_fingerprint: payloadFingerprint,
          p_source_row_number: row.rowNumber,
          p_source_submitted_local_datetime: normalized.sourceSubmittedLocalDateTime,
          p_source_timezone: fetched.timezone,
          p_source_version: REFUND_GOOGLE_FORM_CONTRACT_VERSION,
          p_source_start_at: sourceStartAt,
          p_customer_email: normalized.customerEmail,
          p_customer_name: normalized.customerName,
          p_source_location: normalized.sourceLocation,
          p_incident_local_datetime: normalized.incidentLocalDateTime,
          p_issue_summary: normalized.issueSummary,
          p_payment_method: normalized.paymentMethod,
          p_payment_amount_cents: normalized.paymentAmountCents,
          p_card_last4: normalized.cardLast4,
          p_card_wallet_used: normalized.cardWalletUsed,
          p_cash_payment_preference: normalized.cashPaymentPreference,
          p_cash_payment_contact: normalized.cashPaymentContact,
          p_missing_fields: normalized.missingFields,
          p_invalid_fields: normalized.invalidFields,
        });
        if (error) throw new Error("row_ingest_failed");

        const result = (data ?? {}) as IngestResult;
        if (result.skipped) counts.rowsSkipped += 1;
        else if (result.duplicate) counts.rowsDuplicate += 1;
        else if (result.updated) counts.rowsUpdated += 1;
        else if (result.importStatus === "imported") counts.rowsImported += 1;
        else if (result.importStatus === "quarantined") counts.rowsQuarantined += 1;
        else counts.rowsRejected += 1;
      } catch {
        counts.rowsFailed += 1;
        console.error("refund-google-form-sync row failed", { rowNumber: row.rowNumber, errorCode: "row_ingest_failed" });
      }
    }

    const finalStatus = counts.rowsFailed > 0 ? "failed" : "completed";
    if (!dryRun && supabase && runId) {
      await supabase.rpc("service_finish_refund_google_form_sync", {
        p_run_id: runId,
        p_status: finalStatus,
        p_counts: counts,
        p_error_code: counts.rowsFailed > 0 ? "one_or_more_rows_failed" : null,
        p_meta: {
          contract_version: REFUND_GOOGLE_FORM_CONTRACT_VERSION,
          source_rows_total: allRows.length,
          row_offset: effectiveOffset,
          row_limit: rowLimit,
          has_more: effectiveOffset + rows.length < allRows.length,
          pii_redacted: true,
        },
      });
    }

    return jsonResponse({
      status: finalStatus,
      source: "sms_google_form",
      dryRun,
      runId,
      contractVersion: REFUND_GOOGLE_FORM_CONTRACT_VERSION,
      sourceRowsTotal: allRows.length,
      rowOffset: effectiveOffset,
      rowLimit,
      nextRowOffset: effectiveOffset + rows.length,
      hasMore: effectiveOffset + rows.length < allRows.length,
      ...counts,
    }, finalStatus === "failed" ? 500 : 200);
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "sync_failed";
    if (!dryRun && supabase && runId) {
      await supabase.rpc("service_finish_refund_google_form_sync", {
        p_run_id: runId,
        p_status: "failed",
        p_counts: counts,
        p_error_code: errorCode,
        p_meta: { contract_version: REFUND_GOOGLE_FORM_CONTRACT_VERSION, pii_redacted: true },
      });
    }
    console.error("refund-google-form-sync failed", { errorCode });
    return jsonResponse({
      status: "failed",
      source: "sms_google_form",
      runId,
      error: errorCode,
    }, 500);
  }
});

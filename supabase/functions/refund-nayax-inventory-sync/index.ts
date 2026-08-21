import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REFUND_NAYAX_INVENTORY_SYNC_SECRET");
const enabled = Deno.env.get("REFUND_NAYAX_INVENTORY_SYNC_ENABLED") === "true";
const baseUrl = (Deno.env.get("NAYAX_LYNX_BASE_URL") || "https://lynx.nayax.com/operational/v1").replace(/\/+$/, "");
const configuredAccounts = (Deno.env.get("REFUND_NAYAX_INVENTORY_ACCOUNT_KEYS") || "TGPACI_USA_DB")
  .split(",")
  .map((value) => value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"))
  .filter(Boolean);

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

type JsonObject = Record<string, unknown>;

const jsonResponse = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const text = (value: unknown, max = 240) =>
  value === null || value === undefined ? "" : String(value).trim().slice(0, max);

const field = (record: JsonObject, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return "";
};

const recordsFromPayload = (payload: unknown): JsonObject[] => {
  if (Array.isArray(payload)) return payload.filter((row): row is JsonObject => Boolean(row) && typeof row === "object");
  if (!payload || typeof payload !== "object") return [];
  const object = payload as JsonObject;
  for (const key of ["data", "Data", "machines", "Machines", "result", "Result", "records", "Records"]) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).filter((row): row is JsonObject => Boolean(row) && typeof row === "object");
    }
  }
  return [];
};

const normalizeRecord = (record: JsonObject) => {
  const statusText = text(field(record, "MachineStatusBit", "machineStatusBit"), 20);
  const statusBit = /^-?\d+$/.test(statusText) ? Number(statusText) : null;
  return {
    machineId: text(field(record, "MachineID", "MachineId", "machineId"), 160),
    machineName: text(field(record, "MachineName", "Machine_Name", "machineName"), 240),
    machineNumber: text(field(record, "MachineNumber", "Machine_Number", "machineNumber"), 160),
    machineTypeId: text(field(record, "MachineTypeID", "MachineTypeId", "machineTypeId"), 120),
    statusBit,
    active: statusBit === 1,
  };
};

const tokenForAccount = (accountKey: string) =>
  Deno.env.get(`NAYAX_LYNX_API_TOKEN_${accountKey}`) ||
  (accountKey === "TGPACI_USA_DB" ? Deno.env.get("NAYAX_LYNX_API_TOKEN") : "") ||
  "";

const recordFailure = async (runKey: string, accountKey: string, errorCode: string) => {
  if (!supabase) return;
  await supabase.rpc("service_sync_refund_nayax_inventory", {
    p_run_key: runKey,
    p_account_key: accountKey,
    p_snapshot: [],
    p_succeeded: false,
    p_error_code: errorCode,
  });
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization") || "";
  if (!schedulerSecret || authorization !== `Bearer ${schedulerSecret}`) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }
  if (!supabase) return jsonResponse({ error: "Inventory service is not configured." }, 503);

  let body: JsonObject = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const healthCheck = body.operation === "health_check";
  if (healthCheck) {
    const { data, error } = await supabase
      .from("refund_nayax_inventory_runs")
      .select("status,completed_at,error_code")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return jsonResponse({ error: "Unable to read inventory health." }, 503);
    const ageMinutes = data?.completed_at ? (Date.now() - new Date(data.completed_at).getTime()) / 60_000 : null;
    const healthy = data?.status === "completed" && ageMinutes !== null && ageMinutes <= 180;
    return jsonResponse({ status: healthy ? "healthy" : "attention", latestRunStatus: data?.status ?? "missing", ageMinutes });
  }

  if (!enabled) {
    return jsonResponse({ status: "disabled", accountsConfigured: configuredAccounts.length, writesApplied: 0 });
  }

  const requestedAccount = text(body.accountKey, 80).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const accounts = requestedAccount ? configuredAccounts.filter((key) => key === requestedAccount) : configuredAccounts;
  if (accounts.length === 0) return jsonResponse({ error: "Requested account is not configured." }, 400);

  const runPrefix = text(body.runKey, 120) || `scheduled-${new Date().toISOString().slice(0, 16)}`;
  const results: JsonObject[] = [];

  for (const accountKey of accounts) {
    const runKey = `${runPrefix}:${accountKey}`;
    const token = tokenForAccount(accountKey);
    if (!token) {
      await recordFailure(runKey, accountKey, "token_missing");
      results.push({ accountKey, status: "failed", errorCode: "token_missing" });
      continue;
    }

    try {
      const response = await fetch(`${baseUrl}/machines?ResultsLimit=1000`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
      const payload = await response.json();
      const records = recordsFromPayload(payload).map(normalizeRecord);
      if (records.length === 0) throw new Error("empty_snapshot");
      if (records.some((record) => !record.machineId)) throw new Error("missing_machine_id");
      if (new Set(records.map((record) => record.machineId)).size !== records.length) throw new Error("duplicate_machine_id");

      const { data, error } = await supabase.rpc("service_sync_refund_nayax_inventory", {
        p_run_key: runKey,
        p_account_key: accountKey,
        p_snapshot: records,
        p_succeeded: true,
        p_error_code: null,
      });
      if (error) throw new Error("inventory_write_failed");
      results.push(data as JsonObject);
    } catch (error) {
      const errorCode = error instanceof Error
        ? text(error.message, 120).toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "sync_failed"
        : "sync_failed";
      await recordFailure(runKey, accountKey, errorCode);
      results.push({ accountKey, status: "failed", errorCode });
    }
  }

  const failed = results.filter((result) => result.status === "failed").length;
  return jsonResponse({
    status: failed === 0 ? "completed" : "failed",
    accountCount: results.length,
    failedAccountCount: failed,
    results,
  }, failed === 0 ? 200 : 502);
});

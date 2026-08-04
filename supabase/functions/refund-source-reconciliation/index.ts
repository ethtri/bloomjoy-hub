import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const monitorSecret = (Deno.env.get("REFUND_SOURCE_RECONCILIATION_SECRET") ?? "").trim();
const monitorEnabled = Deno.env.get("REFUND_SOURCE_RECONCILIATION_ENABLED") === "true";

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const safeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length || leftBytes.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

const authorize = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  return Boolean(monitorSecret) && safeEqual(token, monitorSecret);
};

type SourceHealth = {
  source?: unknown;
  label?: unknown;
  status?: unknown;
  lastSuccessfulAt?: unknown;
  oldestUnprocessedAt?: unknown;
  lagMinutes?: unknown;
  importedCount?: unknown;
  failedCount?: unknown;
  unmappedCount?: unknown;
  quarantinedCount?: unknown;
  possibleDuplicateCount?: unknown;
  stale?: unknown;
  quarantineVisible?: unknown;
};

type Reconciliation = {
  windowStart?: unknown;
  windowEnd?: unknown;
  sourceSubmissionCount?: unknown;
  representedItemCount?: unknown;
  visibleQuarantineCount?: unknown;
  delta?: unknown;
  reconciled?: unknown;
  quarantineVisible?: unknown;
};

const safeSource = (source: SourceHealth) => ({
  source: String(source.source ?? "unknown").slice(0, 40),
  label: String(source.label ?? "Unknown source").slice(0, 80),
  status: String(source.status ?? "unknown").slice(0, 40),
  lastSuccessfulAt: source.lastSuccessfulAt ?? null,
  oldestUnprocessedAt: source.oldestUnprocessedAt ?? null,
  lagMinutes: Number(source.lagMinutes ?? 0),
  importedCount: Number(source.importedCount ?? 0),
  failedCount: Number(source.failedCount ?? 0),
  unmappedCount: Number(source.unmappedCount ?? 0),
  quarantinedCount: Number(source.quarantinedCount ?? 0),
  possibleDuplicateCount: Number(source.possibleDuplicateCount ?? 0),
  stale: source.stale === true,
  quarantineVisible: source.quarantineVisible === true,
  payloadRedacted: true,
});

const safeReconciliation = (value: Reconciliation) => ({
  windowStart: value.windowStart ?? null,
  windowEnd: value.windowEnd ?? null,
  sourceSubmissionCount: Number(value.sourceSubmissionCount ?? 0),
  representedItemCount: Number(value.representedItemCount ?? 0),
  visibleQuarantineCount: Number(value.visibleQuarantineCount ?? 0),
  delta: Number(value.delta ?? 0),
  reconciled: value.reconciled === true,
  quarantineVisible: value.quarantineVisible === true,
  payloadRedacted: true,
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!authorize(request)) return jsonResponse({ error: "Unauthorized." }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.failureTest === true) {
    return jsonResponse({
      status: "attention",
      generatedAt: new Date().toISOString(),
      sources: [],
      reconciliation: {
        sourceSubmissionCount: 1,
        representedItemCount: 0,
        visibleQuarantineCount: 0,
        delta: 1,
        reconciled: false,
        quarantineVisible: true,
        payloadRedacted: true,
      },
      reasonCodes: ["synthetic_reconciliation_failure"],
      payloadRedacted: true,
    });
  }

  if (!monitorEnabled) {
    return jsonResponse({ status: "disabled", payloadRedacted: true });
  }
  if (!supabase) {
    return jsonResponse({ error: "Server configuration unavailable.", payloadRedacted: true }, 503);
  }

  const requestedHours = Math.max(1, Math.min(Number(body.windowHours ?? 24), 168));
  const windowStart = new Date(Date.now() - requestedHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("get_refund_source_queue_snapshot", {
    p_window_start: windowStart,
  });
  if (error) {
    return jsonResponse({
      error: "Source reconciliation unavailable.",
      reasonCodes: ["snapshot_rpc_failed"],
      payloadRedacted: true,
    }, 503);
  }

  const snapshot = (data ?? {}) as Record<string, unknown>;
  const sources = Array.isArray(snapshot.sources)
    ? snapshot.sources.map((source) => safeSource((source ?? {}) as SourceHealth))
    : [];
  const reconciliation = safeReconciliation((snapshot.reconciliation ?? {}) as Reconciliation);
  const reasonCodes = [
    ...(!reconciliation.reconciled ? ["source_count_delta"] : []),
    ...sources.filter((source) => ["stale", "failing", "revoked"].includes(source.status))
      .map((source) => `${source.source}_${source.status}`),
    ...sources.filter((source) => source.failedCount > 0).map((source) => `${source.source}_import_failure`),
    ...sources.filter((source) => source.unmappedCount > 0).map((source) => `${source.source}_unmapped`),
  ];

  return jsonResponse({
    status: reasonCodes.length > 0 ? "attention" : "healthy",
    generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
    sources,
    reconciliation,
    reasonCodes: [...new Set(reasonCodes)],
    payloadRedacted: true,
  });
});

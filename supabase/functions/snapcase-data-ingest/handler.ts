type JsonObject = Record<string, unknown>;

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

type HandlerOptions = {
  ingestToken: string | null | undefined;
  ingest: (payload: JsonObject) => Promise<RpcResult>;
  finalize: (sourceAccountKey: string, runKey: string) => Promise<RpcResult>;
};

const jsonResponse = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const safeCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const isBoundedBatch = (value: unknown) =>
  Array.isArray(value) && value.length <= 50;

const isEnvelope = (value: unknown): value is JsonObject => {
  if (!isObject(value) || value.contractVersion !== "snapcase.ingest.v1") return false;
  if (
    typeof value.sourceAccountKey !== "string" ||
    typeof value.runKey !== "string" ||
    typeof value.batchKey !== "string" ||
    typeof value.batchDigest !== "string"
  ) return false;
  return [value.machines, value.orders, value.payments, value.evidence].every(isBoundedBatch);
};

const hasPaymentEvidence = (payload: JsonObject) =>
  (payload.evidence as unknown[]).some((item) =>
    isObject(item) && item.resource === "payments"
  );

export const createSnapcaseIngestHandler = ({ ingestToken, ingest, finalize }: HandlerOptions) =>
  async (request: Request) => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!ingestToken || request.headers.get("Authorization") !== `Bearer ${ingestToken}`) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }
    if (!isEnvelope(payload)) {
      return jsonResponse({ error: "Invalid SnapCase ingest envelope." }, 400);
    }

    let result: RpcResult;
    try {
      result = await ingest(payload);
    } catch {
      return jsonResponse({ error: "SnapCase batch was not recorded." }, 502);
    }
    if (result.error || !isObject(result.data)) {
      return jsonResponse({ error: "SnapCase batch was not recorded." }, 502);
    }

    let finalization: JsonObject = {};
    if (hasPaymentEvidence(payload)) {
      let finalized: RpcResult;
      try {
        finalized = await finalize(
          payload.sourceAccountKey as string,
          payload.runKey as string,
        );
      } catch {
        return jsonResponse({ error: "SnapCase payment import was not finalized." }, 502);
      }
      if (finalized.error || !isObject(finalized.data)) {
        return jsonResponse({ error: "SnapCase payment import was not finalized." }, 502);
      }
      finalization = {
        completedWindowCount: safeCount(finalized.data.completedWindowCount),
        changedWindowCount: safeCount(finalized.data.changedWindowCount),
        publishedCashFactCount: safeCount(finalized.data.publishedCashFactCount),
      };
    }

    return jsonResponse({
      ok: result.data.recorded === true,
      duplicate: result.data.duplicate === true,
      machineCount: safeCount(result.data.machineCount),
      orderCount: safeCount(result.data.orderCount),
      paymentCount: safeCount(result.data.paymentCount),
      evidenceCount: safeCount(result.data.evidenceCount),
      ...finalization,
    });
  };

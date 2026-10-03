import type { AlertRpcClient } from "./machine-email-alert-delivery.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Inventory activity, textual attention states and failed reads are never connectivity evidence. */
export function explicitNayaxConnectivity(
  payload: unknown,
): { providerField: "IsOnline" | "isOnline"; isOnline: boolean } | null {
  const root = record(payload);
  if (!root) return null;
  const candidates = [root, record(root.data), record(root.Data)].filter((
    v,
  ): v is Record<string, unknown> => v !== null);
  const observed: Array<
    { providerField: "IsOnline" | "isOnline"; isOnline: boolean }
  > = [];
  for (const candidate of candidates) {
    for (const name of ["IsOnline", "isOnline"] as const) {
      if (candidate[name] !== undefined) {
        if (typeof candidate[name] !== "boolean") {
          return null;
        }
        observed.push({
          providerField: name,
          isOnline: candidate[name] as boolean,
        });
      }
    }
  }
  if (
    !observed.length ||
    observed.some((v) => v.isOnline !== observed[0].isOnline)
  ) return null;
  return observed[0];
}

export type SignalCollectionResult = {
  checkedDevices: number;
  recordedObservations: number;
  unavailableDevices: number;
  recordedQuietPeriods: number;
  deferredDevices: number;
};

/** Read only the established Nayax status resource; concurrency 2, at most 12 bootstrap reads. */
export async function collectMachineEmailSignals(
  {
    client,
    observedAt,
    tokenForAccount,
    baseUrl = "https://lynx.nayax.com/operational/v1",
    fetcher = fetch,
  }: {
    client: AlertRpcClient;
    observedAt: string;
    tokenForAccount: (accountKey: string) => string | undefined;
    baseUrl?: string;
    fetcher?: typeof fetch;
  },
): Promise<SignalCollectionResult> {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" || base.username || base.password ||
    base.search || base.hash
  ) throw new Error("email_alert_signal_origin_invalid");
  const response = await client.rpc("service_get_email_alert_signal_inputs", {
    p_observed_at: observedAt,
  });
  const input = record(response.data);
  if (
    response.error || !input || !Array.isArray(input.devices) ||
    !Array.isArray(input.quietPeriods)
  ) throw new Error("email_alert_signal_inputs_invalid");
  const followed = input.devices.filter((v) => record(v)?.subscribed === true);
  const bootstrap = input.devices.filter((v) => record(v)?.subscribed !== true);
  const devices = [...followed, ...bootstrap.slice(0, 12)];
  const result: SignalCollectionResult = {
    checkedDevices: 0,
    recordedObservations: 0,
    unavailableDevices: 0,
    recordedQuietPeriods: 0,
    deferredDevices: Math.max(0, bootstrap.length - 12),
  };
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < devices.length) {
      const device = record(devices[next++]);
      if (
        !device || typeof device.machineId !== "string" ||
        !uuid.test(device.machineId) ||
        typeof device.nayaxMachineId !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(device.nayaxMachineId) ||
        typeof device.nayaxAccountKey !== "string" ||
        !/^[A-Z0-9_]{1,80}$/.test(device.nayaxAccountKey)
      ) {
        result.unavailableDevices++;
        continue;
      }
      const token = tokenForAccount(device.nayaxAccountKey);
      if (!token) {
        result.unavailableDevices++;
        continue;
      }
      result.checkedDevices++;
      try {
        const status = await fetcher(
          `${base.toString().replace(/\/+$/, "")}/machines/${
            encodeURIComponent(device.nayaxMachineId)
          }/status`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!status.ok) {
          result.unavailableDevices++;
          continue;
        }
        const body = await status.text();
        if (body.length > 65_536) {
          result.unavailableDevices++;
          continue;
        }
        const observation = explicitNayaxConnectivity(JSON.parse(body));
        if (!observation) {
          result.unavailableDevices++;
          continue;
        }
        const stored = await client.rpc(
          "service_record_email_alert_device_observation",
          {
            p_machine_id: device.machineId,
            p_observed_at: new Date().toISOString(),
            p_provider_field: observation.providerField,
            p_is_online: observation.isOnline,
          },
        );
        if (stored.error) {
          result.unavailableDevices++;
          continue;
        }
        result.recordedObservations++;
      } catch {
        result.unavailableDevices++;
      }
    }
  }));
  // SQL produces candidates only from canonical counts and proved completed source windows.
  for (const raw of input.quietPeriods) {
    const candidate = record(raw);
    const payload = record(candidate?.payload);
    if (
      !candidate || typeof candidate.machineId !== "string" ||
      !uuid.test(candidate.machineId) ||
      candidate.evidenceSource !== "sunze_validated_payment_window" ||
      typeof candidate.signalKey !== "string" ||
      candidate.signalKey.length > 200 || !payload ||
      payload.coverageVerified !== true || payload.paymentScope !== "cash" ||
      !Number.isSafeInteger(payload.actualTransactions) ||
      (payload.actualTransactions as number) < 0 ||
      typeof payload.baselineTransactions !== "number" ||
      !Number.isFinite(payload.baselineTransactions) ||
      payload.baselineTransactions <= 0 ||
      !Number.isSafeInteger(payload.baselinePeriods) ||
      (payload.baselinePeriods as number) < 4 ||
      (payload.actualTransactions as number) >
        payload.baselineTransactions * 0.5 ||
      typeof payload.periodStart !== "string" ||
      typeof payload.periodEnd !== "string" ||
      Date.parse(payload.periodStart) >= Date.parse(payload.periodEnd) ||
      !Number.isFinite(Date.parse(payload.periodEnd)) ||
      Date.parse(payload.periodEnd) > Date.parse(observedAt) ||
      typeof candidate.validUntil !== "string" ||
      Date.parse(candidate.validUntil) <= Date.parse(observedAt)
    ) continue;
    const stored = await client.rpc("service_record_email_alert_signal", {
      p_signal: {
        schemaVersion: "machine_email_signal_v1",
        category: "sales-quiet",
        machineId: candidate.machineId,
        signalKey: candidate.signalKey,
        evidenceSource: candidate.evidenceSource,
        observedAt: candidate.observedAt,
        validUntil: candidate.validUntil,
        payload,
      },
    });
    if (!stored.error) result.recordedQuietPeriods++;
  }
  return result;
}

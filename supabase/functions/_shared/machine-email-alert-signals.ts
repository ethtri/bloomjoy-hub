import type { AlertRpcClient } from "./machine-email-alert-delivery.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Nayax documents MachineMQTTStatus as the current MQTT connection state:
 * https://devzone.nayax.com/reference/lynx/machines/get-specific-machine-statistics
 * It is not proof of whole-terminal availability or successful payments.
 * Inventory activity, timestamps, textual attention and undocumented IsOnline
 * fields are never substituted. The returned machine must match the queried mapping.
 */
export function explicitNayaxConnectivity(
  payload: unknown,
  expectedMachineId: string,
): { providerField: "MachineMQTTStatus"; connected: boolean } | null {
  const root = record(payload);
  if (
    !root || !/^[1-9][0-9]*$/.test(expectedMachineId) ||
    typeof root.MachineMQTTStatus !== "boolean" ||
    !(typeof root.MachineID === "string" ||
      (typeof root.MachineID === "number" &&
        Number.isSafeInteger(root.MachineID))) ||
    String(root.MachineID) !== expectedMachineId
  ) return null;
  return {
    providerField: "MachineMQTTStatus",
    connected: root.MachineMQTTStatus,
  };
}

export type SignalCollectionResult = {
  checkedDevices: number;
  recordedObservations: number;
  unavailableDevices: number;
  recordedQuietPeriods: number;
  deferredDevices: number;
  deferredQuietPeriods: number;
  budgetExhausted: boolean;
};

/** Read only the established Nayax status resource; concurrency 2, at most 12 bootstrap reads. */
export async function collectMachineEmailSignals(
  {
    client,
    observedAt,
    tokenForAccount,
    baseUrl = "https://lynx.nayax.com/operational/v1",
    fetcher = fetch,
    shouldContinue = () => true,
  }: {
    client: AlertRpcClient;
    observedAt: string;
    tokenForAccount: (accountKey: string) => string | undefined;
    baseUrl?: string;
    fetcher?: typeof fetch;
    shouldContinue?: () => boolean;
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
  const rotate = (values: unknown[]) => {
    values.sort((a, b) =>
      `${record(a)?.machineId ?? ""}|${record(a)?.signalKey ?? ""}`
        .localeCompare(
          `${record(b)?.machineId ?? ""}|${record(b)?.signalKey ?? ""}`,
        )
    );
    const tick = Math.floor(Date.parse(observedAt) / 300_000);
    const offset = values.length && Number.isFinite(tick)
      ? ((tick % values.length) + values.length) % values.length
      : 0;
    return [...values.slice(offset), ...values.slice(0, offset)];
  };
  const followed = input.devices.filter((v) => record(v)?.subscribed === true);
  const bootstrap = input.devices.filter((v) => record(v)?.subscribed !== true);
  // SQL may alternate disjoint bootstrap shortlists. A tick modulo list length
  // resonates with that rotation (e.g. only even positions ever lead a list).
  // Shuffle each shortlist with the full snapshot as a reproducible seed instead.
  const shuffledBootstrap = bootstrap.slice(0, 12).sort((a, b) =>
    String(record(a)?.machineId ?? "").localeCompare(
      String(record(b)?.machineId ?? ""),
    )
  );
  let seed = 2166136261;
  for (const char of observedAt) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  seed ||= 1;
  for (let i = shuffledBootstrap.length - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [shuffledBootstrap[i], shuffledBootstrap[j]] = [
      shuffledBootstrap[j],
      shuffledBootstrap[i],
    ];
  }
  // Inputs reserve all returned candidates in SQL. Rotate the stable followed
  // list each five-minute tick so a slow-provider deadline cannot keep admitting
  // the same prefix forever. Followed devices always precede bootstrap reads.
  const devices = [
    ...rotate(followed),
    ...shuffledBootstrap,
  ];
  const result: SignalCollectionResult = {
    checkedDevices: 0,
    recordedObservations: 0,
    unavailableDevices: 0,
    recordedQuietPeriods: 0,
    deferredDevices: Math.max(0, bootstrap.length - 12),
    deferredQuietPeriods: 0,
    budgetExhausted: false,
  };
  let next = 0;
  const deviceWork = Promise.all([0, 1].map(async () => {
    while (next < devices.length) {
      if (!shouldContinue()) {
        result.deferredDevices += devices.length - next;
        result.budgetExhausted = true;
        next = devices.length;
        break;
      }
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
        const observation = explicitNayaxConnectivity(
          JSON.parse(body),
          device.nayaxMachineId,
        );
        if (!observation) {
          result.unavailableDevices++;
          continue;
        }
        const stored = await client.rpc(
          "service_record_email_alert_device_observation",
          {
            p_machine_id: device.machineId,
            p_expected_account_key: device.nayaxAccountKey,
            p_expected_nayax_machine_id: device.nayaxMachineId,
            p_observed_at: new Date().toISOString(),
            p_provider_field: observation.providerField,
            p_is_online: observation.connected,
          },
        );
        if (stored.error || record(stored.data)?.recorded !== true) {
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
  // Admit quiet records independently of provider polling so a slow device
  // prefix cannot consume their whole window. Each lane shares the deadline;
  // rotated candidates prevent repeated no-op records from starving the tail.
  const quietPeriods = rotate([...input.quietPeriods]);
  const quietWork = (async () => {
    for (let i = 0; i < quietPeriods.length; i++) {
      if (!shouldContinue()) {
        result.deferredQuietPeriods = quietPeriods.length - i;
        result.budgetExhausted = true;
        break;
      }
      const raw = quietPeriods[i];
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
  })();
  const settled = await Promise.allSettled([deviceWork, quietWork]);
  if (settled.some((result) => result.status === "rejected")) {
    throw new Error("email_alert_signal_collection_failed");
  }
  return result;
}

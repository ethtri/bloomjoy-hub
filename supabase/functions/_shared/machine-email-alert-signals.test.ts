import {
  collectMachineEmailSignals,
  explicitNayaxConnectivity,
} from "./machine-email-alert-signals.ts";
import { fixtureId, fixtureVariants } from "./machine-email-alert-fixtures.ts";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
Deno.test("only documented MQTT booleans for the exact queried machine prove connection state", () => {
  assert(
    explicitNayaxConnectivity(
      { MachineID: 123, MachineMQTTStatus: false },
      "123",
    )?.connected ===
      false,
    "explicit false",
  );
  assert(
    explicitNayaxConnectivity(
      { MachineID: "123", MachineMQTTStatus: true },
      "123",
    )?.connected === true,
    "explicit true",
  );
  for (
    const payload of [
      { MachineStatusBit: 0 },
      { Status: "offline" },
      { machineStatus: { state: "attention" } },
      { IsOnline: "false" },
      { IsOnline: false, isOnline: true },
      { IsOnline: false, data: { IsOnline: true } },
      { MachineID: 123, MachineMQTTStatus: "false" },
      { MachineID: 123, MachineMQTTStatus: null },
      { MachineID: 456, MachineMQTTStatus: false },
      { MachineMQTTStatus: false },
      { data: { MachineID: 123, MachineMQTTStatus: false } },
      {
        MachineID: 123,
        LastKeepAliveDateTime: "2025-01-01T00:00:00Z",
        LastPowerDownDateTime: "2026-10-03T00:00:00Z",
      },
      null,
    ]
  ) {
    assert(
      explicitNayaxConnectivity(payload, "123") === null,
      "undocumented, malformed, mismatched and absent evidence stays unknown",
    );
  }
});
Deno.test("all subscribed devices retain cadence, bootstrap is bounded, reads are scoped", async () => {
  let reads = 0, records = 0;
  const accountKeys: string[] = [];
  const devices = Array.from(
    { length: 30 },
    (_, i) => ({
      machineId: fixtureId(i + 100),
      nayaxMachineId: String(i + 100),
      nayaxAccountKey: "TGPACI_USA_DB",
      subscribed: i < 15,
    }),
  );
  const result = await collectMachineEmailSignals({
    observedAt: "2026-10-02T15:00:00Z",
    client: {
      rpc: (name, args) => {
        if (name === "service_get_email_alert_signal_inputs") {
          return Promise.resolve({
            data: { devices, quietPeriods: [] },
            error: null,
          });
        }
        assert(
          args.p_provider_field === "MachineMQTTStatus" &&
            args.p_is_online === false,
          "only documented explicit observation sent to persistence",
        );
        records++;
        return Promise.resolve({ data: true, error: null });
      },
    },
    tokenForAccount: (key) => {
      accountKeys.push(key);
      return "synthetic-test-token";
    },
    fetcher: async (url, init) => {
      reads++;
      assert(
        String(url).match(/\/machines\/\d+\/status$/) &&
          (init as { method?: string })?.method === "GET",
        "established exact endpoint, read only",
      );
      return new Response(
        JSON.stringify({
          MachineID: Number(
            String(url).match(/\/machines\/(\d+)\/status$/)![1],
          ),
          MachineMQTTStatus: false,
        }),
      );
    },
  });
  assert(
    reads === 27 && records === 27 && result.deferredDevices === 3,
    "all15 followed plus12 bootstrap",
  );
  assert(
    accountKeys.every((key) => key === "TGPACI_USA_DB"),
    "correct account only",
  );
});
Deno.test("failed, missing and mismatched provider reads never record disconnected", async () => {
  let observations = 0;
  for (
    const payload of [
      { Status: "offline" },
      { IsOnline: false },
      { MachineID: 456, MachineMQTTStatus: false },
      { MachineID: 123, MachineMQTTStatus: null },
      null,
    ]
  ) {
    const result = await collectMachineEmailSignals({
      observedAt: "2026-10-02T15:00:00Z",
      client: {
        rpc: (name) => {
          if (name === "service_get_email_alert_signal_inputs") {
            return Promise.resolve({
              data: {
                devices: [{
                  machineId: fixtureId(1),
                  nayaxMachineId: "123",
                  nayaxAccountKey: "TGPACI_USA_DB",
                  subscribed: true,
                }],
                quietPeriods: [],
              },
              error: null,
            });
          }
          observations++;
          return Promise.resolve({ data: true, error: null });
        },
      },
      tokenForAccount: () => "fake",
      fetcher: async () =>
        new Response(JSON.stringify(payload), {
          status: payload === null ? 503 : 200,
        }),
    });
    assert(
      result.unavailableDevices === 1,
      "unknown recorded as unavailable only",
    );
  }
  assert(observations === 0, "no false disconnection observations");
});
Deno.test("cash quiet signal requires known complete periods and a meaningful decline", async () => {
  const payload = fixtureVariants()["sales-quiet"].signal;
  const good = {
    machineId: fixtureId(101),
    signalKey: "sunze-cash-day",
    evidenceSource: "sunze_validated_payment_window",
    observedAt: "2026-10-02T15:00:00Z",
    validUntil: "2026-10-03T15:00:00Z",
    payload,
  };
  let stored = 0;
  const result = await collectMachineEmailSignals({
    observedAt: "2026-10-02T15:00:00Z",
    client: {
      rpc: (name, args) => {
        if (name === "service_get_email_alert_signal_inputs") {
          return Promise.resolve({
            data: {
              devices: [],
              quietPeriods: [
                good,
                { ...good, payload: { ...payload, coverageVerified: false } },
                { ...good, payload: { ...payload, actualTransactions: 12 } },
                { ...good, evidenceSource: "nayax_report_arrived" },
              ],
            },
            error: null,
          });
        }
        stored++;
        assert(
          (args.p_signal as Record<string, unknown>).category === "sales-quiet",
          "correct event envelope",
        );
        return Promise.resolve({ data: true, error: null });
      },
    },
    tokenForAccount: () => undefined,
    fetcher: () => {
      throw new Error("no provider read expected");
    },
  });
  assert(
    stored === 1 && result.recordedQuietPeriods === 1,
    "only proof-backed decline forwarded",
  );
});

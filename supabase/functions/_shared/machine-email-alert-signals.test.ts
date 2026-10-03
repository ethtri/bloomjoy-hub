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
        assert(
          args.p_expected_account_key === "TGPACI_USA_DB" &&
            String(args.p_expected_nayax_machine_id) ===
              String(Number(String(args.p_machine_id).slice(-12))),
          "captured source identity submitted with observation",
        );
        records++;
        return Promise.resolve({ data: { recorded: true }, error: null });
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

Deno.test("in-flight remap rejection cannot be counted or retried as a recorded observation", async () => {
  const captured = {
    machineId: fixtureId(101),
    nayaxMachineId: "123",
    nayaxAccountKey: "TGPACI_USA_DB",
    subscribed: true,
  };
  let observations = 0;
  const result = await collectMachineEmailSignals({
    observedAt: "2026-10-02T15:00:00Z",
    client: {
      rpc: (name, args) => {
        if (name === "service_get_email_alert_signal_inputs") {
          return Promise.resolve({
            data: { devices: [captured], quietPeriods: [] },
            error: null,
          });
        }
        observations++;
        assert(
          args.p_expected_account_key === "TGPACI_USA_DB" &&
            args.p_expected_nayax_machine_id === "123",
          "persistence proof must be the identity actually queried, not the replacement mapping",
        );
        return Promise.resolve({
          data: { recorded: false, reason: "mapping_changed" },
          error: null,
        });
      },
    },
    tokenForAccount: (account) => {
      assert(account === "TGPACI_USA_DB", "exact account token selected");
      return "fake";
    },
    fetcher: async (url) => {
      assert(
        String(url).endsWith("/machines/123/status"),
        "read uses captured provider machine",
      );
      // The database mapping changes during this GET. Its under-lock rejection
      // is simulated above; no second read or rewritten identity may follow.
      return new Response(
        JSON.stringify({ MachineID: 123, MachineMQTTStatus: false }),
      );
    },
  });
  assert(
    observations === 1 && result.recordedObservations === 0 &&
      result.unavailableDevices === 1,
    "mismatch stays unknown and gets no retry",
  );
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

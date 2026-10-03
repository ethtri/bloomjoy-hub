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
Deno.test("source admission stops at its budget while in-flight observations settle without false offline evidence", async () => {
  let reads = 0;
  let observations = 0;
  let active = 0;
  let maximumActive = 0;
  const devices = Array.from({ length: 5 }, (_, i) => ({
    machineId: fixtureId(i + 100),
    nayaxMachineId: String(i + 100),
    nayaxAccountKey: "TGPACI_USA_DB",
    subscribed: true,
  }));
  const result = await collectMachineEmailSignals({
    observedAt: "2026-10-02T15:00:00Z",
    shouldContinue: () => reads < 2,
    client: {
      rpc: (name, args) => {
        if (name === "service_get_email_alert_signal_inputs") {
          return Promise.resolve({
            data: { devices, quietPeriods: [{}, {}] },
            error: null,
          });
        }
        assert(
          name === "service_record_email_alert_device_observation" &&
            args.p_is_online === true,
          "only actually observed in-flight readings settle; no quiet records",
        );
        observations++;
        return Promise.resolve({ data: { recorded: true }, error: null });
      },
    },
    tokenForAccount: () => "fake",
    fetcher: async (url) => {
      reads++;
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      return new Response(JSON.stringify({
        MachineID: Number(String(url).match(/\/machines\/(\d+)\/status$/)![1]),
        MachineMQTTStatus: true,
      }));
    },
  });
  assert(
    reads === 2 && maximumActive === 2 && observations === 2 &&
      result.recordedObservations === 2 && result.unavailableDevices === 0 &&
      result.deferredDevices === 3 && result.deferredQuietPeriods === 2 &&
      result.budgetExhausted === true && result.recordedQuietPeriods === 0,
    "remaining source work is deferred, not fabricated unknown/offline observations",
  );
});
Deno.test("a constrained five-minute tick rotates followed machines before bootstrap instead of starving a fixed suffix", async () => {
  const firsts: string[] = [];
  const devices = Array.from({ length: 4 }, (_, i) => ({
    machineId: fixtureId(i + 100),
    nayaxMachineId: String(i + 100),
    nayaxAccountKey: "TGPACI_USA_DB",
    subscribed: i < 3,
  }));
  for (let tick = 0; tick < 3; tick++) {
    let admitted = false;
    const result = await collectMachineEmailSignals({
      observedAt: new Date(Date.UTC(2026, 9, 2, 15, tick * 5)).toISOString(),
      shouldContinue: () => !admitted,
      client: {
        rpc: (name) =>
          Promise.resolve({
            data: name === "service_get_email_alert_signal_inputs"
              ? { devices, quietPeriods: [] }
              : { recorded: true },
            error: null,
          }),
      },
      tokenForAccount: () => "fake",
      fetcher: async (url) => {
        admitted = true;
        const id = String(url).match(/\/machines\/(\d+)\/status$/)![1];
        firsts.push(id);
        return new Response(JSON.stringify({
          MachineID: Number(id),
          MachineMQTTStatus: true,
        }));
      },
    });
    assert(result.deferredDevices === 3, "unadmitted candidates stay deferred");
  }
  assert(
    new Set(firsts).size === 3 && !firsts.includes("103"),
    "every followed machine eventually leads; bootstrap cannot displace it",
  );
});
Deno.test("slow device polling cannot starve quiet records and bounded quiet admission rotates across ticks", async () => {
  const firstQuiet: string[] = [];
  const devices = Array.from({ length: 4 }, (_, i) => ({
    machineId: fixtureId(i + 100),
    nayaxMachineId: String(i + 100),
    nayaxAccountKey: "TGPACI_USA_DB",
    subscribed: true,
  }));
  const quietPeriods = Array.from({ length: 3 }, (_, i) => ({
    machineId: fixtureId(i + 200),
    signalKey: "sunze-cash-day",
    evidenceSource: "sunze_validated_payment_window",
    observedAt: "2026-10-02T15:00:00Z",
    validUntil: "2026-10-03T15:00:00Z",
    payload: fixtureVariants()["sales-quiet"].signal,
  }));
  for (let tick = 0; tick < 3; tick++) {
    let reads = 0;
    let observations = 0;
    let withinBudget = true;
    const result = await collectMachineEmailSignals({
      observedAt: new Date(Date.UTC(2026, 9, 2, 15, tick * 5)).toISOString(),
      shouldContinue: () => withinBudget,
      client: {
        rpc: (name, args) => {
          if (name === "service_get_email_alert_signal_inputs") {
            return Promise.resolve({
              data: { devices, quietPeriods },
              error: null,
            });
          }
          if (name === "service_record_email_alert_signal") {
            assert(
              reads === 2 && observations === 0,
              "cash work is admitted while both device GETs are still in flight",
            );
            firstQuiet.push(
              String((args.p_signal as Record<string, unknown>).machineId),
            );
          } else observations++;
          return Promise.resolve({ data: { recorded: true }, error: null });
        },
      },
      tokenForAccount: () => "fake",
      fetcher: async (url) => {
        reads++;
        await Promise.resolve();
        // Simulate the outstanding provider reads consuming the shared window.
        withinBudget = false;
        return new Response(JSON.stringify({
          MachineID: Number(
            String(url).match(/\/machines\/(\d+)\/status$/)![1],
          ),
          MachineMQTTStatus: true,
        }));
      },
    });
    assert(
      reads === 2 && observations === 2 && result.recordedQuietPeriods === 1 &&
        result.deferredDevices === 2 && result.deferredQuietPeriods === 2 &&
        result.budgetExhausted === true,
      "both source lanes progress; all unadmitted work stays explicitly deferred",
    );
  }
  assert(new Set(firstQuiet).size === 3, "every quiet candidate gets admitted");
});
Deno.test("alternating bootstrap shortlists do not resonate with the scheduler tick and starve fixed positions", async () => {
  const attempted = new Set<string>();
  const devices = Array.from({ length: 24 }, (_, i) => ({
    machineId: fixtureId(i + 100),
    nayaxMachineId: String(i + 100),
    nayaxAccountKey: "TGPACI_USA_DB",
    subscribed: false,
  }));
  for (let tick = 0; tick < 240; tick++) {
    let admitted = false;
    const result = await collectMachineEmailSignals({
      observedAt: new Date(Date.UTC(2026, 9, 2, 15, tick * 5)).toISOString(),
      shouldContinue: () => !admitted,
      client: {
        rpc: (name) =>
          Promise.resolve({
            data: name === "service_get_email_alert_signal_inputs"
              ? {
                devices: devices.slice(tick % 2 * 12, tick % 2 * 12 + 12),
                quietPeriods: [],
              }
              : { recorded: true },
            error: null,
          }),
      },
      tokenForAccount: () => "fake",
      fetcher: async (url) => {
        admitted = true;
        const id = String(url).match(/\/machines\/(\d+)\/status$/)![1];
        attempted.add(id);
        return new Response(JSON.stringify({
          MachineID: Number(id),
          MachineMQTTStatus: true,
        }));
      },
    });
    assert(
      result.deferredDevices === 11,
      "unadmitted shortlist remains deferred",
    );
  }
  assert(
    attempted.size === 24,
    "all positions in both alternating lists are attempted across cold-start ticks",
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

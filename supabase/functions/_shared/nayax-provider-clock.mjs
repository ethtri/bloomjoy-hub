// Provider clock evidence belongs to an exact Nayax account/machine inventory
// row. It is independent of a customer's physical purchase timezone.
export const buildNayaxProviderClockContext = (reportingMachineId, inventory) => {
  const unknown = { reportingMachineId, timezone: null, source: "unknown", observedAt: null };
  if (!inventory || inventory.provider_clock_timezone == null) return unknown;
  const timezone = inventory.provider_clock_timezone;
  const observed = Date.parse(inventory.provider_clock_observed_at ?? "");
  if (inventory.provider_clock_source !== "native_machine_configuration" ||
      inventory.provider_clock_daylight_saving !== true ||
      typeof timezone !== "string" || timezone.length > 80 || !Number.isFinite(observed)) {
    throw new Error("The verified Nayax machine clock configuration is incomplete.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch { throw new Error("The verified Nayax machine clock timezone is invalid."); }
  return { reportingMachineId, timezone, source: "native_machine_configuration", observedAt: inventory.provider_clock_observed_at };
};

export const loadNayaxProviderClockContext = async (supabase, scope) => {
  const { data, error } = await supabase.from("refund_nayax_machine_inventory")
    .select("provider_clock_timezone,provider_clock_source,provider_clock_observed_at,provider_clock_daylight_saving")
    .eq("account_key", scope.accountKey)
    .eq("nayax_machine_id", scope.nayaxMachineId)
    .eq("reporting_machine_id", scope.reportingMachineId)
    .maybeSingle();
  if (error) throw error;
  return buildNayaxProviderClockContext(scope.reportingMachineId, data);
};

export const withNayaxProviderClockDiagnostics = (diagnostics, contexts) => {
  if (!diagnostics || !contexts?.length) return diagnostics;
  return {
    ...diagnostics,
    schemaVersion: "nayax_lookup_diagnostics_v2",
    providerTimePolicy: "authorization_gmt_else_provider_clock_else_unverified_location",
    machineTimezoneSource: "per_machine_provider_clock_contexts",
    providerClockContexts: contexts.map(({ reportingMachineId, timezone, source, observedAt }) =>
      ({ reportingMachineId, timezone, source, observedAt })),
  };
};

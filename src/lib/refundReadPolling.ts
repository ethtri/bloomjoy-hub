// Keep failures outside Query state: fetchFailureCount resets for each poll.
// A separate instance for each selected case isolates late responses after a switch.
export const createRefundReadPolling = () => {
  let failures = 0;
  return {
    async read<T>(fetch: () => Promise<T>): Promise<T> {
      try { const result = await fetch(); failures = 0; return result; }
      catch (error) { failures = Math.min(failures + 1, 6); throw error; }
    },
    interval(healthyInterval: number | false): number | false {
      if (healthyInterval === false) return false;
      return Math.min(60_000, healthyInterval * 2 ** failures);
    },
  };
};

export const refundOverviewPollingInterval = (cases: Array<{lifecycle?: {terminal: boolean; refreshAfterSeconds: number | null} | null}> | undefined): number | false => {
  // An unavailable initial read needs bounded recovery; it is not terminal proof.
  if (!cases) return 5_000;
  const active = cases.map((row) => row.lifecycle)
    .filter((lifecycle) => lifecycle && !lifecycle.terminal && lifecycle.refreshAfterSeconds)
    .map((lifecycle) => Math.min(15_000, Math.max(1_000, lifecycle!.refreshAfterSeconds! * 1_000)));
  return active.length ? Math.min(...active) : false;
};

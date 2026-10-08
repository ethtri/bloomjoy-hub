/// <reference lib="deno.ns" />
import { ReportingAdmissionQueue, ReportingAdmissionCancelled } from './reportingAdmission.ts';
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const deferred = () => { let resolve!: (value: number) => void; const promise = new Promise<number>(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const allowed = { eligible: () => true };

Deno.test('one active report, foreground priority, and failure release', async () => {
  const queue = new ReportingAdmissionQueue(); const gate = deferred(); const starts: string[] = [];
  let active = 0; let max = 0;
  const run = (name: string, result: () => Promise<number>) => async () => {
    starts.push(name); active++; max = Math.max(max, active);
    try { return await result(); } finally { active--; }
  };
  const first = queue.run(allowed, run('sales', () => gate.promise)); await tick();
  const prior = queue.run({ ...allowed, priority: 2 }, run('prior', async () => 3));
  const labor = queue.run({ ...allowed, priority: 1 }, run('labor', async () => { throw new Error('57014'); })).catch(e => e.message);
  const refund = queue.run({ ...allowed, priority: 1 }, run('refund', async () => 2));
  equal(starts, ['sales']); gate.resolve(1);
  equal(await first, 1); equal(await labor, '57014'); equal(await refund, 2); equal(await prior, 3);
  equal(max, 1); equal(starts, ['sales', 'labor', 'refund', 'prior']);
});

Deno.test('pending signal and latest eligibility cancellation never dispatch stale work', async () => {
  const queue = new ReportingAdmissionQueue(); const gate = deferred(); let eligible = true; let staleCalls = 0;
  const active = queue.run(allowed, () => gate.promise); await tick();
  const controller = new AbortController();
  const cancelled = queue.run({ ...allowed, signal: controller.signal }, async () => { staleCalls++; return 2; }).catch(e => e);
  const changed = queue.run({ eligible: () => eligible }, async () => { staleCalls++; return 3; }).catch(e => e);
  controller.abort(); eligible = false; queue.revalidate();
  equal((await cancelled) instanceof ReportingAdmissionCancelled, true);
  equal((await changed) instanceof ReportingAdmissionCancelled, true);
  gate.resolve(1); await active; equal(staleCalls, 0);
});

Deno.test('aborted active work retains slot across user/scope transition until settled', async () => {
  const queue = new ReportingAdmissionQueue(); const gate = deferred(); const controller = new AbortController(); let nextStarted = false;
  const active = queue.run({ ...allowed, signal: controller.signal }, () => gate.promise).catch(e => e);
  await tick(); controller.abort();
  const next = queue.run(allowed, async () => { nextStarted = true; return 2; });
  await tick(); equal(nextStarted, false); gate.resolve(1);
  equal((await active) instanceof ReportingAdmissionCancelled, true); equal(await next, 2);
});

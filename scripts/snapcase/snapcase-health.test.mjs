import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSnapcaseSyncHealth, readLatestScheduledRun } from './check-sync-health.mjs';

const now = new Date('2026-09-26T18:00:00Z');
const run = (overrides = {}) => ({
  id: 42,
  url: 'https://github.example/actions/runs/42',
  createdAt: '2026-09-26T17:17:00Z',
  status: 'completed',
  conclusion: 'success',
  importStepConclusion: 'success',
  ...overrides,
});

test('a completed live import is healthy even when it ingested an empty window', () => {
  assert.deepEqual(evaluateSnapcaseSyncHealth({ run: run(), now }), {
    ok: true,
    status: 'healthy',
    runId: '42',
    runUrl: 'https://github.example/actions/runs/42',
    startedAt: '2026-09-26T17:17:00.000Z',
  });
});

test('disabled no-op, failed, stale, and absent schedules remain actionable', () => {
  assert.equal(
    evaluateSnapcaseSyncHealth({ run: run({ importStepConclusion: 'skipped' }), now }).reason,
    'live_import_step_not_run',
  );
  assert.equal(
    evaluateSnapcaseSyncHealth({ run: run({ conclusion: 'failure' }), now }).reason,
    'scheduled_run_failed',
  );
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({ createdAt: '2026-09-25T20:00:00Z' }), now,
  }).reason, 'last_import_stale');
  assert.equal(evaluateSnapcaseSyncHealth({ run: null, now }).reason, 'no_scheduled_run');
});

test('a current run is active but cannot hide a timeout', () => {
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({
      createdAt: '2026-09-26T17:40:00Z', status: 'in_progress', conclusion: null,
    }), now,
  }).status, 'active');
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({
      createdAt: '2026-09-26T16:00:00Z', status: 'in_progress', conclusion: null,
    }),
    now,
  }).reason, 'run_timed_out');
});

test('GitHub reader requires the live import step rather than workflow success alone', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    const body = requests.length === 1
      ? { workflow_runs: [{
        id: 91, html_url: 'https://github.example/actions/runs/91',
        created_at: '2026-09-26T17:17:00Z', status: 'completed', conclusion: 'success',
      }] }
      : { jobs: [{ steps: [{ name: 'Run enabled private staging sync', conclusion: 'skipped' }] }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const latest = await readLatestScheduledRun({
    repository: 'example/repo', token: 'fixture-token', apiUrl: 'https://api.example', fetchImpl,
  });
  assert.equal(latest.importStepConclusion, 'skipped');
  assert.match(requests[0], /event=schedule/);
  assert.match(requests[1], /runs\/91\/jobs/);
});

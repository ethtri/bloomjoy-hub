import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSnapcaseSyncHealth, readRelevantSyncRuns } from './check-sync-health.mjs';

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
    run: run({ createdAt: '2026-09-25T10:00:00Z' }), now,
  }).reason, 'last_import_stale');
  assert.equal(evaluateSnapcaseSyncHealth({ run: null, now }).reason, 'no_scheduled_run');
});

test('normal scheduler delay stays healthy and active runs use the freshness allowance', () => {
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({ createdAt: '2026-09-26T04:30:00Z' }), now,
  }).status, 'healthy');
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({
      createdAt: '2026-09-26T04:30:00Z', status: 'in_progress', conclusion: null,
    }), now,
  }).status, 'active');
  assert.equal(evaluateSnapcaseSyncHealth({
    run: run({
      createdAt: '2026-09-25T10:00:00Z', status: 'in_progress', conclusion: null,
    }),
    now,
  }).reason, 'active_run_stale');
});

test('only a newer full live rerun clears a failed scheduled import', () => {
  const failed = run({ conclusion: 'failure' });
  const recovery = run({
    id: 43,
    createdAt: '2026-09-26T17:40:00Z',
    url: 'https://github.example/actions/runs/43',
  });
  const result = evaluateSnapcaseSyncHealth({ run: failed, recoveryRun: recovery, now });
  assert.equal(result.status, 'recovered');
  assert.equal(result.recoveredScheduledRunId, '42');
  assert.equal(evaluateSnapcaseSyncHealth({
    run: failed,
    recoveryRun: { ...recovery, importStepConclusion: 'skipped' },
    now,
  }).status, 'failed');
});

test('GitHub reader requires the live import step rather than workflow success alone', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    const body = requests.length === 1
      ? { workflow_runs: [{
        id: 91, html_url: 'https://github.example/actions/runs/91',
        created_at: '2026-09-26T17:17:00Z', status: 'completed', conclusion: 'success',
        event: 'schedule', display_title: 'SnapCase Sync',
      }, {
        id: 92, html_url: 'https://github.example/actions/runs/92',
        created_at: '2026-09-26T17:40:00Z', status: 'completed', conclusion: 'success',
        event: 'workflow_dispatch',
        display_title: 'SnapCase Sync | event=workflow_dispatch | mode=fixture-dry-run | start=routine | end=routine',
      }] }
      : { jobs: [{ steps: [{ name: 'Run enabled private staging sync', conclusion: 'skipped' }] }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const latest = await readRelevantSyncRuns({
    repository: 'example/repo', token: 'fixture-token', apiUrl: 'https://api.example', fetchImpl,
  });
  assert.equal(latest.scheduledRun.importStepConclusion, 'skipped');
  assert.equal(latest.recoveryRun, null);
  assert.doesNotMatch(requests[0], /event=schedule/);
  assert.match(requests[1], /runs\/91\/jobs/);
});

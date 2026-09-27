#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const LIVE_IMPORT_STEP = 'Run enabled private staging sync';

export class SnapcaseHealthError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SnapcaseHealthError';
    this.code = code;
  }
}

const timestamp = (value) => {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export const evaluateSnapcaseSyncHealth = ({
  run,
  recoveryRun = null,
  now = new Date(),
  staleHours = 30,
} = {}) => {
  const recoveryStartedAt = timestamp(recoveryRun?.createdAt);
  const recoveryHealthy = recoveryStartedAt !== null &&
    recoveryRun.conclusion === 'success' &&
    recoveryRun.importStepConclusion === 'success' &&
    now.getTime() - recoveryStartedAt <= staleHours * 60 * 60_000;
  if (!run) {
    if (recoveryHealthy) {
      return {
        ok: true,
        status: 'recovered',
        runId: String(recoveryRun.id ?? ''),
        runUrl: String(recoveryRun.url ?? ''),
        startedAt: new Date(recoveryStartedAt).toISOString(),
      };
    }
    return { ok: false, status: 'missed', reason: 'no_scheduled_run' };
  }

  const startedAt = timestamp(run.createdAt);
  if (startedAt === null) return { ok: false, status: 'missed', reason: 'invalid_run_time' };
  const ageMs = now.getTime() - startedAt;
  const summary = {
    runId: String(run.id ?? ''),
    runUrl: String(run.url ?? ''),
    startedAt: new Date(startedAt).toISOString(),
  };

  if (run.status === 'queued' || run.status === 'in_progress') {
    if (ageMs <= staleHours * 60 * 60_000) {
      return { ok: true, status: 'active', ...summary };
    }
    return { ok: false, status: 'missed', reason: 'active_run_stale', ...summary };
  }
  const scheduledHealthy = run.conclusion === 'success' &&
    run.importStepConclusion === 'success' && ageMs <= staleHours * 60 * 60_000;
  if (scheduledHealthy) return { ok: true, status: 'healthy', ...summary };

  if (
    recoveryHealthy &&
    recoveryStartedAt > startedAt
  ) {
    return {
      ok: true,
      status: 'recovered',
      runId: String(recoveryRun.id ?? ''),
      runUrl: String(recoveryRun.url ?? ''),
      startedAt: new Date(recoveryStartedAt).toISOString(),
      recoveredScheduledRunId: summary.runId,
    };
  }
  if (run.conclusion !== 'success') {
    return { ok: false, status: 'failed', reason: 'scheduled_run_failed', ...summary };
  }
  if (run.importStepConclusion !== 'success') {
    return { ok: false, status: 'missed', reason: 'live_import_step_not_run', ...summary };
  }
  return { ok: false, status: 'missed', reason: 'last_import_stale', ...summary };
};

const githubRequest = async (url, token, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new SnapcaseHealthError('github_actions_read_failed');
  return body;
};

const withImportStep = async ({ run, repository, token, apiUrl, fetchImpl }) => {
  if (!run) return null;
  const jobsBody = await githubRequest(
    `${apiUrl}/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`,
    token,
    fetchImpl,
  );
  const steps = Array.isArray(jobsBody.jobs)
    ? jobsBody.jobs.flatMap((job) => Array.isArray(job.steps) ? job.steps : [])
    : [];
  const importStep = steps.find((step) => step?.name === LIVE_IMPORT_STEP);
  return {
    id: run.id,
    url: run.html_url,
    createdAt: run.created_at,
    status: run.status,
    conclusion: run.conclusion,
    importStepConclusion: importStep?.conclusion ?? null,
  };
};

const isFullLiveRecovery = (run) =>
  run?.event === 'workflow_dispatch' &&
  /\bmode=live-ingest\b/.test(String(run.display_title ?? '')) &&
  /\bstart=routine\b/.test(String(run.display_title ?? '')) &&
  /\bend=routine\b/.test(String(run.display_title ?? ''));

export const readRelevantSyncRuns = async ({
  repository,
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!repository || !token) throw new SnapcaseHealthError('health_configuration_missing');
  const runsBody = await githubRequest(
    `${apiUrl}/repos/${repository}/actions/workflows/snapcase-sync.yml/runs?per_page=20`,
    token,
    fetchImpl,
  );
  const runs = Array.isArray(runsBody.workflow_runs) ? runsBody.workflow_runs : [];
  const scheduled = runs.find((run) => run?.event === 'schedule') ?? null;
  const recovery = runs.find(isFullLiveRecovery) ?? null;
  return {
    scheduledRun: await withImportStep({
      run: scheduled, repository, token, apiUrl, fetchImpl,
    }),
    recoveryRun: await withImportStep({
      run: recovery, repository, token, apiUrl, fetchImpl,
    }),
  };
};

export const runSnapcaseHealthCheck = async ({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) => {
  const staleHours = Number(env.SNAPCASE_SYNC_STALE_HOURS ?? 30);
  if (!Number.isFinite(staleHours) || staleHours <= 0) {
    throw new SnapcaseHealthError('invalid_stale_hours');
  }
  const { scheduledRun, recoveryRun } = await readRelevantSyncRuns({
    repository: env.GITHUB_REPOSITORY,
    token: env.GH_TOKEN,
    apiUrl: env.GITHUB_API_URL,
    fetchImpl,
  });
  return evaluateSnapcaseSyncHealth({ run: scheduledRun, recoveryRun, now, staleHours });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runSnapcaseHealthCheck();
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const errorCode = error instanceof SnapcaseHealthError ? error.code : 'health_check_failed';
    console.error(JSON.stringify({ ok: false, status: 'failed', reason: errorCode }));
    process.exitCode = 1;
  }
}

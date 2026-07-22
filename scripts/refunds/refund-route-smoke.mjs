#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { requiredFunctionSlugs } from './refund-release.mjs';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const DEFAULT_TIMEOUT_MS = 15_000;

export const refundRouteSmokeExpectations = Object.freeze([
  { slug: 'refund-case-intake', expectedStatus: 200 },
  { slug: 'nayax-transaction-lookup', expectedStatus: 200 },
  { slug: 'refund-case-admin-update', expectedStatus: 200 },
  { slug: 'refund-case-message-send', expectedStatus: 200 },
  { slug: 'refund-case-automation-sweep', expectedStatus: 200 },
  { slug: 'refund-gmail-sync', expectedStatus: 405 },
  { slug: 'refund-gpt-triage', expectedStatus: 405 },
  { slug: 'nayax-card-refund', expectedStatus: 200 },
]);

const usage = () => {
  console.error(
    'Usage: npm run refunds:smoke-routes -- --project-ref <project-ref> --confirm-project-ref <project-ref>\n' +
      '   or: npm run refunds:smoke-routes -- --base-url http://127.0.0.1:54321/functions/v1',
  );
};

export const parseRefundRouteSmokeArgs = (argv) => {
  const args = { projectRef: '', confirmProjectRef: '', baseUrl: '', timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--project-ref' && next) {
      args.projectRef = next.trim();
      index += 1;
    } else if (value === '--confirm-project-ref' && next) {
      args.confirmProjectRef = next.trim();
      index += 1;
    } else if (value === '--base-url' && next) {
      args.baseUrl = next.trim();
      index += 1;
    } else if (value === '--timeout-ms' && next) {
      args.timeoutMs = Number(next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }
  return args;
};

export const resolveRefundRouteSmokeBaseUrl = ({ projectRef, confirmProjectRef, baseUrl }) => {
  if (baseUrl && projectRef) {
    throw new Error('Use either --base-url or --project-ref, not both.');
  }
  if (baseUrl) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) {
      throw new Error('--base-url must be an HTTP(S) URL without a query or fragment.');
    }
    return parsed.toString().replace(/\/+$/, '');
  }
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('--project-ref must be a 20-character lowercase Supabase project reference.');
  }
  if (confirmProjectRef !== projectRef) {
    throw new Error('--confirm-project-ref must exactly match --project-ref.');
  }
  return `https://${projectRef}.supabase.co/functions/v1`;
};

const probeRoute = async ({ baseUrl, expectation, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/${expectation.slug}`, {
      method: 'OPTIONS',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    return {
      ...expectation,
      status,
      passed: status === expectation.expectedStatus,
      failure: status === 404 ? 'route_missing' : status === expectation.expectedStatus ? null : 'unexpected_status',
    };
  } catch {
    return {
      ...expectation,
      status: null,
      passed: false,
      failure: 'network_or_timeout',
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const runRefundRouteSmoke = async ({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  let normalizedBaseUrl;
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error();
    normalizedBaseUrl = parsed.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('Route smoke base URL must be an absolute HTTP(S) URL without a query or fragment.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new Error('Route smoke timeout must be an integer from 1000 to 60000 milliseconds.');
  }

  const expectedSlugs = refundRouteSmokeExpectations.map(({ slug }) => slug);
  if (JSON.stringify(expectedSlugs) !== JSON.stringify(requiredFunctionSlugs)) {
    throw new Error('Route smoke expectations do not match the approved refund release function order.');
  }

  const results = await Promise.all(
    refundRouteSmokeExpectations.map((expectation) =>
      probeRoute({ baseUrl: normalizedBaseUrl, expectation, fetchImpl, timeoutMs })),
  );
  const failures = results.filter(({ passed }) => !passed);
  if (failures.length > 0) {
    const summary = failures
      .map(({ slug, status, expectedStatus, failure }) =>
        `${slug}: ${status ?? failure} (expected ${expectedStatus})`)
      .join('; ');
    const error = new Error(`Refund route smoke failed: ${summary}`);
    error.results = results;
    throw error;
  }
  return results;
};

const main = async () => {
  let args;
  let baseUrl;
  try {
    args = parseRefundRouteSmokeArgs(process.argv.slice(2));
    baseUrl = resolveRefundRouteSmokeBaseUrl(args);
  } catch (error) {
    usage();
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log('INFO: Sending OPTIONS-only Refund Operations route probes with no auth, body, case, email, or provider request.');
  try {
    const results = await runRefundRouteSmoke({ baseUrl, timeoutMs: args.timeoutMs });
    for (const result of results) {
      console.log(`PASS: ${result.slug} returned ${result.status}.`);
    }
    console.log(`Refund route smoke passed for ${results.length} approved functions.`);
  } catch (error) {
    const results = Array.isArray(error?.results) ? error.results : [];
    for (const result of results) {
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'}: ${result.slug} returned ${result.status ?? result.failure}; expected ${result.expectedStatus}.`,
      );
    }
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) await main();

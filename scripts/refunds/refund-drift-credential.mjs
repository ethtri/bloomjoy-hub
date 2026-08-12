#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const projectRefPattern = /^[a-z0-9]{20}$/;
const accessTokenPattern = /^sbp_[A-Za-z0-9_-]{20,}$/;

export const writeProbeSlug = 'bloomjoy-refund-drift-write-probe-never-create';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const request = async ({ fetchImpl, token, url, method = 'GET' }) => {
  try {
    return await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Supabase credential probe could not reach the Management API.');
  }
};

export const validateRefundDriftCredentialInput = ({ token, projectRef }) => {
  assert(
    typeof token === 'string' && accessTokenPattern.test(token),
    'SUPABASE_ACCESS_TOKEN is missing or malformed.'
  );
  assert(projectRefPattern.test(projectRef ?? ''), 'SUPABASE_PROJECT_REF is missing or malformed.');
};

export const probeRefundDriftCredential = async ({
  token,
  projectRef,
  fetchImpl = fetch,
  apiRoot = 'https://api.supabase.com',
}) => {
  validateRefundDriftCredentialInput({ token, projectRef });

  const functionsUrl = `${apiRoot}/v1/projects/${projectRef}/functions`;
  const functionsResponse = await request({ fetchImpl, token, url: functionsUrl });
  assert(
    functionsResponse.status === 200,
    `The credential cannot read Edge Functions for the configured project (HTTP ${functionsResponse.status}).`
  );

  let functions;
  try {
    functions = await functionsResponse.json();
  } catch {
    throw new Error('The Edge Functions read probe returned malformed JSON.');
  }
  assert(Array.isArray(functions), 'The Edge Functions read probe returned an unexpected response.');
  assert(
    !functions.some((entry) => (entry?.slug ?? entry?.name) === writeProbeSlug),
    `The reserved write-probe function ${writeProbeSlug} unexpectedly exists; aborting without a write test.`
  );

  const projectsResponse = await request({
    fetchImpl,
    token,
    url: `${apiRoot}/v1/projects`,
  });
  assert(
    projectsResponse.status === 403,
    `The credential has broader account project-list access than allowed (HTTP ${projectsResponse.status}).`
  );

  const deleteResponse = await request({
    fetchImpl,
    token,
    method: 'DELETE',
    url: `${functionsUrl}/${writeProbeSlug}`,
  });
  assert(
    deleteResponse.status === 403,
    `The credential did not prove Edge Function writes are forbidden (HTTP ${deleteResponse.status}).`
  );

  return { visibleFunctionCount: functions.length };
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    const result = await probeRefundDriftCredential({
      token: process.env.SUPABASE_ACCESS_TOKEN,
      projectRef: process.env.SUPABASE_PROJECT_REF,
    });
    console.log(
      `Refund drift credential passed least-privilege checks (${result.visibleFunctionCount} Edge Functions visible; account listing and function deletion forbidden).`
    );
  } catch (error) {
    console.error(`Refund drift credential check failed: ${error.message}`);
    process.exit(1);
  }
}

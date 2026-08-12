#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const REFUND_PRODUCTION_PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';
export const REFUND_AUTH_CONFIG_READ_TOKEN_ENV = 'SUPABASE_AUTH_CONFIG_READ_TOKEN';

const fail = (message) => {
  throw new Error(message);
};

export const requireExactRefundProductionProject = ({ projectRef, confirmedProjectRef }) => {
  const normalizedProjectRef = typeof projectRef === 'string' ? projectRef.trim() : '';
  const normalizedConfirmation = typeof confirmedProjectRef === 'string'
    ? confirmedProjectRef.trim()
    : '';

  if (!/^[a-z0-9]{20}$/.test(normalizedProjectRef)) {
    fail('Use an explicit 20-character Supabase project reference.');
  }
  if (normalizedProjectRef !== REFUND_PRODUCTION_PROJECT_REF) {
    fail('This gate is pinned to the Bloomjoy Hub production project.');
  }
  if (normalizedConfirmation !== normalizedProjectRef) {
    fail('--confirm-project-ref must exactly match --project-ref.');
  }

  return normalizedProjectRef;
};

const readBooleanSetting = (sectionLines, settingName) => {
  const matches = sectionLines
    .map((line) => line.match(
      new RegExp(`^\\s*${settingName}\\s*=\\s*(true|false)\\s*(?:#.*)?$`)
    ))
    .filter(Boolean);
  if (matches.length !== 1) {
    fail('Canonical Supabase Auth TOTP source is incomplete or ambiguous.');
  }
  return matches[0][1] === 'true';
};

export const requireCanonicalRefundTotpSourceClosed = ({
  repoRoot = process.cwd(),
  readFileSync = fs.readFileSync,
} = {}) => {
  const configPath = path.join(repoRoot, 'supabase', 'config.toml');
  const lines = readFileSync(configPath, 'utf8').split(/\r?\n/u);
  const sectionIndexes = lines
    .map((line, index) => line.trim() === '[auth.mfa.totp]' ? index : -1)
    .filter((index) => index >= 0);
  if (sectionIndexes.length !== 1) {
    fail('Canonical Supabase Auth TOTP source is incomplete or ambiguous.');
  }

  const startIndex = sectionIndexes[0] + 1;
  const nextSectionOffset = lines
    .slice(startIndex)
    .findIndex((line) => /^\s*\[[^\]]+\]\s*$/u.test(line));
  const endIndex = nextSectionOffset < 0
    ? lines.length
    : startIndex + nextSectionOffset;
  const sectionLines = lines.slice(startIndex, endIndex);
  const enrollmentEnabled = readBooleanSetting(sectionLines, 'enroll_enabled');
  const verificationEnabled = readBooleanSetting(sectionLines, 'verify_enabled');

  if (enrollmentEnabled || !verificationEnabled) {
    fail('Canonical Supabase Auth TOTP source is not in the reviewed closed state.');
  }

  return { enrollmentEnabled, verificationEnabled };
};

export const requireOwnerHeldAuthConfigReadToken = (environment = process.env) => {
  const token = environment[REFUND_AUTH_CONFIG_READ_TOKEN_ENV]?.trim();
  if (!token) {
    fail(
      `${REFUND_AUTH_CONFIG_READ_TOKEN_ENV} is required from the owner's short-lived private shell.`
    );
  }
  return token;
};

export const readHostedRefundTotpState = async ({
  projectRef,
  confirmedProjectRef,
  accessToken,
  fetchImpl = globalThis.fetch,
}) => {
  const exactProjectRef = requireExactRefundProductionProject({
    projectRef,
    confirmedProjectRef,
  });
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    fail(
      `${REFUND_AUTH_CONFIG_READ_TOKEN_ENV} is required from the owner's short-lived private shell.`
    );
  }
  if (typeof fetchImpl !== 'function') {
    fail('A read-only HTTP client is required for the Auth control-plane check.');
  }

  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${exactProjectRef}/config/auth`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        cache: 'no-store',
      }
    );
  } catch {
    fail('Live Supabase Auth state could not be read. No changes were made.');
  }
  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? response.status : 'unknown';
    fail(`Live Supabase Auth state could not be confirmed (HTTP ${status}). No changes were made.`);
  }

  let config;
  try {
    config = await response.json();
  } catch {
    fail('Live Supabase Auth response could not be parsed. No changes were made.');
  }
  const enrollmentEnabled = config?.mfa_totp_enroll_enabled;
  const verificationEnabled = config?.mfa_totp_verify_enabled;
  if (typeof enrollmentEnabled !== 'boolean' || typeof verificationEnabled !== 'boolean') {
    fail('Live Supabase Auth did not return both required TOTP booleans. No changes were made.');
  }

  return { enrollmentEnabled, verificationEnabled };
};

export const requireHostedRefundTotpState = (state, expectedEnrollmentEnabled) => {
  if (
    state.enrollmentEnabled !== expectedEnrollmentEnabled ||
    state.verificationEnabled !== true
  ) {
    fail(
      `Live Auth check failed: enrollment=${state.enrollmentEnabled}; ` +
      `verification=${state.verificationEnabled}. No changes were made.`
    );
  }
  return state;
};

export const formatHostedRefundTotpPass = ({ state, label }) =>
  `PASS: ${label}; enrollment=${state.enrollmentEnabled}; ` +
  `verification=${state.verificationEnabled}. Read-only check made no changes.`;

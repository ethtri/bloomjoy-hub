#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULTS = {
  appOrigin: 'http://localhost:8080',
  prodAppOrigin: 'https://www.bloomjoyusa.com',
  projectRef: 'ygbzkgxktzqsiygjlqyg',
  customAuthHost: 'auth.bloomjoyusa.com',
  requireCustomAuthDomain: false,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const parsed = { ...DEFAULTS, envFiles: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      i += 1;
      continue;
    }

    if (arg === '--app-origin' && next) {
      parsed.appOrigin = next;
      i += 1;
      continue;
    }

    if (arg === '--prod-app-origin' && next) {
      parsed.prodAppOrigin = next;
      i += 1;
      continue;
    }

    if (arg === '--project-ref' && next) {
      parsed.projectRef = next;
      i += 1;
      continue;
    }

    if (arg === '--custom-auth-host' && next) {
      parsed.customAuthHost = next;
      i += 1;
      continue;
    }

    if (arg === '--require-custom-auth-domain') {
      parsed.requireCustomAuthDomain = true;
      continue;
    }
  }

  if (parsed.envFiles.length === 0) {
    parsed.envFiles = ['.env', '.env.local'];
  }

  return parsed;
}

function parseEnvFile(contents) {
  const result = {};
  const lines = contents.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadEnv(envFiles) {
  const merged = {};
  const loadedFiles = [];

  for (const envFile of envFiles) {
    const absolute = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolute)) {
      continue;
    }

    const parsed = parseEnvFile(fs.readFileSync(absolute, 'utf8'));
    Object.assign(merged, parsed);
    loadedFiles.push(envFile);
  }

  return { merged, loadedFiles };
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getRelatedOrigins(origin) {
  if (!validUrl(origin)) {
    return [origin];
  }

  const url = new URL(origin);
  const origins = [url.origin];
  const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (isLocalHost) {
    return origins;
  }

  if (url.hostname.startsWith('www.')) {
    origins.push(`${url.protocol}//${url.hostname.slice(4)}`);
  } else {
    origins.push(`${url.protocol}//www.${url.hostname}`);
  }

  return [...new Set(origins)];
}

function printList(title, values) {
  console.log(`\n${title}`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function fail(message) {
  console.error(`ERROR: ${message}`);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function info(message) {
  console.log(`INFO: ${message}`);
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const { merged: envFromFiles, loadedFiles } = loadEnv(args.envFiles);

  const resolvedEnv = {
    ...envFromFiles,
    ...process.env,
  };

  const requiredKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const errors = [];
  const warnings = [];

  for (const key of requiredKeys) {
    if (!resolvedEnv[key] || resolvedEnv[key].trim() === '') {
      errors.push(`${key} is missing. Add it to .env or .env.local.`);
    }
  }

  if (resolvedEnv.VITE_SUPABASE_URL && !validUrl(resolvedEnv.VITE_SUPABASE_URL)) {
    errors.push('VITE_SUPABASE_URL must be a valid absolute URL.');
  }

  if (
    resolvedEnv.VITE_SUPABASE_ANON_KEY &&
    !resolvedEnv.VITE_SUPABASE_ANON_KEY.startsWith('ey')
  ) {
    warnings.push('VITE_SUPABASE_ANON_KEY does not look like a JWT-format anon key.');
  }

  const projectHost = `${args.projectRef}.supabase.co`;
  const allowedAuthHosts = new Set([projectHost, args.customAuthHost]);
  let supabaseUrlHost = '';

  if (resolvedEnv.VITE_SUPABASE_URL && validUrl(resolvedEnv.VITE_SUPABASE_URL)) {
    supabaseUrlHost = new URL(resolvedEnv.VITE_SUPABASE_URL).host;
    if (!allowedAuthHosts.has(supabaseUrlHost)) {
      warnings.push(
        `VITE_SUPABASE_URL host (${supabaseUrlHost}) is not one of expected hosts: ${projectHost}, ${args.customAuthHost}.`
      );
    }
  }

  if (args.requireCustomAuthDomain && supabaseUrlHost !== args.customAuthHost) {
    errors.push(
      `Custom auth domain required but VITE_SUPABASE_URL host is ${supabaseUrlHost || 'unset'} (expected ${args.customAuthHost}).`
    );
  }

  if (!resolvedEnv.VITE_GOOGLE_CLIENT_ID) {
    warnings.push(
      'VITE_GOOGLE_CLIENT_ID is not set. Google OAuth can still work via redirect flow, but GIS rendered button checks cannot be validated.'
    );
  }

  if (
    resolvedEnv.VITE_USE_GIS_BUTTON &&
    resolvedEnv.VITE_USE_GIS_BUTTON !== 'true' &&
    resolvedEnv.VITE_USE_GIS_BUTTON !== 'false'
  ) {
    warnings.push('VITE_USE_GIS_BUTTON should be set to "true" or "false" when provided.');
  }

  if (resolvedEnv.VITE_USE_GIS_BUTTON === 'true') {
    warnings.push(
      'VITE_USE_GIS_BUTTON=true is intended for local GIS-button checks; production auth should use redirect flow.'
    );
  }

  info(`Loaded env files: ${loadedFiles.length > 0 ? loadedFiles.join(', ') : 'none'}`);
  info(`Project ref: ${args.projectRef}`);
  info(`Expected custom auth host: ${args.customAuthHost}`);

  const googleRedirectLegacy = `https://${args.projectRef}.supabase.co/auth/v1/callback`;
  const googleRedirectCustom = `https://${args.customAuthHost}/auth/v1/callback`;
  const productionOrigins = getRelatedOrigins(args.prodAppOrigin);
  const additionalRedirectUrls = [
    `${args.appOrigin}`,
    `${args.appOrigin}/login`,
    `${args.appOrigin}/portal`,
    `${args.appOrigin}/reset-password`,
    ...productionOrigins.flatMap((origin) => [
      `${origin}`,
      `${origin}/login`,
      `${origin}/portal`,
      `${origin}/reset-password`,
    ]),
  ];

  printList('Google OAuth Authorized JavaScript origins (copy/paste)', [
    args.appOrigin,
    ...productionOrigins,
  ]);

  printList('Google OAuth Authorized redirect URIs (copy/paste)', [
    googleRedirectLegacy,
    googleRedirectCustom,
  ]);

  printList('Supabase URL Configuration values (copy/paste)', [
    `Site URL: ${productionOrigins[0]}`,
    ...additionalRedirectUrls.map((value) => `Additional redirect URL: ${value}`),
  ]);

  if (warnings.length > 0) {
    console.log('');
    for (const message of warnings) {
      warn(message);
    }
  }

  if (errors.length > 0) {
    console.log('');
    for (const message of errors) {
      fail(message);
    }
    process.exit(1);
  }

  console.log('\nAuth preflight checks passed.');
}

run();

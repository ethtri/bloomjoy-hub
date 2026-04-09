#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_RECIPIENTS = [
  'etrifari@bloomjoysweets.com',
  'ian@bloomjoysweets.com',
];
const WECOM_API_BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin';
const TOKEN_RETRYABLE_ERROR_CODES = new Set([40014, 42001, 42007, 42009]);
const submissionTypeLabels = {
  quote: 'quote request',
  demo: 'demo request',
  procurement: 'procurement inquiry',
  general: 'general inquiry',
};
const DEFAULTS = {
  envFiles: ['.env', '.env.local'],
  since: '',
  limit: 50,
  dryRun: false,
  includeTestData: false,
  kind: 'all',
};

let cachedAccessToken = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const parsed = { ...DEFAULTS, envFiles: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      index += 1;
      continue;
    }

    if (arg === '--since' && next) {
      parsed.since = next;
      index += 1;
      continue;
    }

    if (arg === '--limit' && next) {
      parsed.limit = Number(next);
      index += 1;
      continue;
    }

    if (arg === '--kind' && next) {
      parsed.kind = next;
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--include-test-data') {
      parsed.includeTestData = true;
    }
  }

  if (parsed.envFiles.length === 0) {
    parsed.envFiles = [...DEFAULTS.envFiles];
  }

  if (!['all', 'leads', 'mini_waitlist'].includes(parsed.kind)) {
    throw new Error('--kind must be one of: all, leads, mini_waitlist');
  }

  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
    throw new Error('--limit must be a positive number.');
  }

  return parsed;
}

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split(/\r?\n/)) {
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

function loadEnvFiles(envFiles) {
  const merged = {};
  const loadedFiles = [];

  for (const envFile of envFiles) {
    const absolutePath = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
    loadedFiles.push(envFile);
  }

  return {
    merged,
    loadedFiles,
  };
}

function parseRecipients(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getInternalRecipients(env) {
  const recipients = parseRecipients(env.INTERNAL_NOTIFICATION_RECIPIENTS);
  return recipients.length > 0 ? recipients : DEFAULT_RECIPIENTS;
}

function shouldSkipTestEmail(email, includeTestData) {
  if (includeTestData) {
    return false;
  }

  const normalized = String(email || '').trim().toLowerCase();
  return normalized.endsWith('@example.com') || normalized.startsWith('codex-');
}

async function sendInternalEmail(env, subject, text) {
  const resendApiKey = env.RESEND_API_KEY;
  const fromEmail = env.INTERNAL_NOTIFICATION_FROM_EMAIL;
  const recipients = getInternalRecipients(env);

  if (!resendApiKey || !fromEmail) {
    throw new Error('Missing Resend internal email configuration.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body || 'Unknown error'}`);
  }
}

function getWeComConfig(env) {
  const corpId = String(env.WECOM_CORP_ID || '').trim();
  const agentId = Number(String(env.WECOM_AGENT_ID || '').trim());
  const agentSecret = String(env.WECOM_AGENT_SECRET || '').trim();
  const toUser = String(env.WECOM_ALERT_TO_USERIDS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join('|');

  if (!corpId || !Number.isFinite(agentId) || !agentSecret || !toUser) {
    return null;
  }

  return {
    corpId,
    agentId,
    agentSecret,
    toUser,
  };
}

async function fetchWeComAccessToken(config) {
  const params = new URLSearchParams({
    corpid: config.corpId,
    corpsecret: config.agentSecret,
  });

  const response = await fetch(`${WECOM_API_BASE_URL}/gettoken?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`WeCom gettoken request failed (${response.status}).`);
  }

  const payload = await response.json();
  const errCode = Number(payload.errcode ?? -1);
  if (errCode !== 0) {
    throw new Error(`WeCom gettoken failed (${errCode}): ${payload.errmsg ?? 'Unknown error'}`);
  }

  cachedAccessToken = {
    token: String(payload.access_token || '').trim(),
    expiresAtMs: Date.now() + Number(payload.expires_in ?? 0) * 1000,
  };

  return cachedAccessToken.token;
}

async function getWeComAccessToken(config, forceRefresh = false) {
  if (
    !forceRefresh &&
    cachedAccessToken &&
    Date.now() + 60_000 < cachedAccessToken.expiresAtMs
  ) {
    return cachedAccessToken.token;
  }

  return fetchWeComAccessToken(config);
}

async function sendWeComAlertSafe(env, title, lines, tag) {
  const config = getWeComConfig(env);
  if (!config) {
    return { ok: false, skipped: true, message: 'WeCom config missing.' };
  }

  const content = [tag ? `[${tag}] ${title}` : title, ...lines.filter(Boolean)]
    .join('\n')
    .slice(0, 1800);

  try {
    let accessToken = await getWeComAccessToken(config);
    let response = await fetch(
      `${WECOM_API_BASE_URL}/message/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          touser: config.toUser,
          msgtype: 'text',
          agentid: config.agentId,
          text: {
            content,
          },
          safe: 0,
        }),
      }
    );

    let payload = await response.json();
    let errCode = Number(payload.errcode ?? -1);

    if (TOKEN_RETRYABLE_ERROR_CODES.has(errCode)) {
      cachedAccessToken = null;
      accessToken = await getWeComAccessToken(config, true);
      response = await fetch(
        `${WECOM_API_BASE_URL}/message/send?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            touser: config.toUser,
            msgtype: 'text',
            agentid: config.agentId,
            text: {
              content,
            },
            safe: 0,
          }),
        }
      );
      payload = await response.json();
      errCode = Number(payload.errcode ?? -1);
    }

    if (!response.ok || errCode !== 0) {
      return {
        ok: false,
        skipped: false,
        message: `WeCom message send failed (${errCode}): ${payload.errmsg ?? response.status}`,
      };
    }

    return {
      ok: true,
      skipped: false,
      message: 'WeCom alert sent.',
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildLeadEmail(row) {
  const submissionLabel = submissionTypeLabels[row.submission_type] || 'lead submission';
  return {
    subject: `New ${submissionLabel}: ${row.name}`,
    text: [
      `A new ${submissionLabel} was submitted.`,
      '',
      `Submission ID: ${row.id}`,
      `Submitted At (UTC): ${row.created_at}`,
      `Inquiry Type: ${row.submission_type}`,
      `Name: ${row.name}`,
      `Email: ${row.email}`,
      `Source Page: ${row.source_page}`,
      '',
      'Message:',
      row.message,
    ].join('\n'),
    wecomTitle: `New ${submissionLabel}: ${row.name}`,
    wecomTag: 'Bloomjoy Lead',
    wecomLines: [
      `Submission ID: ${row.id}`,
      `Submitted At (UTC): ${row.created_at}`,
      `Inquiry Type: ${row.submission_type}`,
      `Name: ${row.name}`,
      `Email: ${row.email}`,
      `Source Page: ${row.source_page}`,
      'Message:',
      row.message,
    ],
    dispatchType: 'lead_submission',
    eventKey: `lead_submission:${row.id}`,
    sourceTable: 'lead_submissions',
    sourceId: row.id,
    meta: {
      submission_type: row.submission_type,
      source_page: row.source_page,
      email: row.email,
      recovered_by: 'scripts/backfill-submission-notifications',
    },
  };
}

function buildWaitlistEmail(row) {
  return {
    subject: `New Mini waitlist sign-up: ${row.email}`,
    text: [
      'A new Mini waitlist sign-up was submitted.',
      '',
      `Submission ID: ${row.id}`,
      `Submitted At (UTC): ${row.created_at}`,
      `Product: ${row.product_slug}`,
      `Email: ${row.email}`,
      `Source Page: ${row.source_page}`,
    ].join('\n'),
    wecomTitle: 'New Mini waitlist sign-up',
    wecomTag: 'Bloomjoy Mini',
    wecomLines: [
      `Submission ID: ${row.id}`,
      `Submitted At (UTC): ${row.created_at}`,
      `Product: ${row.product_slug}`,
      `Email: ${row.email}`,
      `Source Page: ${row.source_page}`,
    ],
    dispatchType: 'mini_waitlist',
    eventKey: `mini_waitlist:${row.id}`,
    sourceTable: 'mini_waitlist_submissions',
    sourceId: row.id,
    meta: {
      product_slug: row.product_slug,
      source_page: row.source_page,
      email: row.email,
      recovered_by: 'scripts/backfill-submission-notifications',
    },
  };
}

async function recordDispatch(supabase, payload) {
  const { error } = await supabase.from('internal_notification_dispatches').upsert(
    {
      event_key: payload.eventKey,
      dispatch_type: payload.dispatchType,
      source_table: payload.sourceTable,
      source_id: payload.sourceId,
      meta: payload.meta,
      sent_at: new Date().toISOString(),
    },
    {
      onConflict: 'event_key',
    }
  );

  if (error) {
    throw new Error(error.message || 'Failed to record internal notification dispatch.');
  }
}

async function backfillLeads({ supabase, env, since, limit, dryRun, includeTestData }) {
  let query = supabase
    .from('lead_submissions')
    .select(
      'id, submission_type, name, email, message, source_page, created_at, internal_notification_sent_at'
    )
    .is('internal_notification_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (since) {
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'Unable to load unsent lead submissions.');
  }

  const rows = (data || []).filter((row) => !shouldSkipTestEmail(row.email, includeTestData));
  console.log(`INFO: lead submissions queued for backfill: ${rows.length}`);

  for (const row of rows) {
    const payload = buildLeadEmail(row);
    if (dryRun) {
      console.log(`DRY RUN lead ${row.id} -> ${row.email}`);
      continue;
    }

    await sendInternalEmail(env, payload.subject, payload.text);
    const wecomResult = await sendWeComAlertSafe(
      env,
      payload.wecomTitle,
      payload.wecomLines,
      payload.wecomTag
    );
    await supabase
      .from('lead_submissions')
      .update({ internal_notification_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    await recordDispatch(supabase, payload);
    console.log(
      `RECOVERED lead ${row.id} -> ${row.email} (WeCom: ${wecomResult.message})`
    );
  }
}

async function backfillMiniWaitlist({
  supabase,
  env,
  since,
  limit,
  dryRun,
  includeTestData,
}) {
  const columnProbe = await supabase
    .from('mini_waitlist_submissions')
    .select('id, internal_notification_sent_at')
    .limit(1);

  const supportsNotificationColumn = !columnProbe.error;
  const selectedColumns = supportsNotificationColumn
    ? 'id, product_slug, email, source_page, created_at, internal_notification_sent_at'
    : 'id, product_slug, email, source_page, created_at';

  if (!supportsNotificationColumn && !since) {
    throw new Error(
      'Mini waitlist backfill requires --since until mini_waitlist_submissions.internal_notification_sent_at exists in the target database.'
    );
  }

  let query = supabase
    .from('mini_waitlist_submissions')
    .select(selectedColumns)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (since) {
    query = query.gte('created_at', since);
  }

  if (supportsNotificationColumn) {
    query = query.is('internal_notification_sent_at', null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'Unable to load Mini waitlist rows.');
  }

  const rows = (data || []).filter((row) => !shouldSkipTestEmail(row.email, includeTestData));
  console.log(`INFO: Mini waitlist rows queued for backfill: ${rows.length}`);

  for (const row of rows) {
    const payload = buildWaitlistEmail(row);
    if (dryRun) {
      console.log(`DRY RUN mini_waitlist ${row.id} -> ${row.email}`);
      continue;
    }

    await sendInternalEmail(env, payload.subject, payload.text);
    const wecomResult = await sendWeComAlertSafe(
      env,
      payload.wecomTitle,
      payload.wecomLines,
      payload.wecomTag
    );

    if (supportsNotificationColumn) {
      await supabase
        .from('mini_waitlist_submissions')
        .update({ internal_notification_sent_at: new Date().toISOString() })
        .eq('id', row.id);
    }

    await recordDispatch(supabase, payload);
    console.log(
      `RECOVERED mini_waitlist ${row.id} -> ${row.email} (WeCom: ${wecomResult.message})`
    );
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { merged, loadedFiles } = loadEnvFiles(args.envFiles);
  const env = { ...merged, ...process.env };

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service role key.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(
    `INFO: Loaded env files: ${loadedFiles.length ? loadedFiles.join(', ') : 'process.env only'}`
  );
  console.log(
    `INFO: Backfill mode: kind=${args.kind} since=${args.since || 'none'} limit=${args.limit} dryRun=${args.dryRun}`
  );

  if (args.kind === 'all' || args.kind === 'leads') {
    await backfillLeads({
      supabase,
      env,
      since: args.since,
      limit: args.limit,
      dryRun: args.dryRun,
      includeTestData: args.includeTestData,
    });
  }

  if (args.kind === 'all' || args.kind === 'mini_waitlist') {
    await backfillMiniWaitlist({
      supabase,
      env,
      since: args.since,
      limit: args.limit,
      dryRun: args.dryRun,
      includeTestData: args.includeTestData,
    });
  }

  console.log('Submission notification backfill completed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

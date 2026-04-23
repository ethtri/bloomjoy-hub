#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULTS = {
  days: 7,
  envFiles: ['.env', '.env.local'],
  format: 'markdown',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const parsed = { ...DEFAULTS, envFiles: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--days' && next) {
      const days = Number(next);
      if (Number.isFinite(days) && days > 0) {
        parsed.days = days;
      }
      index += 1;
      continue;
    }

    if (arg === '--env-file' && next) {
      parsed.envFiles.push(next);
      index += 1;
      continue;
    }

    if (arg === '--format' && next) {
      parsed.format = next === 'json' ? 'json' : 'markdown';
      index += 1;
      continue;
    }
  }

  if (parsed.envFiles.length === 0) {
    parsed.envFiles = [...DEFAULTS.envFiles];
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
    env: {
      ...merged,
      ...process.env,
    },
    loadedFiles,
  };
}

function countBy(rows, mapper) {
  return rows.reduce((acc, row) => {
    const key = mapper(row) || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function sumCents(rows) {
  return rows.reduce((total, row) => {
    const amount = Number(row.amount_total);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function toSortedEntries(record) {
  return Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function fetchRows(client, table, select, cutoffIso) {
  const { data, error } = await client
    .from(table)
    .select(select)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }

  return data ?? [];
}

function buildActionQueue({ leads, orders, subscriptions }) {
  const actions = [];
  const qualifiedLeads = leads.filter((lead) => ['A', 'B'].includes(lead.qualification_grade));
  const quoteLeads = leads.filter((lead) => lead.submission_type === 'quote');
  const optIns = leads.filter((lead) => lead.marketing_consent);

  if (qualifiedLeads.length === 0) {
    actions.push('Prioritize one machine-buyer SEO/CRO improvement before adding social volume.');
  }

  if (quoteLeads.length > 0 && optIns.length === 0) {
    actions.push('Review contact form consent copy and lead magnet offer; quote demand is not converting into nurture permission.');
  }

  if (orders.length > 0 && subscriptions.length === 0) {
    actions.push('Add a Plus follow-up to post-purchase owned channels for recent supply buyers.');
  }

  if (actions.length === 0) {
    actions.push('Continue the weekly owned-first cadence: one SEO asset, one email/nurture improvement, and one conversion experiment.');
  }

  return actions;
}

function buildScorecard({ days, cutoffIso, leads, orders, subscriptions }) {
  const quoteLeads = leads.filter((lead) => lead.submission_type === 'quote');
  const qualifiedA = quoteLeads.filter((lead) => lead.qualification_grade === 'A');
  const qualifiedB = quoteLeads.filter((lead) => lead.qualification_grade === 'B');
  const optIns = leads.filter((lead) => lead.marketing_consent);
  const plusInterest = leads.filter((lead) => lead.plus_interest);
  const completedOrders = orders.filter((order) => order.status === 'paid' || order.status === 'complete');
  const activeSubscriptions = subscriptions.filter((subscription) =>
    ['active', 'trialing'].includes(subscription.status)
  );

  return {
    generated_at: new Date().toISOString(),
    window_days: days,
    cutoff_iso: cutoffIso,
    metrics: {
      total_leads: leads.length,
      quote_leads: quoteLeads.length,
      qualified_quote_leads_a: qualifiedA.length,
      qualified_quote_leads_b: qualifiedB.length,
      qualified_quote_leads_a_or_b: qualifiedA.length + qualifiedB.length,
      marketing_opt_ins: optIns.length,
      plus_interest_leads: plusInterest.length,
      orders: orders.length,
      completed_orders: completedOrders.length,
      order_revenue: sumCents(completedOrders.length ? completedOrders : orders),
      plus_activations: activeSubscriptions.length,
    },
    breakdowns: {
      leads_by_machine: countBy(quoteLeads, (lead) => lead.machine_interest),
      leads_by_segment: countBy(quoteLeads, (lead) => lead.audience_segment),
      leads_by_grade: countBy(quoteLeads, (lead) => lead.qualification_grade),
      leads_by_utm_source: countBy(leads, (lead) => lead.attribution?.utm_source),
      leads_by_utm_campaign: countBy(leads, (lead) => lead.attribution?.utm_campaign),
      orders_by_type: countBy(orders, (order) => order.order_type),
    },
    autonomous_action_queue: buildActionQueue({ leads, orders, subscriptions }),
  };
}

function renderBreakdown(title, record) {
  const entries = toSortedEntries(record);
  if (entries.length === 0) {
    return [`### ${title}`, '- none'];
  }

  return [
    `### ${title}`,
    ...entries.map(([key, count]) => `- ${key}: ${count}`),
  ];
}

function renderMarkdown(scorecard) {
  const metrics = scorecard.metrics;
  return [
    '# Bloomjoy Autonomous Marketing Scorecard',
    '',
    `Generated: ${scorecard.generated_at}`,
    `Window: last ${scorecard.window_days} days since ${scorecard.cutoff_iso}`,
    '',
    '## KPI Summary',
    `- Qualified quote leads (A/B): ${metrics.qualified_quote_leads_a_or_b}`,
    `- A-grade quote leads: ${metrics.qualified_quote_leads_a}`,
    `- Total quote leads: ${metrics.quote_leads}`,
    `- Marketing opt-ins: ${metrics.marketing_opt_ins}`,
    `- Plus-interest leads: ${metrics.plus_interest_leads}`,
    `- Orders: ${metrics.orders}`,
    `- Completed-order revenue: ${formatUsd(metrics.order_revenue)}`,
    `- Plus activations: ${metrics.plus_activations}`,
    '',
    ...renderBreakdown('Quote Leads By Grade', scorecard.breakdowns.leads_by_grade),
    '',
    ...renderBreakdown('Quote Leads By Machine', scorecard.breakdowns.leads_by_machine),
    '',
    ...renderBreakdown('Quote Leads By Segment', scorecard.breakdowns.leads_by_segment),
    '',
    ...renderBreakdown('Leads By UTM Source', scorecard.breakdowns.leads_by_utm_source),
    '',
    ...renderBreakdown('Leads By UTM Campaign', scorecard.breakdowns.leads_by_utm_campaign),
    '',
    ...renderBreakdown('Orders By Type', scorecard.breakdowns.orders_by_type),
    '',
    '## Autonomous Action Queue',
    ...scorecard.autonomous_action_queue.map((action) => `- ${action}`),
  ].join('\n');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const { env, loadedFiles } = loadEnvFiles(args.envFiles);
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('This command reads aggregate marketing data and requires service-role access.');
    process.exit(1);
  }

  const cutoffIso = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });

  const [leads, orders, subscriptions] = await Promise.all([
    fetchRows(
      client,
      'lead_submissions',
      'created_at, submission_type, source_page, machine_interest, audience_segment, purchase_timeline, budget_status, plus_interest, marketing_consent, qualification_grade, attribution',
      cutoffIso
    ),
    fetchRows(
      client,
      'orders',
      'created_at, order_type, amount_total, pricing_tier, status',
      cutoffIso
    ),
    fetchRows(
      client,
      'subscriptions',
      'created_at, status',
      cutoffIso
    ),
  ]);

  const scorecard = buildScorecard({ days: args.days, cutoffIso, leads, orders, subscriptions });

  if (args.format === 'json') {
    console.log(JSON.stringify(scorecard, null, 2));
    return;
  }

  if (loadedFiles.length > 0) {
    console.error(`Loaded env files: ${loadedFiles.join(', ')}`);
  }
  console.log(renderMarkdown(scorecard));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

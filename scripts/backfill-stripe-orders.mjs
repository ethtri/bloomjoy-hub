#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULTS = {
  envFiles: ['.env', '.env.local'],
  dryRun: false,
  sessionIds: [],
};

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

    if (arg === '--session-id' && next) {
      parsed.sessionIds.push(next);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
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

  for (const envFile of envFiles) {
    const absolutePath = path.resolve(repoRoot, envFile);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
  }

  return {
    ...merged,
    ...process.env,
  };
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toAddressSnapshot(address) {
  if (!address || typeof address !== 'object') {
    return null;
  }

  const snapshot = {
    line1: normalizeString(address.line1),
    line2: normalizeString(address.line2),
    city: normalizeString(address.city),
    state: normalizeString(address.state),
    postal_code: normalizeString(address.postal_code),
    country: normalizeString(address.country),
  };

  return Object.values(snapshot).some(Boolean) ? snapshot : null;
}

function deriveUnitPriceCents(lineItems) {
  const primaryLineItem = lineItems.find(
    (item) =>
      typeof item.amount_total === 'number' &&
      typeof item.quantity === 'number' &&
      item.quantity > 0
  );

  if (!primaryLineItem) {
    return null;
  }

  return Math.round(primaryLineItem.amount_total / primaryLineItem.quantity);
}

function coerceOrderType(metadataOrderType, sugarMix, blankSticks) {
  if (metadataOrderType === 'sugar' || metadataOrderType === 'blank_sticks') {
    return metadataOrderType;
  }

  if (sugarMix.total_kg > 0) {
    return 'sugar';
  }

  if (blankSticks.box_count > 0) {
    return 'blank_sticks';
  }

  return 'unknown';
}

async function fetchStripeJson(stripeSecretKey, pathname, params = []) {
  const url = new URL(`https://api.stripe.com/${pathname.replace(/^\//, '')}`);

  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Stripe request failed (${response.status}) for ${url.pathname}: ${errorBody || 'Unknown error'}`
    );
  }

  return response.json();
}

async function resolveUserId(supabase, candidateUserId) {
  if (!candidateUserId) {
    return null;
  }

  const { data, error } = await supabase.auth.admin.getUserById(candidateUserId);
  if (error || !data?.user) {
    return null;
  }

  return data.user.id;
}

async function resolveUserIdByEmail(supabase, email) {
  if (!email) {
    return null;
  }

  const { data, error } = await supabase
    .schema('auth')
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data.id;
}

function mapSessionToOrderPayload(session) {
  const metadata = session.metadata || {};
  const lineItems = Array.isArray(session.line_items?.data)
    ? session.line_items.data.map((item) => ({
        description: item.description ?? null,
        quantity: item.quantity ?? null,
        amount_total: item.amount_total ?? null,
        currency: item.currency ?? null,
        price_id: item.price?.id ?? null,
      }))
    : [];

  const sugarMix = {
    white_kg: parseNumber(metadata.sugar_white_kg),
    blue_kg: parseNumber(metadata.sugar_blue_kg),
    orange_kg: parseNumber(metadata.sugar_orange_kg),
    red_kg: parseNumber(metadata.sugar_red_kg),
    total_kg: parseNumber(metadata.sugar_total_kg),
  };

  const blankSticks = {
    box_count: parseNumber(metadata.sticks_box_count),
    pieces_per_box: parseNumber(metadata.sticks_pieces_per_box),
    stick_size: normalizeString(metadata.stick_size),
    address_type: normalizeString(metadata.sticks_address_type),
    shipping_rate_per_box_usd: parseNumber(metadata.sticks_shipping_rate_per_box_usd),
    shipping_total_cents: parseNumber(metadata.sticks_shipping_total_cents),
    free_shipping: String(metadata.sticks_free_shipping ?? 'false') === 'true',
  };

  if (sugarMix.total_kg > 0) {
    lineItems.push({
      description: 'Sugar mix breakdown',
      quantity: sugarMix.total_kg,
      amount_total: null,
      currency: session.currency ?? null,
      price_id: null,
      metadata: sugarMix,
    });
  }

  if (blankSticks.box_count > 0 || blankSticks.pieces_per_box > 0) {
    lineItems.push({
      description: 'Blank sticks order details',
      quantity: blankSticks.box_count || null,
      amount_total: null,
      currency: session.currency ?? null,
      price_id: null,
      metadata: blankSticks,
    });
  }

  const latestCharge = session.payment_intent?.latest_charge ?? null;
  const billingDetails = latestCharge?.billing_details ?? null;
  const orderType = coerceOrderType(metadata.order_type, sugarMix, blankSticks);
  const pricingTier =
    metadata.pricing_tier === 'plus_member' || metadata.pricing_tier === 'standard'
      ? metadata.pricing_tier
      : null;
  const unitPriceCents = parseNumber(metadata.unit_price_cents) || deriveUnitPriceCents(lineItems);
  const shippingTotalCents =
    typeof session.total_details?.amount_shipping === 'number'
      ? session.total_details.amount_shipping
      : parseNumber(metadata.shipping_total_cents) || blankSticks.shipping_total_cents;

  return {
    orderType,
    lineItems,
    sugarMix,
    payload: {
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      stripe_customer_id:
        typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      order_type: orderType,
      status: session.payment_status || 'unpaid',
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null,
      customer_email:
        normalizeString(session.customer_details?.email) ||
        normalizeString(session.customer_email) ||
        normalizeString(billingDetails?.email),
      customer_name:
        normalizeString(session.customer_details?.name) || normalizeString(billingDetails?.name),
      customer_phone:
        normalizeString(session.customer_details?.phone) || normalizeString(billingDetails?.phone),
      billing_address:
        toAddressSnapshot(session.customer_details?.address) || toAddressSnapshot(billingDetails?.address),
      shipping_name: normalizeString(session.shipping_details?.name),
      shipping_phone: normalizeString(session.shipping_details?.phone),
      shipping_address: toAddressSnapshot(session.shipping_details?.address),
      pricing_tier: pricingTier,
      unit_price_cents: unitPriceCents || null,
      shipping_total_cents: shippingTotalCents,
      receipt_url: normalizeString(latestCharge?.receipt_url),
      line_items: lineItems,
    },
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.sessionIds.length === 0) {
    console.error('ERROR: Provide at least one --session-id <cs_...> value.');
    process.exit(1);
  }

  const env = loadEnvFiles(args.envFiles);
  const requiredKeys = ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missingKeys = requiredKeys.filter((key) => !env[key] || String(env[key]).trim() === '');

  if (missingKeys.length > 0) {
    console.error(`ERROR: Missing required env vars: ${missingKeys.join(', ')}`);
    process.exit(1);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  for (const sessionId of args.sessionIds) {
    const session = await fetchStripeJson(env.STRIPE_SECRET_KEY, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, [
      ['expand[]', 'line_items'],
      ['expand[]', 'payment_intent.latest_charge'],
    ]);

    const normalized = mapSessionToOrderPayload(session);
    const metadataUserId = normalizeString(session.metadata?.user_id);
    const clientReferenceId = normalizeString(session.client_reference_id);
    let userId = await resolveUserId(supabase, metadataUserId || clientReferenceId);

    if (!userId) {
      userId = await resolveUserIdByEmail(supabase, normalized.payload.customer_email);
    }

    const payload = {
      user_id: userId,
      ...normalized.payload,
    };

    if (args.dryRun) {
      console.log(
        JSON.stringify(
          {
            session_id: session.id,
            order_type: normalized.orderType,
            customer_email: payload.customer_email,
            amount_total: payload.amount_total,
            pricing_tier: payload.pricing_tier,
            sugar_mix: normalized.sugarMix,
            payload,
          },
          null,
          2
        )
      );
      continue;
    }

    const { error } = await supabase.from('orders').upsert(payload, {
      onConflict: 'stripe_checkout_session_id',
    });

    if (error) {
      throw new Error(`Failed to backfill order for ${session.id}: ${error.message}`);
    }

    console.log(
      `Imported ${session.id} (${normalized.orderType}) for ${payload.customer_email ?? 'unknown customer'}.`
    );
  }

  if (args.dryRun) {
    console.log('\nDry run complete. No orders were written.');
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});

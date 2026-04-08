#!/usr/bin/env node

import { createHmac } from 'node:crypto';

function sanitize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseArgs(argv) {
  const parsed = {
    title: 'Bloomjoy relay smoke test',
    tag: 'Bloomjoy Relay',
    lines: [],
    relayUrl: sanitize(process.env.WECOM_RELAY_URL),
    hmacSecret: sanitize(process.env.WECOM_RELAY_HMAC_SECRET),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--relay-url' && next) {
      parsed.relayUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--hmac-secret' && next) {
      parsed.hmacSecret = next;
      index += 1;
      continue;
    }

    if (arg === '--title' && next) {
      parsed.title = next;
      index += 1;
      continue;
    }

    if (arg === '--tag' && next) {
      parsed.tag = next;
      index += 1;
      continue;
    }

    if (arg === '--line' && next) {
      parsed.lines.push(next);
      index += 1;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.relayUrl || !args.hmacSecret) {
    throw new Error(
      'Set WECOM_RELAY_URL and WECOM_RELAY_HMAC_SECRET, or pass --relay-url and --hmac-secret.'
    );
  }

  const payload = {
    title: args.title,
    tag: args.tag,
    lines:
      args.lines.length > 0
        ? args.lines
        : [`Triggered at ${new Date().toISOString()}`],
  };

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', args.hmacSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const response = await fetch(args.relayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bloomjoy-Timestamp': timestamp,
      'X-Bloomjoy-Signature': signature,
    },
    body,
  });

  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  if (text) {
    console.log(text);
  }

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

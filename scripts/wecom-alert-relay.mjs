#!/usr/bin/env node

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const WECOM_API_BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin';
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const MAX_TEXT_CONTENT_LENGTH = 1800;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const TOKEN_RETRYABLE_ERROR_CODES = new Set([40014, 42001, 42007, 42009]);

let cachedAccessToken = null;

function sanitize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseToUser(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join('|');
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRelayConfig() {
  const corpId = sanitize(process.env.WECOM_CORP_ID);
  const agentIdRaw = sanitize(process.env.WECOM_AGENT_ID);
  const agentSecret = sanitize(process.env.WECOM_AGENT_SECRET);
  const toUserRaw = sanitize(process.env.WECOM_ALERT_TO_USERIDS);
  const hmacSecret = sanitize(process.env.WECOM_RELAY_HMAC_SECRET);
  const host = sanitize(process.env.WECOM_RELAY_BIND_HOST) || '0.0.0.0';
  const port = parsePositiveNumber(process.env.PORT, 8787);
  const maxSkewSeconds = parsePositiveNumber(
    process.env.WECOM_RELAY_MAX_SKEW_SECONDS,
    300
  );

  if (!corpId || !agentIdRaw || !agentSecret || !toUserRaw || !hmacSecret) {
    throw new Error(
      'Missing relay configuration. Set WECOM_CORP_ID, WECOM_AGENT_ID, WECOM_AGENT_SECRET, WECOM_ALERT_TO_USERIDS, and WECOM_RELAY_HMAC_SECRET.'
    );
  }

  const agentId = Number(agentIdRaw);
  if (!Number.isFinite(agentId)) {
    throw new Error('WECOM_AGENT_ID must be numeric.');
  }

  const toUser = parseToUser(toUserRaw);
  if (!toUser) {
    throw new Error('WECOM_ALERT_TO_USERIDS must contain at least one valid user ID.');
  }

  return {
    corpId,
    agentId,
    agentSecret,
    toUser,
    hmacSecret,
    host,
    port,
    maxSkewMs: maxSkewSeconds * 1000,
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function buildContent({ title, lines, tag }) {
  const header = tag ? `[${tag}] ${title}` : title;
  const content = [header, ...lines.filter(Boolean)].join('\n');
  return content.length <= MAX_TEXT_CONTENT_LENGTH
    ? content
    : `${content.slice(0, MAX_TEXT_CONTENT_LENGTH - 3)}...`;
}

function hasValidCachedToken() {
  return (
    !!cachedAccessToken &&
    Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS < cachedAccessToken.expiresAtMs
  );
}

async function fetchAccessToken(config) {
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
    throw new Error(
      `WeCom gettoken failed (${errCode}): ${payload.errmsg ?? 'Unknown error'}`
    );
  }

  const accessToken = sanitize(payload.access_token);
  const expiresIn = Number(payload.expires_in ?? 0);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('WeCom gettoken response was missing token metadata.');
  }

  cachedAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

async function getAccessToken(config, forceRefresh = false) {
  if (!forceRefresh && hasValidCachedToken()) {
    return cachedAccessToken.token;
  }

  return fetchAccessToken(config);
}

async function sendMessageWithToken(config, accessToken, content) {
  const response = await fetch(
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

  if (!response.ok) {
    throw new Error(`WeCom message send request failed (${response.status}).`);
  }

  const payload = await response.json();
  const errCode = Number(payload.errcode ?? -1);
  return {
    ok: errCode === 0,
    errCode,
    errMessage: payload.errmsg ?? 'Unknown error',
  };
}

async function sendAlert(config, input) {
  const content = buildContent(input);
  let accessToken = await getAccessToken(config);
  let sendResult = await sendMessageWithToken(config, accessToken, content);

  if (!sendResult.ok && TOKEN_RETRYABLE_ERROR_CODES.has(sendResult.errCode)) {
    cachedAccessToken = null;
    accessToken = await getAccessToken(config, true);
    sendResult = await sendMessageWithToken(config, accessToken, content);
  }

  if (!sendResult.ok) {
    throw new Error(
      `WeCom message send failed (${sendResult.errCode}): ${sendResult.errMessage}`
    );
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        reject(new Error('Request body exceeded maximum size.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    request.on('error', (error) => {
      reject(error);
    });
  });
}

function validateSignature(config, timestamp, body, receivedSignature) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) {
    return false;
  }

  if (Math.abs(Date.now() - numericTimestamp) > config.maxSkewMs) {
    return false;
  }

  const expectedSignature = createHmac('sha256', config.hmacSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function parseAlertPayload(body) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }

  const title = sanitize(payload?.title);
  const tag = sanitize(payload?.tag) || undefined;
  const lines = Array.isArray(payload?.lines)
    ? payload.lines.map((entry) => sanitize(entry)).filter(Boolean)
    : [];

  if (!title) {
    throw new Error('Alert title is required.');
  }

  return { title, tag, lines };
}

async function main() {
  const config = getRelayConfig();

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'wecom-alert-relay',
          direct_send_configured: true,
          recipient_count: config.toUser.split('|').filter(Boolean).length,
        });
        return;
      }

      if (request.method !== 'POST' || requestUrl.pathname !== '/wecom-alert') {
        sendJson(response, 404, { ok: false, message: 'Not found.' });
        return;
      }

      const body = await readRequestBody(request);
      const timestamp = sanitize(request.headers['x-bloomjoy-timestamp']);
      const signature = sanitize(request.headers['x-bloomjoy-signature']);

      if (!timestamp || !signature) {
        sendJson(response, 401, { ok: false, message: 'Missing relay signature headers.' });
        return;
      }

      if (!validateSignature(config, timestamp, body, signature)) {
        sendJson(response, 401, { ok: false, message: 'Invalid relay signature.' });
        return;
      }

      const alertInput = parseAlertPayload(body);
      await sendAlert(config, alertInput);
      sendJson(response, 200, { ok: true, message: 'WeCom alert sent.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('wecom-alert-relay error', message);
      sendJson(response, 502, { ok: false, message });
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(
      `wecom-alert-relay listening on http://${config.host}:${config.port} with ${config.toUser.split('|').filter(Boolean).length} configured recipient(s).`
    );
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

import { sha256 } from './kexiazhan-contract.mjs';

export const KEXIAOZHAN_API_BASE_URL = 'https://kxzus.kexiaozhan.com/mer';
export const KEXIAOZHAN_READ_PATHS = Object.freeze([
  '/v1/machines',
  '/v1/orders',
  '/v1/payments',
]);

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const ID_FIELDS = Object.freeze({
  '/v1/machines': ['machineId', 'id'],
  '/v1/orders': ['orderNo'],
  '/v1/payments': ['outTradeNo'],
});
const QUERY_FIELDS = Object.freeze({
  '/v1/machines': new Set(['page', 'size']),
  '/v1/orders': new Set(['page', 'size', 'machineId', 'paymentTimeStart', 'paymentTimeEnd']),
  '/v1/payments': new Set(['page', 'size', 'machineId', 'paymentTimeStart', 'paymentTimeEnd']),
});

export class SnapcaseTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SnapcaseTransportError';
    this.code = code;
    this.details = details;
  }
}

const wait = (milliseconds) =>
  milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();

const retryAfterMs = (value, now = Date.now()) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
};

const unwrapPage = (payload) => {
  if (Number(payload?.code) !== 0) {
    throw new SnapcaseTransportError('provider_error', 'SnapCase returned a provider error');
  }
  if (!payload?.data || !Array.isArray(payload.data.list)) {
    throw new SnapcaseTransportError('invalid_page_schema', 'SnapCase page schema is invalid');
  }
  const total = Number(payload.data.total);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new SnapcaseTransportError('invalid_page_total', 'SnapCase page total is invalid');
  }
  return { rows: payload.data.list, total };
};

const rowIdentity = (path, record) => {
  const values = (ID_FIELDS[path] ?? []).map((field) => String(record?.[field] ?? '').trim());
  return values.length > 0 && values.every(Boolean)
    ? `${path}:${values.join(':')}`
    : `${path}:digest:${sha256(JSON.stringify(record))}`;
};

export class KexiazhanReadOnlyClient {
  #baseUrl;
  #fetch;
  #language;
  #timezone;
  #timeoutMs;
  #maxAttempts;
  #baseDelayMs;
  #maxDelayMs;
  #sleep;
  #random;
  #token = null;
  #credentials = null;
  #refreshPromise = null;

  constructor({
    baseUrl = KEXIAOZHAN_API_BASE_URL,
    fetchImpl = globalThis.fetch,
    language = 'en-US',
    timezone = 'UTC',
    timeoutMs = 15_000,
    maxAttempts = 4,
    baseDelayMs = 250,
    maxDelayMs = 10_000,
    sleep = wait,
    random = Math.random,
  } = {}) {
    if (baseUrl !== KEXIAOZHAN_API_BASE_URL) throw new Error('SnapCase API base URL is not allowlisted');
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid timeout');
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 6) throw new Error('Invalid attempt limit');
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#language = String(language).slice(0, 40);
    this.#timezone = String(timezone).slice(0, 100);
    this.#timeoutMs = timeoutMs;
    this.#maxAttempts = maxAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#maxDelayMs = maxDelayMs;
    this.#sleep = sleep;
    this.#random = random;
  }

  async #timedRequest(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (!response.ok) return { response, payload: null };
      try {
        return { response, payload: await response.json() };
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw new SnapcaseTransportError('timeout', 'SnapCase response body timed out');
        }
        throw new SnapcaseTransportError('invalid_json', 'SnapCase returned invalid JSON');
      }
    } catch (error) {
      if (error instanceof SnapcaseTransportError) throw error;
      const code = error?.name === 'AbortError' ? 'timeout' : 'network_error';
      throw new SnapcaseTransportError(code, `SnapCase request ${code === 'timeout' ? 'timed out' : 'failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async #request(url, options, allowTokenRefresh = false) {
    let refreshed = false;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      let result;
      try {
        result = await this.#timedRequest(url, options());
      } catch (error) {
        if (attempt === this.#maxAttempts) throw error;
        const backoff = Math.min(this.#maxDelayMs, this.#baseDelayMs * (2 ** (attempt - 1)));
        await this.#sleep(Math.floor(backoff * (0.5 + this.#random() * 0.5)));
        continue;
      }
      const { response, payload } = result;
      if (response.status === 401 && allowTokenRefresh && !refreshed && this.#credentials) {
        refreshed = true;
        await this.#refreshToken();
        attempt -= 1;
        continue;
      }
      if (response.ok) return payload;
      if (!RETRYABLE.has(response.status) || attempt === this.#maxAttempts) {
        throw new SnapcaseTransportError('http_error', `SnapCase request failed with HTTP ${response.status}`, { status: response.status });
      }
      const retryAfter = retryAfterMs(response.headers.get('retry-after'));
      const backoff = Math.min(this.#maxDelayMs, this.#baseDelayMs * (2 ** (attempt - 1)));
      if (retryAfter !== null && retryAfter > this.#maxDelayMs) {
        throw new SnapcaseTransportError(
          'retry_after_exceeds_limit',
          'SnapCase requested a retry delay beyond the configured limit',
          { retryAfterMs: retryAfter },
        );
      }
      await this.#sleep(retryAfter === null
        ? Math.floor(backoff * (0.5 + this.#random() * 0.5))
        : retryAfter);
    }
    throw new SnapcaseTransportError('retry_exhausted', 'SnapCase retry limit exhausted');
  }

  async #loginRequest() {
    const payload = await this.#request(`${this.#baseUrl}/user/login`, () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.#credentials),
    }));
    const token = typeof payload?.data?.token === 'string' ? payload.data.token.trim() : '';
    if (Number(payload?.code) !== 0 || !token) {
      throw new SnapcaseTransportError('login_contract_error', 'SnapCase login returned no token');
    }
    this.#token = token;
  }

  async #refreshToken() {
    if (!this.#refreshPromise) {
      this.#refreshPromise = this.#loginRequest().finally(() => {
        this.#refreshPromise = null;
      });
    }
    return this.#refreshPromise;
  }

  async login({ username, password }) {
    if (!String(username ?? '').trim() || !String(password ?? '')) throw new Error('SnapCase credentials are required');
    this.#credentials = { username: String(username).trim(), password: String(password) };
    await this.#loginRequest();
  }

  async getPage(path, query = {}) {
    if (!KEXIAOZHAN_READ_PATHS.includes(path)) throw new Error(`SnapCase read path is not allowlisted: ${path}`);
    if (!this.#token) throw new Error('SnapCase client is not authenticated');
    const allowedQueryFields = QUERY_FIELDS[path];
    const unknownQueryField = Object.keys(query).find((key) => !allowedQueryFields.has(key));
    if (unknownQueryField) throw new Error(`SnapCase query field is not allowlisted: ${unknownQueryField}`);
    const url = new URL(`${this.#baseUrl}${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    });
    const payload = await this.#request(url, () => ({
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'X-App-Language': this.#language,
        'X-App-TimeZone': this.#timezone,
      },
    }), true);
    return unwrapPage(payload);
  }

  async getAll(path, query = {}, { pageSize = 50, maxPages = 1_000 } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('pageSize exceeds the observed provider cap of 50');
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5_000) throw new Error('Invalid page limit');
    const rows = [];
    const seen = new Set();
    let expectedTotal = null;
    let effectivePageSize = null;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.getPage(path, { ...query, page, size: pageSize });
      if (query.machineId && result.rows.some((row) => String(row?.machineId ?? '') !== String(query.machineId))) {
        throw new SnapcaseTransportError('machine_filter_mismatch', 'SnapCase returned a row for a different machine');
      }
      expectedTotal ??= result.total;
      if (result.total !== expectedTotal) throw new SnapcaseTransportError('count_drift', 'SnapCase total changed during pagination');
      if (result.rows.length === 0 && rows.length < expectedTotal) throw new SnapcaseTransportError('premature_empty_page', 'SnapCase returned an early empty page');
      effectivePageSize ??= result.rows.length || pageSize;
      if (result.rows.length > effectivePageSize) throw new SnapcaseTransportError('page_size_drift', 'SnapCase page size changed during pagination');
      if (result.rows.length < effectivePageSize && rows.length + result.rows.length < expectedTotal) {
        throw new SnapcaseTransportError('premature_short_page', 'SnapCase returned an early short page');
      }
      for (const row of result.rows) {
        const identity = rowIdentity(path, row);
        if (seen.has(identity)) throw new SnapcaseTransportError('duplicate_page_record', 'SnapCase repeated a paged record');
        seen.add(identity);
        rows.push(row);
      }
      if (rows.length > expectedTotal) throw new SnapcaseTransportError('count_overflow', 'SnapCase returned more rows than its total');
      if (rows.length === expectedTotal) {
        return { rows, evidence: { status: 'complete', pageCount: page, observedCount: rows.length, nextCursor: null, responseTruncated: false, expectedTotal, effectivePageSize } };
      }
    }
    throw new SnapcaseTransportError('page_limit', 'SnapCase pagination exceeded the page limit');
  }
}

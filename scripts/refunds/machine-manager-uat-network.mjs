const SAFE_METHOD = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/;
const SAFE_RESOURCE_TYPES = new Set([
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'eventsource',
  'websocket',
  'manifest',
  'other',
]);
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const LONG_IDENTIFIER_SHAPE = /^[A-Za-z0-9_-]{24,}$/;

const redactPathSegment = (segment) => {
  if (!segment) return segment;
  if (UUID_SHAPE.test(segment) || LONG_IDENTIFIER_SHAPE.test(segment)) return '[id]';
  if (segment.includes('@') || /%40/i.test(segment)) return '[identity]';
  if (segment.length > 80 || !/^[A-Za-z0-9._~-]+$/.test(segment)) return '[redacted]';
  return segment;
};

export const redactUatRequestTarget = (rawUrl, appUrl) => {
  try {
    const target = new URL(rawUrl);
    const appOrigin = new URL(appUrl).origin;
    const pathname = target.pathname
      .split('/')
      .map(redactPathSegment)
      .join('/');
    const safePathname = pathname || '/';

    if (target.origin === appOrigin) return safePathname;
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost') {
      return `[loopback]${safePathname}`;
    }
    return `[external-origin]${safePathname}`;
  } catch {
    return '[invalid-url]';
  }
};

const safeMethod = (method) => {
  const normalized = String(method ?? '').toUpperCase();
  return SAFE_METHOD.test(normalized) ? normalized : 'UNKNOWN';
};

const safeResourceType = (resourceType) => {
  const normalized = String(resourceType ?? '').toLowerCase();
  return SAFE_RESOURCE_TYPES.has(normalized) ? normalized : 'other';
};

export const describeFailedUatResponse = (response, appUrl) => {
  const status = Number(response?.status?.());
  if (!Number.isInteger(status) || status < 400 || status > 599) return null;

  const request = response.request();
  return [
    `HTTP ${status}`,
    safeMethod(request.method()),
    safeResourceType(request.resourceType()),
    redactUatRequestTarget(response.url(), appUrl),
  ].join(' ');
};

export const describeFailedUatRequest = (request, appUrl) => {
  const failure = request?.failure?.();
  if (!failure) return null;

  return [
    'NETWORK_FAILED',
    safeMethod(request.method()),
    safeResourceType(request.resourceType()),
    redactUatRequestTarget(request.url(), appUrl),
  ].join(' ');
};

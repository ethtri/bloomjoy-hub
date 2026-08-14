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
const SAFE_STATIC_PATH_SEGMENTS = new Set([
  '.vite',
  '.well-known',
  '@react-refresh',
  '@vite',
  'admin',
  'appspecific',
  'assets',
  'auth',
  'bloomjoy-icon.png',
  'client',
  'com.chrome.devtools.json',
  'deps',
  'favicon.ico',
  'favicon.svg',
  'functions',
  'index.html',
  'login',
  'machines',
  'media',
  'node_modules',
  'pages',
  'public',
  'rest',
  'robots.txt',
  'rpc',
  'seo',
  'site.webmanifest',
  'src',
  'training-guides',
  'v1',
]);
const SAFE_FILE_EXTENSION = /\.(css|gif|html|ico|jpe?g|js|json|map|mjs|mp4|png|svg|ts|tsx|ttf|webmanifest|webp|woff2?)$/i;

const redactPathSegment = (segment) => {
  if (!segment) return segment;
  if (SAFE_STATIC_PATH_SEGMENTS.has(segment)) return segment;

  const extension = segment.match(SAFE_FILE_EXTENSION)?.[0]?.toLowerCase();
  return extension ? `[redacted${extension}]` : '[redacted]';
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

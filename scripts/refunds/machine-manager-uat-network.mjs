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
const SAFE_EXACT_PATHS = new Set([
  '/.well-known/appspecific/com.chrome.devtools.json',
  '/@react-refresh',
  '/@vite/client',
  '/bloomjoy-icon.png',
  '/favicon.ico',
  '/favicon.svg',
  '/index.html',
  '/robots.txt',
  '/site.webmanifest',
]);
const SAFE_FILE_EXTENSION = /\.(css|gif|html|ico|jpe?g|js|json|map|mjs|mp4|png|svg|ts|tsx|ttf|webmanifest|webp|woff2?)$/i;

const redactUnknownSegment = (segment) => {
  const extension = segment.match(SAFE_FILE_EXTENSION)?.[0]?.toLowerCase();
  return extension ? `[redacted${extension}]` : '[redacted]';
};

const redactUnknownPath = (pathname) =>
  pathname
    .split('/')
    .map((segment) => (segment ? redactUnknownSegment(segment) : segment))
    .join('/') || '/';

const redactStaticPrefixPath = (pathname) => {
  const twoPartStatic = pathname.match(/^\/(assets|media|seo|training-guides)\/([^/]+)$/);
  if (twoPartStatic) {
    return `/${twoPartStatic[1]}/${redactUnknownSegment(twoPartStatic[2])}`;
  }

  const viteDependency = pathname.match(/^\/node_modules\/\.vite\/deps\/([^/]+)$/);
  if (viteDependency) {
    return `/node_modules/.vite/deps/${redactUnknownSegment(viteDependency[1])}`;
  }

  const sourceModule = pathname.match(
    /^\/src\/(pages|components|lib|data|hooks|assets|integrations|locales|i18n)\/(?:[^/]+\/)*([^/]+)$/
  );
  if (sourceModule) {
    return `/src/${sourceModule[1]}/${redactUnknownSegment(sourceModule[2])}`;
  }

  const syntheticApi = pathname.match(
    /^\/(auth|functions|rest)\/v1\/(?:rpc\/)?([^/]+)(?:\/([^/]+))?$/
  );
  if (syntheticApi) {
    const rpcPrefix = pathname.includes('/v1/rpc/') ? '/rpc' : '';
    const redactedTail = [syntheticApi[2], syntheticApi[3]]
      .filter(Boolean)
      .map(redactUnknownSegment)
      .join('/');
    return `/${syntheticApi[1]}/v1${rpcPrefix}/${redactedTail}`;
  }

  return null;
};

const redactPathname = (pathname) => {
  if (SAFE_EXACT_PATHS.has(pathname)) return pathname;
  return redactStaticPrefixPath(pathname) ?? redactUnknownPath(pathname);
};

export const redactUatRequestTarget = (rawUrl, appUrl) => {
  try {
    const target = new URL(rawUrl);
    const appOrigin = new URL(appUrl).origin;
    const safePathname = redactPathname(target.pathname);

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

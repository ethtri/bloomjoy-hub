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
const SAFE_NETWORK_FAILURE_CODES = new Set([
  'ERR_ABORTED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_FAILED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_TIMED_OUT',
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
const pageNetworkFailures = new WeakMap();
const SYNTHETIC_RESOURCE_HEADER = 'x-bloomjoy-uat-synthetic-resource';

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

const safeNetworkFailureCode = (failure) => {
  const match = String(failure?.errorText ?? '').match(/^net::(ERR_[A-Z_]+)$/);
  return match && SAFE_NETWORK_FAILURE_CODES.has(match[1]) ? match[1] : 'UNKNOWN';
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
    safeNetworkFailureCode(failure),
    safeMethod(request.method()),
    safeResourceType(request.resourceType()),
    redactUatRequestTarget(request.url(), appUrl),
  ].join(' ');
};

const safelyExpected = (predicate, value) => {
  if (typeof predicate !== 'function') return false;
  try {
    return predicate(value) === true;
  } catch {
    return false;
  }
};

export const isFixtureOwnedUatRequestFailure = (
  request,
  {
    ownedRequests,
    failureCode,
    method,
    resourceType,
    validateRequest,
  }
) => (
  ownedRequests instanceof WeakSet &&
  ownedRequests.has(request) &&
  request?.failure?.()?.errorText === `net::${failureCode}` &&
  request?.method?.() === method &&
  request?.resourceType?.() === resourceType &&
  safelyExpected(validateRequest, request)
);

const installSyntheticExternalResources = async (context) => {
  await context.route('https://fonts.googleapis.com/**', async (route) => {
    const request = route.request();
    let isExactFontStylesheet = false;
    try {
      const target = new URL(request.url());
      isExactFontStylesheet =
        target.hostname === 'fonts.googleapis.com' &&
        target.pathname === '/css2' &&
        request.method() === 'GET' &&
        request.resourceType() === 'stylesheet';
    } catch {
      isExactFontStylesheet = false;
    }

    if (!isExactFontStylesheet) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/css',
      headers: { [SYNTHETIC_RESOURCE_HEADER]: 'google-font-css' },
      body: '',
    });
  });
};

const bindTargetValue = (target, property) => {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
};

export const getUatPageNetworkFailures = (page) => [
  ...(pageNetworkFailures.get(page) ?? []),
];

export const getUatPageFailures = (page, consoleOrPageErrors = []) => [
  ...getUatPageNetworkFailures(page),
  ...consoleOrPageErrors,
];

export const closeUatSuiteResources = async ({ context, browser }) => {
  const teardownFailures = [];
  try {
    await context.close();
  } catch {
    teardownFailures.push('CONTEXT_CLOSE_FAILED');
  }
  try {
    await browser.close();
  } catch {
    teardownFailures.push('BROWSER_CLOSE_FAILED');
  }
  return teardownFailures;
};

export const evaluateUatSuiteFailures = ({
  networkFailures,
  consoleErrors,
  teardownFailures,
  pageFailures,
}) => {
  if (![networkFailures, consoleErrors, teardownFailures, pageFailures].every(Array.isArray)) {
    return { pass: false, detail: 'UAT_FAILURE_STATE_INVALID' };
  }
  return {
    pass:
      networkFailures.length === 0 &&
      consoleErrors.length === 0 &&
      teardownFailures.length === 0,
    detail: [...teardownFailures, ...pageFailures].slice(0, 5).join(' | '),
  };
};

export const createTrackedUatBrowser = (
  browser,
  {
    appUrl,
    failures,
    isExpectedResponse,
    isExpectedRequestFailure,
    isExpectedClosingRequestFailure,
  }
) => {
  if (!browser || typeof browser.newContext !== 'function') {
    throw new TypeError('A Playwright browser is required.');
  }
  if (!Array.isArray(failures)) {
    throw new TypeError('A suite failure array is required.');
  }

  const trackedPages = new WeakSet();

  const attachPage = (page) => {
    if (!page || trackedPages.has(page)) return page;
    trackedPages.add(page);
    if (!pageNetworkFailures.has(page)) pageNetworkFailures.set(page, []);
    return page;
  };

  const pageForRequest = (request) => {
    try {
      return request.frame().page();
    } catch {
      return null;
    }
  };

  const record = (failure, request) => {
    if (!failure) return;
    failures.push(failure);
    const page = pageForRequest(request);
    if (!page) return;
    if (!pageNetworkFailures.has(page)) pageNetworkFailures.set(page, []);
    pageNetworkFailures.get(page).push(failure);
  };

  const wrapContext = async (context) => {
    let isClosing = false;
    await installSyntheticExternalResources(context);
    context.on('response', (response) => {
      if (safelyExpected(isExpectedResponse, response)) return;
      record(describeFailedUatResponse(response, appUrl), response.request());
    });
    context.on('requestfailed', (request) => {
      if (safelyExpected(isExpectedRequestFailure, request)) return;
      if (isClosing && safelyExpected(isExpectedClosingRequestFailure, request)) return;
      record(describeFailedUatRequest(request, appUrl), request);
    });
    context.on('page', attachPage);
    return new Proxy(context, {
      get(target, property) {
        if (property === 'newPage') {
          return async (...args) => attachPage(await target.newPage(...args));
        }
        if (property === 'close') {
          return async (...args) => {
            isClosing = true;
            return target.close(...args);
          };
        }
        return bindTargetValue(target, property);
      },
    });
  };

  return new Proxy(browser, {
    get(target, property) {
      if (property === 'newContext') {
        return async (...args) => wrapContext(await target.newContext(...args));
      }
      return bindTargetValue(target, property);
    },
  });
};

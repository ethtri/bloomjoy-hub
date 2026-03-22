export type AppSurface = 'marketing' | 'app';
type HostSurface = AppSurface | 'auth' | 'local';

export const CANONICAL_HOSTS = {
  apex: 'bloomjoyusa.com',
  marketing: 'www.bloomjoyusa.com',
  app: 'app.bloomjoyusa.com',
  auth: 'auth.bloomjoyusa.com',
} as const;

type HostLocation = {
  hostname: string;
  origin: string;
};

const appPathMatchers = [
  /^\/login$/,
  /^\/login\/operator$/,
  /^\/reset-password$/,
  /^\/portal(?:\/.*)?$/,
  /^\/admin(?:\/.*)?$/,
];

export const isAppPath = (pathname: string) =>
  appPathMatchers.some((matcher) => matcher.test(pathname));

export const getRouteSurface = (pathname: string): AppSurface =>
  isAppPath(pathname) ? 'app' : 'marketing';

export const resolveHostSurface = (hostname: string): HostSurface => {
  const normalizedHost = hostname.toLowerCase();

  if (normalizedHost === CANONICAL_HOSTS.auth) {
    return 'auth';
  }

  if (normalizedHost === CANONICAL_HOSTS.app) {
    return 'app';
  }

  if (normalizedHost === CANONICAL_HOSTS.marketing || normalizedHost === CANONICAL_HOSTS.apex) {
    return 'marketing';
  }

  if (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.vercel.app')
  ) {
    return 'local';
  }

  return 'local';
};

export const getCanonicalOriginForSurface = (
  surface: AppSurface,
  locationLike?: HostLocation
) => {
  if (!locationLike) {
    return `https://${surface === 'app' ? CANONICAL_HOSTS.app : CANONICAL_HOSTS.marketing}`;
  }

  const hostSurface = resolveHostSurface(locationLike.hostname);
  if (hostSurface === 'local') {
    return locationLike.origin;
  }

  return `https://${surface === 'app' ? CANONICAL_HOSTS.app : CANONICAL_HOSTS.marketing}`;
};

export const getCanonicalUrlForSurface = (
  surface: AppSurface,
  pathname: string,
  search = '',
  hash = '',
  locationLike?: HostLocation
) => `${getCanonicalOriginForSurface(surface, locationLike)}${pathname}${search}${hash}`;

export const getHostRedirectTarget = (
  locationLike: HostLocation,
  pathname: string,
  search = '',
  hash = ''
) => {
  const hostSurface = resolveHostSurface(locationLike.hostname);

  if (hostSurface === 'local' || hostSurface === 'auth') {
    return null;
  }

  const targetSurface = getRouteSurface(pathname);
  const targetUrl = getCanonicalUrlForSurface(
    targetSurface,
    pathname,
    search,
    hash,
    locationLike
  );
  const currentUrl = `${locationLike.origin}${pathname}${search}${hash}`;

  if (locationLike.hostname === CANONICAL_HOSTS.apex) {
    return targetUrl;
  }

  return currentUrl === targetUrl ? null : targetUrl;
};

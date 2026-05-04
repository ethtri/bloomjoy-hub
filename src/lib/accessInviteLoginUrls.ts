export type AccessInviteLoginIntent = 'corporate_partner' | 'technician';

export type AccessInviteLocationLike = {
  origin: string;
  hostname: string;
  protocol: string;
};

export type AccessInvitePreflight =
  | { ok: true; targetEmail: string; loginUrl: string }
  | { ok: false; message: string };

const productionAppOrigin = 'https://app.bloomjoyusa.com';
const loginPathname = '/login';
const allowedLocalHosts = new Set(['localhost', '127.0.0.1']);
const allowedLocalProtocols = new Set(['http:', 'https:']);
const vercelPreviewHostnameSuffix = '.vercel.app';

const hasInviteEmailShape = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const getBrowserLocation = (): AccessInviteLocationLike | null => {
  if (typeof window === 'undefined') return null;
  return window.location;
};

const normalizeLocationOrigin = (locationLike: AccessInviteLocationLike | null) => {
  if (!locationLike?.origin) return null;

  try {
    const originUrl = new URL(locationLike.origin);
    const hostname = locationLike.hostname.trim().toLowerCase();
    const protocol = locationLike.protocol.trim().toLowerCase();

    if (
      originUrl.username ||
      originUrl.password ||
      originUrl.pathname !== '/' ||
      originUrl.search ||
      originUrl.hash ||
      originUrl.hostname.toLowerCase() !== hostname ||
      originUrl.protocol.toLowerCase() !== protocol
    ) {
      return null;
    }

    return {
      origin: originUrl.origin,
      hostname,
      protocol,
    };
  } catch {
    return null;
  }
};

export const resolveAccessInviteLoginOrigin = (
  locationLike: AccessInviteLocationLike | null = getBrowserLocation()
):
  | { ok: true; origin: string; originType: 'production' | 'local' | 'preview' }
  | { ok: false; message: string } => {
  if (!locationLike) {
    return { ok: true, origin: productionAppOrigin, originType: 'production' };
  }

  const currentOrigin = normalizeLocationOrigin(locationLike);
  if (!currentOrigin) {
    return {
      ok: false,
      message: 'Unable to create a safe Bloomjoy invite login URL from this browser origin.',
    };
  }

  if (currentOrigin.origin === productionAppOrigin) {
    return { ok: true, origin: productionAppOrigin, originType: 'production' };
  }

  if (
    allowedLocalHosts.has(currentOrigin.hostname) &&
    allowedLocalProtocols.has(currentOrigin.protocol)
  ) {
    return { ok: true, origin: currentOrigin.origin, originType: 'local' };
  }

  if (
    currentOrigin.protocol === 'https:' &&
    currentOrigin.hostname.endsWith(vercelPreviewHostnameSuffix)
  ) {
    return { ok: true, origin: currentOrigin.origin, originType: 'preview' };
  }

  return {
    ok: false,
    message:
      'Invite login links can only use the Bloomjoy app, localhost/127.0.0.1, or the current Vercel preview origin.',
  };
};

export const getAccessInviteLoginUrl = (
  inviteType: AccessInviteLoginIntent,
  email: string,
  locationLike: AccessInviteLocationLike | null = getBrowserLocation()
) => {
  const originResult = resolveAccessInviteLoginOrigin(locationLike);
  if (!originResult.ok) return originResult;

  const params = new URLSearchParams({
    intent: inviteType,
    email: normalizeEmail(email),
  });

  return {
    ok: true as const,
    loginUrl: `${originResult.origin}${loginPathname}?${params.toString()}`,
  };
};

export const validateAccessInvitePreflight = (
  inviteType: AccessInviteLoginIntent,
  email: string,
  locationLike: AccessInviteLocationLike | null = getBrowserLocation()
): AccessInvitePreflight => {
  const targetEmail = normalizeEmail(email);
  if (!hasInviteEmailShape(targetEmail)) {
    return { ok: false, message: 'Enter a valid invite email before saving access.' };
  }

  const loginUrlResult = getAccessInviteLoginUrl(inviteType, targetEmail, locationLike);
  if (!loginUrlResult.ok) {
    return { ok: false, message: loginUrlResult.message };
  }

  try {
    const parsedUrl = new URL(loginUrlResult.loginUrl);
    const originResult = resolveAccessInviteLoginOrigin(locationLike);
    const hasAllowedOrigin = originResult.ok && parsedUrl.origin === originResult.origin;
    const hasExpectedLoginRoute = parsedUrl.pathname === loginPathname;
    const hasExpectedInviteIntent = parsedUrl.searchParams.get('intent') === inviteType;
    const hasExpectedEmail = parsedUrl.searchParams.get('email') === targetEmail;

    if (
      !hasAllowedOrigin ||
      !hasExpectedLoginRoute ||
      !hasExpectedInviteIntent ||
      !hasExpectedEmail
    ) {
      return {
        ok: false,
        message: 'Unable to create a valid Bloomjoy invite login URL before saving access.',
      };
    }

    return { ok: true, targetEmail, loginUrl: loginUrlResult.loginUrl };
  } catch {
    return {
      ok: false,
      message: 'Unable to create a valid Bloomjoy invite login URL before saving access.',
    };
  }
};

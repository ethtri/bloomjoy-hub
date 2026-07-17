import { trackEvent } from '@/lib/analytics';

const marks = {
  sessionAccepted: 'bloomjoy.portal.session_accepted',
  shellVisible: 'bloomjoy.portal.shell_visible',
  accessReady: 'bloomjoy.portal.access_ready',
  dashboardVisible: 'bloomjoy.portal.dashboard_visible',
  dashboardDataReady: 'bloomjoy.portal.dashboard_data_ready',
} as const;

const measures = {
  sessionToShell: 'bloomjoy.portal.session_to_shell',
  sessionToAccess: 'bloomjoy.portal.session_to_access',
  sessionToDashboard: 'bloomjoy.portal.session_to_dashboard',
  sessionToDashboardData: 'bloomjoy.portal.session_to_dashboard_data',
} as const;

type PortalRouteCategory = 'portal-dashboard' | 'portal' | 'admin' | 'other';

let activeRouteCategory: PortalRouteCategory = 'other';
let timingEventSent = false;
let shellIsVisible = false;
let shellVisibleAt: number | null = null;

const hasPerformanceApi = () =>
  typeof performance !== 'undefined' &&
  typeof performance.mark === 'function' &&
  typeof performance.getEntriesByName === 'function';

const hasMark = (name: string) =>
  hasPerformanceApi() && performance.getEntriesByName(name, 'mark').length > 0;

const markOnce = (name: string) => {
  if (!hasPerformanceApi() || hasMark(name)) {
    return;
  }

  performance.mark(name);
};

const getMarkStartTime = (name: string) =>
  hasPerformanceApi()
    ? performance.getEntriesByName(name, 'mark').at(-1)?.startTime
    : undefined;

const getElapsedFromSession = (markName: string) => {
  const sessionStart = getMarkStartTime(marks.sessionAccepted);
  const phaseStart = getMarkStartTime(markName);

  if (sessionStart === undefined || phaseStart === undefined) {
    return undefined;
  }

  return Math.max(0, Math.round(phaseStart - sessionStart));
};

const measureOnce = (name: string, endMark: string) => {
  if (
    !hasPerformanceApi() ||
    performance.getEntriesByName(name, 'measure').length > 0 ||
    !hasMark(marks.sessionAccepted) ||
    !hasMark(endMark)
  ) {
    return;
  }

  const sessionStart = getMarkStartTime(marks.sessionAccepted);
  const phaseStart = getMarkStartTime(endMark);

  if (sessionStart === undefined || phaseStart === undefined) {
    return;
  }

  if (phaseStart < sessionStart) {
    performance.measure(name, { start: sessionStart, duration: 0 });
    return;
  }

  performance.measure(name, marks.sessionAccepted, endMark);
};

export const getPortalRouteCategory = (): PortalRouteCategory => {
  if (typeof window === 'undefined') {
    return 'other';
  }

  const currentPath = window.location.pathname;
  const nextPath =
    currentPath === '/login'
      ? new URLSearchParams(window.location.search).get('next') ?? ''
      : currentPath;

  const routePath = nextPath.split(/[?#]/, 1)[0];

  if (routePath.startsWith('/admin')) {
    return 'admin';
  }

  if (routePath === '/portal') {
    return 'portal-dashboard';
  }

  if (routePath.startsWith('/portal/')) {
    return 'portal';
  }

  return 'other';
};

export const beginPortalBootstrap = (routeCategory = getPortalRouteCategory()): void => {
  if (!hasPerformanceApi()) {
    return;
  }

  const visibleShellStart = shellIsVisible ? shellVisibleAt : null;
  Object.values(marks).forEach((name) => performance.clearMarks(name));
  Object.values(measures).forEach((name) => performance.clearMeasures(name));
  activeRouteCategory = routeCategory;
  timingEventSent = false;
  performance.mark(marks.sessionAccepted);

  if (visibleShellStart !== null) {
    performance.mark(marks.shellVisible, { startTime: visibleShellStart });
    measureOnce(measures.sessionToShell, marks.shellVisible);
  }
};

export const markPortalShellVisible = (): void => {
  shellIsVisible = true;
  shellVisibleAt ??= hasPerformanceApi() ? performance.now() : null;
  markOnce(marks.shellVisible);
  measureOnce(measures.sessionToShell, marks.shellVisible);
};

export const markPortalShellHidden = (): void => {
  shellIsVisible = false;
  shellVisibleAt = null;
};

export const markPortalAccessReady = (): void => {
  markOnce(marks.accessReady);
  measureOnce(measures.sessionToAccess, marks.accessReady);
};

export const markPortalDashboardVisible = (): void => {
  markOnce(marks.dashboardVisible);
  measureOnce(measures.sessionToDashboard, marks.dashboardVisible);
};

export const markPortalDashboardDataReady = (): void => {
  markOnce(marks.dashboardDataReady);
  measureOnce(measures.sessionToDashboardData, marks.dashboardDataReady);

  if (timingEventSent || !hasMark(marks.sessionAccepted)) {
    return;
  }

  timingEventSent = true;
  trackEvent('portal_bootstrap_timing', {
    route_category: activeRouteCategory,
    session_to_shell_ms: getElapsedFromSession(marks.shellVisible),
    session_to_access_ms: getElapsedFromSession(marks.accessReady),
    session_to_dashboard_ms: getElapsedFromSession(marks.dashboardVisible),
    session_to_dashboard_data_ms: getElapsedFromSession(marks.dashboardDataReady),
    access_ready: hasMark(marks.accessReady),
  });
};

export const portalPerformanceNames = { marks, measures } as const;

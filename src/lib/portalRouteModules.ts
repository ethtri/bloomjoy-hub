type PortalDashboardModule = typeof import('@/pages/portal/Dashboard');

let portalDashboardModulePromise: Promise<PortalDashboardModule> | null = null;

export const loadPortalDashboard = (): Promise<PortalDashboardModule> => {
  portalDashboardModulePromise ??= import('@/pages/portal/Dashboard').catch((error: unknown) => {
    portalDashboardModulePromise = null;
    throw error;
  });
  return portalDashboardModulePromise;
};

export const preloadPortalDashboard = (): void => {
  void loadPortalDashboard().catch(() => undefined);
};

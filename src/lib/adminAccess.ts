export const hasAdminSurface = (allowedSurfaces: string[], surface: string) =>
  allowedSurfaces.includes('*') || allowedSurfaces.includes(surface);

export const hasAdminCapability = (capabilities: string[], capability: string) =>
  capabilities.includes('*') || capabilities.includes(capability);

export const getAdminSurfaceForPath = (pathname: string): string => {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/admin/orders' || pathname.startsWith('/admin/orders/')) return 'orders';
  if (pathname === '/admin/support' || pathname.startsWith('/admin/support/')) return 'support';
  if (
    pathname === '/admin/access' ||
    pathname.startsWith('/admin/access/') ||
    pathname === '/admin/accounts' ||
    pathname === '/admin/audit'
  ) {
    return 'access';
  }
  if (pathname === '/admin/partner-records' || pathname.startsWith('/admin/partner-records/')) {
    return 'partner_records';
  }
  if (pathname === '/admin/machines' || pathname.startsWith('/admin/machines/')) return 'machines';
  if (pathname === '/admin/partnerships' || pathname.startsWith('/admin/partnerships/')) {
    return 'partnerships';
  }
  if (pathname === '/admin/reporting' || pathname.startsWith('/admin/reporting/')) {
    return 'reporting';
  }
  return 'admin';
};

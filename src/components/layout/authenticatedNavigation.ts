import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Building2,
  Clock3,
  Handshake,
  HeadphonesIcon,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MonitorCog,
  ReceiptText,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react';
import {
  canAccessPortalLevel,
  getPortalDestinationByPath,
  portalDestinations,
  type PortalAccessLevel,
} from '@/components/portal/portalNavigation';
import type { AdminAccessContext } from '@/contexts/auth-context';
import type { TranslationKey } from '@/lib/i18n';
import type { PortalAccessTier } from '@/lib/membership';

export type AuthenticatedNavSectionId =
  | 'home'
  | 'work'
  | 'learnSupport'
  | 'operations'
  | 'accessSetup'
  | 'settings';

export type AuthenticatedNavSectionDefinition = {
  id: AuthenticatedNavSectionId;
  labelKey: TranslationKey;
};

export type AuthenticatedNavItem = {
  href: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  section: AuthenticatedNavSectionId;
  end?: boolean;
  match?: (pathname: string) => boolean;
};

type AdminSurface = 'access' | 'payouts' | 'refunds';

export type AdminDestination = {
  href: string;
  labelKey: TranslationKey;
  shortLabelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  section: AuthenticatedNavSectionId;
  requiresSuperAdmin?: boolean;
  surface?: AdminSurface;
};

export type AppContext = {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
};

export type AuthenticatedNavBuildInput = {
  adminAccess: AdminAccessContext;
  canManageTechnicians: boolean;
  capabilities: string[];
  hasReportingAccess: boolean;
  isSuperAdmin: boolean;
  portalAccessTier: PortalAccessTier;
  canUsePortalTeam: boolean;
  showAccountLink: boolean;
};

export const authenticatedNavSections: AuthenticatedNavSectionDefinition[] = [
  { id: 'home', labelKey: 'app.nav.home' },
  { id: 'work', labelKey: 'app.nav.work' },
  { id: 'learnSupport', labelKey: 'app.nav.learnSupport' },
  { id: 'operations', labelKey: 'app.nav.operations' },
  { id: 'accessSetup', labelKey: 'app.nav.accessSetup' },
  { id: 'settings', labelKey: 'app.nav.settings' },
];

export const adminDestinations: AdminDestination[] = [
  {
    href: '/admin',
    labelKey: 'app.nav.adminOverview',
    shortLabelKey: 'app.nav.adminOverview',
    descriptionKey: 'admin.homeDescription',
    icon: LayoutDashboard,
    section: 'home',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/orders',
    labelKey: 'app.nav.adminOrders',
    shortLabelKey: 'app.nav.adminOrders',
    descriptionKey: 'admin.ordersDescription',
    icon: ShoppingBag,
    section: 'operations',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/support',
    labelKey: 'app.nav.supportQueue',
    shortLabelKey: 'app.nav.supportQueue',
    descriptionKey: 'admin.supportDescription',
    icon: LifeBuoy,
    section: 'operations',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/access',
    labelKey: 'app.nav.peoplePermissions',
    shortLabelKey: 'app.nav.peoplePermissions',
    descriptionKey: 'admin.accessDescription',
    icon: Users,
    section: 'accessSetup',
    surface: 'access',
  },
  {
    href: '/admin/partner-records',
    labelKey: 'admin.partnerRecordsShort',
    shortLabelKey: 'admin.partnerRecordsShort',
    descriptionKey: 'admin.partnerRecordsDescription',
    icon: Building2,
    section: 'accessSetup',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/machines',
    labelKey: 'admin.machines',
    shortLabelKey: 'admin.machines',
    descriptionKey: 'admin.machinesDescription',
    icon: MonitorCog,
    section: 'accessSetup',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/partnerships',
    labelKey: 'admin.partnerships',
    shortLabelKey: 'admin.partnerships',
    descriptionKey: 'admin.partnershipsDescription',
    icon: Handshake,
    section: 'accessSetup',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/reporting',
    labelKey: 'app.nav.adminReporting',
    shortLabelKey: 'app.nav.adminReporting',
    descriptionKey: 'admin.reportingDescription',
    icon: BarChart3,
    section: 'accessSetup',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/payouts',
    labelKey: 'admin.payouts',
    shortLabelKey: 'admin.payouts',
    descriptionKey: 'admin.payoutsDescription',
    icon: ReceiptText,
    section: 'operations',
    surface: 'payouts',
  },
];

const portalSectionByHref: Record<string, AuthenticatedNavSectionId> = {
  '/portal': 'home',
  '/portal/time': 'work',
  '/portal/orders': 'work',
  '/portal/reports': 'work',
  '/portal/refunds': 'operations',
  '/portal/training': 'learnSupport',
  '/portal/onboarding': 'learnSupport',
  '/portal/support': 'learnSupport',
  '/portal/team': 'accessSetup',
  '/portal/account': 'settings',
};

const portalLabelOverrideByHref: Partial<Record<string, TranslationKey>> = {
  '/portal/orders': 'app.nav.myOrders',
  '/portal/refunds': 'app.nav.refundCases',
};

const portalIconOverrideByHref: Partial<Record<string, LucideIcon>> = {
  '/portal/orders': ShoppingBag,
  '/portal/time': Clock3,
  '/portal/onboarding': ListChecks,
  '/portal/support': HeadphonesIcon,
  '/portal/account': Settings,
};

const getAllowedAdminSurfaces = (adminAccess: AdminAccessContext) =>
  new Set(adminAccess.allowedSurfaces);

export const getVisibleAdminDestinations = ({
  adminAccess,
  isSuperAdmin,
}: {
  adminAccess: AdminAccessContext;
  isSuperAdmin: boolean;
}) => {
  const allowedAdminSurfaces = getAllowedAdminSurfaces(adminAccess);

  return adminDestinations
    .filter((item) => isSuperAdmin || !item.requiresSuperAdmin)
    .filter((item) => {
      if (!item.surface || isSuperAdmin || allowedAdminSurfaces.has('*')) {
        return true;
      }

      return allowedAdminSurfaces.has(item.surface);
    });
};

const canAccessPortalDestination = (
  destinationAccess: PortalAccessLevel,
  input: AuthenticatedNavBuildInput
) => {
  if (destinationAccess === 'team') {
    return input.canUsePortalTeam;
  }

  const allowedAdminSurfaces = getAllowedAdminSurfaces(input.adminAccess);
  const hasRefundOperationsAccess =
    input.isSuperAdmin || allowedAdminSurfaces.has('*') || allowedAdminSurfaces.has('refunds');

  return canAccessPortalLevel(
    input.portalAccessTier,
    destinationAccess,
    input.hasReportingAccess,
    input.capabilities,
    hasRefundOperationsAccess,
    input.canManageTechnicians,
    input.adminAccess.isScopedAdmin
  );
};

export const buildAuthenticatedNavSections = (input: AuthenticatedNavBuildInput) => {
  const portalItems: AuthenticatedNavItem[] = portalDestinations
    .filter((destination) => destination.href !== '/portal/account' || input.showAccountLink)
    .filter((destination) => canAccessPortalDestination(destination.access, input))
    .map((destination) => ({
      href: destination.href,
      labelKey: portalLabelOverrideByHref[destination.href] ?? destination.labelKey,
      descriptionKey: destination.descriptionKey,
      icon: portalIconOverrideByHref[destination.href] ?? destination.icon,
      section: portalSectionByHref[destination.href] ?? 'work',
      end: destination.end,
    }));

  const adminItems: AuthenticatedNavItem[] = getVisibleAdminDestinations(input).map((destination) => ({
    href: destination.href,
    labelKey: destination.labelKey,
    descriptionKey: destination.descriptionKey,
    icon: destination.icon,
    section: destination.section,
  }));

  const allItems = [...portalItems, ...adminItems];

  return authenticatedNavSections
    .map((section) => ({
      ...section,
      items: allItems.filter((item) => item.section === section.id),
    }))
    .filter((section) => section.items.length > 0);
};

export const isAuthenticatedNavItemActive = (pathname: string, item: AuthenticatedNavItem) => {
  if (item.href === '/portal') {
    return pathname === '/portal';
  }

  if (item.href === '/portal/refunds') {
    return (
      pathname === '/portal/refunds' ||
      pathname.startsWith('/portal/refunds/') ||
      pathname === '/admin/refunds' ||
      pathname.startsWith('/admin/refunds/')
    );
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
};

export const getAdminDestinationByPath = (pathname: string) =>
  adminDestinations.find((destination) => pathname === destination.href) ??
  adminDestinations
    .filter((destination) => destination.href !== '/admin')
    .find((destination) => pathname.startsWith(`${destination.href}/`)) ??
  adminDestinations[0];

export const getAppContext = (pathname: string): AppContext => {
  if (pathname.startsWith('/portal')) {
    const currentDestination = getPortalDestinationByPath(pathname);

    return {
      titleKey: portalLabelOverrideByHref[currentDestination.href] ?? currentDestination.labelKey,
      descriptionKey: currentDestination.descriptionKey,
    };
  }

  if (pathname.startsWith('/admin')) {
    const currentDestination = getAdminDestinationByPath(pathname);

    return {
      titleKey: currentDestination.labelKey,
      descriptionKey: currentDestination.descriptionKey,
    };
  }

  if (pathname === '/reset-password') {
    return {
      titleKey: 'app.resetPassword',
      descriptionKey: 'app.resetPasswordDescription',
    };
  }

  return {
    titleKey: 'app.operatorLogin',
    descriptionKey: 'app.operatorLoginDescription',
  };
};

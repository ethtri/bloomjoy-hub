import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
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
  | 'customers'
  | 'reporting'
  | 'administration'
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
  kind: 'core' | 'portal' | 'admin';
  end?: boolean;
  match?: (pathname: string) => boolean;
};

export type AdminSurface =
  | 'overview'
  | 'orders'
  | 'support'
  | 'accounts'
  | 'machines'
  | 'access'
  | 'audit'
  | 'partnerships'
  | 'payouts'
  | 'refunds';

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

export type CoreDestination = {
  href: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  section: AuthenticatedNavSectionId;
  access: PortalAccessLevel;
  end?: boolean;
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
  canUsePortalTimekeeping: boolean;
  currentPathname?: string;
  showAccountLink: boolean;
};

export const authenticatedNavSections: AuthenticatedNavSectionDefinition[] = [
  { id: 'home', labelKey: 'app.nav.home' },
  { id: 'work', labelKey: 'app.nav.work' },
  { id: 'learnSupport', labelKey: 'app.nav.learnSupport' },
  { id: 'operations', labelKey: 'app.nav.operations' },
  { id: 'customers', labelKey: 'app.nav.customers' },
  { id: 'reporting', labelKey: 'app.nav.reportingPartners' },
  { id: 'administration', labelKey: 'app.nav.administration' },
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
    surface: 'overview',
  },
  {
    href: '/admin/orders',
    labelKey: 'app.nav.adminOrders',
    shortLabelKey: 'app.nav.adminOrders',
    descriptionKey: 'admin.ordersDescription',
    icon: ShoppingBag,
    section: 'operations',
    surface: 'orders',
  },
  {
    href: '/admin/support',
    labelKey: 'app.nav.supportQueue',
    shortLabelKey: 'app.nav.supportQueue',
    descriptionKey: 'admin.supportDescription',
    icon: LifeBuoy,
    section: 'operations',
    surface: 'support',
  },
  {
    href: '/admin/accounts',
    labelKey: 'admin.accounts',
    shortLabelKey: 'admin.accounts',
    descriptionKey: 'admin.accountsDescription',
    icon: Building2,
    section: 'customers',
    surface: 'accounts',
  },
  {
    href: '/admin/machines',
    labelKey: 'admin.machines',
    shortLabelKey: 'admin.machines',
    descriptionKey: 'admin.machinesDescription',
    icon: MonitorCog,
    section: 'customers',
    surface: 'machines',
  },
  {
    href: '/admin/access',
    labelKey: 'app.nav.peoplePermissions',
    shortLabelKey: 'app.nav.peoplePermissions',
    descriptionKey: 'admin.accessDescription',
    icon: Users,
    section: 'administration',
    surface: 'access',
  },
  {
    href: '/admin/partner-records',
    labelKey: 'admin.partnerRecordsShort',
    shortLabelKey: 'admin.partnerRecordsShort',
    descriptionKey: 'admin.partnerRecordsDescription',
    icon: Building2,
    section: 'reporting',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/partnerships',
    labelKey: 'admin.partnerships',
    shortLabelKey: 'admin.partnerships',
    descriptionKey: 'admin.partnershipsDescription',
    icon: Handshake,
    section: 'reporting',
    surface: 'partnerships',
  },
  {
    href: '/admin/reporting',
    labelKey: 'app.nav.adminReporting',
    shortLabelKey: 'app.nav.adminReporting',
    descriptionKey: 'admin.reportingDescription',
    icon: BarChart3,
    section: 'reporting',
    requiresSuperAdmin: true,
  },
  {
    href: '/admin/audit',
    labelKey: 'admin.audit',
    shortLabelKey: 'admin.audit',
    descriptionKey: 'admin.auditDescription',
    icon: ListChecks,
    section: 'administration',
    surface: 'audit',
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

const coreDestinations: CoreDestination[] = [
  {
    href: '/refunds',
    labelKey: 'portal.nav.refunds',
    descriptionKey: 'portal.nav.refundsDescription',
    icon: ReceiptText,
    section: 'work',
    access: 'refunds',
    end: true,
  },
];

const coreDestinationHrefs = new Set(coreDestinations.map((destination) => destination.href));

const portalSectionByHref: Record<string, AuthenticatedNavSectionId> = {
  '/portal': 'home',
  '/portal/time': 'work',
  '/portal/time-review': 'work',
  '/portal/orders': 'work',
  '/portal/reports': 'work',
  '/portal/training': 'learnSupport',
  '/portal/onboarding': 'learnSupport',
  '/portal/support': 'learnSupport',
  '/portal/team': 'accessSetup',
  '/portal/account': 'settings',
};

const portalLabelOverrideByHref: Partial<Record<string, TranslationKey>> = {
  '/portal/orders': 'app.nav.myOrders',
};

const portalIconOverrideByHref: Partial<Record<string, LucideIcon>> = {
  '/portal/orders': ShoppingBag,
  '/portal/time': Clock3,
  '/portal/time-review': ClipboardCheck,
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

  if (destinationAccess === 'timekeeping') {
    return input.canUsePortalTimekeeping;
  }

  if (destinationAccess === 'time-review') {
    const allowedAdminSurfaces = getAllowedAdminSurfaces(input.adminAccess);
    return (
      input.isSuperAdmin ||
      allowedAdminSurfaces.has('*') ||
      allowedAdminSurfaces.has('payouts') ||
      input.capabilities.includes('timekeeping.review')
    );
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
    input.adminAccess.isScopedAdmin,
    input.canUsePortalTimekeeping
  );
};

export const buildAuthenticatedNavSections = (input: AuthenticatedNavBuildInput) => {
  const isAdminContext = input.currentPathname?.startsWith('/admin') ?? false;
  const adminItems: AuthenticatedNavItem[] = getVisibleAdminDestinations(input).map((destination) => ({
    href: destination.href,
    labelKey: destination.labelKey,
    descriptionKey: destination.descriptionKey,
    icon: destination.icon,
    section: destination.section,
    kind: 'admin',
  }));
  const adminHrefs = new Set(adminItems.map((item) => item.href));
  const hasAdminItems = adminItems.length > 0;

  const coreItems: AuthenticatedNavItem[] = coreDestinations
    .filter((destination) => canAccessPortalDestination(destination.access, input))
    .map((destination) => ({
      href: destination.href,
      labelKey: destination.labelKey,
      descriptionKey: destination.descriptionKey,
      icon: destination.icon,
      section: destination.section,
      kind: 'core',
      end: destination.end,
    }));

  const portalItems: AuthenticatedNavItem[] = portalDestinations
        .filter(() => !isAdminContext)
        .filter((destination) => !coreDestinationHrefs.has(destination.href))
        .filter((destination) => destination.href !== '/portal/account' || input.showAccountLink)
        .filter((destination) => !adminHrefs.has(destination.href))
        .filter((destination) => canAccessPortalDestination(destination.access, input))
        .map((destination) => ({
          href: destination.href,
          labelKey:
            destination.href === '/portal' && hasAdminItems
              ? 'app.nav.portalDashboard'
              : portalLabelOverrideByHref[destination.href] ?? destination.labelKey,
          descriptionKey: destination.descriptionKey,
          icon: portalIconOverrideByHref[destination.href] ?? destination.icon,
          section: portalSectionByHref[destination.href] ?? 'work',
          kind: 'portal',
          end: destination.end,
        }));

  const allItems = [...coreItems, ...portalItems, ...adminItems];
  const sectionOrder = isAdminContext
    ? ([
        'home',
        'work',
        'operations',
        'customers',
        'administration',
        'reporting',
      ] satisfies AuthenticatedNavSectionId[])
    : authenticatedNavSections.map((section) => section.id);

  return sectionOrder
    .map((sectionId) => authenticatedNavSections.find((section) => section.id === sectionId))
    .filter((section): section is AuthenticatedNavSectionDefinition => Boolean(section))
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

  if (item.href === '/admin') {
    return pathname === '/admin';
  }

  if (item.href === '/refunds') {
    return (
      pathname === '/refunds' ||
      pathname.startsWith('/refunds/') ||
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
  if (pathname === '/refunds' || pathname.startsWith('/refunds/')) {
    return {
      titleKey: 'portal.nav.refunds',
      descriptionKey: 'portal.nav.refundsDescription',
    };
  }

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

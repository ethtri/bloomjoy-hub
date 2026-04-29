import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  HeadphonesIcon,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShoppingBag,
} from 'lucide-react';
import type { PortalAccessTier } from '@/lib/membership';
import type { TranslationKey } from '@/lib/i18n';

export type PortalAccessLevel =
  | 'all'
  | 'baseline'
  | 'training'
  | 'plus'
  | 'support'
  | 'reporting';

export interface PortalDestination {
  href: string;
  label: string;
  labelKey: TranslationKey;
  description: string;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  access: PortalAccessLevel;
  mobileOrder: number;
  end?: boolean;
  upsellCopy?: string;
  upsellCopyKey?: TranslationKey;
}

export const portalDestinations: PortalDestination[] = [
  {
    href: '/portal',
    label: 'Dashboard',
    labelKey: 'portal.nav.dashboard',
    description: 'Your next actions, progress, and account status.',
    descriptionKey: 'portal.nav.dashboardDescription',
    icon: LayoutDashboard,
    access: 'all',
    mobileOrder: 1,
    end: true,
  },
  {
    href: '/portal/orders',
    label: 'Orders',
    labelKey: 'portal.nav.orders',
    description: 'Receipts, totals, and shipment tracking.',
    descriptionKey: 'portal.nav.ordersDescription',
    icon: ShoppingBag,
    access: 'baseline',
    mobileOrder: 2,
  },
  {
    href: '/portal/account',
    label: 'Account',
    labelKey: 'portal.nav.account',
    description: 'Billing, profile, and shipping details.',
    descriptionKey: 'portal.nav.accountDescription',
    icon: Settings,
    access: 'baseline',
    mobileOrder: 3,
  },
  {
    href: '/portal/reports',
    label: 'Reporting',
    labelKey: 'portal.nav.reporting',
    description: 'Machine sales, location rollups, and available reporting views.',
    descriptionKey: 'portal.nav.reportingDescription',
    icon: BarChart3,
    access: 'reporting',
    mobileOrder: 4,
    upsellCopy: 'Sales reporting is available only for machines Bloomjoy has granted to this account.',
    upsellCopyKey: 'portal.nav.reportingUpsell',
  },
  {
    href: '/portal/training',
    label: 'Training',
    labelKey: 'portal.nav.training',
    description: 'Task-first videos, quick aids, and operator guides.',
    descriptionKey: 'portal.nav.trainingDescription',
    icon: BookOpen,
    access: 'training',
    mobileOrder: 5,
    upsellCopy: 'Unlock the operator hub, quick aids, and certificate path.',
    upsellCopyKey: 'portal.nav.trainingUpsell',
  },
  {
    href: '/portal/onboarding',
    label: 'Onboarding',
    labelKey: 'portal.nav.onboarding',
    description: 'Guided setup milestones for your first successful runs.',
    descriptionKey: 'portal.nav.onboardingDescription',
    icon: ListChecks,
    access: 'plus',
    mobileOrder: 6,
    upsellCopy: 'Unlock guided setup steps and first-spin milestones.',
    upsellCopyKey: 'portal.nav.onboardingUpsell',
  },
  {
    href: '/portal/support',
    label: 'Support',
    labelKey: 'portal.nav.support',
    description: 'Concierge help, WeChat onboarding, and parts assistance.',
    descriptionKey: 'portal.nav.supportDescription',
    icon: HeadphonesIcon,
    access: 'support',
    mobileOrder: 7,
    upsellCopy: 'Unlock guided support requests and concierge escalation.',
    upsellCopyKey: 'portal.nav.supportUpsell',
  },
];

export const getPortalDestinationByPath = (pathname: string) =>
  portalDestinations.find((destination) =>
    destination.end
      ? pathname === destination.href
      : pathname === destination.href || pathname.startsWith(`${destination.href}/`)
  ) ?? portalDestinations[0];

export const canAccessPortalLevel = (
  accessTier: PortalAccessTier,
  accessLevel: PortalAccessLevel,
  hasReportingAccess = false,
  capabilities: string[] = []
): boolean => {
  const hasCapability = (capability: string) => capabilities.includes(capability);

  switch (accessLevel) {
    case 'all':
      return true;
    case 'baseline':
      return (
        accessTier === 'baseline' ||
        accessTier === 'plus' ||
        accessTier === 'corporate_partner'
      );
    case 'training':
      return (
        accessTier === 'training' ||
        accessTier === 'plus' ||
        accessTier === 'corporate_partner' ||
        hasCapability('training.view')
      );
    case 'plus':
      return accessTier === 'plus';
    case 'support':
      return accessTier === 'plus' || hasCapability('support.request');
    case 'reporting':
      return hasReportingAccess || hasCapability('reports.partner.view');
    default:
      return false;
  }
};

export const getAccessLevelLabel = (accessLevel: PortalAccessLevel) => {
  switch (accessLevel) {
    case 'baseline':
      return 'Customer';
    case 'training':
      return 'Training';
    case 'plus':
      return 'Plus';
    case 'support':
      return 'Support';
    case 'reporting':
      return 'Reporting';
    case 'all':
    default:
      return 'Open';
  }
};

export const getAccessLevelLabelKey = (accessLevel: PortalAccessLevel): TranslationKey => {
  switch (accessLevel) {
    case 'baseline':
      return 'portal.access.customer';
    case 'training':
      return 'portal.access.training';
    case 'plus':
      return 'portal.access.plus';
    case 'support':
      return 'portal.access.support';
    case 'reporting':
      return 'portal.access.reporting';
    case 'all':
    default:
      return 'portal.access.open';
  }
};

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

export type PortalAccessLevel = 'all' | 'baseline' | 'training' | 'plus' | 'reporting';

export interface PortalDestination {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  access: PortalAccessLevel;
  mobileOrder: number;
  end?: boolean;
  upsellCopy?: string;
}

export const portalDestinations: PortalDestination[] = [
  {
    href: '/portal',
    label: 'Dashboard',
    description: 'Your next actions, progress, and account status.',
    icon: LayoutDashboard,
    access: 'all',
    mobileOrder: 1,
    end: true,
  },
  {
    href: '/portal/orders',
    label: 'Orders',
    description: 'Receipts, totals, and shipment tracking.',
    icon: ShoppingBag,
    access: 'baseline',
    mobileOrder: 2,
  },
  {
    href: '/portal/account',
    label: 'Account',
    description: 'Billing, profile, and shipping details.',
    icon: Settings,
    access: 'baseline',
    mobileOrder: 3,
  },
  {
    href: '/portal/reports',
    label: 'Reporting',
    description: 'Machine sales, location rollups, and available reporting views.',
    icon: BarChart3,
    access: 'reporting',
    mobileOrder: 4,
    upsellCopy: 'Sales reporting is available only for machines Bloomjoy has granted to this account.',
  },
  {
    href: '/portal/training',
    label: 'Training',
    description: 'Task-first videos, quick aids, and operator guides.',
    icon: BookOpen,
    access: 'training',
    mobileOrder: 5,
    upsellCopy: 'Unlock the operator hub, quick aids, and certificate path.',
  },
  {
    href: '/portal/onboarding',
    label: 'Onboarding',
    description: 'Guided setup milestones for your first successful runs.',
    icon: ListChecks,
    access: 'plus',
    mobileOrder: 6,
    upsellCopy: 'Unlock guided setup steps and first-spin milestones.',
  },
  {
    href: '/portal/support',
    label: 'Support',
    description: 'Concierge help, WeChat onboarding, and parts assistance.',
    icon: HeadphonesIcon,
    access: 'plus',
    mobileOrder: 7,
    upsellCopy: 'Unlock guided support requests and concierge escalation.',
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
  hasReportingAccess = false
): boolean => {
  switch (accessLevel) {
    case 'all':
      return true;
    case 'baseline':
      return accessTier === 'baseline' || accessTier === 'plus';
    case 'training':
      return accessTier === 'training' || accessTier === 'plus';
    case 'plus':
      return accessTier === 'plus';
    case 'reporting':
      return hasReportingAccess;
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
    case 'reporting':
      return 'Reporting';
    case 'all':
    default:
      return 'Open';
  }
};

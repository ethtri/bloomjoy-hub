import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  HeadphonesIcon,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShoppingBag,
} from 'lucide-react';

export type PortalAccessLevel = 'baseline' | 'plus';

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
    access: 'baseline',
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
    href: '/portal/training',
    label: 'Training',
    description: 'Task-first videos, quick aids, and operator guides.',
    icon: BookOpen,
    access: 'plus',
    mobileOrder: 4,
    upsellCopy: 'Unlock the operator hub, quick aids, and certificate path.',
  },
  {
    href: '/portal/onboarding',
    label: 'Onboarding',
    description: 'Guided setup milestones for your first successful runs.',
    icon: ListChecks,
    access: 'plus',
    mobileOrder: 5,
    upsellCopy: 'Unlock guided setup steps and first-spin milestones.',
  },
  {
    href: '/portal/support',
    label: 'Support',
    description: 'Concierge help, WeChat onboarding, and parts assistance.',
    icon: HeadphonesIcon,
    access: 'plus',
    mobileOrder: 6,
    upsellCopy: 'Unlock guided support requests and concierge escalation.',
  },
];

export const getPortalDestinationByPath = (pathname: string) =>
  portalDestinations.find((destination) =>
    destination.end
      ? pathname === destination.href
      : pathname === destination.href || pathname.startsWith(`${destination.href}/`)
  ) ?? portalDestinations[0];

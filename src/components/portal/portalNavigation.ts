import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Clock3,
  HeadphonesIcon,
  LayoutDashboard,
  ListChecks,
  ReceiptText,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type { PortalAccessTier } from '@/lib/membership';
import type { TranslationKey } from '@/lib/i18n';

export type PortalAccessLevel =
  | 'all'
  | 'account'
  | 'baseline'
  | 'training'
  | 'plus'
  | 'support'
  | 'reporting'
  | 'refunds'
  | 'team'
  | 'timekeeping';

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
    href: '/portal/time',
    label: 'Time',
    labelKey: 'portal.nav.time',
    description: 'Submit assigned-machine shifts and review current payout-period time.',
    descriptionKey: 'portal.nav.timeDescription',
    icon: Clock3,
    access: 'timekeeping',
    mobileOrder: 2,
  },
  {
    href: '/portal/orders',
    label: 'Orders',
    labelKey: 'portal.nav.orders',
    description: 'Receipts, totals, and shipment tracking.',
    descriptionKey: 'portal.nav.ordersDescription',
    icon: ShoppingBag,
    access: 'baseline',
    mobileOrder: 3,
  },
  {
    href: '/portal/account',
    label: 'Account Settings',
    labelKey: 'portal.nav.account',
    description: 'Profile, billing, shipping, and language preferences.',
    descriptionKey: 'portal.nav.accountDescription',
    icon: Settings,
    access: 'account',
    mobileOrder: 4,
  },
  {
    href: '/portal/team',
    label: 'Team',
    labelKey: 'portal.nav.team',
    description: 'Add Technicians and manage assigned-machine reporting access.',
    descriptionKey: 'portal.nav.teamDescription',
    icon: Users,
    access: 'team',
    mobileOrder: 5,
  },
  {
    href: '/portal/reports',
    label: 'Reporting',
    labelKey: 'portal.nav.reporting',
    description: 'Machine sales, location rollups, and available reporting views.',
    descriptionKey: 'portal.nav.reportingDescription',
    icon: BarChart3,
    access: 'reporting',
    mobileOrder: 6,
    upsellCopy: 'Sales reporting is available only for machines Bloomjoy has granted to this account.',
    upsellCopyKey: 'portal.nav.reportingUpsell',
  },
  {
    href: '/portal/refunds',
    label: 'Refunds',
    labelKey: 'portal.nav.refunds',
    description: 'Review assigned customer refund cases, evidence, and follow-up.',
    descriptionKey: 'portal.nav.refundsDescription',
    icon: ReceiptText,
    access: 'refunds',
    mobileOrder: 7,
  },
  {
    href: '/portal/training',
    label: 'Training',
    labelKey: 'portal.nav.training',
    description: 'Task-first videos, quick aids, and operator guides.',
    descriptionKey: 'portal.nav.trainingDescription',
    icon: BookOpen,
    access: 'training',
    mobileOrder: 8,
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
    mobileOrder: 9,
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
    mobileOrder: 10,
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

export const canUsePortalTeamManagement = ({
  canManageTechnicians = false,
  capabilities = [],
}: {
  canManageTechnicians?: boolean;
  capabilities?: string[];
}) => canManageTechnicians || capabilities.includes('technicians.manage');

export const canUsePortalTimekeeping = ({
  capabilities = [],
  hasTimekeepingAccess = false,
}: {
  capabilities?: string[];
  hasTimekeepingAccess?: boolean;
}) =>
  hasTimekeepingAccess ||
  capabilities.some((capability) =>
    ['operator.timekeeping', 'timekeeping.submit', 'operator.payouts'].includes(capability)
  );

export const canAccessPortalLevel = (
  accessTier: PortalAccessTier,
  accessLevel: PortalAccessLevel,
  hasReportingAccess = false,
  capabilities: string[] = [],
  hasRefundOperationsAccess = false,
  canManageTechnicians = false,
  canAccessAccountSettings = false,
  hasTimekeepingAccess = false
): boolean => {
  const hasCapability = (capability: string) => capabilities.includes(capability);

  switch (accessLevel) {
    case 'all':
      return true;
    case 'account':
      return (
        canAccessAccountSettings ||
        accessTier === 'baseline' ||
        accessTier === 'plus' ||
        accessTier === 'corporate_partner'
      );
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
    case 'refunds':
      return hasRefundOperationsAccess || hasCapability('refunds.manage');
    case 'team':
      return canUsePortalTeamManagement({ canManageTechnicians, capabilities });
    case 'timekeeping':
      return canUsePortalTimekeeping({ capabilities, hasTimekeepingAccess });
    default:
      return false;
  }
};

export const getAccessLevelLabel = (accessLevel: PortalAccessLevel) => {
  switch (accessLevel) {
    case 'baseline':
      return 'Customer';
    case 'account':
      return 'Account';
    case 'training':
      return 'Training';
    case 'plus':
      return 'Plus';
    case 'support':
      return 'Support';
    case 'reporting':
      return 'Reporting';
    case 'refunds':
      return 'Refunds';
    case 'team':
      return 'Team';
    case 'timekeeping':
      return 'Timekeeping';
    case 'all':
    default:
      return 'Open';
  }
};

export const getAccessLevelLabelKey = (accessLevel: PortalAccessLevel): TranslationKey => {
  switch (accessLevel) {
    case 'baseline':
      return 'portal.access.customer';
    case 'account':
      return 'portal.nav.account';
    case 'training':
      return 'portal.access.training';
    case 'plus':
      return 'portal.access.plus';
    case 'support':
      return 'portal.access.support';
    case 'reporting':
      return 'portal.access.reporting';
    case 'refunds':
      return 'portal.access.refunds';
    case 'team':
      return 'portal.access.team';
    case 'timekeeping':
      return 'portal.access.timekeeping';
    case 'all':
    default:
      return 'portal.access.open';
  }
};

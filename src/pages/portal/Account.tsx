import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  User,
  Users,
  MapPin,
  CreditCard,
  ExternalLink,
  Languages,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { LanguagePreferenceControl } from '@/components/i18n/LanguagePreferenceControl';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePortalTechnicianManagement } from '@/hooks/usePortalTechnicianManagement';
import { openCustomerPortal } from '@/lib/stripeCheckout';
import { hasPlusAccess } from '@/lib/membership';
import {
  fetchPortalAccountProfile,
  fetchPortalMembershipSummary,
  upsertPortalAccountProfile,
  type PortalAccountProfileInput,
} from '@/lib/accountProfile';
import { toast } from 'sonner';

const DEFAULT_PROFILE_FORM: PortalAccountProfileInput = {
  fullName: '',
  companyName: '',
  phone: '',
  shippingStreet1: '',
  shippingStreet2: '',
  shippingCity: '',
  shippingState: '',
  shippingPostalCode: '',
  shippingCountry: 'US',
};

const formatMembershipStatus = (status: string) =>
  status
    .split('_')
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(' ');

export default function AccountPage() {
  const { user, adminAccess, isCorporatePartner } = useAuth();
  const { t } = useLanguage();
  const {
    canUsePortalTeam,
    hasAdvertisedTeamCapability,
    isResolvingPortalTeam,
  } = usePortalTechnicianManagement();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasHandledBillingReturn = useRef(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [profileForm, setProfileForm] = useState<PortalAccountProfileInput>(DEFAULT_PROFILE_FORM);

  const { data: accountProfile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['portal-account-profile', user?.id],
    queryFn: () => fetchPortalAccountProfile(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 1000 * 30,
  });

  const {
    data: membershipSummary,
    isLoading: isMembershipLoading,
    refetch: refetchMembershipSummary,
  } = useQuery({
    queryKey: ['portal-membership-summary', user?.id],
    queryFn: () => fetchPortalMembershipSummary(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 1000 * 30,
  });

  const saveProfileMutation = useMutation({
    mutationFn: async (payload: PortalAccountProfileInput) => {
      if (!user?.id) {
        throw new Error('Log in to update account details.');
      }

      return upsertPortalAccountProfile(user.id, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-account-profile', user?.id] });
    },
  });

  useEffect(() => {
    if (!accountProfile) {
      setProfileForm(DEFAULT_PROFILE_FORM);
      return;
    }

    setProfileForm({
      fullName: accountProfile.full_name ?? '',
      companyName: accountProfile.company_name ?? '',
      phone: accountProfile.phone ?? '',
      shippingStreet1: accountProfile.shipping_street_1 ?? '',
      shippingStreet2: accountProfile.shipping_street_2 ?? '',
      shippingCity: accountProfile.shipping_city ?? '',
      shippingState: accountProfile.shipping_state ?? '',
      shippingPostalCode: accountProfile.shipping_postal_code ?? '',
      shippingCountry: accountProfile.shipping_country ?? 'US',
    });
  }, [accountProfile]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('billing') !== 'return' || hasHandledBillingReturn.current) {
      return;
    }

    hasHandledBillingReturn.current = true;
    void refetchMembershipSummary();
    toast.success('Returned from Stripe billing portal. Membership status has been refreshed.');

    searchParams.delete('billing');
    const nextSearch = searchParams.toString();

    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate, refetchMembershipSummary]);

  const effectiveMembershipStatus =
    membershipSummary?.membershipStatus ?? user?.membershipStatus ?? 'none';
  const hasSummaryPlusAccess =
    membershipSummary?.hasPlusAccess ?? user?.plusAccess.hasPlusAccess ?? false;
  const isMember = hasSummaryPlusAccess || hasPlusAccess(effectiveMembershipStatus);
  const isCorporatePartnerOnly =
    isCorporatePartner && !hasSummaryPlusAccess && !user?.plusAccess.hasPlusAccess && !user?.isSuperAdmin;
  const isScopedAdminOnly = Boolean(user?.isScopedAdmin && !user?.isSuperAdmin);
  const hasPaidBilling =
    membershipSummary?.paidSubscriptionActive ??
    user?.plusAccess.paidSubscriptionActive ??
    hasPlusAccess(effectiveMembershipStatus);
  const accessSource = membershipSummary?.source ?? user?.plusAccess.source ?? 'none';
  const currentPeriodEnd =
    membershipSummary?.currentPeriodEnd ?? user?.plusAccess.currentPeriodEnd ?? null;
  const cancelAtPeriodEnd =
    membershipSummary?.cancelAtPeriodEnd ?? user?.plusAccess.cancelAtPeriodEnd ?? false;
  const freeGrantExpiresAt =
    membershipSummary?.freeGrantExpiresAt ?? user?.plusAccess.freeGrantExpiresAt ?? null;
  const freeGrantExpiryLabel = freeGrantExpiresAt
    ? new Date(freeGrantExpiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const membershipStatusLabel = useMemo(() => {
    if (isScopedAdminOnly) {
      return 'Scoped Admin';
    }

    if (isCorporatePartnerOnly) {
      return 'Corporate Partner';
    }

    if (accessSource === 'free_grant' && freeGrantExpiryLabel) {
      return `Waived until ${freeGrantExpiryLabel}`;
    }

    if (accessSource === 'admin') {
      return 'Admin access';
    }

    if (effectiveMembershipStatus === 'none') {
      return 'Upgrade available';
    }

    return formatMembershipStatus(effectiveMembershipStatus);
  }, [
    accessSource,
    effectiveMembershipStatus,
    freeGrantExpiryLabel,
    isCorporatePartnerOnly,
    isScopedAdminOnly,
  ]);
  const accountAccessLabel = isScopedAdminOnly
    ? 'Scoped Admin'
    : isCorporatePartnerOnly
    ? 'Corporate Partner'
    : isMember
      ? 'Plus Basic'
      : 'Baseline';
  const nextBillingLabel =
    hasPaidBilling && currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;
  const canUseAdminAccess =
    Boolean(user?.isSuperAdmin) ||
    adminAccess.allowedSurfaces.includes('*') ||
    adminAccess.allowedSurfaces.includes('access');
  const shouldShowAdminTechnicianCard =
    canUseAdminAccess &&
    (Boolean(user?.isScopedAdmin) ||
      (hasAdvertisedTeamCapability && !isResolvingPortalTeam && !canUsePortalTeam));

  const handleManageBilling = async () => {
    if (!user?.email) {
      toast.error('Log in to manage billing.');
      return;
    }

    try {
      setIsOpeningPortal(true);
      const portalUrl = await openCustomerPortal(window.location.origin);
      window.location.assign(portalUrl);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `${error.message} Please try again, or contact support if the issue continues.`
          : 'Unable to open the Stripe billing portal right now. Please try again, or contact support if the issue continues.';
      toast.error(message);
      setIsOpeningPortal(false);
    }
  };

  const updateProfileField = (
    key: keyof PortalAccountProfileInput,
    value: string
  ) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };

  const saveProfileSection = async () => {
    try {
      await saveProfileMutation.mutateAsync(profileForm);
      toast.success('Account details saved.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save account details.';
      toast.error(message);
    }
  };

  const saveShippingSection = async () => {
    try {
      await saveProfileMutation.mutateAsync(profileForm);
      toast.success('Shipping address updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update shipping address.';
      toast.error(message);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section overflow-x-clip">
        <div className="container-page">
          <PortalPageIntro
            title={t('account.title')}
            description={t('account.description')}
            badges={[
              { label: membershipStatusLabel, tone: isMember ? 'success' : 'accent' },
              ...(nextBillingLabel
                ? [{ label: `Renews ${nextBillingLabel}`, tone: 'muted' as const }]
                : []),
            ]}
            actions={
              isScopedAdminOnly || isCorporatePartnerOnly ? undefined : hasPaidBilling ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={handleManageBilling}
                  disabled={isOpeningPortal || isMembershipLoading}
                >
                  {isOpeningPortal ? 'Opening billing...' : 'Manage Billing'}
                </Button>
              ) : !isMember ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link to="/plus">View Plus Membership</Link>
                </Button>
              ) : undefined
            }
          />

          {!isScopedAdminOnly && !isCorporatePartnerOnly && accessSource === 'free_grant' && freeGrantExpiryLabel && (
            <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
              Plus access is waived through {freeGrantExpiryLabel}. No subscription fee is being
              billed for this grant.
            </div>
          )}

          {canUsePortalTeam && (
            <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Team access
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      Add Technicians, send invites, and manage assigned-machine reporting from
                      the Team page.
                    </p>
                  </div>
                </div>
                <Button asChild className="min-h-11 w-full md:w-auto">
                  <Link to="/portal/team">Manage Technicians</Link>
                </Button>
              </div>
            </div>
          )}

          {shouldShowAdminTechnicianCard && (
            <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Technician administration
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      Use Admin Access to add Technicians for assigned or admin-controlled
                      machines. Portal Team appears only when this account has an active customer
                      or partner team management scope.
                    </p>
                  </div>
                </div>
                <Button asChild className="min-h-11 w-full md:w-auto">
                  <Link to="/admin/access?action=add-access&preset=technician">Open Admin Access</Link>
                </Button>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-3 lg:gap-8">
            {/* Profile */}
            <div className="min-w-0 lg:col-span-2">
              <div className="card-elevated min-w-0 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    {t('account.profile')}
                  </h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.email')}</label>
                    <Input value={user?.email || ''} disabled className="mt-1 h-11" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.name')}</label>
                    <Input
                      value={profileForm.fullName}
                      onChange={(event) => updateProfileField('fullName', event.target.value)}
                      placeholder={t('account.namePlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.company')}</label>
                    <Input
                      value={profileForm.companyName}
                      onChange={(event) => updateProfileField('companyName', event.target.value)}
                      placeholder={t('account.companyPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.phone')}</label>
                    <Input
                      value={profileForm.phone}
                      onChange={(event) => updateProfileField('phone', event.target.value)}
                      placeholder={t('account.phonePlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                </div>
                <Button
                  className="mt-6 min-h-11 w-full sm:w-auto"
                  onClick={saveProfileSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? t('account.saving') : t('account.saveChanges')}
                </Button>
              </div>

              {/* Shipping */}
              {!isScopedAdminOnly && (
              <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    {t('account.shippingAddress')}
                  </h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground">{t('account.streetAddress')}</label>
                    <Input
                      value={profileForm.shippingStreet1}
                      onChange={(event) => updateProfileField('shippingStreet1', event.target.value)}
                      placeholder={t('account.streetPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground">
                      {t('account.apartmentSuite')}
                    </label>
                    <Input
                      value={profileForm.shippingStreet2}
                      onChange={(event) => updateProfileField('shippingStreet2', event.target.value)}
                      placeholder={t('account.apartmentPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.city')}</label>
                    <Input
                      value={profileForm.shippingCity}
                      onChange={(event) => updateProfileField('shippingCity', event.target.value)}
                      placeholder={t('account.cityPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.state')}</label>
                    <Input
                      value={profileForm.shippingState}
                      onChange={(event) => updateProfileField('shippingState', event.target.value)}
                      placeholder={t('account.statePlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.zipCode')}</label>
                    <Input
                      value={profileForm.shippingPostalCode}
                      onChange={(event) =>
                        updateProfileField('shippingPostalCode', event.target.value)
                      }
                      placeholder={t('account.zipPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">{t('account.country')}</label>
                    <Input
                      value={profileForm.shippingCountry}
                      onChange={(event) => updateProfileField('shippingCountry', event.target.value)}
                      placeholder={t('account.countryPlaceholder')}
                      className="mt-1 h-11"
                      disabled={isProfileLoading}
                    />
                  </div>
                </div>
                <Button
                  className="mt-6 min-h-11 w-full sm:w-auto"
                  onClick={saveShippingSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? t('account.saving') : t('account.updateAddress')}
                </Button>
              </div>
              )}
            </div>

            {/* Billing */}
            <div className="min-w-0">
              <section
                className="mt-6 card-elevated min-w-0 p-5 sm:p-6"
                aria-labelledby="account-preferences-title"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Languages className="h-5 w-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="account-preferences-title"
                      className="font-display text-lg font-semibold text-foreground"
                    >
                      {t('account.preferences')}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t('language.selectorDescription')}
                    </p>
                  </div>
                </div>
                <div className="mt-5">
                  <LanguagePreferenceControl showText fullWidth />
                </div>
              </section>

              {!isScopedAdminOnly && !isCorporatePartnerOnly && (
                <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Billing</h2>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {hasPaidBilling
                    ? 'Manage your payment methods, invoices, and cancellations through the Stripe customer portal.'
                    : isMember
                      ? 'Your current Plus access is waived by Bloomjoy. No Stripe billing action is needed for this grant.'
                      : 'Upgrade to Plus to unlock premium training, onboarding, and concierge support.'}
                </p>
                {hasPaidBilling ? (
                  <Button
                    variant="outline"
                    className="mt-4 min-h-11 w-full"
                    onClick={handleManageBilling}
                    disabled={isOpeningPortal || !user?.email || isMembershipLoading}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {isOpeningPortal ? 'Opening...' : 'Open Billing Portal'}
                  </Button>
                ) : !isMember ? (
                  <Button asChild variant="outline" className="mt-4 min-h-11 w-full">
                    <Link to="/plus">View Plus Membership</Link>
                  </Button>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  Review{' '}
                  <Link to="/billing-cancellation" className="underline hover:text-foreground">
                    billing and cancellation terms
                  </Link>
                  .
                </p>
                </div>
              )}

              {!isScopedAdminOnly && (
              <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                <h3 className="font-semibold text-foreground">Membership</h3>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-semibold text-foreground">
                    {accountAccessLabel}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Status</span>
                  {isMember ? (
                    <span className="max-w-full rounded-full bg-sage-light px-2 py-0.5 text-xs font-semibold text-sage">
                      {membershipStatusLabel}
                    </span>
                  ) : (
                    <span className="max-w-full rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {membershipStatusLabel}
                    </span>
                  )}
                </div>
                {isMember && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      {hasPaidBilling ? 'Next billing' : 'Waived until'}
                    </span>
                    <span className="text-sm text-foreground">
                      {hasPaidBilling
                        ? nextBillingLabel ?? 'Not available'
                        : freeGrantExpiryLabel ?? 'Not available'}
                    </span>
                  </div>
                )}
                {cancelAtPeriodEnd && hasPaidBilling && (
                  <div className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
                    Subscription is set to cancel at the end of the current billing period.
                  </div>
                )}
              </div>
              )}

            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

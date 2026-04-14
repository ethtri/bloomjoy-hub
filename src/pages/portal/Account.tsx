import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  User,
  MapPin,
  CreditCard,
  ExternalLink,
  GraduationCap,
  UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { useAuth } from '@/contexts/AuthContext';
import { openCustomerPortal } from '@/lib/stripeCheckout';
import { hasPlusAccess } from '@/lib/membership';
import {
  fetchPortalAccountProfile,
  fetchPortalMembershipSummary,
  upsertPortalAccountProfile,
  type PortalAccountProfileInput,
} from '@/lib/accountProfile';
import {
  fetchMyOperatorTrainingGrants,
  grantOperatorTrainingAccess,
  revokeOperatorTrainingAccess,
} from '@/lib/operatorTrainingAccess';
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

const parseOperatorEmails = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0)
    )
  );

export default function AccountPage() {
  const { user, canManageOperatorTraining } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasHandledBillingReturn = useRef(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [profileForm, setProfileForm] = useState<PortalAccountProfileInput>(DEFAULT_PROFILE_FORM);
  const [operatorEmails, setOperatorEmails] = useState('');

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

  const {
    data: operatorTrainingGrants = [],
    isLoading: operatorTrainingGrantsLoading,
    error: operatorTrainingGrantsError,
  } = useQuery({
    queryKey: ['operator-training-grants', user?.id],
    queryFn: fetchMyOperatorTrainingGrants,
    enabled: Boolean(user?.id && canManageOperatorTraining),
    staleTime: 1000 * 30,
  });

  const parsedOperatorEmails = useMemo(() => parseOperatorEmails(operatorEmails), [operatorEmails]);
  const activeOperatorGrants = operatorTrainingGrants.filter((grant) => grant.isActive);
  const operatorTrainingErrorMessage =
    operatorTrainingGrantsError instanceof Error ? operatorTrainingGrantsError.message : null;

  const grantOperatorMutation = useMutation({
    mutationFn: async (emails: string[]) => {
      if (emails.length === 0) {
        throw new Error('Enter at least one operator email.');
      }

      const results = await Promise.allSettled(
        emails.map((email) => grantOperatorTrainingAccess(email))
      );
      const added = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - added;
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      const firstFailureMessage =
        firstFailure?.reason instanceof Error
          ? firstFailure.reason.message
          : 'Unable to grant operator training access.';

      if (added === 0 && failed > 0) {
        throw new Error(firstFailureMessage);
      }

      return { added, failed, firstFailureMessage };
    },
    onSuccess: async ({ added, failed, firstFailureMessage }) => {
      setOperatorEmails('');
      await queryClient.invalidateQueries({ queryKey: ['operator-training-grants', user?.id] });

      if (failed > 0) {
        toast.error(`${added} operator${added === 1 ? '' : 's'} added; ${failed} failed. ${firstFailureMessage}`);
        return;
      }

      toast.success(`${added} training operator${added === 1 ? '' : 's'} added.`);
    },
  });

  const revokeOperatorMutation = useMutation({
    mutationFn: revokeOperatorTrainingAccess,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operator-training-grants', user?.id] });
      toast.success('Operator training access revoked.');
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
  }, [accessSource, effectiveMembershipStatus, freeGrantExpiryLabel]);
  const nextBillingLabel =
    hasPaidBilling && currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;

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

  const handleGrantOperatorAccess = async () => {
    try {
      await grantOperatorMutation.mutateAsync(parsedOperatorEmails);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to grant operator training access.';
      toast.error(message);
    }
  };

  const handleRevokeOperatorAccess = async (grantId: string) => {
    try {
      await revokeOperatorMutation.mutateAsync(grantId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to revoke operator training access.';
      toast.error(message);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section overflow-x-clip">
        <div className="container-page">
          <PortalPageIntro
            title="Account Settings"
            description="Manage the billing details, profile information, and shipping address that keep future orders and support handoffs running smoothly."
            badges={[
              { label: membershipStatusLabel, tone: isMember ? 'success' : 'accent' },
              ...(nextBillingLabel
                ? [{ label: `Renews ${nextBillingLabel}`, tone: 'muted' as const }]
                : []),
            ]}
            actions={
              hasPaidBilling ? (
                <Button
                  variant="outline"
                  onClick={handleManageBilling}
                  disabled={isOpeningPortal || isMembershipLoading}
                >
                  {isOpeningPortal ? 'Opening billing...' : 'Manage Billing'}
                </Button>
              ) : !isMember ? (
                <Button asChild variant="outline">
                  <Link to="/plus">View Plus Membership</Link>
                </Button>
              ) : undefined
            }
          />

          {accessSource === 'free_grant' && freeGrantExpiryLabel && (
            <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
              Plus access is waived through {freeGrantExpiryLabel}. No subscription fee is being
              billed for this grant.
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
                  <h2 className="font-display text-lg font-semibold text-foreground">Profile</h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Email</label>
                    <Input value={user?.email || ''} disabled className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Name</label>
                    <Input
                      value={profileForm.fullName}
                      onChange={(event) => updateProfileField('fullName', event.target.value)}
                      placeholder="Your name"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Company</label>
                    <Input
                      value={profileForm.companyName}
                      onChange={(event) => updateProfileField('companyName', event.target.value)}
                      placeholder="Company name (optional)"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Phone</label>
                    <Input
                      value={profileForm.phone}
                      onChange={(event) => updateProfileField('phone', event.target.value)}
                      placeholder="Phone number"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                </div>
                <Button
                  className="mt-6 w-full sm:w-auto"
                  onClick={saveProfileSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>

              {/* Shipping */}
              <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Shipping Address
                  </h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground">Street Address</label>
                    <Input
                      value={profileForm.shippingStreet1}
                      onChange={(event) => updateProfileField('shippingStreet1', event.target.value)}
                      placeholder="123 Main St"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground">
                      Apartment/Suite
                    </label>
                    <Input
                      value={profileForm.shippingStreet2}
                      onChange={(event) => updateProfileField('shippingStreet2', event.target.value)}
                      placeholder="Suite 100 (optional)"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">City</label>
                    <Input
                      value={profileForm.shippingCity}
                      onChange={(event) => updateProfileField('shippingCity', event.target.value)}
                      placeholder="City"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">State</label>
                    <Input
                      value={profileForm.shippingState}
                      onChange={(event) => updateProfileField('shippingState', event.target.value)}
                      placeholder="State"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">ZIP Code</label>
                    <Input
                      value={profileForm.shippingPostalCode}
                      onChange={(event) =>
                        updateProfileField('shippingPostalCode', event.target.value)
                      }
                      placeholder="12345"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Country</label>
                    <Input
                      value={profileForm.shippingCountry}
                      onChange={(event) => updateProfileField('shippingCountry', event.target.value)}
                      placeholder="US"
                      className="mt-1"
                      disabled={isProfileLoading}
                    />
                  </div>
                </div>
                <Button
                  className="mt-6 w-full sm:w-auto"
                  onClick={saveShippingSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? 'Saving...' : 'Update Address'}
                </Button>
              </div>
            </div>

            {/* Billing */}
            <div className="min-w-0">
              <div className="card-elevated min-w-0 p-5 sm:p-6">
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
                    className="mt-4 w-full"
                    onClick={handleManageBilling}
                    disabled={isOpeningPortal || !user?.email || isMembershipLoading}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {isOpeningPortal ? 'Opening...' : 'Open Billing Portal'}
                  </Button>
                ) : !isMember ? (
                  <Button asChild variant="outline" className="mt-4 w-full">
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

              <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                <h3 className="font-semibold text-foreground">Membership</h3>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-semibold text-foreground">
                    {isMember ? 'Plus Basic' : 'Baseline'}
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

            </div>
          </div>

          {canManageOperatorTraining && (
            <div className="mt-8 card-elevated min-w-0 p-5 sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <GraduationCap className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Operator Training Access
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Add people who need the training library. Operators do not get billing, orders,
                    support, onboarding, or Plus pricing access.
                  </p>
                </div>
              </div>

              {operatorTrainingErrorMessage && (
                <div className="mt-5 flex gap-3 rounded-md border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{operatorTrainingErrorMessage}</p>
                </div>
              )}

              <div className="mt-6 space-y-8">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-foreground">
                    Add operators
                  </label>
                  <Textarea
                    value={operatorEmails}
                    onChange={(event) => setOperatorEmails(event.target.value)}
                    placeholder="operator1@example.com, operator2@example.com"
                    className="mt-2 min-h-24"
                    disabled={grantOperatorMutation.isPending || Boolean(operatorTrainingErrorMessage)}
                  />
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-muted-foreground">
                      Paste one email, multiple lines, or a comma-separated list.
                      {parsedOperatorEmails.length > 0
                        ? ` ${parsedOperatorEmails.length} ready.`
                        : ''}
                    </p>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={handleGrantOperatorAccess}
                      disabled={
                        grantOperatorMutation.isPending ||
                        parsedOperatorEmails.length === 0 ||
                        Boolean(operatorTrainingErrorMessage)
                      }
                    >
                      {grantOperatorMutation.isPending
                        ? 'Adding...'
                        : parsedOperatorEmails.length > 1
                          ? `Add ${parsedOperatorEmails.length} Operators`
                          : 'Add Operator'}
                    </Button>
                  </div>
                </div>

                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">People with training access</h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Revoke access when someone no longer needs the training library.
                  </p>

                  <div className="mt-4 space-y-3">
                    {operatorTrainingGrantsLoading && (
                      <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Loading operators...
                      </p>
                    )}
                    {!operatorTrainingGrantsLoading &&
                      !operatorTrainingErrorMessage &&
                      activeOperatorGrants.length === 0 && (
                        <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                          No operator training access has been added yet.
                        </p>
                      )}
                    {activeOperatorGrants.map((grant) => (
                      <div
                        key={grant.id}
                        className="rounded-md border border-border bg-muted/20 px-3 py-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium text-foreground">
                              {grant.operatorEmail}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">Training access</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevokeOperatorAccess(grant.id)}
                            disabled={revokeOperatorMutation.isPending}
                            className="w-full sm:w-auto"
                          >
                            <UserMinus className="mr-1.5 h-4 w-4" />
                            Revoke
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}

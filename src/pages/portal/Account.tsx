import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CreditCard, ExternalLink, MailPlus, MapPin, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { useAuth } from '@/contexts/AuthContext';
import { openCustomerPortal } from '@/lib/stripeCheckout';
import { hasPlusAccess } from '@/lib/membership';
import {
  createOperatorInvite,
  fetchCurrentAccountState,
  resendInvite,
  revokeInviteOrMembership,
} from '@/lib/customerAccounts';
import { getPortalAccessBadgeLabel } from '@/lib/portalAccess';
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

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not sent yet';

export default function AccountPage() {
  const { user, accessTier, portalRole, canManageOperators } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasHandledBillingReturn = useRef(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [profileForm, setProfileForm] = useState<PortalAccountProfileInput>(DEFAULT_PROFILE_FORM);
  const [operatorEmail, setOperatorEmail] = useState('');

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

  const { data: teamAccessState, isLoading: isTeamAccessLoading } = useQuery({
    queryKey: ['customer-account-team-state', user?.accountId],
    queryFn: () => fetchCurrentAccountState(user!.accountId!),
    enabled: Boolean(user?.accountId) && canManageOperators,
    staleTime: 1000 * 15,
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

  const createOperatorInviteMutation = useMutation({
    mutationFn: (email: string) => createOperatorInvite(email),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customer-account-team-state', user?.accountId],
      });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: (inviteId: string) => resendInvite(inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customer-account-team-state', user?.accountId],
      });
    },
  });

  const revokeAccessMutation = useMutation({
    mutationFn: ({
      inviteId,
      membershipId,
    }: {
      inviteId?: string;
      membershipId?: string;
    }) => revokeInviteOrMembership({ inviteId, membershipId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['customer-account-team-state', user?.accountId],
      });
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

  const effectiveMembershipStatus = membershipSummary?.status ?? user?.membershipStatus ?? 'none';
  const hasPaidMembership = hasPlusAccess(effectiveMembershipStatus);
  const accessBadgeLabel = getPortalAccessBadgeLabel({
    accessTier,
    portalRole,
    hasPaidMembership,
    isAdmin: user?.isAdmin,
  });
  const membershipStatusLabel = useMemo(() => {
    if (effectiveMembershipStatus === 'none') {
      return 'No active billing plan';
    }

    return formatMembershipStatus(effectiveMembershipStatus);
  }, [effectiveMembershipStatus]);
  const nextBillingLabel =
    hasPaidMembership && membershipSummary?.currentPeriodEnd
      ? new Date(membershipSummary.currentPeriodEnd).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;
  const seatUsageLabel = teamAccessState
    ? `${teamAccessState.usedSeats}/${teamAccessState.seatLimit} seats used`
    : 'Up to 50 operator seats';
  const billingDescription = hasPaidMembership
    ? 'Manage your payment methods, invoices, and cancellations through the Stripe customer portal.'
    : portalRole === 'partner'
      ? 'Partner access is provisioned outside Stripe billing. The billing portal appears here only if this user also has a direct Plus subscription.'
      : portalRole === 'operator'
        ? 'Operator seats do not manage billing from this screen.'
        : 'Upgrade to Plus to unlock premium training, onboarding, and concierge support.';
  const pageDescription = portalRole === 'partner'
    ? 'Manage your partner access, operator seats, profile information, and shipping details from one place.'
    : portalRole === 'operator'
      ? 'Manage your profile and shipping details while keeping your operator training seat attached to this account.'
      : 'Manage the billing details, profile information, and shipping address that keep future orders and support handoffs running smoothly.';

  const handleManageBilling = async () => {
    if (!user?.email || !hasPaidMembership) {
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

  const updateProfileField = (key: keyof PortalAccountProfileInput, value: string) => {
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

  const handleCreateOperatorInvite = async () => {
    const normalizedEmail = operatorEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error('Enter an operator email address first.');
      return;
    }

    try {
      const result = await createOperatorInviteMutation.mutateAsync(normalizedEmail);
      setOperatorEmail('');

      if (result.deliveryStatus === 'failed') {
        toast.error(
          `Operator access was created for ${result.invite.email}, but the invite email failed to send. Use resend after checking the sender configuration.`
        );
        return;
      }

      toast.success(`Operator invite sent to ${result.invite.email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add operator access.';
      toast.error(message);
    }
  };

  const handleResendInvite = async (inviteId: string, email: string) => {
    try {
      const result = await resendInviteMutation.mutateAsync(inviteId);

      if (result.deliveryStatus === 'failed') {
        toast.error(
          `Invite resend failed for ${email}. The invite is still pending and can be retried again.`
        );
        return;
      }

      toast.success(`Invite resent to ${email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resend invite.';
      toast.error(message);
    }
  };

  const handleRevokeAccess = async ({
    inviteId,
    membershipId,
    email,
  }: {
    inviteId?: string;
    membershipId?: string;
    email: string;
  }) => {
    try {
      await revokeAccessMutation.mutateAsync({ inviteId, membershipId });
      toast.success(`Access revoked for ${email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to revoke access.';
      toast.error(message);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section overflow-x-clip">
        <div className="container-page">
          <PortalPageIntro
            title="Account Settings"
            description={pageDescription}
            badges={[
              {
                label: accessBadgeLabel,
                tone: accessTier === 'plus' ? 'success' : accessTier === 'training' ? 'muted' : 'accent',
              },
              ...(nextBillingLabel
                ? [{ label: `Renews ${nextBillingLabel}`, tone: 'muted' as const }]
                : []),
              ...(canManageOperators
                ? [{ label: seatUsageLabel, tone: 'muted' as const }]
                : []),
            ]}
            actions={
              hasPaidMembership ? (
                <Button
                  variant="outline"
                  onClick={handleManageBilling}
                  disabled={isOpeningPortal || isMembershipLoading}
                >
                  {isOpeningPortal ? 'Opening billing...' : 'Manage Billing'}
                </Button>
              ) : canManageOperators ? (
                <Button asChild variant="outline">
                  <a href="#team-access">Manage Team Access</a>
                </Button>
              ) : accessTier === 'baseline' ? (
                <Button asChild variant="outline">
                  <Link to="/plus">View Plus Membership</Link>
                </Button>
              ) : null
            }
          />
          <div className="mt-6 grid gap-6 lg:grid-cols-3 lg:gap-8">
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

            <div className="min-w-0">
              <div className="card-elevated min-w-0 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Billing</h2>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">{billingDescription}</p>
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={handleManageBilling}
                  disabled={isOpeningPortal || !user?.email || !hasPaidMembership || isMembershipLoading}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {hasPaidMembership
                    ? isOpeningPortal
                      ? 'Opening...'
                      : 'Open Billing Portal'
                    : portalRole === 'partner'
                      ? 'No direct billing plan'
                      : portalRole === 'operator'
                        ? 'Billing not available'
                        : 'Plus Required'}
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  Review{' '}
                  <Link to="/billing-cancellation" className="underline hover:text-foreground">
                    billing and cancellation terms
                  </Link>
                  .
                </p>
              </div>

              <div className="mt-6 card-elevated min-w-0 p-5 sm:p-6">
                <h3 className="font-semibold text-foreground">Portal Access</h3>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Access level</span>
                  <span className="font-semibold text-foreground">{accessBadgeLabel}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Billing plan</span>
                  <span className="text-sm text-foreground">
                    {hasPaidMembership
                      ? 'Plus Basic'
                      : portalRole === 'partner'
                        ? 'None (partner-provisioned)'
                        : portalRole === 'operator'
                          ? 'None (operator seat)'
                          : 'Baseline'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <span className="max-w-full rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {hasPaidMembership
                      ? membershipStatusLabel
                      : portalRole === 'partner'
                        ? 'Partner access active'
                        : portalRole === 'operator'
                          ? 'Training access active'
                          : membershipStatusLabel}
                  </span>
                </div>
                {nextBillingLabel && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Next billing</span>
                    <span className="text-sm text-foreground">{nextBillingLabel}</span>
                  </div>
                )}
                {canManageOperators && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Operator seats</span>
                    <span className="text-sm text-foreground">
                      {teamAccessState
                        ? `${teamAccessState.usedSeats}/${teamAccessState.seatLimit} used`
                        : 'Loading...'}
                    </span>
                  </div>
                )}
                {membershipSummary?.cancelAtPeriodEnd && (
                  <div className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
                    Subscription is set to cancel at the end of the current billing period.
                  </div>
                )}
              </div>
            </div>
          </div>

          {canManageOperators && (
            <div id="team-access" className="mt-8 card-elevated p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      Team Access
                    </h2>
                  </div>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Partners can provision up to 50 operator seats. Operators get training access
                    only and must sign in with the exact email address you invite here.
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm">
                  {isTeamAccessLoading || !teamAccessState ? (
                    'Loading seats...'
                  ) : (
                    <span className="font-medium text-foreground">
                      {teamAccessState.usedSeats}/{teamAccessState.seatLimit} seats used
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr,1.12fr]">
                <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                  <div className="flex items-center gap-3">
                    <MailPlus className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-foreground">Add operator access</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    The invite email sends operators to the existing login page. They can use
                    password, Google, or email link after you add them here.
                  </p>
                  <div className="mt-5 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground">
                        Operator email
                      </label>
                      <Input
                        type="email"
                        value={operatorEmail}
                        onChange={(event) => setOperatorEmail(event.target.value)}
                        placeholder="operator@example.com"
                        className="mt-1"
                        disabled={
                          createOperatorInviteMutation.isPending ||
                          Boolean(teamAccessState && teamAccessState.availableSeats <= 0)
                        }
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={handleCreateOperatorInvite}
                      disabled={
                        createOperatorInviteMutation.isPending ||
                        Boolean(teamAccessState && teamAccessState.availableSeats <= 0)
                      }
                    >
                      {createOperatorInviteMutation.isPending
                        ? 'Sending invite...'
                        : teamAccessState && teamAccessState.availableSeats <= 0
                          ? 'Seat limit reached'
                          : 'Add operator'}
                    </Button>
                    {teamAccessState && (
                      <p className="text-xs text-muted-foreground">
                        {teamAccessState.availableSeats > 0
                          ? `${teamAccessState.availableSeats} seats still available. Pending invites count against the limit until revoked or accepted.`
                          : 'All seats are currently allocated. Revoke an active operator or pending invite to free a seat.'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Active operators
                        </p>
                        <h3 className="mt-1 font-semibold text-foreground">
                          {teamAccessState?.activeOperatorCount ?? 0} active seats
                        </h3>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {teamAccessState?.activeOperators.length ? (
                        teamAccessState.activeOperators.map((membership) => (
                          <div
                            key={membership.id}
                            className="rounded-[20px] border border-border bg-muted/20 p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-medium text-foreground">{membership.email}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Joined {formatDateTime(membership.joinedAt)}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleRevokeAccess({
                                    membershipId: membership.id,
                                    email: membership.email,
                                  })}
                                disabled={revokeAccessMutation.isPending}
                              >
                                Revoke access
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[20px] border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
                          No operators are active yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-border bg-background p-5 shadow-[var(--shadow-sm)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Pending invites
                        </p>
                        <h3 className="mt-1 font-semibold text-foreground">
                          {teamAccessState?.pendingInviteCount ?? 0} pending
                        </h3>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {teamAccessState?.pendingInvites.length ? (
                        teamAccessState.pendingInvites.map((invite) => (
                          <div
                            key={invite.id}
                            className="rounded-[20px] border border-border bg-muted/20 p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-medium text-foreground">{invite.email}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {invite.lastSendError
                                    ? `Send failed: ${invite.lastSendError}`
                                    : `Last sent ${formatDateTime(invite.lastSentAt)}`}
                                </p>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleResendInvite(invite.id, invite.email)}
                                  disabled={resendInviteMutation.isPending}
                                >
                                  Resend invite
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleRevokeAccess({
                                      inviteId: invite.id,
                                      email: invite.email,
                                    })}
                                  disabled={revokeAccessMutation.isPending}
                                >
                                  Revoke invite
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[20px] border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
                          No pending operator invites.
                        </div>
                      )}
                    </div>
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

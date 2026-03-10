import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { User, MapPin, CreditCard, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();
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

  const effectiveMembershipStatus = membershipSummary?.status ?? user?.membershipStatus ?? 'none';
  const isMember = hasPlusAccess(effectiveMembershipStatus);
  const membershipStatusLabel = useMemo(() => {
    if (effectiveMembershipStatus === 'none') {
      return 'Upgrade available';
    }

    return formatMembershipStatus(effectiveMembershipStatus);
  }, [effectiveMembershipStatus]);
  const nextBillingLabel =
    isMember && membershipSummary?.currentPeriodEnd
      ? new Date(membershipSummary.currentPeriodEnd).toLocaleDateString(undefined, {
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
      const portalUrl = await openCustomerPortal(user.email, window.location.origin);
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
      <section className="section-padding overflow-x-clip">
        <div className="container-page">
          <h1 className="font-display text-3xl font-bold text-foreground">Account Settings</h1>

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {/* Profile */}
            <div className="min-w-0 lg:col-span-2">
              <div className="card-elevated min-w-0 p-6">
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
                  className="mt-6"
                  onClick={saveProfileSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>

              {/* Shipping */}
              <div className="mt-6 card-elevated min-w-0 p-6">
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
                  className="mt-6"
                  onClick={saveShippingSection}
                  disabled={saveProfileMutation.isPending || isProfileLoading}
                >
                  {saveProfileMutation.isPending ? 'Saving...' : 'Update Address'}
                </Button>
              </div>
            </div>

            {/* Billing */}
            <div className="min-w-0">
              <div className="card-elevated min-w-0 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Billing</h2>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {isMember
                    ? 'Manage your payment methods, invoices, and cancellations through the Stripe customer portal.'
                    : 'Upgrade to Plus to unlock premium training, onboarding, and concierge support.'}
                </p>
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={handleManageBilling}
                  disabled={isOpeningPortal || !user?.email || !isMember || isMembershipLoading}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {isMember ? (isOpeningPortal ? 'Opening...' : 'Open Billing Portal') : 'Plus Required'}
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  Review{' '}
                  <Link to="/billing-cancellation" className="underline hover:text-foreground">
                    billing and cancellation terms
                  </Link>
                  .
                </p>
              </div>

              <div className="mt-6 card-elevated min-w-0 p-6">
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
                    <span className="text-sm text-muted-foreground">Next billing</span>
                    <span className="text-sm text-foreground">
                      {nextBillingLabel ?? 'Not available'}
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
        </div>
      </section>
    </PortalLayout>
  );
}

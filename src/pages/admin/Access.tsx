import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchAdminAccountSummaries,
  fetchMachineInventoryForAccount,
  grantPlusAccessAdmin,
  revokePlusAccessAdmin,
  type AdminAccountSummary,
  type MachineType,
  upsertMachineInventoryAdmin,
} from '@/lib/adminAccounts';
import {
  fetchAdminAuditLog,
  fetchAdminRoles,
  fetchScopedAdminGrants,
  grantScopedAdminByEmail,
  grantSuperAdminByEmail,
  revokeScopedAdmin,
  revokeSuperAdmin,
  type AdminAuditLogRecord,
  type AdminRoleRecord,
  type ScopedAdminGrantRecord,
} from '@/lib/adminGovernance';
import {
  fetchAdminCorporatePartnerAccessOptions,
  fetchAdminEffectiveAccessContext,
  grantCorporatePartnerMembership,
  revokeCorporatePartnerMembership,
  setPartnershipPartyPortalAccess,
  type EffectiveAccessContext,
} from '@/lib/corporatePartnerAccess';
import {
  fetchAdminReportingAccessMatrix,
  lookupReportingUserByEmailAdmin,
  setUserMachineReportingAccessAdmin,
  type AdminReportingAccessGrant,
  type AdminReportingAccessMachine,
  type AdminReportingAccessPerson,
  type ReportingAccessLevel,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

const superAdminTabs = ['presets', 'users', 'reporting-access', 'scoped-admins', 'global-roles', 'audit'];
const scopedAdminTabs = ['reporting-access'];
const machineTypeMeta: Array<{ key: MachineType; label: string }> = [
  { key: 'commercial', label: 'Commercial' },
  { key: 'mini', label: 'Mini' },
  { key: 'micro', label: 'Micro' },
];
const emptyQuantities: Record<MachineType, number> = { commercial: 0, mini: 0, micro: 0 };
const accessLevels: ReportingAccessLevel[] = ['viewer', 'report_manager'];

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPresetExpiryDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
};

const parseExpiryDateEndOfDay = (value: string): Date | null => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const formatAccessSource = (account: AdminAccountSummary) => {
  switch (account.plus_access_source) {
    case 'paid_subscription':
      return 'Paid Plus';
    case 'free_grant':
      return 'Plus Customer access';
    case 'admin':
      return 'Super-admin override';
    default:
      return 'No Plus access';
  }
};

const formatFreeGrant = (account: AdminAccountSummary) => {
  if (!account.plus_grant_id) return 'none';
  const expiry = formatDate(account.plus_grant_expires_at);
  return account.plus_grant_active ? `active until ${expiry}` : `expired ${expiry}`;
};

const isMachineGrant = (grant: AdminReportingAccessGrant) =>
  grant.scopeType === 'machine' && Boolean(grant.machineId);

const mergePeople = (
  matrixPeople: AdminReportingAccessPerson[],
  localPeople: AdminReportingAccessPerson[]
) => {
  const byUserId = new Map<string, AdminReportingAccessPerson>();
  [...localPeople, ...matrixPeople].forEach((person) => byUserId.set(person.userId, person));
  return [...byUserId.values()].sort((left, right) => {
    if (left.isSuperAdmin !== right.isSuperAdmin) return left.isSuperAdmin ? -1 : 1;
    return (left.userEmail ?? left.userId).localeCompare(right.userEmail ?? right.userId);
  });
};

const groupMachines = (machines: AdminReportingAccessMachine[]) => {
  const groups = new Map<string, AdminReportingAccessMachine[]>();
  machines.forEach((machine) => {
    const key = machine.accountName;
    groups.set(key, [...(groups.get(key) ?? []), machine]);
  });

  return [...groups.entries()].map(([key, values]) => ({ key, accountName: key, machines: values }));
};

const uniqueValues = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

const roleSort = (a: AdminRoleRecord, b: AdminRoleRecord) => {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
};

export default function AdminAccessPage() {
  const { isScopedAdmin, isSuperAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const availableTabs = isSuperAdmin ? superAdminTabs : scopedAdminTabs;
  const defaultTab = isSuperAdmin ? 'presets' : 'reporting-access';
  const activeTab = availableTabs.includes(searchParams.get('tab') ?? '')
    ? (searchParams.get('tab') as string)
    : defaultTab;

  const setActiveTab = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                Access
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {isSuperAdmin
                  ? 'Manage users, Plus access, global roles, scoped admins, and explicit machine-level reporting visibility from one place.'
                  : 'Manage reporting visibility for the machines included in your scoped admin grant.'}
              </p>
              {isScopedAdmin && !isSuperAdmin && (
                <Badge className="mt-3" variant="secondary">
                  Scoped Admin
                </Badge>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
            <TabsList className="h-auto flex-wrap justify-start">
              {isSuperAdmin && <TabsTrigger value="presets">Presets</TabsTrigger>}
              {isSuperAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
              <TabsTrigger value="reporting-access">Reporting Access</TabsTrigger>
              {isSuperAdmin && <TabsTrigger value="scoped-admins">Scoped Admins</TabsTrigger>}
              {isSuperAdmin && <TabsTrigger value="global-roles">Global Roles</TabsTrigger>}
              {isSuperAdmin && <TabsTrigger value="audit">Audit</TabsTrigger>}
            </TabsList>

            {isSuperAdmin && (
              <TabsContent value="presets" className="mt-6">
                <PresetsTab />
              </TabsContent>
            )}
            {isSuperAdmin && (
              <TabsContent value="users" className="mt-6">
                <UsersTab />
              </TabsContent>
            )}
            <TabsContent value="reporting-access" className="mt-6">
              <ReportingAccessTab />
            </TabsContent>
            {isSuperAdmin && (
              <TabsContent value="scoped-admins" className="mt-6">
                <ScopedAdminsTab />
              </TabsContent>
            )}
            {isSuperAdmin && (
              <TabsContent value="global-roles" className="mt-6">
                <GlobalRolesTab />
              </TabsContent>
            )}
            {isSuperAdmin && (
              <TabsContent value="audit" className="mt-6">
                <AuditTab />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </section>
    </AppLayout>
  );
}

function PresetsTab() {
  const queryClient = useQueryClient();
  const [personEmail, setPersonEmail] = useState('');
  const [effectiveAccess, setEffectiveAccess] = useState<EffectiveAccessContext | null>(null);
  const [isLoadingEffectiveAccess, setIsLoadingEffectiveAccess] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [portalReason, setPortalReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isGrantingCorporatePartner, setIsGrantingCorporatePartner] = useState(false);
  const [updatingPartyId, setUpdatingPartyId] = useState<string | null>(null);
  const [revokingMembershipId, setRevokingMembershipId] = useState<string | null>(null);

  const {
    data: corporateOptions = { partners: [] },
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-corporate-partner-access-options'],
    queryFn: fetchAdminCorporatePartnerAccessOptions,
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!selectedPartnerId && corporateOptions.partners.length > 0) {
      setSelectedPartnerId(corporateOptions.partners[0].partnerId);
    }
  }, [corporateOptions.partners, selectedPartnerId]);

  const selectedPartner =
    corporateOptions.partners.find((partner) => partner.partnerId === selectedPartnerId) ??
    corporateOptions.partners[0] ??
    null;
  const portalEnabledPartnerships =
    selectedPartner?.portalPartnerships.filter((partnership) => partnership.portalAccessEnabled) ??
    [];
  const derivedMachineIds = new Set(
    portalEnabledPartnerships.flatMap((partnership) =>
      partnership.machines.map((machine) => machine.machineId)
    )
  );

  const refreshCorporatePartnerOptions = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['admin-corporate-partner-access-options'],
    });
  };

  const loadEffectiveAccess = async () => {
    if (!personEmail.trim()) {
      toast.error('Enter an email to preview access.');
      return;
    }

    setIsLoadingEffectiveAccess(true);
    try {
      const accessContext = await fetchAdminEffectiveAccessContext(personEmail);
      setEffectiveAccess(accessContext);
      setGrantEmail(accessContext.email ?? personEmail.trim());
    } catch (lookupError) {
      toast.error(
        lookupError instanceof Error ? lookupError.message : 'Unable to load effective access.'
      );
    } finally {
      setIsLoadingEffectiveAccess(false);
    }
  };

  const reloadPreviewedEffectiveAccess = async (fallbackEmail?: string) => {
    const email = effectiveAccess?.email ?? fallbackEmail ?? personEmail.trim();
    if (!email) return;

    try {
      setEffectiveAccess(await fetchAdminEffectiveAccessContext(email));
    } catch {
      // Keep the grant/revoke result visible even if the preview refresh misses.
    }
  };

  const grantCorporatePartner = async () => {
    const targetEmail = grantEmail.trim();

    if (!targetEmail) {
      toast.error('Enter the Corporate Partner member email.');
      return;
    }
    if (!selectedPartner) {
      toast.error('Select a partner record.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }

    setIsGrantingCorporatePartner(true);
    try {
      await grantCorporatePartnerMembership({
        email: targetEmail,
        partnerId: selectedPartner.partnerId,
        reason: grantReason,
      });
      toast.success('Corporate Partner access saved.');
      setPersonEmail(targetEmail);
      setGrantEmail(targetEmail);
      setGrantReason('');
      await refreshCorporatePartnerOptions();
      await reloadPreviewedEffectiveAccess(targetEmail);
    } catch (grantError) {
      toast.error(
        grantError instanceof Error ? grantError.message : 'Unable to grant Corporate Partner access.'
      );
    } finally {
      setIsGrantingCorporatePartner(false);
    }
  };

  const updatePortalAccess = async (partyId: string, enabled: boolean) => {
    if (!portalReason.trim()) {
      toast.error('Enter a reason before changing portal access.');
      return;
    }

    setUpdatingPartyId(partyId);
    try {
      await setPartnershipPartyPortalAccess({
        partyId,
        enabled,
        reason: portalReason,
      });
      toast.success('Partnership portal access updated.');
      await refreshCorporatePartnerOptions();
      await reloadPreviewedEffectiveAccess();
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Unable to update access.');
    } finally {
      setUpdatingPartyId(null);
    }
  };

  const revokeCorporatePartner = async (membershipId: string) => {
    const reason = revokeReasons[membershipId]?.trim() ?? '';
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingMembershipId(membershipId);
    try {
      await revokeCorporatePartnerMembership({ membershipId, reason });
      toast.success('Corporate Partner access revoked.');
      setRevokeReasons((current) => ({ ...current, [membershipId]: '' }));
      await refreshCorporatePartnerOptions();
      await reloadPreviewedEffectiveAccess();
    } catch (revokeError) {
      toast.error(
        revokeError instanceof Error ? revokeError.message : 'Unable to revoke Corporate Partner access.'
      );
    } finally {
      setRevokingMembershipId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="effective-access-email">Person</Label>
              <Input
                id="effective-access-email"
                type="email"
                value={personEmail}
                onChange={(event) => setPersonEmail(event.target.value)}
                placeholder="name@example.com"
                className="mt-2"
              />
            </div>
            <Button onClick={loadEffectiveAccess} disabled={isLoadingEffectiveAccess}>
              {isLoadingEffectiveAccess ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Preview
            </Button>
          </div>

          <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
            {!effectiveAccess ? (
              <p className="text-sm text-muted-foreground">
                Search a user or email to preview presets, capabilities, scopes, expiry, and warnings
                before granting or revoking access.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {effectiveAccess.email ?? personEmail}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {effectiveAccess.userId ?? 'No auth user yet'}
                  </p>
                </div>
                <AccessBadgeGroup title="Presets" values={effectiveAccess.presets} />
                <AccessBadgeGroup title="Capabilities" values={effectiveAccess.capabilities} />
                <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Partnerships</p>
                    <p className="mt-1 text-xl font-semibold">
                      {effectiveAccess.scopes.partnershipIds?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Machines</p>
                    <p className="mt-1 text-xl font-semibold">
                      {effectiveAccess.scopes.machineIds?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Partner machines</p>
                    <p className="mt-1 text-xl font-semibold">
                      {effectiveAccess.scopes.corporatePartnerMachineIds?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Technician machines</p>
                    <p className="mt-1 text-xl font-semibold">
                      {effectiveAccess.scopes.technicianMachineIds?.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Admin machines</p>
                    <p className="mt-1 text-xl font-semibold">
                      {effectiveAccess.scopes.scopedAdminMachineIds?.length ?? 0}
                    </p>
                  </div>
                </div>
                {effectiveAccess.warnings.length > 0 && (
                  <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-foreground">
                    {effectiveAccess.warnings.join(' ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Corporate Partner preset</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Grants training, support, member supply pricing, partner reporting, machine
                reporting, and Technician management for portal-enabled partnerships.
              </p>
            </div>
            <Button variant="outline" onClick={refreshCorporatePartnerOptions} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Unable to load Corporate Partner options.
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[0.45fr_0.55fr]">
            <div className="space-y-3">
              <div>
                <Label htmlFor="corporate-partner-select">Partner record</Label>
                <select
                  id="corporate-partner-select"
                  value={selectedPartner?.partnerId ?? ''}
                  onChange={(event) => setSelectedPartnerId(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={isLoading || corporateOptions.partners.length === 0}
                >
                  {corporateOptions.partners.map((partner) => (
                    <option key={partner.partnerId} value={partner.partnerId}>
                      {partner.partnerName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="corporate-partner-email">Member email</Label>
                <Input
                  id="corporate-partner-email"
                  type="email"
                  value={grantEmail}
                  onChange={(event) => setGrantEmail(event.target.value)}
                  placeholder="partner@example.com"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="corporate-partner-reason">Grant reason</Label>
                <Input
                  id="corporate-partner-reason"
                  value={grantReason}
                  onChange={(event) => setGrantReason(event.target.value)}
                  placeholder="Required reason"
                  className="mt-2"
                />
              </div>
              <Button
                onClick={grantCorporatePartner}
                disabled={isGrantingCorporatePartner || !selectedPartner}
              >
                {isGrantingCorporatePartner ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Grant Corporate Partner
              </Button>
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-3">
              <h3 className="text-sm font-semibold text-foreground">Save preview</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This will give access to {portalEnabledPartnerships.length} active
                portal-enabled partnership{portalEnabledPartnerships.length === 1 ? '' : 's'} and{' '}
                {derivedMachineIds.size} derived machine{derivedMachineIds.size === 1 ? '' : 's'}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  'Training',
                  'Support',
                  'Member supply pricing',
                  'Partner reporting',
                  'Machine reporting',
                  'Technician management',
                ].map((capability) => (
                  <Badge key={capability} variant="outline">
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedPartner && (
        <div className="grid gap-6 xl:grid-cols-[0.52fr_0.48fr]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold text-foreground">Portal-enabled partnerships</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Corporate Partner reporting uses active partnership parties with portal access enabled.
            </p>
            <div className="mt-3">
              <Label htmlFor="portal-access-reason">Reason for portal-access changes</Label>
              <Input
                id="portal-access-reason"
                value={portalReason}
                onChange={(event) => setPortalReason(event.target.value)}
                placeholder="Required before toggling access"
                className="mt-2"
              />
            </div>
            <div className="mt-4 divide-y divide-border rounded-md border border-border">
              {selectedPartner.portalPartnerships.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No active partnerships are linked to this partner record.
                </p>
              ) : (
                selectedPartner.portalPartnerships.map((partnership) => (
                  <label
                    key={partnership.partyId}
                    className="flex cursor-pointer items-start gap-3 p-3"
                  >
                    <Checkbox
                      checked={partnership.portalAccessEnabled}
                      disabled={updatingPartyId === partnership.partyId}
                      onCheckedChange={(checked) =>
                        void updatePortalAccess(partnership.partyId, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {partnership.partnershipName}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {partnership.machineCount} active machine
                        {partnership.machineCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold text-foreground">Current Corporate Partner members</h3>
            <div className="mt-4 space-y-3">
              {selectedPartner.memberships.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  No Corporate Partner members have been granted for this partner yet.
                </p>
              ) : (
                selectedPartner.memberships.map((membership) => (
                  <div key={membership.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {membership.memberEmail}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {membership.isActive ? 'Active' : membership.status} /{' '}
                          {membership.grantReason}
                        </p>
                      </div>
                      <Badge variant={membership.isActive ? 'default' : 'outline'}>
                        {membership.status}
                      </Badge>
                    </div>
                    {membership.isActive && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={revokeReasons[membership.id] ?? ''}
                          onChange={(event) =>
                            setRevokeReasons((current) => ({
                              ...current,
                              [membership.id]: event.target.value,
                            }))
                          }
                          placeholder="Required revoke reason"
                        />
                        <Button
                          variant="outline"
                          disabled={revokingMembershipId === membership.id}
                          onClick={() => void revokeCorporatePartner(membership.id)}
                        >
                          {revokingMembershipId === membership.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Revoke
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessBadgeGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.length === 0 ? (
          <Badge variant="outline">None</Badge>
        ) : (
          values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<MachineType, number>>(emptyQuantities);
  const [updateReason, setUpdateReason] = useState('');
  const [grantExpiryDate, setGrantExpiryDate] = useState(() => getPresetExpiryDate(90));
  const [grantReason, setGrantReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [isSavingInventory, setIsSavingInventory] = useState(false);
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [isRevokingGrant, setIsRevokingGrant] = useState(false);

  const {
    data: accounts = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-account-summaries', search],
    queryFn: () => fetchAdminAccountSummaries(search),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (!selectedUserId && accounts.length > 0) {
      setSelectedUserId(accounts[0].user_id);
      return;
    }
    if (selectedUserId && !accounts.find((account) => account.user_id === selectedUserId)) {
      setSelectedUserId(accounts[0]?.user_id ?? null);
    }
  }, [accounts, selectedUserId]);

  const selectedAccount = accounts.find((account) => account.user_id === selectedUserId) ?? null;
  const paidSubscriptionBlocksGrant = Boolean(
    selectedAccount?.paid_subscription_active && !selectedAccount.membership_cancel_at_period_end
  );

  const {
    data: machineInventory = [],
    isFetching: inventoryFetching,
    error: inventoryError,
  } = useQuery({
    queryKey: ['admin-account-machine-inventory', selectedUserId],
    queryFn: () => fetchMachineInventoryForAccount(selectedUserId as string),
    enabled: Boolean(selectedUserId),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    const nextQuantities = { ...emptyQuantities };
    machineInventory.forEach((entry) => {
      nextQuantities[entry.machine_type] = entry.quantity;
    });
    setQuantities(nextQuantities);
    setUpdateReason('');
    setGrantReason('');
    setRevokeReason('');
    setGrantExpiryDate(getPresetExpiryDate(90));
  }, [machineInventory, selectedUserId]);

  const refreshAccounts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-account-summaries'] });
    if (selectedUserId) {
      await queryClient.invalidateQueries({
        queryKey: ['admin-account-machine-inventory', selectedUserId],
      });
    }
  };

  const updateQuantity = (machineType: MachineType, value: string) => {
    const parsed = Number(value);
    const nextValue = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setQuantities((prev) => ({ ...prev, [machineType]: nextValue }));
  };

  const saveMachineCounts = async () => {
    if (!selectedAccount) return;
    if (!updateReason.trim()) {
      toast.error('Update reason is required.');
      return;
    }

    setIsSavingInventory(true);
    try {
      for (const type of machineTypeMeta) {
        await upsertMachineInventoryAdmin({
          customerUserId: selectedAccount.user_id,
          machineType: type.key,
          quantity: quantities[type.key],
          updatedReason: updateReason.trim(),
        });
      }
      trackEvent('admin_machine_inventory_updated', {
        user_id: selectedAccount.user_id,
        total_machine_count: quantities.commercial + quantities.mini + quantities.micro,
      });
      toast.success('Machine counts updated.');
      setUpdateReason('');
      await refreshAccounts();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to update counts.');
    } finally {
      setIsSavingInventory(false);
    }
  };

  const savePlusGrant = async () => {
    if (!selectedAccount) return;
    if (paidSubscriptionBlocksGrant) {
      toast.error('Cancel or schedule cancellation for the paid Stripe subscription first.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }
    const expiry = parseExpiryDateEndOfDay(grantExpiryDate);
    if (!expiry || expiry <= new Date()) {
      toast.error('Grant expiry must be a future date.');
      return;
    }

    setIsSavingGrant(true);
    try {
      await grantPlusAccessAdmin({
        customerUserId: selectedAccount.user_id,
        expiresAt: expiry.toISOString(),
        reason: grantReason.trim(),
      });
      toast.success(
        selectedAccount.plus_grant_id
          ? 'Plus Customer access updated.'
          : 'Plus Customer access granted.'
      );
      setGrantReason('');
      await refreshAccounts();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to grant Plus access.');
    } finally {
      setIsSavingGrant(false);
    }
  };

  const revokePlusGrant = async () => {
    if (!selectedAccount?.plus_grant_id) return;
    if (!revokeReason.trim()) {
      toast.error('Revoke reason is required.');
      return;
    }

    setIsRevokingGrant(true);
    try {
      await revokePlusAccessAdmin({
        grantId: selectedAccount.plus_grant_id,
        reason: revokeReason.trim(),
      });
      toast.success('Plus Customer access revoked.');
      setRevokeReason('');
      await refreshAccounts();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke Plus access.');
    } finally {
      setIsRevokingGrant(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-md sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by account email or user ID"
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={refreshAccounts} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load account summaries.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plus Access</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Orders</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machines</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading users...
                  </td>
                </tr>
              )}
              {!isLoading && accounts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
              {!isLoading &&
                accounts.map((account) => (
                  <tr
                    key={account.user_id}
                    className={cn(
                      'cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40',
                      account.user_id === selectedUserId && 'bg-muted/50'
                    )}
                    onClick={() => setSelectedUserId(account.user_id)}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="text-sm font-medium text-foreground">
                        {account.customer_email || 'No email on file'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{account.user_id}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-foreground">{formatAccessSource(account)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatFreeGrant(account)}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{account.total_orders}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{account.total_machine_count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          {!selectedAccount ? (
            <div className="text-sm text-muted-foreground">Select a user to manage account access.</div>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-foreground">
                  {selectedAccount.customer_email || selectedAccount.user_id}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{selectedAccount.user_id}</p>
              </div>

              <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Paid subscription</span>
                  <span className="font-medium text-foreground">{selectedAccount.membership_status ?? 'none'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Effective Plus access</span>
                  <span className="font-medium text-foreground">{formatAccessSource(selectedAccount)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Last order</span>
                  <span className="text-foreground">{formatDate(selectedAccount.last_order_at)}</span>
                </div>
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold text-foreground">Plus Customer Access</h3>
                {paidSubscriptionBlocksGrant && (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    This user has an active paid Stripe subscription.
                  </div>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="grant-expiry">Grant expiry</Label>
                    <Input
                      id="grant-expiry"
                      type="date"
                      value={grantExpiryDate}
                      onChange={(event) => setGrantExpiryDate(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="grant-reason">Grant reason</Label>
                    <Input
                      id="grant-reason"
                      value={grantReason}
                      onChange={(event) => setGrantReason(event.target.value)}
                      placeholder="Required reason"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[30, 90, 180, 365].map((days) => (
                    <Button
                      key={days}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setGrantExpiryDate(getPresetExpiryDate(days))}
                    >
                      {days === 365 ? '1 year' : `${days} days`}
                    </Button>
                  ))}
                  <Button onClick={savePlusGrant} disabled={isSavingGrant || paidSubscriptionBlocksGrant}>
                    {isSavingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {selectedAccount.plus_grant_id
                      ? 'Extend Plus Customer'
                      : 'Grant Plus Customer'}
                  </Button>
                </div>

                {selectedAccount.plus_grant_id && (
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <Label htmlFor="revoke-plus">Revoke reason</Label>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="revoke-plus"
                        value={revokeReason}
                        onChange={(event) => setRevokeReason(event.target.value)}
                        placeholder="Required reason"
                      />
                      <Button variant="outline" onClick={revokePlusGrant} disabled={isRevokingGrant}>
                        {isRevokingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Revoke
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold text-foreground">Customer Machine Counts</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Count records are customer context only. They do not grant reporting access.
                </p>
                {inventoryError && (
                  <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    Unable to load machine inventory.
                  </div>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {machineTypeMeta.map((machineType) => (
                    <div key={machineType.key}>
                      <Label htmlFor={`count-${machineType.key}`}>{machineType.label}</Label>
                      <Input
                        id={`count-${machineType.key}`}
                        type="number"
                        min={0}
                        value={quantities[machineType.key]}
                        onChange={(event) => updateQuantity(machineType.key, event.target.value)}
                        disabled={inventoryFetching}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Label htmlFor="machine-count-reason">Update reason</Label>
                  <Input
                    id="machine-count-reason"
                    value={updateReason}
                    onChange={(event) => setUpdateReason(event.target.value)}
                    placeholder="Required reason for count changes"
                  />
                </div>
                <Button className="mt-3" onClick={saveMachineCounts} disabled={isSavingInventory || inventoryFetching}>
                  {isSavingInventory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Machine Counts
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportingAccessTab() {
  const { isScopedAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [peopleSearch, setPeopleSearch] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [localPeople, setLocalPeople] = useState<AdminReportingAccessPerson[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [accessReason, setAccessReason] = useState('');
  const [accessLevel, setAccessLevel] = useState<ReportingAccessLevel>('viewer');
  const [isLookingUpUser, setIsLookingUpUser] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [machineSearch, setMachineSearch] = useState('');

  const {
    data: matrix = { people: [], machines: [], grants: [] },
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-reporting-access-matrix'],
    queryFn: fetchAdminReportingAccessMatrix,
    staleTime: 1000 * 30,
  });

  const people = useMemo(() => mergePeople(matrix.people, localPeople), [localPeople, matrix.people]);
  const selectedPerson = people.find((person) => person.userId === selectedUserId) ?? null;

  const selectedMachineGrantByMachineId = useMemo(() => {
    const grantMap = new Map<string, AdminReportingAccessGrant>();
    matrix.grants
      .filter((grant) => grant.userId === selectedUserId && isMachineGrant(grant))
      .forEach((grant) => {
        if (grant.machineId) grantMap.set(grant.machineId, grant);
      });
    return grantMap;
  }, [matrix.grants, selectedUserId]);

  const originalMachineIds = useMemo(
    () => new Set(selectedMachineGrantByMachineId.keys()),
    [selectedMachineGrantByMachineId]
  );

  useEffect(() => {
    if (!selectedUserId && people.length > 0) {
      setSelectedUserId(people[0].userId);
    }
  }, [people, selectedUserId]);

  useEffect(() => {
    setSelectedMachineIds(new Set(originalMachineIds));
    setAccessReason('');
  }, [originalMachineIds, selectedUserId]);

  const filteredPeople = useMemo(() => {
    const search = normalizeSearch(peopleSearch);
    if (!search) return people;
    return people.filter((person) =>
      `${person.userEmail ?? ''} ${person.userId}`.toLowerCase().includes(search)
    );
  }, [people, peopleSearch]);

  const filteredMachines = useMemo(() => {
    const search = normalizeSearch(machineSearch);
    if (!search) return matrix.machines;
    return matrix.machines.filter((machine) =>
      [machine.machineLabel, machine.sunzeMachineId ?? '', machine.accountName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [machineSearch, matrix.machines]);

  const groupedMachines = useMemo(() => groupMachines(filteredMachines), [filteredMachines]);
  const addedMachineIds = [...selectedMachineIds].filter((id) => !originalMachineIds.has(id));
  const removedMachineIds = [...originalMachineIds].filter((id) => !selectedMachineIds.has(id));
  const hasAccessChanges = addedMachineIds.length > 0 || removedMachineIds.length > 0;

  const lookupUser = async () => {
    if (!lookupEmail.trim()) {
      toast.error('User email is required.');
      return;
    }

    setIsLookingUpUser(true);
    try {
      const person = await lookupReportingUserByEmailAdmin(lookupEmail);
      setLocalPeople((current) => mergePeople([person], current));
      setSelectedUserId(person.userId);
      setLookupEmail('');
      toast.success('User loaded.');
    } catch (lookupError) {
      toast.error(lookupError instanceof Error ? lookupError.message : 'Unable to find user.');
    } finally {
      setIsLookingUpUser(false);
    }
  };

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (checked) next.add(machineId);
      else next.delete(machineId);
      return next;
    });
  };

  const saveAccessChanges = async () => {
    if (!selectedPerson?.userEmail) {
      toast.error('Select a user with an email before saving.');
      return;
    }
    if (selectedPerson.isSuperAdmin) {
      toast.error('Super-admin reporting access is managed from Global Roles.');
      return;
    }
    if (!hasAccessChanges) {
      toast.info('No reporting access changes to save.');
      return;
    }
    if (!accessReason.trim()) {
      toast.error('Reason is required.');
      return;
    }

    setIsSavingAccess(true);
    try {
      await setUserMachineReportingAccessAdmin({
        userEmail: selectedPerson.userEmail as string,
        machineIds: [...selectedMachineIds],
        accessLevel,
        reason: accessReason.trim(),
      });

      trackEvent('admin_reporting_access_matrix_saved', {
        user_id: selectedPerson.userId,
        added_count: addedMachineIds.length,
        removed_count: removedMachineIds.length,
      });
      toast.success('Reporting access saved.');
      setAccessReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] });
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save reporting access.');
    } finally {
      setIsSavingAccess(false);
    }
  };

  return (
    <div className="space-y-4">
      {isScopedAdmin && !isSuperAdmin && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          Your scoped admin grant limits this matrix to assigned machines. Saving changes only
          affects manual reporting grants inside that scope.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <Label htmlFor="reporting-user-email">Add existing user by email</Label>
            <Input
              id="reporting-user-email"
              type="email"
              value={lookupEmail}
              onChange={(event) => setLookupEmail(event.target.value)}
              placeholder="adam@example.com"
            />
          </div>
          <Button onClick={lookupUser} disabled={isLookingUpUser}>
            {isLookingUpUser ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Load User
          </Button>
          <Button
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] })}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Unable to load reporting access.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <Label htmlFor="people-search">People</Label>
            <Input
              id="people-search"
              value={peopleSearch}
              onChange={(event) => setPeopleSearch(event.target.value)}
              placeholder="Search people"
            />
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading people...</div>}
            {!isLoading && filteredPeople.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">Load a user by email to manage access.</div>
            )}
            {filteredPeople.map((person) => (
              <button
                key={person.userId}
                type="button"
                onClick={() => setSelectedUserId(person.userId)}
                className={cn(
                  'block w-full border-b border-border/70 p-4 text-left transition hover:bg-muted/40',
                  selectedUserId === person.userId && 'bg-muted/50'
                )}
              >
                <div className="font-medium text-foreground">{person.userEmail ?? person.userId}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {person.isSuperAdmin && <Badge variant="secondary">Super-admin</Badge>}
                  <Badge variant="outline">{person.explicitMachineCount} machine grants</Badge>
                  {!person.isSuperAdmin && person.explicitMachineCount === 0 && (
                    <Badge variant="destructive">No machine grants</Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          {!selectedPerson ? (
            <div className="p-6 text-sm text-muted-foreground">Select a user to manage machine access.</div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="font-semibold text-foreground">
                    {selectedPerson.userEmail ?? selectedPerson.userId}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedPerson.userId}</p>
                  {selectedPerson.isSuperAdmin && (
                    <Badge className="mt-2" variant="secondary">
                      All machines via super-admin
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selectedMachineIds.size} selected</Badge>
                  <Badge variant={hasAccessChanges ? 'default' : 'outline'}>
                    +{addedMachineIds.length} / -{removedMachineIds.length}
                  </Badge>
                </div>
              </div>

              {selectedPerson.isSuperAdmin ? (
                <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Super-admins have implicit reporting access to all machines. Use the Global Roles
                  tab to grant or revoke that global role.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-[0.5fr_1fr_auto]">
                    <div>
                      <Label htmlFor="access-level">New grant level</Label>
                      <select
                        id="access-level"
                        value={accessLevel}
                        onChange={(event) => setAccessLevel(event.target.value as ReportingAccessLevel)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {accessLevels.map((level) => (
                          <option key={level} value={level}>
                            {level === 'report_manager' ? 'Report manager' : 'Viewer'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="access-reason">Reason</Label>
                      <Input
                        id="access-reason"
                        value={accessReason}
                        onChange={(event) => setAccessReason(event.target.value)}
                        placeholder="Required reason for access changes"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={saveAccessChanges} disabled={isSavingAccess || !hasAccessChanges}>
                        {isSavingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Save Access
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="machine-search">Machines</Label>
                    <Input
                      id="machine-search"
                      value={machineSearch}
                      onChange={(event) => setMachineSearch(event.target.value)}
                      placeholder="Filter by label, external machine ID, or account"
                    />
                  </div>

                  <div className="max-h-[520px] overflow-y-auto rounded-md border border-border">
                    {groupedMachines.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">No machines found.</div>
                    ) : (
                      groupedMachines.map((group) => (
                        <div key={group.key} className="border-b border-border last:border-b-0">
                          <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.accountName}
                          </div>
                          {group.machines.map((machine) => (
                            <label
                              key={machine.id}
                              className="flex cursor-pointer items-start gap-3 border-b border-border/60 p-3 last:border-b-0"
                            >
                              <Checkbox
                                checked={selectedMachineIds.has(machine.id)}
                                onCheckedChange={(checked) => toggleMachine(machine.id, Boolean(checked))}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-foreground">{machine.machineLabel}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  External machine ID: {machine.sunzeMachineId ?? 'n/a'} / Viewers: {machine.viewerCount}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function scopedGrantSort(a: ScopedAdminGrantRecord, b: ScopedAdminGrantRecord) {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime();
}

function ScopedAdminsTab() {
  const queryClient = useQueryClient();
  const [grantEmail, setGrantEmail] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [machineSearch, setMachineSearch] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  const {
    data: matrix = { people: [], machines: [], grants: [] },
    isLoading: machinesLoading,
    error: machinesError,
  } = useQuery({
    queryKey: ['admin-reporting-access-matrix'],
    queryFn: fetchAdminReportingAccessMatrix,
    staleTime: 1000 * 30,
  });

  const {
    data: grants = [],
    isLoading: grantsLoading,
    isFetching: grantsFetching,
    error: grantsError,
  } = useQuery({
    queryKey: ['admin-scoped-admin-grants'],
    queryFn: fetchScopedAdminGrants,
    staleTime: 1000 * 30,
  });

  const filteredMachines = useMemo(() => {
    const search = normalizeSearch(machineSearch);
    if (!search) return matrix.machines;
    return matrix.machines.filter((machine) =>
      [machine.machineLabel, machine.sunzeMachineId ?? '', machine.accountName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [machineSearch, matrix.machines]);

  const groupedMachines = useMemo(() => groupMachines(filteredMachines), [filteredMachines]);
  const sortedGrants = useMemo(() => [...grants].sort(scopedGrantSort), [grants]);

  const refreshScopedAdmins = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-scoped-admin-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] }),
    ]);
  };

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);
      if (checked) next.add(machineId);
      else next.delete(machineId);
      return next;
    });
  };

  const loadGrantForEditing = (grant: ScopedAdminGrantRecord) => {
    setGrantEmail(grant.userEmail ?? '');
    setGrantReason(grant.grantReason);
    setSelectedMachineIds(
      new Set(
        grant.scopes
          .filter((scope) => scope.active && scope.scopeType === 'machine' && scope.machineId)
          .map((scope) => scope.machineId as string)
      )
    );
  };

  const handleGrantScopedAdmin = async () => {
    if (!grantEmail.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }
    if (selectedMachineIds.size === 0) {
      toast.error('Select at least one machine scope.');
      return;
    }

    setIsSavingGrant(true);
    try {
      await grantScopedAdminByEmail({
        targetEmail: grantEmail.trim(),
        machineIds: [...selectedMachineIds],
        reason: grantReason.trim(),
      });
      trackEvent('admin_role_granted', {
        target_email: grantEmail.trim(),
        role: 'scoped_admin',
        machine_count: selectedMachineIds.size,
      });
      toast.success('Scoped admin grant saved.');
      setGrantEmail('');
      setGrantReason('');
      setSelectedMachineIds(new Set());
      await refreshScopedAdmins();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to save scoped admin.');
    } finally {
      setIsSavingGrant(false);
    }
  };

  const handleRevokeScopedAdmin = async (grant: ScopedAdminGrantRecord) => {
    const reason = revokeReasons[grant.id]?.trim();
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingGrantId(grant.id);
    try {
      await revokeScopedAdmin({ grantId: grant.id, reason });
      trackEvent('admin_role_revoked', {
        target_user_id: grant.userId,
        role: 'scoped_admin',
      });
      toast.success('Scoped admin revoked.');
      setRevokeReasons((current) => ({ ...current, [grant.id]: '' }));
      await refreshScopedAdmins();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke scoped admin.');
    } finally {
      setRevokingGrantId(null);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold text-foreground">Grant Scoped Admin</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scoped Admin can open Admin Access and manage manual reporting grants for selected
            machines only.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="scoped-admin-email">Email</Label>
            <Input
              id="scoped-admin-email"
              type="email"
              value={grantEmail}
              onChange={(event) => setGrantEmail(event.target.value)}
              placeholder="admin@company.com"
            />
          </div>
          <div>
            <Label htmlFor="scoped-admin-reason">Grant reason</Label>
            <Input
              id="scoped-admin-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Required reason"
            />
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex-1">
              <Label htmlFor="scoped-admin-machine-search">Machine scope</Label>
              <Input
                id="scoped-admin-machine-search"
                value={machineSearch}
                onChange={(event) => setMachineSearch(event.target.value)}
                placeholder="Filter machines"
              />
            </div>
            <Badge variant="outline">{selectedMachineIds.size} selected</Badge>
          </div>

          {machinesError && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load machines.
            </div>
          )}

          <div className="mt-3 max-h-[440px] overflow-y-auto rounded-md border border-border">
            {machinesLoading && (
              <div className="p-4 text-sm text-muted-foreground">Loading machines...</div>
            )}
            {!machinesLoading && groupedMachines.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">No machines found.</div>
            )}
            {groupedMachines.map((group) => (
              <div key={group.key} className="border-b border-border last:border-b-0">
                <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.accountName}
                </div>
                {group.machines.map((machine) => (
                  <label
                    key={machine.id}
                    className="flex cursor-pointer items-start gap-3 border-b border-border/60 p-3 last:border-b-0"
                  >
                    <Checkbox
                      checked={selectedMachineIds.has(machine.id)}
                      onCheckedChange={(checked) => toggleMachine(machine.id, Boolean(checked))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">{machine.machineLabel}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {machine.accountName} / external ID {machine.sunzeMachineId ?? 'n/a'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleGrantScopedAdmin} disabled={isSavingGrant}>
          {isSavingGrant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Save Scoped Admin
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">Current Scoped Admins</h2>
          <Button variant="outline" size="sm" onClick={refreshScopedAdmins} disabled={grantsFetching}>
            {grantsFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {grantsError && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Unable to load scoped admins.
          </div>
        )}

        <div className="mt-4 space-y-3">
          {grantsLoading && <div className="text-sm text-muted-foreground">Loading scoped admins...</div>}
          {!grantsLoading && sortedGrants.length === 0 && (
            <div className="text-sm text-muted-foreground">No scoped admins found.</div>
          )}
          {sortedGrants.map((grant) => (
            <div key={grant.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">{grant.userEmail ?? grant.userId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{grant.userId}</div>
                </div>
                <Badge variant={grant.active ? 'default' : 'outline'}>{grant.active ? 'active' : 'revoked'}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">{grant.scopes.length} machine scopes</Badge>
                <Badge variant="outline">{grant.source}</Badge>
              </div>
              <div className="mt-3 max-h-28 overflow-y-auto rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                {grant.scopes.length === 0
                  ? 'No active scopes.'
                  : grant.scopes
                      .map((scope) => scope.machineLabel ?? scope.accountName ?? scope.id)
                      .join(', ')}
              </div>
              {grant.active && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={() => loadGrantForEditing(grant)}>
                      Edit Scopes
                    </Button>
                    <Input
                      value={revokeReasons[grant.id] ?? ''}
                      onChange={(event) =>
                        setRevokeReasons((prev) => ({ ...prev, [grant.id]: event.target.value }))
                      }
                      placeholder="Required revoke reason"
                    />
                    <Button
                      variant="outline"
                      onClick={() => handleRevokeScopedAdmin(grant)}
                      disabled={revokingGrantId === grant.id}
                    >
                      {revokingGrantId === grant.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Revoke
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GlobalRolesTab() {
  const queryClient = useQueryClient();
  const [grantEmail, setGrantEmail] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [isGranting, setIsGranting] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const {
    data: roles = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-governance-roles'],
    queryFn: fetchAdminRoles,
    staleTime: 1000 * 30,
  });

  const sortedRoles = useMemo(() => [...roles].sort(roleSort), [roles]);

  const refreshRoles = () => queryClient.invalidateQueries({ queryKey: ['admin-governance-roles'] });

  const handleGrant = async () => {
    if (!grantEmail.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!grantReason.trim()) {
      toast.error('Grant reason is required.');
      return;
    }

    setIsGranting(true);
    try {
      await grantSuperAdminByEmail(grantEmail.trim(), grantReason.trim());
      trackEvent('admin_role_granted', { target_email: grantEmail.trim() });
      toast.success('Super-admin role granted.');
      setGrantEmail('');
      setGrantReason('');
      await refreshRoles();
    } catch (grantError) {
      toast.error(grantError instanceof Error ? grantError.message : 'Unable to grant role.');
    } finally {
      setIsGranting(false);
    }
  };

  const handleRevoke = async (role: AdminRoleRecord) => {
    const reason = revokeReasons[role.user_id]?.trim();
    if (!reason) {
      toast.error('Revoke reason is required.');
      return;
    }

    setRevokingUserId(role.user_id);
    try {
      await revokeSuperAdmin(role.user_id, reason);
      trackEvent('admin_role_revoked', { target_user_id: role.user_id });
      toast.success('Super-admin role revoked.');
      setRevokeReasons((prev) => ({ ...prev, [role.user_id]: '' }));
      await refreshRoles();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Unable to revoke role.');
    } finally {
      setRevokingUserId(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Grant Super-Admin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Super-admin is global access across admin and reporting surfaces.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="super-admin-email">Email</Label>
            <Input
              id="super-admin-email"
              type="email"
              value={grantEmail}
              onChange={(event) => setGrantEmail(event.target.value)}
              placeholder="admin@company.com"
            />
          </div>
          <div>
            <Label htmlFor="super-admin-reason">Grant reason</Label>
            <Input
              id="super-admin-reason"
              value={grantReason}
              onChange={(event) => setGrantReason(event.target.value)}
              placeholder="Why this user needs global access"
            />
          </div>
          <Button onClick={handleGrant} disabled={isGranting}>
            {isGranting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Grant Super-Admin
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">Current Global Roles</h2>
          <Button variant="outline" size="sm" onClick={refreshRoles} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
        {error && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Unable to load roles.
          </div>
        )}
        <div className="mt-4 space-y-3">
          {isLoading && <div className="text-sm text-muted-foreground">Loading roles...</div>}
          {!isLoading && sortedRoles.length === 0 && (
            <div className="text-sm text-muted-foreground">No super-admin roles found.</div>
          )}
          {sortedRoles.map((role) => (
            <div key={role.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">{role.user_email ?? role.user_id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{role.user_id}</div>
                </div>
                <Badge variant={role.active ? 'default' : 'outline'}>{role.active ? 'active' : 'revoked'}</Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Granted: {formatDate(role.granted_at)}</div>
              {role.active && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={revokeReasons[role.user_id] ?? ''}
                    onChange={(event) =>
                      setRevokeReasons((prev) => ({ ...prev, [role.user_id]: event.target.value }))
                    }
                    placeholder="Required revoke reason"
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleRevoke(role)}
                    disabled={revokingUserId === role.user_id}
                  >
                    {revokingUserId === role.user_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Revoke
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditTab() {
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditEntityFilter, setAuditEntityFilter] = useState('all');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const {
    data: auditLog = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-governance-audit', auditSearch, auditActionFilter, auditEntityFilter],
    queryFn: () =>
      fetchAdminAuditLog({
        search: auditSearch,
        action: auditActionFilter === 'all' ? undefined : auditActionFilter,
        entityType: auditEntityFilter === 'all' ? undefined : auditEntityFilter,
        limit: 250,
      }),
    staleTime: 1000 * 20,
  });

  const selectedLog = auditLog.find((entry) => entry.id === selectedLogId) ?? null;
  const actionOptions = useMemo(() => uniqueValues(auditLog.map((entry) => entry.action)), [auditLog]);
  const entityOptions = useMemo(
    () => uniqueValues(auditLog.map((entry) => entry.entity_type)),
    [auditLog]
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-lg border border-border bg-card">
        <div className="space-y-3 border-b border-border p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value)}
              placeholder="Search audit log"
            />
            <select
              value={auditActionFilter}
              onChange={(event) => setAuditActionFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <select
              value={auditEntityFilter}
              onChange={(event) => setAuditEntityFilter(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All entities</option>
              {entityOptions.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </select>
          </div>
          {isFetching && <div className="text-xs text-muted-foreground">Refreshing audit log...</div>}
        </div>

        {error && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Unable to load audit log.
          </div>
        )}

        <div className="max-h-[640px] overflow-y-auto">
          {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading audit log...</div>}
          {!isLoading && auditLog.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No audit entries found.</div>
          )}
          {auditLog.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedLogId(entry.id)}
              className={cn(
                'block w-full border-b border-border/70 p-4 text-left transition hover:bg-muted/40',
                selectedLogId === entry.id && 'bg-muted/50'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="text-sm font-medium text-foreground">{entry.entity_type}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {formatDate(entry.created_at)} / actor: {entry.actor_email ?? entry.actor_user_id ?? 'system'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        {!selectedLog ? (
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            Select an audit row to inspect before/after details.
          </div>
        ) : (
          <AuditDetails entry={selectedLog} />
        )}
      </div>
    </div>
  );
}

function AuditDetails({ entry }: { entry: AdminAuditLogRecord }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-foreground">{entry.action}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.created_at)}</p>
      </div>
      <div className="grid gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Entity: </span>
          <span className="text-foreground">{entry.entity_type}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Actor: </span>
          <span className="text-foreground">{entry.actor_email ?? entry.actor_user_id ?? 'system'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Target: </span>
          <span className="text-foreground">{entry.target_email ?? entry.target_user_id ?? 'n/a'}</span>
        </div>
      </div>
      {(['before', 'after', 'meta'] as const).map((key) => (
        <div key={key}>
          <Label>{key}</Label>
          <Textarea
            readOnly
            value={JSON.stringify(entry[key] ?? {}, null, 2)}
            className="mt-1 min-h-36 font-mono text-xs"
          />
        </div>
      ))}
    </div>
  );
}

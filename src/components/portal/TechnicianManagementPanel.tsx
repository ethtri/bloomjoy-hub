import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Send,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { TechnicianMachineAssignmentPicker } from '@/components/technicians/TechnicianMachineAssignmentPicker';
import { formatTechnicianScopePreview } from '@/components/technicians/technicianMachineAssignmentCopy';
import { useAuth } from '@/contexts/auth-context';
import {
  fetchMyTechnicianGrants,
  fetchTechnicianManagementContext,
  grantTechnicianAccess,
  revokeTechnicianAccess,
  updateTechnicianMachines,
  type TechnicianGrant,
  type TechnicianGrantStatus,
  type TechnicianManagementMachine,
} from '@/lib/technicianEntitlements';
import {
  fetchMyOperatorTrainingGrants,
  revokeOperatorTrainingAccess,
  type OperatorTrainingGrant,
} from '@/lib/operatorTrainingAccess';
import {
  fetchAccessInviteDeliveries,
  sendAccessInvite,
  validateAccessInvitePreflight,
  type AccessInviteDelivery,
} from '@/lib/accessInvites';
import { cn } from '@/lib/utils';

const DEFAULT_TECHNICIAN_REASON = 'Technician access';
const DEFAULT_UPDATE_REASON = 'Technician machine assignments updated';
const DEFAULT_REVOKE_REASON = 'Technician no longer needs access';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatStatusLabel = (status: TechnicianGrantStatus) =>
  status
    .split('_')
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(' ');

const getStatusBadgeVariant = (status: TechnicianGrantStatus) => {
  if (status === 'active') return 'default';
  if (status === 'pending') return 'secondary';
  if (status === 'suspended') return 'outline';
  return 'destructive';
};

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const getLatestInviteDeliveryBySourceId = (deliveries: AccessInviteDelivery[]) => {
  const latestBySourceId = new Map<string, AccessInviteDelivery>();

  deliveries.forEach((delivery) => {
    if (!latestBySourceId.has(delivery.sourceId)) {
      latestBySourceId.set(delivery.sourceId, delivery);
    }
  });

  return latestBySourceId;
};

const formatInviteDeliverySummary = (delivery: AccessInviteDelivery | undefined) => {
  if (!delivery) return 'No invite email has been sent for this Technician yet.';

  return delivery.deliveryStatus === 'sent'
    ? `Last invite sent ${formatDateTime(delivery.sentAt)} to ${delivery.targetEmail}.`
    : `Last invite failed ${formatDateTime(delivery.sentAt)}${delivery.errorMessage ? `: ${delivery.errorMessage}` : '.'}`;
};

const haveSameMachineIds = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};

const uniqueSortedValues = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

const buildLocalTechnicianInviteDelivery = ({
  sourceId,
  targetEmail,
  sentBy,
}: {
  sourceId: string;
  targetEmail: string;
  sentBy: string | null;
}): AccessInviteDelivery => ({
  id: `local-technician-invite-${Date.now()}`,
  inviteType: 'technician',
  sourceType: 'technician_grant',
  sourceId,
  targetEmail,
  sentBy,
  sentAt: new Date().toISOString(),
  deliveryStatus: 'sent',
  errorMessage: null,
});

const getAccountSelectionKey = (account: {
  accountId: string;
  authorityPath?: string;
  partnerId?: string | null;
}) => `${account.authorityPath ?? 'account'}:${account.accountId}:${account.partnerId ?? 'none'}`;

export function TechnicianManagementPanel() {
  const { user, canManageOperatorTraining } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [technicianEmail, setTechnicianEmail] = useState('');
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [grantReason, setGrantReason] = useState(DEFAULT_TECHNICIAN_REASON);
  const [trainingOnlyConfirmed, setTrainingOnlyConfirmed] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [editingMachineIds, setEditingMachineIds] = useState<string[]>([]);
  const [editReason, setEditReason] = useState(DEFAULT_UPDATE_REASON);
  const [revokeTarget, setRevokeTarget] = useState<TechnicianGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState(DEFAULT_REVOKE_REASON);
  const [sendingInviteGrantId, setSendingInviteGrantId] = useState<string | null>(null);
  const [recentlySavedGrantId, setRecentlySavedGrantId] = useState<string | null>(null);

  const {
    data: managementContext,
    isLoading: managementLoading,
    isFetching: managementFetching,
    error: managementError,
  } = useQuery({
    queryKey: ['technician-management-context', user?.id],
    queryFn: fetchTechnicianManagementContext,
    enabled: Boolean(user?.id),
    staleTime: 1000 * 30,
  });
  const shouldLoadTechnicianGrants = Boolean(user?.id && managementContext?.canManage);

  const {
    data: technicianGrants = [],
    isLoading: grantsLoading,
    isFetching: grantsFetching,
    error: grantsError,
  } = useQuery({
    queryKey: ['technician-grants', user?.id],
    queryFn: fetchMyTechnicianGrants,
    enabled: shouldLoadTechnicianGrants,
    staleTime: 1000 * 30,
  });

  const {
    data: legacyTrainingGrants = [],
    isLoading: legacyTrainingLoading,
    error: legacyTrainingError,
  } = useQuery({
    queryKey: ['operator-training-grants', user?.id],
    queryFn: fetchMyOperatorTrainingGrants,
    enabled: Boolean(user?.id && canManageOperatorTraining && managementContext?.canManage),
    staleTime: 1000 * 30,
  });

  const accounts = useMemo(() => managementContext?.accounts ?? [], [managementContext?.accounts]);
  const selectedAccount =
    accounts.find((account) => getAccountSelectionKey(account) === selectedAccountId) ??
    accounts[0] ??
    null;
  const selectedAccountMachineIds = useMemo(
    () => new Set((selectedAccount?.machines ?? []).map((machine) => machine.machineId)),
    [selectedAccount]
  );
  const currentAccountGrants = useMemo(
    () =>
      technicianGrants
        .filter(
          (grant) =>
            grant.canManage &&
            !grant.revokedAt &&
            (!selectedAccount ||
              (grant.accountId === selectedAccount.accountId &&
                (selectedAccount.authorityPath !== 'corporate_partner' ||
                  grant.partnerId === selectedAccount.partnerId)))
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [technicianGrants, selectedAccount]
  );
  const technicianInviteSourceIds = useMemo(
    () => currentAccountGrants.map((grant) => grant.grantId).sort(),
    [currentAccountGrants]
  );
  const {
    data: technicianInviteDeliveries = [],
    isFetching: inviteDeliveriesFetching,
    error: inviteDeliveriesError,
  } = useQuery({
    queryKey: ['access-invite-deliveries', 'technician', technicianInviteSourceIds],
    queryFn: () =>
      fetchAccessInviteDeliveries({
        inviteType: 'technician',
        sourceType: 'technician_grant',
        sourceIds: technicianInviteSourceIds,
      }),
    enabled: shouldLoadTechnicianGrants && technicianInviteSourceIds.length > 0,
    staleTime: 1000 * 15,
  });
  const latestInviteBySourceId = useMemo(
    () => getLatestInviteDeliveryBySourceId(technicianInviteDeliveries),
    [technicianInviteDeliveries]
  );
  const linkedTrainingGrantIds = useMemo(
    () =>
      new Set(
        technicianGrants
          .map((grant) => grant.operatorTrainingGrantId)
          .filter((grantId): grantId is string => Boolean(grantId))
      ),
    [technicianGrants]
  );
  const visibleLegacyTrainingGrants = useMemo(
    () =>
      legacyTrainingGrants
        .filter((grant) => grant.isActive && !linkedTrainingGrantIds.has(grant.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [legacyTrainingGrants, linkedTrainingGrantIds]
  );
  const activeSeatCount =
    selectedAccount?.activeSeatCount ??
    currentAccountGrants.filter((grant) => grant.isActive).length;
  const seatCap = selectedAccount?.seatCap ?? managementContext?.seatCap ?? 10;
  const capReached = Boolean(selectedAccount && activeSeatCount >= seatCap);
  const normalizedTechnicianEmail = technicianEmail.trim().toLowerCase();
  const addEmailMatchesExistingGrant = currentAccountGrants.some(
    (grant) => grant.technicianEmail.toLowerCase() === normalizedTechnicianEmail
  );
  const addBlockedByCap = capReached && !addEmailMatchesExistingGrant;
  const isLoading = Boolean(managementContext?.canManage && grantsLoading);
  const isRefreshing = managementFetching || grantsFetching;
  const hasMachines = Boolean(selectedAccount?.machines.length);
  const managementErrorMessage =
    managementError instanceof Error ? managementError.message : null;
  const grantsErrorMessage = grantsError instanceof Error ? grantsError.message : null;
  const legacyTrainingErrorMessage =
    legacyTrainingError instanceof Error ? legacyTrainingError.message : null;
  const inviteDeliveriesErrorMessage =
    inviteDeliveriesError instanceof Error ? inviteDeliveriesError.message : null;

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId('');
      return;
    }

    if (
      !selectedAccountId ||
      !accounts.some((account) => getAccountSelectionKey(account) === selectedAccountId)
    ) {
      setSelectedAccountId(getAccountSelectionKey(accounts[0]));
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    setSelectedMachineIds((currentIds) =>
      currentIds.filter((machineId) => selectedAccountMachineIds.has(machineId))
    );
    setEditingMachineIds((currentIds) =>
      currentIds.filter((machineId) => selectedAccountMachineIds.has(machineId))
    );
  }, [selectedAccountMachineIds]);

  useEffect(() => {
    setTrainingOnlyConfirmed(false);
  }, [selectedAccount?.accountId, selectedAccount?.partnerId]);

  useEffect(() => {
    if (selectedMachineIds.length > 0) {
      setTrainingOnlyConfirmed(false);
    }
  }, [selectedMachineIds.length]);

  const invalidateTechnicianQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['technician-management-context', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['technician-grants', user?.id] }),
    ]);
  };

  const grantMutation = useMutation({
    mutationFn: grantTechnicianAccess,
  });

  const updateMutation = useMutation({
    mutationFn: updateTechnicianMachines,
    onSuccess: async () => {
      setEditingGrantId(null);
      setEditingMachineIds([]);
      setEditReason(DEFAULT_UPDATE_REASON);
      await invalidateTechnicianQueries();
      toast.success('Technician machine assignments updated.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeTechnicianAccess,
    onSuccess: async () => {
      setRevokeTarget(null);
      setRevokeReason(DEFAULT_REVOKE_REASON);
      await invalidateTechnicianQueries();
      toast.success('Technician access revoked.');
    },
  });

  const revokeLegacyTrainingMutation = useMutation({
    mutationFn: revokeOperatorTrainingAccess,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operator-training-grants', user?.id] });
      toast.success('Legacy training-only Technician access revoked.');
    },
  });

  if (managementLoading && !managementErrorMessage) {
    return null;
  }

  const handleAddTechnician = async () => {
    const normalizedEmail = technicianEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error('Enter a Technician email.');
      return;
    }

    if (addBlockedByCap) {
      toast.error('This account is already at the 10 Technician grant cap.');
      return;
    }

    if (selectedMachineIds.length === 0 && !trainingOnlyConfirmed) {
      toast.error('Confirm training-only access before sending this Technician invite.');
      return;
    }

    try {
      const grant = await grantMutation.mutateAsync({
        technicianEmail: normalizedEmail,
        machineIds: selectedMachineIds,
        accountId: selectedAccount?.accountId,
        partnerId: selectedAccount?.partnerId,
        reason: grantReason.trim() || DEFAULT_TECHNICIAN_REASON,
      });
      setTechnicianEmail('');
      setSelectedMachineIds([]);
      setTrainingOnlyConfirmed(false);
      setGrantReason(DEFAULT_TECHNICIAN_REASON);
      setRecentlySavedGrantId(grant.grantId);
      await invalidateTechnicianQueries();

      const invitePreflight = validateAccessInvitePreflight('technician', grant.technicianEmail || normalizedEmail);
      if (!invitePreflight.ok) {
        toast.error(`Technician access saved, but invite email was not sent: ${invitePreflight.message}`);
        return;
      }

      setSendingInviteGrantId(grant.grantId);
      try {
        await sendAccessInvite({
          inviteType: 'technician',
          sourceId: grant.grantId,
          targetEmail: invitePreflight.targetEmail,
          loginUrl: invitePreflight.loginUrl,
        });
        queryClient.setQueryData<AccessInviteDelivery[]>(
          ['access-invite-deliveries', 'technician', uniqueSortedValues([...technicianInviteSourceIds, grant.grantId])],
          (current = []) => [
            buildLocalTechnicianInviteDelivery({
              sourceId: grant.grantId,
              targetEmail: invitePreflight.targetEmail,
              sentBy: user?.id ?? null,
            }),
            ...current.filter(
              (delivery) =>
                delivery.sourceId !== grant.grantId ||
                delivery.inviteType !== 'technician' ||
                delivery.targetEmail !== invitePreflight.targetEmail
            ),
          ]
        );
        setRecentlySavedGrantId(null);
        toast.success('Technician access saved and invite email sent.');
      } catch (inviteError) {
        const message =
          inviteError instanceof Error ? inviteError.message : 'Unable to send Technician invite.';
        toast.error(`Technician access saved, but invite email failed: ${message}`);
      } finally {
        setSendingInviteGrantId(null);
        await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save Technician access.';
      toast.error(message);
    }
  };

  const startEditingGrant = (grant: TechnicianGrant) => {
    setEditingGrantId(grant.grantId);
    setEditingMachineIds(
      grant.machines
        .filter((machine) => machine.isActive)
        .map((machine) => machine.machineId)
        .filter((machineId) => selectedAccountMachineIds.has(machineId))
    );
    setEditReason(DEFAULT_UPDATE_REASON);
  };

  const handleSaveEdit = async (grant: TechnicianGrant) => {
    try {
      await updateMutation.mutateAsync({
        grantId: grant.grantId,
        machineIds: editingMachineIds,
        reason: editReason.trim() || DEFAULT_UPDATE_REASON,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update Technician machines.';
      toast.error(message);
    }
  };

  const handleRevokeLegacyTraining = async (grantId: string) => {
    try {
      await revokeLegacyTrainingMutation.mutateAsync(grantId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to revoke legacy training-only Technician access.';
      toast.error(message);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;

    if (!revokeReason.trim()) {
      toast.error('Enter a revoke reason.');
      return;
    }

    try {
      await revokeMutation.mutateAsync({
        grantId: revokeTarget.grantId,
        reason: revokeReason.trim(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to revoke Technician access.';
      toast.error(message);
    }
  };

  const handleSendTechnicianInvite = async (grant: TechnicianGrant) => {
    const invitePreflight = validateAccessInvitePreflight('technician', grant.technicianEmail);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }

    setSendingInviteGrantId(grant.grantId);
    try {
      await sendAccessInvite({
        inviteType: 'technician',
        sourceId: grant.grantId,
        targetEmail: invitePreflight.targetEmail,
        loginUrl: invitePreflight.loginUrl,
      });
      queryClient.setQueryData<AccessInviteDelivery[]>(
        ['access-invite-deliveries', 'technician', technicianInviteSourceIds],
        (current = []) => [
          {
            id: `local-technician-invite-${Date.now()}`,
            inviteType: 'technician',
            sourceType: 'technician_grant',
            sourceId: grant.grantId,
            targetEmail: invitePreflight.targetEmail,
            sentBy: user?.id ?? null,
            sentAt: new Date().toISOString(),
            deliveryStatus: 'sent',
            errorMessage: null,
          },
          ...current.filter(
            (delivery) =>
              delivery.sourceId !== grant.grantId ||
              delivery.inviteType !== 'technician' ||
              delivery.targetEmail !== invitePreflight.targetEmail
          ),
        ]
      );
      setRecentlySavedGrantId(null);
      toast.success('Technician invite sent.');
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send Technician invite.';
      toast.error(message);
      await queryClient.invalidateQueries({ queryKey: ['access-invite-deliveries'] });
    } finally {
      setSendingInviteGrantId(null);
    }
  };

  const handleCopyTechnicianInviteLink = async (grant: TechnicianGrant) => {
    const invitePreflight = validateAccessInvitePreflight('technician', grant.technicianEmail);
    if (!invitePreflight.ok) {
      toast.error(invitePreflight.message);
      return;
    }

    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard copy is not available in this browser.');
      return;
    }

    try {
      await navigator.clipboard.writeText(invitePreflight.loginUrl);
      toast.success('Technician login link copied.');
    } catch {
      toast.error('Unable to copy Technician login link.');
    }
  };

  return (
    <div className="mt-8 card-elevated min-w-0 p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Technician Access
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Add staff who need the training library and, when needed, reporting for assigned
              machines. Machines can have multiple Technicians; each Technician only sees the
              machine reporting assigned here.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={capReached ? 'destructive' : 'outline'}>
            {activeSeatCount} / {seatCap} seats used
          </Badge>
          {isRefreshing && <Badge variant="secondary">Refreshing</Badge>}
        </div>
      </div>

      {isLoading ? (
        <TechnicianPanelSkeleton />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {(managementErrorMessage || grantsErrorMessage) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Unable to load Technician management</AlertTitle>
              <AlertDescription>
                {managementErrorMessage ?? grantsErrorMessage}
              </AlertDescription>
            </Alert>
          )}

          {legacyTrainingErrorMessage && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Some training-only staff could not be loaded</AlertTitle>
              <AlertDescription>{legacyTrainingErrorMessage}</AlertDescription>
            </Alert>
          )}

          {inviteDeliveriesErrorMessage && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Invite history could not be loaded</AlertTitle>
              <AlertDescription>
                Existing Technician access is still available. Send/copy actions will retry invite
                delivery history after the next change. {inviteDeliveriesErrorMessage}
              </AlertDescription>
            </Alert>
          )}

          {managementContext && !managementContext.canManage && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Technician management is not available</AlertTitle>
              <AlertDescription>
                This portal session does not have an active customer or partner Technician
                management scope. Admin Technician grants are handled from Admin Access.
              </AlertDescription>
            </Alert>
          )}

          {managementContext?.canManage && selectedAccount && (
            <>
              <div className="grid gap-4 lg:grid-cols-[0.38fr_0.62fr]">
                <div className="flex flex-col gap-4 rounded-md border border-border bg-muted/20 p-4">
                  <div>
                    <Label htmlFor="technician-account">Account</Label>
                    {accounts.length > 1 ? (
                      <Select
                        value={getAccountSelectionKey(selectedAccount)}
                        onValueChange={setSelectedAccountId}
                      >
                        <SelectTrigger id="technician-account" className="mt-2 min-h-11">
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {accounts.map((account) => (
                              <SelectItem
                                key={getAccountSelectionKey(account)}
                                value={getAccountSelectionKey(account)}
                              >
                                {account.partnerName
                                  ? `${account.partnerName} / ${account.accountName}`
                                  : account.accountName}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
                        {selectedAccount.partnerName
                          ? `${selectedAccount.partnerName} / ${selectedAccount.accountName}`
                          : selectedAccount.accountName}
                      </p>
                    )}
                  </div>

                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Scope
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {selectedAccount.authorityPath === 'corporate_partner'
                        ? 'Partner portfolio'
                        : 'Account owner'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {selectedAccount.partnerName
                        ? `${selectedAccount.partnerName} can manage Technicians only for the machines shown here.`
                        : 'This account can manage Technicians only for the machines shown here.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-border bg-background p-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Machines
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">
                        {selectedAccount.machineCount}
                      </p>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Seats
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">
                        {activeSeatCount}/{seatCap}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4 rounded-md border border-border bg-background p-4">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <Label htmlFor="technician-email">Technician email</Label>
                      <Input
                        id="technician-email"
                        type="email"
                        value={technicianEmail}
                        onChange={(event) => setTechnicianEmail(event.target.value)}
                        placeholder="technician@example.com"
                        className="mt-2 h-11"
                        disabled={grantMutation.isPending}
                      />
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Existing emails are updated instead of consuming another seat.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="technician-reason">Reason</Label>
                      <Input
                        id="technician-reason"
                        value={grantReason}
                        onChange={(event) => setGrantReason(event.target.value)}
                        className="mt-2 h-11"
                        disabled={grantMutation.isPending}
                      />
                    </div>
                  </div>

                  {capReached && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Technician seat cap reached</AlertTitle>
                      <AlertDescription>
                        This account already has 10 active Technician grants. Paid additional
                        seats are planned later and are not available in this flow.
                      </AlertDescription>
                    </Alert>
                  )}

                  {!hasMachines ? (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>No controlled machines available</AlertTitle>
                      <AlertDescription>
                        Save without machines to grant training-only Technician access. Assign
                        machines later when this person should see reporting.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <TechnicianMachineAssignmentPicker
                      idPrefix="add-technician-machine"
                      machines={selectedAccount.machines}
                      selectedMachineIds={selectedMachineIds}
                      onSelectedMachineIdsChange={setSelectedMachineIds}
                      disabled={addBlockedByCap || grantMutation.isPending}
                    />
                  )}

                  {selectedMachineIds.length === 0 && (
                    <label
                      htmlFor="technician-training-only-confirm"
                      className={cn(
                        'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-amber/40 bg-amber/10 p-3 text-sm',
                        (addBlockedByCap || grantMutation.isPending) && 'cursor-not-allowed opacity-70'
                      )}
                    >
                      <Checkbox
                        id="technician-training-only-confirm"
                        checked={trainingOnlyConfirmed}
                        onCheckedChange={(checked) => setTrainingOnlyConfirmed(checked === true)}
                        disabled={addBlockedByCap || grantMutation.isPending}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">
                          Send as training-only access
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          I understand this Technician will not see machine reporting until machines
                          are assigned later.
                        </span>
                      </span>
                    </label>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-muted-foreground">
                      {selectedMachineIds.length > 0
                        ? `This Technician will see reporting for ${pluralize(selectedMachineIds.length, 'selected machine')} only.`
                        : 'No machines selected; this Technician will receive training only.'}
                    </p>
                    <Button
                      className="min-h-11 w-full sm:w-auto"
                      onClick={handleAddTechnician}
                      disabled={
                        grantMutation.isPending ||
                        addBlockedByCap ||
                        !technicianEmail.trim() ||
                        (selectedMachineIds.length === 0 && !trainingOnlyConfirmed)
                      }
                    >
                      {grantMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-4 w-4" />
                      )}
                      Save and send invite
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">Current Technicians</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      New Technicians receive an invite during save. Use resend, delivery status,
                      machine assignment edits, or revoke when access needs follow-up.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inviteDeliveriesFetching && <Badge variant="secondary">Checking invites</Badge>}
                    <Badge variant="outline">
                      {pluralize(
                        currentAccountGrants.length + visibleLegacyTrainingGrants.length,
                        'staff member'
                      )}
                    </Badge>
                  </div>
                </div>

                {legacyTrainingLoading && (
                  <p className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                    Loading training-only staff...
                  </p>
                )}

                {currentAccountGrants.length === 0 &&
                visibleLegacyTrainingGrants.length === 0 &&
                !legacyTrainingLoading ? (
                  <p className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                    No Technician access has been added for this account yet. Add a Technician above
                    to save access and send the invite in one step.
                  </p>
                ) : (
                  currentAccountGrants.map((grant) => (
                    <TechnicianGrantRow
                      key={grant.grantId}
                      grant={grant}
                      machines={selectedAccount.machines}
                      isEditing={editingGrantId === grant.grantId}
                      editingMachineIds={editingMachineIds}
                      editReason={editReason}
                      isSaving={updateMutation.isPending}
                      inviteDelivery={latestInviteBySourceId.get(grant.grantId)}
                      isSendingInvite={sendingInviteGrantId === grant.grantId}
                      recentlySaved={recentlySavedGrantId === grant.grantId}
                      onStartEdit={() => startEditingGrant(grant)}
                      onCancelEdit={() => {
                        setEditingGrantId(null);
                        setEditingMachineIds([]);
                        setEditReason(DEFAULT_UPDATE_REASON);
                      }}
                      onChangeEditMachines={setEditingMachineIds}
                      onChangeEditReason={setEditReason}
                      onSaveEdit={() => handleSaveEdit(grant)}
                      onSendInvite={() => handleSendTechnicianInvite(grant)}
                      onCopyInviteLink={() => handleCopyTechnicianInviteLink(grant)}
                      onRevoke={() => {
                        setRevokeTarget(grant);
                        setRevokeReason(DEFAULT_REVOKE_REASON);
                      }}
                    />
                  ))
                )}

                {visibleLegacyTrainingGrants.map((grant) => (
                  <LegacyTrainingGrantRow
                    key={grant.id}
                    grant={grant}
                    isRevoking={revokeLegacyTrainingMutation.isPending}
                    onRevoke={() => handleRevokeLegacyTraining(grant.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Technician access?</DialogTitle>
            <DialogDescription>
              This removes Technician-sourced training and assigned-machine reporting access for{' '}
              {revokeTarget?.technicianEmail ?? 'this Technician'}. Manual reporting grants are not
              removed.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="technician-revoke-reason">Required revoke reason</Label>
            <Textarea
              id="technician-revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              className="mt-2 min-h-24"
              disabled={revokeMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={handleRevoke}
              disabled={revokeMutation.isPending || !revokeReason.trim()}
            >
              {revokeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserMinus className="mr-2 h-4 w-4" />
              )}
              Revoke Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TechnicianGrantRow({
  grant,
  machines,
  isEditing,
  editingMachineIds,
  editReason,
  isSaving,
  inviteDelivery,
  isSendingInvite,
  recentlySaved,
  onStartEdit,
  onCancelEdit,
  onChangeEditMachines,
  onChangeEditReason,
  onSaveEdit,
  onSendInvite,
  onCopyInviteLink,
  onRevoke,
}: {
  grant: TechnicianGrant;
  machines: TechnicianManagementMachine[];
  isEditing: boolean;
  editingMachineIds: string[];
  editReason: string;
  isSaving: boolean;
  inviteDelivery?: AccessInviteDelivery;
  isSendingInvite: boolean;
  recentlySaved: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeEditMachines: (machineIds: string[]) => void;
  onChangeEditReason: (value: string) => void;
  onSaveEdit: () => void;
  onSendInvite: () => void;
  onCopyInviteLink: () => void;
  onRevoke: () => void;
}) {
  const activeMachines = grant.machines.filter((machine) => machine.isActive);
  const originalMachineIds = activeMachines.map((machine) => machine.machineId);
  const hasChanges = !haveSameMachineIds(editingMachineIds, originalMachineIds);
  const inviteStatusVariant =
    inviteDelivery?.deliveryStatus === 'sent'
      ? 'default'
      : inviteDelivery?.deliveryStatus === 'failed'
        ? 'destructive'
        : 'outline';
  const inviteStatusLabel =
    inviteDelivery?.deliveryStatus === 'sent'
      ? 'Invite sent'
      : inviteDelivery?.deliveryStatus === 'failed'
        ? 'Invite failed'
        : recentlySaved
          ? 'Ready to invite'
          : 'No invite sent';
  const canSendInvite = grant.canManage && grant.isActive && !grant.revokedAt;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-muted/20 px-3 py-3',
        recentlySaved && 'border-primary/40 bg-primary/5'
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-sm font-semibold text-foreground">
              {grant.technicianEmail}
            </p>
            <Badge variant={getStatusBadgeVariant(grant.status)}>
              {formatStatusLabel(grant.status)}
            </Badge>
            <Badge variant={activeMachines.length > 0 ? 'outline' : 'secondary'}>
              {activeMachines.length > 0 ? pluralize(activeMachines.length, 'assigned machine') : 'Training-only'}
            </Badge>
            <Badge variant={inviteStatusVariant}>{inviteStatusLabel}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {activeMachines.length > 0
              ? `${pluralize(activeMachines.length, 'assigned machine')} for reporting`
              : 'Training library only'}{' '}
            - Updated {formatDateTime(grant.updatedAt)}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
            {formatInviteDeliverySummary(inviteDelivery)}
          </p>
          {activeMachines.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {activeMachines.map((machine) => (
                <Badge key={machine.machineId} variant="outline">
                  {machine.machineLabel}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:w-auto lg:shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSendInvite}
            disabled={!canSendInvite || isSaving || isSendingInvite}
            className="min-h-11 w-full"
          >
            {isSendingInvite ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            {inviteDelivery ? 'Resend invite' : 'Send invite'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopyInviteLink}
            disabled={!canSendInvite || isSaving || isSendingInvite}
            className="min-h-11 w-full"
          >
            <Copy className="mr-1.5 h-4 w-4" />
            Copy link
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onStartEdit}
            disabled={isSaving || isSendingInvite}
            className="min-h-11 w-full"
          >
            <Pencil className="mr-1.5 h-4 w-4" />
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRevoke}
            disabled={isSaving || isSendingInvite}
            className="min-h-11 w-full"
          >
            <UserMinus className="mr-1.5 h-4 w-4" />
            Revoke
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 flex flex-col gap-4 rounded-md border border-border bg-background p-4">
          <TechnicianMachineAssignmentPicker
            idPrefix={`edit-technician-${grant.grantId}-machine`}
            machines={machines}
            selectedMachineIds={editingMachineIds}
            onSelectedMachineIdsChange={onChangeEditMachines}
            disabled={isSaving}
          />
          <div>
            <Label htmlFor={`edit-reason-${grant.grantId}`}>Reason</Label>
            <Input
              id={`edit-reason-${grant.grantId}`}
              value={editReason}
              onChange={(event) => onChangeEditReason(event.target.value)}
              className="mt-2 h-11"
              disabled={isSaving}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              {formatTechnicianScopePreview(editingMachineIds.length)} after save.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={onCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-11"
                onClick={onSaveEdit}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {hasChanges ? 'Save Access' : 'Renew Access'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegacyTrainingGrantRow({
  grant,
  isRevoking,
  onRevoke,
}: {
  grant: OperatorTrainingGrant;
  isRevoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-sm font-semibold text-foreground">
              {grant.operatorEmail}
            </p>
            <Badge variant="secondary">Legacy training-only</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Training-only Technician - Updated {formatDateTime(grant.updatedAt)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRevoke}
          disabled={isRevoking}
          className="min-h-11 w-full sm:w-auto lg:shrink-0"
        >
          <UserMinus className="mr-1.5 h-4 w-4" />
          Revoke
        </Button>
      </div>
    </div>
  );
}

function TechnicianPanelSkeleton() {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[0.38fr_0.62fr]">
      <div className="rounded-md border border-border bg-muted/20 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-10 w-full" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
      <div className="rounded-md border border-border bg-background p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-10 w-full" />
        <Skeleton className="mt-4 h-36 w-full" />
      </div>
    </div>
  );
}

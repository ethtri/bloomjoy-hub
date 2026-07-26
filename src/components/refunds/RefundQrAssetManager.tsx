import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  manageMachineRefundQrAdmin,
  updateMachineRefundQrRolloutAdmin,
  type RefundMachineQrAsset,
  type RefundMachineQrReplacementOwner,
} from '@/lib/refundOperations';
import {
  buildRefundQrPrintAsset,
  downloadRefundQrPrintAsset,
  type RefundQrPrintAsset,
} from '@/lib/refundQrAssets';

type DestructiveQrAction = 'rotate' | 'disable';
type RolloutAction = 'mark_printed' | 'mark_installed' | 'verify_label' | 'verify_phone';

const replacementOwnerLabels: Record<RefundMachineQrReplacementOwner, string> = {
  operations: 'Bloomjoy Operations',
  machine_manager: 'Machine Manager',
  site_partner: 'Site Partner',
};

const buildDemoQrAsset = (
  previous: RefundMachineQrAsset | null,
  action: 'create' | 'rotate' | 'disable'
): RefundMachineQrAsset => {
  const nextVersion = (previous?.version ?? 0) + (action === 'rotate' || action === 'create' ? 1 : 0);
  const now = new Date().toISOString();

  if (action === 'disable' && previous) {
    return {
      ...previous,
      status: 'disabled',
      publicPath: null,
      deactivatedAt: now,
      rolloutReady: false,
    };
  }

  const suffix = String(nextVersion).padStart(6, '0');
  return {
    status: 'active',
    version: nextVersion,
    publicPath: `/refunds/request?qr=refund_qr_asset_demo_public_code_${suffix}`,
    createdAt: now,
    deactivatedAt: null,
    printedAt: null,
    installedAt: null,
    labelVerifiedAt: null,
    phoneVerifiedAt: null,
    replacementOwnerRole: null,
    rolloutReady: false,
  };
};

const applyDemoRolloutAction = (
  asset: RefundMachineQrAsset,
  action: RolloutAction | 'set_owner',
  replacementOwnerRole?: RefundMachineQrReplacementOwner | null
) => {
  const now = new Date().toISOString();
  const next = {
    ...asset,
    printedAt: action === 'mark_printed' ? now : asset.printedAt,
    installedAt: action === 'mark_installed' ? now : asset.installedAt,
    labelVerifiedAt: action === 'verify_label' ? now : asset.labelVerifiedAt,
    phoneVerifiedAt: action === 'verify_phone' ? now : asset.phoneVerifiedAt,
    replacementOwnerRole:
      action === 'set_owner' ? replacementOwnerRole ?? null : asset.replacementOwnerRole,
  };

  return {
    ...next,
    rolloutReady: Boolean(
      next.printedAt &&
        next.installedAt &&
        next.labelVerifiedAt &&
        next.phoneVerifiedAt &&
        next.replacementOwnerRole
    ),
  };
};

const formatStatus = (asset: RefundMachineQrAsset | null) => {
  if (!asset) return 'Not created';
  if (asset.status === 'active' && asset.rolloutReady) return 'Pilot ready';
  if (asset.status === 'active') return 'Rollout checks needed';
  if (asset.status === 'retired') return 'Retired';
  return 'Disabled';
};

export function RefundQrAssetManager({
  machineId,
  locationName,
  machineLabel,
  refundIntakeEnabled,
  setupHasUnsavedChanges,
  qrAsset,
  isLocalDemoMode,
  onDemoAssetChanged,
  onSaved,
}: {
  machineId: string;
  locationName: string;
  machineLabel: string;
  refundIntakeEnabled: boolean;
  setupHasUnsavedChanges: boolean;
  qrAsset: RefundMachineQrAsset | null;
  isLocalDemoMode: boolean;
  onDemoAssetChanged: (asset: RefundMachineQrAsset) => void;
  onSaved: () => Promise<unknown>;
}) {
  const [currentAsset, setCurrentAsset] = useState<RefundMachineQrAsset | null>(qrAsset);
  const [printAsset, setPrintAsset] = useState<RefundQrPrintAsset | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<DestructiveQrAction | null>(null);
  const [confirmationReason, setConfirmationReason] = useState('');
  const [replacementOwnerRole, setReplacementOwnerRole] =
    useState<RefundMachineQrReplacementOwner | ''>(qrAsset?.replacementOwnerRole ?? '');

  useEffect(() => {
    setCurrentAsset(qrAsset);
    setReplacementOwnerRole(qrAsset?.replacementOwnerRole ?? '');
  }, [machineId, qrAsset]);

  useEffect(() => {
    let cancelled = false;
    const activePath =
      currentAsset?.status === 'active' ? currentAsset.publicPath : null;

    if (!activePath) {
      setPrintAsset(null);
      setAssetError(null);
      return () => {
        cancelled = true;
      };
    }

    setAssetError(null);
    void buildRefundQrPrintAsset({
      publicPath: activePath,
      locationName,
      machineLabel,
      version: currentAsset.version,
    })
      .then((nextAsset) => {
        if (!cancelled) setPrintAsset(nextAsset);
      })
      .catch((error) => {
        if (!cancelled) {
          setPrintAsset(null);
          setAssetError(error instanceof Error ? error.message : 'Unable to build the QR asset.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentAsset, locationName, machineLabel]);

  const isActive = currentAsset?.status === 'active';
  const canCreate = refundIntakeEnabled && !isActive && !setupHasUnsavedChanges;
  const statusLabel = formatStatus(currentAsset);
  const statusVariant =
    currentAsset?.rolloutReady
      ? 'default'
      : currentAsset?.status === 'active'
        ? 'secondary'
        : 'outline';
  const checklist = useMemo(
    () => [
      {
        key: 'printed',
        label: 'Approved asset printed',
        detail: 'Download the current version, print it at full size, then record completion.',
        complete: Boolean(currentAsset?.printedAt),
        action: 'mark_printed' as const,
        actionLabel: 'Mark printed',
        disabled: false,
      },
      {
        key: 'installed',
        label: 'Installed on this machine',
        detail: 'Confirm the printed version is physically attached to this exact machine.',
        complete: Boolean(currentAsset?.installedAt),
        action: 'mark_installed' as const,
        actionLabel: 'Mark installed',
        disabled: !currentAsset?.printedAt,
      },
      {
        key: 'label',
        label: 'Printed label matches',
        detail: 'Match the location and machine label below to the physical machine.',
        complete: Boolean(currentAsset?.labelVerifiedAt),
        action: 'verify_label' as const,
        actionLabel: 'Verify label',
        disabled: !currentAsset?.installedAt,
      },
      {
        key: 'phone',
        label: 'Real-phone scan verified',
        detail: 'Scan the installed code on a real phone and confirm the expected refund page opens.',
        complete: Boolean(currentAsset?.phoneVerifiedAt),
        action: 'verify_phone' as const,
        actionLabel: 'Verify phone scan',
        disabled: !currentAsset?.labelVerifiedAt,
      },
    ],
    [currentAsset]
  );

  const saveAsset = async (nextAsset: RefundMachineQrAsset, successMessage: string) => {
    setCurrentAsset(nextAsset);
    setReplacementOwnerRole(nextAsset.replacementOwnerRole ?? '');
    if (isLocalDemoMode) onDemoAssetChanged(nextAsset);
    toast.success(
      isLocalDemoMode ? `${successMessage} Demo mode saved this in the browser only.` : successMessage
    );
    if (!isLocalDemoMode) await onSaved();
  };

  const runQrAction = async (
    action: 'create' | 'rotate' | 'disable',
    reason: string
  ) => {
    setPendingAction(action);
    try {
      const nextAsset = isLocalDemoMode
        ? buildDemoQrAsset(currentAsset, action)
        : await manageMachineRefundQrAdmin({ machineId, action, reason });
      const successMessage =
        action === 'create'
          ? 'Refund QR asset created.'
          : action === 'rotate'
            ? 'Refund QR rotated. Replace every copy of the old version.'
            : 'Refund QR disabled.';
      await saveAsset(nextAsset, successMessage);
      setConfirmationAction(null);
      setConfirmationReason('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the refund QR asset.');
    } finally {
      setPendingAction(null);
    }
  };

  const runRolloutAction = async (action: RolloutAction) => {
    if (!currentAsset || currentAsset.status !== 'active') return;
    setPendingAction(action);
    try {
      const nextAsset = isLocalDemoMode
        ? applyDemoRolloutAction(currentAsset, action)
        : await updateMachineRefundQrRolloutAdmin({
            machineId,
            action,
            reason: `Refund QR version ${currentAsset.version} rollout: ${action}`,
          });
      await saveAsset(nextAsset, 'QR rollout checklist updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the QR rollout checklist.');
    } finally {
      setPendingAction(null);
    }
  };

  const saveReplacementOwner = async () => {
    if (!currentAsset || currentAsset.status !== 'active' || !replacementOwnerRole) return;
    setPendingAction('set_owner');
    try {
      const nextAsset = isLocalDemoMode
        ? applyDemoRolloutAction(currentAsset, 'set_owner', replacementOwnerRole)
        : await updateMachineRefundQrRolloutAdmin({
            machineId,
            action: 'set_owner',
            replacementOwnerRole,
            reason: `Refund QR version ${currentAsset.version} replacement ownership recorded`,
          });
      await saveAsset(nextAsset, 'Replacement owner saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save replacement ownership.');
    } finally {
      setPendingAction(null);
    }
  };

  const copyClaimLink = async () => {
    if (!printAsset) return;
    try {
      await navigator.clipboard.writeText(printAsset.claimUrl);
      toast.success('Production refund link copied.');
    } catch {
      toast.error('Unable to copy the link. Download the asset instead.');
    }
  };

  const downloadAsset = () => {
    if (!printAsset) return;
    downloadRefundQrPrintAsset(printAsset);
    toast.success('Print-ready SVG downloaded. Record “printed” only after producing the label.');
  };

  const openConfirmation = (action: DestructiveQrAction) => {
    setConfirmationAction(action);
    setConfirmationReason(
      action === 'rotate'
        ? 'Replace the current printed QR with a new version'
        : 'Temporarily remove this machine from QR refund intake'
    );
  };

  return (
    <div
      className="mt-4 overflow-hidden rounded-lg border border-pink-200 bg-gradient-to-br from-pink-50/80 via-background to-background"
      data-testid="refund-qr-asset-manager"
    >
      <div className="flex flex-col gap-3 border-b border-pink-100 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-100 text-pink-700">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Print and install refund QR</h4>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              This private Operations preview creates the physical label for this machine.
              Download it, print it, and attach it to this machine only. A customer scan captures
              the machine and a server-recorded scan time; it does not approve a refund or prove
              failed delivery.
            </p>
          </div>
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>

      {!refundIntakeEnabled && !isActive ? (
        <div className="p-4 text-sm text-muted-foreground">
          Save this machine with refund intake enabled before creating its QR asset.
        </div>
      ) : !isActive ? (
        <div className="grid gap-3 p-4">
          {setupHasUnsavedChanges && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Save the machine's refund setup before creating or printing a QR asset.
            </div>
          )}
          {currentAsset && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Version {currentAsset.version} is {currentAsset.status}. Its old link no longer
              starts a valid claim. Create a replacement only when a new label will be installed.
            </div>
          )}
          <Button
            type="button"
            className="w-fit"
            onClick={() =>
              void runQrAction(
                'create',
                currentAsset
                  ? 'Create a replacement refund QR asset'
                  : 'Create the approved pilot refund QR asset'
              )
            }
            disabled={!canCreate || pendingAction !== null}
          >
            {pendingAction === 'create' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <QrCode className="mr-2 h-4 w-4" />
            )}
            {currentAsset ? 'Create replacement QR' : 'Create refund QR'}
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 p-4">
          {setupHasUnsavedChanges && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Refund setup has unsaved changes. Save them before downloading, rotating, or
              recording rollout checks so the printed label matches the saved machine record.
            </div>
          )}
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            The QR shown below is a print preview. The finished label belongs on the physical
            machine; customers do not use this admin screen.
          </div>
          <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-border bg-white p-3">
              {printAsset ? (
                <img
                  src={printAsset.qrDataUrl}
                  alt={`Refund help QR for ${locationName}, ${machineLabel}`}
                  className="aspect-square w-full"
                />
              ) : assetError ? (
                <AlertTriangle className="h-8 w-8 text-destructive" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Version {currentAsset.version}</Badge>
                <Badge variant="outline">Production link</Badge>
              </div>
              <p className="mt-3 font-medium text-foreground">{locationName}</p>
              <p className="text-sm text-muted-foreground">{machineLabel}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                The printed label contains no Nayax ID, database ID, customer data, or payment data.
                The full opaque link is available through Copy link but is not printed as text.
              </p>
              {assetError && <p className="mt-2 text-sm text-destructive">{assetError}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={downloadAsset}
                  disabled={!printAsset || setupHasUnsavedChanges || pendingAction !== null}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download printable label
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyClaimLink()}
                  disabled={!printAsset || setupHasUnsavedChanges || pendingAction !== null}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy link
                </Button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h5 className="text-sm font-semibold text-foreground">Physical rollout checklist</h5>
                <p className="mt-1 text-xs text-muted-foreground">
                  These checks belong to version {currentAsset.version}. Rotation resets them.
                </p>
              </div>
              <Badge variant={currentAsset.rolloutReady ? 'default' : 'outline'}>
                {currentAsset.rolloutReady ? 'Ready' : 'Incomplete'}
              </Badge>
            </div>
            <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
              {checklist.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 gap-2.5">
                    {item.complete ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                  {!item.complete && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void runRolloutAction(item.action)}
                      disabled={item.disabled || setupHasUnsavedChanges || pendingAction !== null}
                    >
                      {pendingAction === item.action ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : item.action === 'verify_phone' ? (
                        <Smartphone className="mr-2 h-3.5 w-3.5" />
                      ) : null}
                      {item.actionLabel}
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`qr-owner-${machineId}`}>Replacement owner</Label>
                  <select
                    id={`qr-owner-${machineId}`}
                    value={replacementOwnerRole}
                    onChange={(event) =>
                      setReplacementOwnerRole(
                        event.target.value as RefundMachineQrReplacementOwner | ''
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    disabled={setupHasUnsavedChanges || pendingAction !== null}
                  >
                    <option value="">Choose an accountable role</option>
                    {Object.entries(replacementOwnerLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void saveReplacementOwner()}
                  disabled={
                    !replacementOwnerRole ||
                    replacementOwnerRole === currentAsset.replacementOwnerRole ||
                    setupHasUnsavedChanges ||
                    pendingAction !== null
                  }
                >
                  {pendingAction === 'set_owner' && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Save owner
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Rotate after loss, damage, or incorrect placement. Old versions immediately show the
              safe unavailable-code message.
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => openConfirmation('rotate')}
                disabled={setupHasUnsavedChanges || pendingAction !== null}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Rotate
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => openConfirmation('disable')}
                disabled={pendingAction !== null}
              >
                <Power className="mr-2 h-4 w-4" />
                Disable
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(confirmationAction)}
        onOpenChange={(open) => {
          if (!open && pendingAction === null) {
            setConfirmationAction(null);
            setConfirmationReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmationAction === 'rotate' ? 'Rotate this refund QR?' : 'Disable this refund QR?'}
            </DialogTitle>
            <DialogDescription>
              {confirmationAction === 'rotate'
                ? 'The current printed code will stop creating valid claims immediately. Download, install, and verify the new version before pilot use.'
                : 'The current printed code will show a safe support message and will no longer create valid claims.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="refund-qr-change-reason">Reason</Label>
            <Input
              id="refund-qr-change-reason"
              value={confirmationReason}
              onChange={(event) => setConfirmationReason(event.target.value)}
              maxLength={240}
              disabled={pendingAction !== null}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This reason is stored in the admin audit trail. Do not include customer or payment data.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmationAction(null)}
              disabled={pendingAction !== null}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmationAction === 'disable' ? 'destructive' : 'default'}
              onClick={() => {
                if (confirmationAction) {
                  void runQrAction(confirmationAction, confirmationReason);
                }
              }}
              disabled={confirmationReason.trim().length < 8 || pendingAction !== null}
            >
              {pendingAction === confirmationAction && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {confirmationAction === 'rotate' ? 'Rotate QR' : 'Disable QR'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { fetchMachineWorkspaceMetadata, machineWorkspaceQueryKey, saveMachineCashReportingExclusion } from '@/lib/machineWorkspace';

export function MachineCashReporting({ machineId, canEdit, demo = false }: { machineId: string; canEdit: boolean; demo?: boolean }) {
  const id = useId();
  const queryClient = useQueryClient();
  const metadata = useQuery({ queryKey: machineWorkspaceQueryKey, queryFn: fetchMachineWorkspaceMetadata, enabled: !demo, staleTime: 30000 });
  const machine = metadata.data?.find((item) => item.machineId === machineId);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [demoValue, setDemoValue] = useState(false);
  const savedValue = demo ? demoValue : machine?.excludeCashFromFinancialReporting;
  const available = typeof savedValue === 'boolean';
  const saving = pendingValue !== null;
  const excluded = pendingValue ?? savedValue ?? false;

  const save = async (value: boolean) => {
    if (!available || saving || !canEdit) return;
    setPendingValue(value);
    try {
      if (demo) setDemoValue(value);
      else {
        await saveMachineCashReportingExclusion(machineId, value, savedValue!);
        queryClient.setQueryData<Awaited<ReturnType<typeof fetchMachineWorkspaceMetadata>>>(machineWorkspaceQueryKey,
          (items) => items?.map((item) => item.machineId === machineId ? { ...item, excludeCashFromFinancialReporting: value } : item));
      }
      toast.success(value ? 'Cash excluded from financial reporting.' : 'Cash included in financial reporting.');
      // All already-open financial consumers must refresh from the server.
      await queryClient.invalidateQueries({ predicate: (query) =>
        /sales|finance|revenue|payout|technician-pay|partner.*(report|preview|dashboard)/i.test(String(query.queryKey[0])) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cash reporting could not be saved. Try again.');
    } finally {
      setPendingValue(null);
    }
  };

  return <section className="space-y-3 border-t border-border pt-5" aria-label="Cash reporting">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">Exclude cash from financial reporting</Label>
        <p id={`${id}-description`} className="mt-1 max-w-prose text-sm text-muted-foreground">
          When enabled, reported cash is excluded from revenue, commissions and revenue shares. Applies to all dates in recalculated reports. Card sales continue normally.
        </p>
      </div>
      <Switch id={id} aria-describedby={`${id}-description`} checked={excluded}
        disabled={!canEdit || !available || saving} onCheckedChange={(value) => void save(value)} className="mt-0.5 shrink-0" />
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      {saving ? 'Saving cash reporting…' : available ? <><Badge variant="outline">{excluded ? 'Cash excluded' : 'Cash included'}</Badge><span>{canEdit ? 'Changes save immediately.' : 'Managed by a machine admin.'}</span></> :
        metadata.isPending ? 'Loading cash reporting…' : <><span>Cash reporting setting is unavailable.</span><Button size="sm" variant="outline" onClick={() => void metadata.refetch()}>Retry</Button></>}
    </div>
  </section>;
}

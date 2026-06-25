import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { pluralizeTechnicianMachine } from '@/components/technicians/technicianMachineAssignmentCopy';
import { cn } from '@/lib/utils';

export type TechnicianAssignableMachine = {
  machineId: string;
  machineLabel: string;
  machineType?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  status?: string | null;
};

type TechnicianMachineAssignmentPickerProps<TMachine extends TechnicianAssignableMachine> = {
  idPrefix: string;
  machines: TMachine[];
  selectedMachineIds: string[];
  onSelectedMachineIdsChange: (machineIds: string[]) => void;
  disabled?: boolean;
  label?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  clearLabel?: string;
  searchThreshold?: number;
  groupByLocation?: boolean;
  className?: string;
};

const uniqueSortedValues = (items: string[]) =>
  [...new Set(items)].sort((left, right) => left.localeCompare(right));

const toggleMachineId = (machineIds: string[], machineId: string, checked: boolean) => {
  const next = new Set(machineIds);
  if (checked) next.add(machineId);
  else next.delete(machineId);
  return uniqueSortedValues([...next]);
};

const getMachineLocationKey = (machine: TechnicianAssignableMachine) =>
  machine.locationId || machine.locationName || 'unassigned';

const getMachineLocationName = (machine: TechnicianAssignableMachine) =>
  machine.locationName || 'Unassigned location';

const getMachineMeta = (machine: TechnicianAssignableMachine) =>
  [machine.locationName, machine.machineType, machine.status].filter(Boolean).join(' / ');

export function TechnicianMachineAssignmentPicker<TMachine extends TechnicianAssignableMachine>({
  idPrefix,
  machines,
  selectedMachineIds,
  onSelectedMachineIdsChange,
  disabled = false,
  label = 'Machine reporting',
  emptyMessage = 'No active machines are available for this account.',
  searchPlaceholder = 'Search machines',
  clearLabel = 'Clear',
  searchThreshold = 6,
  groupByLocation = true,
  className,
}: TechnicianMachineAssignmentPickerProps<TMachine>) {
  const selectedIdSet = useMemo(() => new Set(selectedMachineIds), [selectedMachineIds]);
  const [machineSearch, setMachineSearch] = useState('');
  const normalizedMachineSearch = machineSearch.trim().toLowerCase();
  const filteredMachines = useMemo(() => {
    if (!normalizedMachineSearch) return machines;

    return machines.filter((machine) =>
      [
        machine.machineLabel,
        machine.machineType,
        machine.locationName,
        machine.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedMachineSearch)
    );
  }, [machines, normalizedMachineSearch]);
  const groupedMachines = useMemo(() => {
    if (!groupByLocation) {
      return [
        {
          key: 'all',
          locationName: '',
          machines: filteredMachines,
        },
      ];
    }

    const groups = new Map<string, { key: string; locationName: string; machines: TMachine[] }>();

    filteredMachines.forEach((machine) => {
      const key = getMachineLocationKey(machine);
      const existingGroup =
        groups.get(key) ??
        {
          key,
          locationName: getMachineLocationName(machine),
          machines: [],
        };

      existingGroup.machines.push(machine);
      groups.set(key, existingGroup);
    });

    return Array.from(groups.values()).sort((left, right) =>
      left.locationName.localeCompare(right.locationName)
    );
  }, [filteredMachines, groupByLocation]);

  if (machines.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {selectedMachineIds.length > 0
              ? pluralizeTechnicianMachine(selectedMachineIds.length, 'selected machine')
              : 'Training-only when none are selected'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSelectedMachineIdsChange([])}
            disabled={disabled || selectedMachineIds.length === 0}
          >
            {clearLabel}
          </Button>
        </div>
      </div>
      {machines.length > searchThreshold && (
        <div>
          <Label htmlFor={`${idPrefix}-search`} className="sr-only">
            Search machines
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              id={`${idPrefix}-search`}
              value={machineSearch}
              onChange={(event) => setMachineSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-11 pl-9"
              disabled={disabled}
            />
          </div>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {groupedMachines.length === 0 || filteredMachines.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No machines match this search.
          </p>
        ) : (
          groupedMachines.map((group) => (
            <div key={group.key} className="border-b border-border last:border-b-0">
              {groupByLocation && (
                <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.locationName}
                </div>
              )}
              {group.machines.map((machine) => {
                const checkboxId = `${idPrefix}-${machine.machineId}`;
                const machineMeta = getMachineMeta(machine);

                return (
                  <label
                    key={machine.machineId}
                    htmlFor={checkboxId}
                    className={cn(
                      'flex min-h-12 cursor-pointer items-start gap-3 border-b border-border/60 p-3 last:border-b-0',
                      disabled && 'cursor-not-allowed opacity-70'
                    )}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selectedIdSet.has(machine.machineId)}
                      onCheckedChange={(checked) =>
                        onSelectedMachineIdsChange(
                          toggleMachineId(selectedMachineIds, machine.machineId, checked === true)
                        )
                      }
                      disabled={disabled}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-foreground">
                        {machine.machineLabel}
                      </span>
                      {machineMeta && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {machineMeta}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

type Record = { id: string; machineName: string | null; nayaxMachineId: string; accountKey: string; reportingMachineId: string | null };
export function NayaxMachinePicker({ records, currentName, selectedId, machineId, disabled, onSelect, allowOccupied = false }: {
  records: Record[]; currentName: string; selectedId: string; machineId: string; disabled: boolean; onSelect: (id: string) => void; allowOccupied?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = records.find((record) => record.id === selectedId);
  const label = selected ? `${selected.machineName || 'Unnamed'} · ID ${selected.nayaxMachineId} · ${selected.accountKey}` : currentName;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label="Nayax machine" aria-expanded={open} disabled={disabled}
      className="h-auto min-h-11 w-full justify-between whitespace-normal px-3 py-2 text-left text-base font-normal">
      <span className="min-w-0 break-words">{label || 'Select a Nayax machine'}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
    </Button></PopoverTrigger>
    <PopoverContent onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
      <Command><CommandInput placeholder="Search name, ID or account" aria-label="Search Nayax machines" className="min-h-11 text-base" />
        <CommandList><CommandEmpty>No imported Nayax machines found.</CommandEmpty><CommandGroup>
          {records.map((record) => <CommandItem key={record.id} value={`${record.machineName} ${record.nayaxMachineId} ${record.accountKey}`}
            disabled={!allowOccupied && Boolean(record.reportingMachineId && record.reportingMachineId !== machineId)} className="min-h-11 items-start gap-2 whitespace-normal text-base"
            onSelect={() => { onSelect(record.id); setOpen(false); }}>
            <Check className={`mt-1 h-4 w-4 shrink-0 ${record.id === selectedId ? 'opacity-100' : 'opacity-0'}`} />
            <span className="break-words">{record.machineName || 'Unnamed'}<span className="block text-sm text-muted-foreground">ID {record.nayaxMachineId} · {record.accountKey}{record.reportingMachineId && record.reportingMachineId !== machineId ? ' · Already linked' : ''}</span></span>
          </CommandItem>)}
        </CommandGroup></CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}

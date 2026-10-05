import { Info } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
export function MachineHelp({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" aria-label={label} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="h-4 w-4" /></button></PopoverTrigger>
    <PopoverContent onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); }} className="max-w-[calc(100vw-2rem)] text-sm" align="start">{children}</PopoverContent></Popover>;
}

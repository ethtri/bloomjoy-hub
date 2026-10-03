import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CompanyOption } from '@/lib/companyReporting';

export function CompanyFilter({ value, options, onChange, id = 'reporting-company' }: {
  value: string; options: CompanyOption[]; onChange: (value: string) => void; id?: string;
}) {
  const selected = options.find(option => option.id === value);
  return <div className="min-w-0 w-full">
    <Label htmlFor={id}>Company</Label>
    {options.length === 1 && value === 'all' ? <p className="mt-2 break-words text-sm">{options[0].name}</p> : <>
      <Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="mt-1 min-h-11 w-full min-w-0"><SelectValue placeholder="Choose company" /></SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]"><SelectItem className="min-h-11" value="all">All companies</SelectItem>
          {options.map(option => <SelectItem className="min-h-11 whitespace-normal break-words" key={option.id} value={option.id}>{option.name}</SelectItem>)}
          {value !== 'all' && !selected && <SelectItem value={value} disabled>Unavailable company</SelectItem>}
        </SelectContent>
      </Select>
      {selected && <p className="mt-1 break-words text-xs text-muted-foreground">{selected.name}</p>}
    </>}
  </div>;
}

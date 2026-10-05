import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MachineHelp } from '@/components/admin/MachineHelp';
import { useAuth } from '@/contexts/auth-context';
import { changeCompanyAssignment, normalizeCompanyName, singleEligibleCompanyId, type CompanyAssignmentDraft, type SavedCompanyAssignment } from '@/lib/companyAssignment';
import { companyChoicesQueryKey, createReportingCompany, fetchCompanyChoices } from '@/lib/companyAssignmentApi';

const controlClass = 'h-11 min-h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const timezones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

export function CompanyAssignmentFields({ id, value: draft, onChange, saved, disabled = false, enabled = true, activeTargetsOnly = false, autoSelectSingleCompany = true }: {
  id: string;
  value: CompanyAssignmentDraft;
  onChange: (value: CompanyAssignmentDraft) => void;
  saved?: SavedCompanyAssignment | null;
  disabled?: boolean;
  enabled?: boolean;
  activeTargetsOnly?: boolean;
  autoSelectSingleCompany?: boolean;
}) {
  // Emit only assignment fields; the containing form owns its other draft and stale-write fields.
  const value = useMemo<CompanyAssignmentDraft>(() => ({ accountId: draft.accountId, locationId: draft.locationId, locationName: draft.locationName, locationTimezone: draft.locationTimezone, addLocation: draft.addLocation }), [draft.accountId, draft.locationId, draft.locationName, draft.locationTimezone, draft.addLocation]);
  const { user, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const choices = useQuery({ queryKey: [...companyChoicesQueryKey, user?.id], queryFn: fetchCompanyChoices, enabled: enabled && isSuperAdmin, staleTime: 30000 });
  const companies = useMemo(() => choices.data?.companies ?? [], [choices.data]);
  const company = companies.find((item) => item.accountId === value.accountId);
  const changed = Boolean(saved && value.accountId !== saved.accountId);
  const showLocations = !saved || changed;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [creationError, setCreationError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const companyRef = useRef<HTMLSelectElement>(null);
  const returnToAddRef = useRef(false);
  const duplicate = companies.find((item) => normalizeCompanyName(item.accountName) === normalizeCompanyName(name));

  useEffect(() => {
    if (adding) inputRef.current?.focus();
    else if (returnToAddRef.current) { addRef.current?.focus(); returnToAddRef.current = false; }
  }, [adding]);
  useEffect(() => {
    if (!enabled) { setAdding(false); setName(''); setMessage(''); setCreationError(''); }
  }, [enabled]);
  useEffect(() => {
    if (!autoSelectSingleCompany || !enabled || saved || value.accountId || !choices.isSuccess || choices.isError) return;
    const onlyId = singleEligibleCompanyId(companies, activeTargetsOnly);
    if (onlyId) onChange(changeCompanyAssignment(value, onlyId));
  }, [autoSelectSingleCompany, enabled, saved, value, choices.isSuccess, choices.isError, companies, onChange, activeTargetsOnly]);

  const chooseCompany = (accountId: string) => onChange(changeCompanyAssignment(value, accountId, saved));
  const selectExisting = () => {
    if (!duplicate || duplicate.archivedAt || (activeTargetsOnly && duplicate.status !== 'active')) return;
    chooseCompany(duplicate.accountId);
    setMessage(`Existing company selected: ${duplicate.accountName}. Save the machine to assign it.`);
    setAdding(false); setName('');
    companyRef.current?.focus();
  };
  const create = async () => {
    if (!name.trim() || creating || duplicate) return;
    setCreating(true); setCreationError('');
    try {
      const result = await createReportingCompany(name);
      // Keep the persisted result in the choices even when the subsequent refresh fails.
      queryClient.setQueryData<typeof choices.data>([...companyChoicesQueryKey, user?.id], (current) => ({
        canCreateCompany: current?.canCreateCompany ?? false,
        companies: [...(current?.companies ?? []).filter((item) => item.accountId !== result.accountId), { ...result, locations: current?.companies.find((item) => item.accountId === result.accountId)?.locations ?? [] }],
      }));
      if (!result.archivedAt && (!activeTargetsOnly || result.status === 'active')) chooseCompany(result.accountId);
      setMessage(result.created
        ? `Company created: ${result.accountName}. Save the machine to assign it.`
        : `Company already exists: ${result.accountName}.${result.archivedAt ? ' It is archived. Restore it from Manage companies on Machines before a new assignment.' : !activeTargetsOnly || result.status === 'active' ? ' Selected for this draft.' : ' It is inactive and cannot be a new SnapCase assignment.'}`);
      setAdding(false); setName('');
      companyRef.current?.focus();
      void queryClient.invalidateQueries({ queryKey: companyChoicesQueryKey });
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : 'Unable to create company. Try again with the same name.');
    } finally { setCreating(false); }
  };

  return <div className="min-w-0 space-y-4 sm:col-span-2">
    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><Label htmlFor={`${id}-company`}>Company</Label><MachineHelp label="About company assignment">Used to group this machine in reports and refunds. Shared reporting location and time zone are preserved unless you explicitly change its company assignment.</MachineHelp></div>
      <select ref={companyRef} id={`${id}-company`} aria-describedby={`${id}-company-help`} value={value.accountId} onChange={(event) => chooseCompany(event.target.value)} disabled={disabled || choices.isPending || choices.isError} className={controlClass}>
        <option value="">{choices.isPending && enabled ? 'Loading companies…' : 'Choose company'}</option>
        {value.accountId && !company && <option value={value.accountId}>{saved?.accountName || 'Saved company'} (unavailable)</option>}
        {companies.filter((item) => !item.archivedAt || item.accountId === saved?.accountId || item.accountId === value.accountId).map((item) => <option key={item.accountId} value={item.accountId} disabled={Boolean(item.archivedAt && item.accountId !== saved?.accountId) || (activeTargetsOnly && item.status !== 'active' && item.accountId !== saved?.accountId)}>{item.accountName}{item.archivedAt ? ' (archived)' : item.status !== 'active' ? ' (inactive)' : ''}</option>)}
      </select>
      {company?.archivedAt && <p className="text-sm text-muted-foreground">Archived company · current assignment kept</p>}
      {choices.isError && <div role="alert" className="text-sm text-destructive">Unable to load companies. Your draft is preserved. <Button type="button" variant="link" className="min-h-11 px-1" onClick={() => void choices.refetch()}>Retry</Button></div>}
      {choices.isSuccess && !companies.some((item) => !item.archivedAt && (!activeTargetsOnly || item.status === 'active')) && <p className="text-sm text-muted-foreground">No available companies. {choices.data?.canCreateCompany ? 'Add a company, or restore one from Manage companies on Machines.' : 'Ask a Super Admin to set up a company.'}</p>}
      {!disabled && isSuperAdmin && choices.data?.canCreateCompany && !adding && <Button ref={addRef} type="button" variant="link" className="min-h-11 px-0" onClick={() => { setAdding(true); setCreationError(''); }}>Add company</Button>}
      {adding && <div className="space-y-2 rounded-md border border-border p-3">
        <Label htmlFor={`${id}-new-company`}>Company name</Label>
        <Input ref={inputRef} id={`${id}-new-company`} value={name} onChange={(event) => setName(event.target.value)} disabled={creating} className="min-h-11" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (duplicate) selectExisting(); else void create(); } if (event.key === 'Escape' && !creating) { event.preventDefault(); event.stopPropagation(); returnToAddRef.current = true; setAdding(false); } }} />
        <p className="text-xs text-muted-foreground">Create company saves it immediately. Save the machine separately to assign it.</p>
        {duplicate && <p className="break-words text-sm">{duplicate.accountName} already exists{duplicate.archivedAt ? ' and is archived. Restore it from Manage companies on Machines before a new assignment.' : duplicate.status !== 'active' ? ' and is inactive.' : '.'}</p>}
        {creationError && <p role="alert" className="text-sm text-destructive">{creationError}</p>}
        <div className="flex flex-wrap gap-2">
          {duplicate ? <Button type="button" variant="outline" onClick={selectExisting} disabled={creating || Boolean(duplicate.archivedAt) || (activeTargetsOnly && duplicate.status !== 'active')}>Use existing company</Button> : <Button type="button" onClick={() => void create()} disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create company'}</Button>}
          <Button type="button" variant="ghost" disabled={creating} onClick={() => { returnToAddRef.current = true; setAdding(false); setName(''); }}>Cancel</Button>
        </div>
      </div>}
      <p role="status" aria-live="polite" className="break-words text-sm text-muted-foreground">{message}</p>
    </div>
    {showLocations ? <div className="space-y-2">
      <Label htmlFor={`${id}-location`}>Location</Label>
      <select id={`${id}-location`} value={value.addLocation ? '__add__' : value.locationId} disabled={disabled || !company || choices.isError || choices.isPending} className={controlClass} onChange={(event) => {
        const location = company?.locations.find((item) => item.locationId === event.target.value);
        onChange({ ...value, addLocation: event.target.value === '__add__', locationId: location?.locationId ?? '', locationTimezone: location?.timezone ?? value.locationTimezone });
      }}>
        <option value="">Choose location</option>
        {company?.locations.filter((item) => !activeTargetsOnly || item.status === 'active').map((item) => <option key={item.locationId} value={item.locationId}>{item.locationName}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}
        <option value="__add__">Add location…</option>
      </select>
      {changed && !value.locationId && !value.addLocation && <p className="text-xs text-muted-foreground">The saved location belongs to the previous company. Choose a location for this company or add one.</p>}
      {value.addLocation && <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`${id}-new-location`}>New location name</Label><Input id={`${id}-new-location`} value={value.locationName} onChange={(event) => onChange({ ...value, locationName: event.target.value })} className="min-h-11" disabled={disabled} /></div>
        <div><Label htmlFor={`${id}-timezone`}>Location time zone</Label><Input id={`${id}-timezone`} list={`${id}-timezones`} value={value.locationTimezone} onChange={(event) => onChange({ ...value, locationTimezone: event.target.value })} placeholder="America/New_York" className="min-h-11" disabled={disabled} /><datalist id={`${id}-timezones`}>{timezones.map((timezone) => <option key={timezone} value={timezone} />)}</datalist></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">This location is created when you save the machine. Use the venue's IANA time zone.</p>
      </div>}
    </div> : <div><Label htmlFor={`${id}-saved-location`}>Location</Label><Input id={`${id}-saved-location`} value={saved?.locationName || 'Not set'} readOnly aria-readonly="true" className="min-h-11" /></div>}
    {changed && <p className="text-sm text-muted-foreground">Company-level report access follows the selected company. Machine manager assignments stay the same.</p>}
  </div>;
}

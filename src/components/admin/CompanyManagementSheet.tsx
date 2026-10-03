import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { normalizeCompanyName, type CompanyChoice, type CompanyChoices } from '@/lib/companyAssignment';
import { companyChoicesQueryKey, createReportingCompany, fetchCompanyChoices, manageReportingCompany, type CompanyManagementAction } from '@/lib/companyAssignmentApi';

export function CompanyManagementSheet({ disabled = false }: { disabled?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CompanyChoice | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const archivedRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const choices = useQuery({ queryKey: [...companyChoicesQueryKey, user?.id], queryFn: fetchCompanyChoices, enabled: open && isSuperAdmin, staleTime: 30000 });
  const companies = choices.data?.companies ?? [];
  const duplicate = companies.find(row => row.accountId !== editing?.accountId && normalizeCompanyName(row.accountName) === normalizeCompanyName(name));
  const visible = companies.filter(row => showArchived || !row.archivedAt).sort((a, b) => a.accountName.localeCompare(b.accountName));
  useEffect(() => { if (editing || adding) inputRef.current?.focus(); }, [editing, adding]);
  if (!isSuperAdmin) return null;

  const resetEditor = () => { setEditing(null); setAdding(false); setName(''); setError(''); };
  const finishEditor = () => {
    const focusId = editing?.accountId;
    resetEditor();
    requestAnimationFrame(() => (focusId ? rowRefs.current.get(focusId) : addRef.current)?.focus());
  };
  const cacheCompany = (company: CompanyChoice) => {
    queryClient.setQueryData<CompanyChoices>([...companyChoicesQueryKey, user?.id], current => ({
      canCreateCompany: current?.canCreateCompany ?? false,
      companies: [...(current?.companies ?? []).filter(row => row.accountId !== company.accountId), { ...company, locations: current?.companies.find(row => row.accountId === company.accountId)?.locations ?? company.locations }],
    }));
    // Names change throughout the authorized UI. Refetch cached views without transferring access.
    void queryClient.invalidateQueries();
  };
  const reload = async () => {
    const result = await choices.refetch();
    if (result.isSuccess) {
      if (editing) setEditing(result.data.companies.find(row => row.accountId === editing.accountId) ?? editing);
      setError(''); setNotice('Companies refreshed. Review your changes before saving.');
    }
  };
  const save = async (company: CompanyChoice, action: CompanyManagementAction) => {
    if (busy) return;
    if (action === 'rename' && (!name.trim() || duplicate)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await manageReportingCompany(company, action, name);
      cacheCompany(result);
      setNotice(action === 'rename' ? `Company renamed to ${result.accountName}.` : action === 'archive' ? `${result.accountName} archived. Existing machines, reports and access stay available.` : `${result.accountName} restored. Available for new assignments.`);
      if (action === 'rename') finishEditor();
      else requestAnimationFrame(() => (action === 'archive' && !showArchived ? archivedRef.current : rowRefs.current.get(company.accountId))?.focus());
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save company changes.'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (busy || !name.trim() || duplicate) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await createReportingCompany(name);
      cacheCompany(result);
      if (result.archivedAt) setShowArchived(true);
      setNotice(result.created ? `Company created: ${result.accountName}.` : `Company already exists: ${result.accountName}${result.archivedAt ? ' (archived)' : ''}.`);
      finishEditor();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create company.'); }
    finally { setBusy(false); }
  };
  const nameEditor = <div className="space-y-3">
    <Label htmlFor="manage-company-name">Company name</Label>
    <Input ref={inputRef} id="manage-company-name" value={name} onChange={event => setName(event.target.value)} disabled={busy} className="min-h-11" aria-describedby={duplicate ? 'manage-company-duplicate' : undefined} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); if (editing) void save(editing, 'rename'); else void create(); }
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); finishEditor(); }
    }}/>
    {editing && <p className="break-words text-xs text-muted-foreground">Current name: {editing.accountName}</p>}
    {duplicate && <p id="manage-company-duplicate" className="break-words text-sm">{duplicate.accountName} already exists{duplicate.archivedAt ? ' and is archived' : ''}. {duplicate.archivedAt ? showArchived ? 'Cancel to restore it from its row below.' : 'Cancel, then turn on Show archived to restore it.' : 'Cancel to manage the existing company.'}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy || !name.trim() || Boolean(duplicate) || Boolean(editing && !editing.updatedAt)} onClick={() => editing ? void save(editing, 'rename') : void create()}>{busy ? 'Saving…' : editing ? 'Save' : 'Create company'}</Button><Button type="button" className="min-h-11" variant="ghost" disabled={busy} onClick={finishEditor}>Cancel</Button></div>
  </div>;

  return <Sheet open={open} onOpenChange={value => { if (busy) return; setOpen(value); if (!value) { resetEditor(); setNotice(''); } }}>
    <SheetTrigger asChild><Button type="button" variant="outline" className="min-h-11" disabled={disabled}>Manage companies</Button></SheetTrigger>
    <SheetContent className="flex w-full flex-col gap-5 p-4 sm:max-w-xl sm:p-6" onEscapeKeyDown={event => { if (editing || adding || busy) { event.preventDefault(); if (!busy) finishEditor(); } }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <SheetHeader className="pr-10 text-left"><SheetTitle>Manage companies</SheetTitle><SheetDescription>Archive hides a company from new assignments. Existing machines, reports and access stay available.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="flex min-h-11 items-center gap-2"><Switch ref={archivedRef} id="manage-show-archived" checked={showArchived} onCheckedChange={setShowArchived} disabled={busy || Boolean(editing) || adding}/><Label htmlFor="manage-show-archived">Show archived</Label></div>
          {choices.data?.canCreateCompany && !adding && !editing && <Button ref={addRef} type="button" variant="outline" className="min-h-11" disabled={busy || choices.isError} onClick={() => { setAdding(true); setName(''); setError(''); setNotice(''); }}>Add company</Button>}
        </div>
        {error && <div role="alert" className="mb-4 text-sm text-destructive"><p className="break-words">{error}</p><Button type="button" variant="link" className="min-h-11 px-0" disabled={busy} onClick={() => void reload()}>Reload companies</Button></div>}
        <p role="status" aria-live="polite" className="mb-3 break-words text-sm text-muted-foreground">{notice}</p>
        {choices.isPending ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading companies…</p> : choices.isError ? <div role="alert"><p>Companies could not load. Your name draft is preserved.</p><Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => void reload()}>Retry</Button></div> : <>
          {adding && <div className="mb-4 border-b border-border pb-4">{nameEditor}</div>}
          <div className="divide-y divide-border">{visible.map(company => <div key={company.accountId} className="min-w-0 py-4" data-company-id={company.accountId}>
            <p className="break-words text-sm font-semibold">{company.accountName}</p>
            <p className="mt-1 text-xs text-muted-foreground">{company.machineCount == null ? 'Machine count unavailable' : `${company.machineCount} ${company.machineCount === 1 ? 'machine' : 'machines'}`}{company.archivedAt ? ' · Archived' : company.status !== 'active' ? ' · Inactive' : ''}</p>
            {!company.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Reload companies to enable changes.</p>}
            {editing?.accountId === company.accountId ? <div className="mt-3">{nameEditor}</div> : <div className="mt-2 flex flex-wrap gap-2">
              <Button ref={button => { if (button) rowRefs.current.set(company.accountId, button); else rowRefs.current.delete(company.accountId); }} type="button" variant="outline" className="min-h-11" disabled={busy || Boolean(editing) || adding || !company.updatedAt} aria-label={`Rename ${company.accountName}`} onClick={() => { setEditing(company); setName(company.accountName); setError(''); setNotice(''); }}>Rename</Button>
              <Button type="button" variant="ghost" className="min-h-11" disabled={busy || Boolean(editing) || adding || !company.updatedAt} aria-label={`${company.archivedAt ? 'Restore' : 'Archive'} ${company.accountName}`} onClick={() => void save(company, company.archivedAt ? 'restore' : 'archive')}>{company.archivedAt ? 'Restore' : 'Archive'}</Button>
            </div>}
          </div>)}</div>
          {!visible.length && <p className="py-4 text-sm text-muted-foreground">{companies.length ? 'No companies available for new assignments. Turn on Show archived to restore one.' : 'No companies yet. Add a company to use in machine setup.'}</p>}
        </>}
      </div>
    </SheetContent>
  </Sheet>;
}

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Search } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
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
import { Textarea } from '@/components/ui/textarea';
import {
  fetchPartnershipReportingSetup,
  upsertReportingPartnerAdmin,
  type PartnershipReportingSetup,
  type ReportingPartner,
} from '@/lib/partnershipReporting';
import { formatLabel, partnerTypes, statuses } from '@/pages/admin/reportingSetupUi';

const setupQueryKey = ['admin-partnership-reporting-setup'];

const emptySetup: PartnershipReportingSetup = {
  partners: [],
  partnerships: [],
  machines: [],
  assignments: [],
  parties: [],
  taxRates: [],
  financialRules: [],
  warnings: [],
};

const emptyPartnerForm = {
  partnerId: null as string | null,
  name: '',
  partnerType: 'revenue_share_partner',
  primaryContactName: '',
  primaryContactEmail: '',
  status: 'active',
  notes: '',
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export default function AdminPartnerRecordsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingPartner, setEditingPartner] = useState<ReportingPartner | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const {
    data: setup = emptySetup,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: setupQueryKey,
    queryFn: fetchPartnershipReportingSetup,
    staleTime: 1000 * 30,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: setupQueryKey });

  const filteredPartners = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return setup.partners
      .filter((partner) => statusFilter === 'all' || partner.status === statusFilter)
      .filter((partner) => {
        if (!normalizedSearch) return true;
        return [
          partner.name,
          partner.partner_type,
          partner.primary_contact_name ?? '',
          partner.primary_contact_email ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch);
      });
  }, [search, setup.partners, statusFilter]);

  const participantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    setup.parties.forEach((party) => {
      counts.set(party.partner_id, (counts.get(party.partner_id) ?? 0) + 1);
    });
    return counts;
  }, [setup.parties]);

  const openCreate = () => {
    setEditingPartner(null);
    setIsDialogOpen(true);
  };

  const openEdit = (partner: ReportingPartner) => {
    setEditingPartner(partner);
    setIsDialogOpen(true);
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
                Partner Records
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Manage reusable organizations and contacts. Add them to a partnership as
                participants when an agreement needs more than one external entity.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refresh} disabled={isFetching}>
                {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New Partner Record
              </Button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load partner records.
            </div>
          )}

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <Label htmlFor="partner-record-search">Search partner records</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="partner-record-search"
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Name, contact, email, type"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="partner-record-status">Status</Label>
                <select
                  id="partner-record-status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All statuses</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {formatLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <h2 className="font-semibold text-foreground">Records</h2>
              <Badge variant="outline">{filteredPartners.length}</Badge>
            </div>

            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading partner records...</div>
            ) : filteredPartners.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No partner records match this filter.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Type</th>
                      <th className="px-4 py-3 text-left font-semibold">Primary contact</th>
                      <th className="px-4 py-3 text-left font-semibold">Email</th>
                      <th className="px-4 py-3 text-left font-semibold">Usage</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background">
                    {filteredPartners.map((partner) => (
                      <tr key={partner.id}>
                        <td className="px-4 py-3 font-medium text-foreground">{partner.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatLabel(partner.partner_type)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {partner.primary_contact_name ?? 'n/a'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {partner.primary_contact_email ?? 'n/a'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {participantCounts.get(partner.id) ?? 0} partnership participants
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={partner.status === 'active' ? 'default' : 'outline'}>
                            {partner.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="outline" size="sm" onClick={() => openEdit(partner)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <PartnerRecordDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        partner={editingPartner}
        existingPartners={setup.partners}
        onSaved={refresh}
      />
    </AppLayout>
  );
}

function PartnerRecordDialog({
  open,
  onOpenChange,
  partner,
  existingPartners,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partner: ReportingPartner | null;
  existingPartners: ReportingPartner[];
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState(emptyPartnerForm);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!partner) {
      setForm(emptyPartnerForm);
      return;
    }

    setForm({
      partnerId: partner.id,
      name: partner.name,
      partnerType: partner.partner_type,
      primaryContactName: partner.primary_contact_name ?? '',
      primaryContactEmail: partner.primary_contact_email ?? '',
      status: partner.status,
      notes: partner.notes ?? '',
    });
  }, [open, partner]);

  const savePartner = async () => {
    const name = form.name.trim();
    const primaryContactName = form.primaryContactName.trim();
    const primaryContactEmail = form.primaryContactEmail.trim();
    const notes = form.notes.trim();

    if (!name) {
      toast.error('Partner record name is required.');
      return;
    }

    if (primaryContactEmail && !emailPattern.test(primaryContactEmail)) {
      toast.error('Enter a valid contact email address.');
      return;
    }

    const duplicatePartner = existingPartners.find(
      (candidate) =>
        candidate.id !== form.partnerId &&
        normalizeComparableText(candidate.name) === normalizeComparableText(name)
    );
    if (duplicatePartner) {
      toast.error('A partner record with this name already exists.');
      return;
    }

    setIsSaving(true);
    try {
      await upsertReportingPartnerAdmin({
        ...form,
        name,
        primaryContactName: primaryContactName || null,
        primaryContactEmail: primaryContactEmail || null,
        notes: notes || null,
        reason: form.partnerId ? 'Partner record updated' : 'Partner record created',
      });
      toast.success(form.partnerId ? 'Partner record updated.' : 'Partner record created.');
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save partner record.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.partnerId ? 'Edit Partner Record' : 'New Partner Record'}</DialogTitle>
          <DialogDescription>
            These records are reusable across partnerships and reporting workflows.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="partner-record-name">Name</Label>
            <Input
              id="partner-record-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="partner-record-type">Type</Label>
            <FieldSelect
              id="partner-record-type"
              value={form.partnerType}
              onChange={(partnerType) => setForm({ ...form, partnerType })}
              options={partnerTypes}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="partner-record-contact-name">Primary contact</Label>
              <Input
                id="partner-record-contact-name"
                value={form.primaryContactName}
                onChange={(event) => setForm({ ...form, primaryContactName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="partner-record-contact-email">Contact email</Label>
              <Input
                id="partner-record-contact-email"
                type="email"
                value={form.primaryContactEmail}
                onChange={(event) => setForm({ ...form, primaryContactEmail: event.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="partner-record-status-field">Status</Label>
            <FieldSelect
              id="partner-record-status-field"
              value={form.status}
              onChange={(status) => setForm({ ...form, status })}
              options={statuses}
            />
          </div>
          <div>
            <Label htmlFor="partner-record-notes">Notes</Label>
            <Textarea
              id="partner-record-notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={savePartner} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Save Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {formatLabel(option)}
        </option>
      ))}
    </select>
  );
}

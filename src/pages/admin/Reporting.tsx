import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createReportScheduleAdmin,
  fetchAdminReportingAccessMatrix,
  fetchAdminReportingOverview,
  grantMachineReportAccessAdmin,
  lookupReportingUserByEmailAdmin,
  revokeReportingAccessAdmin,
  type AdminReportingAccessGrant,
  type AdminReportingAccessMachine,
  type AdminReportingAccessPerson,
  type ReportingAccessLevel,
  type ReportingMachineType,
  upsertReportingMachineAdmin,
} from '@/lib/reporting';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';

const machineTypes: ReportingMachineType[] = ['commercial', 'mini', 'micro', 'unknown'];
const accessLevels: ReportingAccessLevel[] = ['viewer', 'report_manager'];

const emptyMatrix = {
  people: [] as AdminReportingAccessPerson[],
  machines: [] as AdminReportingAccessMachine[],
  grants: [] as AdminReportingAccessGrant[],
};

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'n/a';

const formatShortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'n/a';

const splitEmails = (value: string) =>
  value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const isMachineGrant = (grant: AdminReportingAccessGrant) =>
  grant.scopeType === 'machine' && Boolean(grant.machineId);

const machineNeedsMapping = (machine: AdminReportingAccessMachine) =>
  machine.accountName === 'Sunze Import Holding' ||
  machine.locationName === 'Unmapped Sunze Machines' ||
  machine.machineType === 'unknown';

const mergePeople = (
  matrixPeople: AdminReportingAccessPerson[],
  localPeople: AdminReportingAccessPerson[]
) => {
  const byUserId = new Map<string, AdminReportingAccessPerson>();

  [...localPeople, ...matrixPeople].forEach((person) => {
    byUserId.set(person.userId, person);
  });

  return [...byUserId.values()].sort((left, right) => {
    if (left.isSuperAdmin !== right.isSuperAdmin) {
      return left.isSuperAdmin ? -1 : 1;
    }

    return (left.userEmail ?? left.userId).localeCompare(right.userEmail ?? right.userId);
  });
};

const groupMachines = (machines: AdminReportingAccessMachine[]) => {
  const groups = new Map<string, AdminReportingAccessMachine[]>();

  machines.forEach((machine) => {
    const key = `${machine.accountName}||${machine.locationName}`;
    const current = groups.get(key) ?? [];
    current.push(machine);
    groups.set(key, current);
  });

  return [...groups.entries()].map(([key, values]) => {
    const [accountName, locationName] = key.split('||');
    return {
      key,
      accountName,
      locationName,
      machines: values,
    };
  });
};

export default function AdminReportingPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('access');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [localPeople, setLocalPeople] = useState<AdminReportingAccessPerson[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [accessReason, setAccessReason] = useState('');
  const [accessLevel, setAccessLevel] = useState<ReportingAccessLevel>('viewer');
  const [isLookingUpUser, setIsLookingUpUser] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [accessMachineSearch, setAccessMachineSearch] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [machineForm, setMachineForm] = useState({
    machineId: null as string | null,
    accountName: '',
    locationName: '',
    machineLabel: '',
    machineType: 'unknown' as ReportingMachineType,
    sunzeMachineId: '',
    reason: 'Machine mapping update',
  });
  const [scheduleForm, setScheduleForm] = useState({
    title: 'Bubble Planet weekly machine sales',
    machineId: '',
    recipients: '',
    dayOfWeek: '1',
    sendHourLocal: '9',
    timezone: 'America/Los_Angeles',
  });
  const [isSavingMachine, setIsSavingMachine] = useState(false);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);

  const {
    data: matrix = emptyMatrix,
    isLoading: matrixLoading,
    isFetching: matrixFetching,
    error: matrixError,
  } = useQuery({
    queryKey: ['admin-reporting-access-matrix'],
    queryFn: fetchAdminReportingAccessMatrix,
    staleTime: 1000 * 30,
  });

  const {
    data: overview,
    isLoading: overviewLoading,
    isFetching: overviewFetching,
    error: overviewError,
  } = useQuery({
    queryKey: ['admin-reporting-overview'],
    queryFn: fetchAdminReportingOverview,
    staleTime: 1000 * 30,
  });

  const people = useMemo(
    () => mergePeople(matrix.people, localPeople),
    [localPeople, matrix.people]
  );
  const machines = useMemo(() => matrix.machines, [matrix.machines]);
  const grants = useMemo(() => matrix.grants, [matrix.grants]);
  const importRuns = useMemo(() => overview?.importRuns ?? [], [overview?.importRuns]);
  const schedules = useMemo(() => overview?.schedules ?? [], [overview?.schedules]);

  const selectedPerson = people.find((person) => person.userId === selectedUserId) ?? null;

  const selectedMachineGrantByMachineId = useMemo(() => {
    const grantMap = new Map<string, AdminReportingAccessGrant>();

    grants
      .filter((grant) => grant.userId === selectedUserId && isMachineGrant(grant))
      .forEach((grant) => {
        if (grant.machineId) {
          grantMap.set(grant.machineId, grant);
        }
      });

    return grantMap;
  }, [grants, selectedUserId]);

  const originalMachineIds = useMemo(
    () => new Set(selectedMachineGrantByMachineId.keys()),
    [selectedMachineGrantByMachineId]
  );

  const filteredPeople = useMemo(() => {
    const search = normalizeSearch(peopleSearch);

    if (!search) {
      return people;
    }

    return people.filter((person) =>
      `${person.userEmail ?? ''} ${person.userId}`.toLowerCase().includes(search)
    );
  }, [people, peopleSearch]);

  const filteredAccessMachines = useMemo(() => {
    const search = normalizeSearch(accessMachineSearch);

    if (!search) {
      return machines;
    }

    return machines.filter((machine) =>
      [
        machine.machineLabel,
        machine.sunzeMachineId ?? '',
        machine.accountName,
        machine.locationName,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [accessMachineSearch, machines]);

  const filteredMappingMachines = useMemo(() => {
    const search = normalizeSearch(machineSearch);

    if (!search) {
      return machines;
    }

    return machines.filter((machine) =>
      [
        machine.machineLabel,
        machine.sunzeMachineId ?? '',
        machine.accountName,
        machine.locationName,
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }, [machineSearch, machines]);

  const groupedAccessMachines = useMemo(
    () => groupMachines(filteredAccessMachines),
    [filteredAccessMachines]
  );

  const machineOptions = useMemo(
    () =>
      machines.map((machine) => ({
        id: machine.id,
        label: `${machine.machineLabel} (${machine.sunzeMachineId ?? 'no Sunze ID'})`,
      })),
    [machines]
  );

  const unmappedMachineCount = useMemo(
    () => machines.filter(machineNeedsMapping).length,
    [machines]
  );

  const addedMachineIds = useMemo(
    () => [...selectedMachineIds].filter((machineId) => !originalMachineIds.has(machineId)),
    [originalMachineIds, selectedMachineIds]
  );

  const removedMachineIds = useMemo(
    () => [...originalMachineIds].filter((machineId) => !selectedMachineIds.has(machineId)),
    [originalMachineIds, selectedMachineIds]
  );

  const hasAccessChanges = addedMachineIds.length > 0 || removedMachineIds.length > 0;
  const isLoading = matrixLoading || overviewLoading;
  const isFetching = matrixFetching || overviewFetching;

  useEffect(() => {
    if (!selectedUserId && people.length > 0) {
      setSelectedUserId(people[0].userId);
      return;
    }

    if (selectedUserId && people.length > 0 && !people.some((person) => person.userId === selectedUserId)) {
      setSelectedUserId(people[0].userId);
    }
  }, [people, selectedUserId]);

  useEffect(() => {
    setSelectedMachineIds(new Set(originalMachineIds));
    setAccessReason('');
  }, [originalMachineIds, selectedUserId]);

  const refreshReporting = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-reporting-access-matrix'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-reporting-overview'] }),
    ]);
  };

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachineIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(machineId);
      } else {
        next.delete(machineId);
      }

      return next;
    });
  };

  const lookupUser = async () => {
    if (!lookupEmail.trim()) {
      toast.error('Enter a user email first.');
      return;
    }

    setIsLookingUpUser(true);
    try {
      const person = await lookupReportingUserByEmailAdmin(lookupEmail);
      setLocalPeople((current) => {
        const withoutPerson = current.filter((entry) => entry.userId !== person.userId);
        return [person, ...withoutPerson];
      });
      setSelectedUserId(person.userId);
      setPeopleSearch('');
      setLookupEmail('');
      trackEvent('admin_reporting_user_lookup', { user_id: person.userId });
      toast.success('User found.');
    } catch (lookupError) {
      toast.error(lookupError instanceof Error ? lookupError.message : 'Unable to find user.');
    } finally {
      setIsLookingUpUser(false);
    }
  };

  const saveAccessChanges = async () => {
    if (!selectedPerson) {
      toast.error('Select a person first.');
      return;
    }

    if (selectedPerson.isSuperAdmin) {
      toast.error('Super-admin reporting access is managed from Governance & Audit.');
      return;
    }

    if (!hasAccessChanges) {
      toast.error('No access changes to save.');
      return;
    }

    if (!accessReason.trim()) {
      toast.error('A reason is required before saving access changes.');
      return;
    }

    setIsSavingAccess(true);
    try {
      await Promise.all([
        ...addedMachineIds.map((machineId) =>
          grantMachineReportAccessAdmin({
            userEmail: selectedPerson.userEmail ?? '',
            machineId,
            accessLevel,
            reason: accessReason.trim(),
          })
        ),
        ...removedMachineIds.map((machineId) => {
          const grant = selectedMachineGrantByMachineId.get(machineId);

          if (!grant) {
            return Promise.resolve(null);
          }

          return revokeReportingAccessAdmin({
            entitlementId: grant.id,
            reason: accessReason.trim(),
          });
        }),
      ]);

      trackEvent('admin_reporting_access_matrix_saved', {
        user_id: selectedPerson.userId,
        grants_added: addedMachineIds.length,
        grants_removed: removedMachineIds.length,
      });
      toast.success('Reporting access updated.');
      await refreshReporting();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to update access.');
    } finally {
      setIsSavingAccess(false);
    }
  };

  const startMachineEdit = (machine: AdminReportingAccessMachine) => {
    setMachineForm({
      machineId: machine.id,
      accountName: machine.accountName,
      locationName: machine.locationName,
      machineLabel: machine.machineLabel,
      machineType: machine.machineType,
      sunzeMachineId: machine.sunzeMachineId ?? '',
      reason: 'Machine mapping update',
    });
    setActiveTab('machines');
  };

  const focusMachineAccess = (machine: AdminReportingAccessMachine) => {
    setAccessMachineSearch(machine.machineLabel);
    setActiveTab('access');
  };

  const saveMachine = async () => {
    if (!machineForm.accountName.trim() || !machineForm.locationName.trim()) {
      toast.error('Account and location are required.');
      return;
    }

    if (!machineForm.machineLabel.trim() || !machineForm.reason.trim()) {
      toast.error('Machine label and reason are required.');
      return;
    }

    setIsSavingMachine(true);
    try {
      await upsertReportingMachineAdmin({
        machineId: machineForm.machineId,
        accountName: machineForm.accountName.trim(),
        locationName: machineForm.locationName.trim(),
        machineLabel: machineForm.machineLabel.trim(),
        machineType: machineForm.machineType,
        sunzeMachineId: machineForm.sunzeMachineId.trim() || null,
        reason: machineForm.reason.trim(),
      });
      trackEvent('admin_reporting_machine_upserted', {
        sunze_machine_id: machineForm.sunzeMachineId.trim(),
      });
      toast.success('Machine mapping saved.');
      await refreshReporting();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Unable to save machine.');
    } finally {
      setIsSavingMachine(false);
    }
  };

  const createSchedule = async () => {
    const recipientEmails = splitEmails(scheduleForm.recipients);
    if (!scheduleForm.title.trim() || recipientEmails.length === 0) {
      toast.error('Schedule title and at least one recipient are required.');
      return;
    }

    setIsCreatingSchedule(true);
    try {
      await createReportScheduleAdmin({
        title: scheduleForm.title.trim(),
        filters: {
          title: scheduleForm.title.trim(),
          datePreset: 'previous_week',
          grain: 'week',
          machineIds: scheduleForm.machineId ? [scheduleForm.machineId] : [],
          paymentMethods: [],
        },
        recipientEmails,
        dayOfWeek: Number(scheduleForm.dayOfWeek),
        sendHourLocal: Number(scheduleForm.sendHourLocal),
        timezone: scheduleForm.timezone,
      });
      trackEvent('admin_report_schedule_created', {
        title: scheduleForm.title.trim(),
        recipient_count: recipientEmails.length,
      });
      toast.success('Report schedule created.');
      await refreshReporting();
    } catch (scheduleError) {
      toast.error(
        scheduleError instanceof Error ? scheduleError.message : 'Unable to create schedule.'
      );
    } finally {
      setIsCreatingSchedule(false);
    }
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
                Sales Reporting
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage who can see each machine, map Sunze machines, and monitor report delivery.
              </p>
            </div>
            <Button variant="outline" onClick={refreshReporting} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          {(matrixError || overviewError) && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load reporting administration data.
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                People
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{people.length}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Machines
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{machines.length}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs Mapping
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{unmappedMachineCount}</p>
            </div>
            <div className="card-elevated p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Last Import
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {formatDate(importRuns[0]?.completed_at ?? importRuns[0]?.created_at ?? null)}
              </p>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-grid sm:w-auto sm:grid-cols-4">
              <TabsTrigger value="access" className="gap-2">
                <Users className="h-4 w-4" />
                Access
              </TabsTrigger>
              <TabsTrigger value="machines" className="gap-2">
                <Settings2 className="h-4 w-4" />
                Machines
              </TabsTrigger>
              <TabsTrigger value="schedules" className="gap-2">
                <CalendarDays className="h-4 w-4" />
                Schedules
              </TabsTrigger>
              <TabsTrigger value="sync" className="gap-2">
                <Database className="h-4 w-4" />
                Sync
              </TabsTrigger>
            </TabsList>

            <TabsContent value="access" className="mt-6">
              <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
                <div className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-foreground">People</h2>
                        <p className="text-sm text-muted-foreground">
                          Explicit machine grants by user.
                        </p>
                      </div>
                      <Users className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={peopleSearch}
                          onChange={(event) => setPeopleSearch(event.target.value)}
                          placeholder="Search people"
                          className="pl-9"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="email"
                          value={lookupEmail}
                          onChange={(event) => setLookupEmail(event.target.value)}
                          placeholder="Add existing user by email"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              void lookupUser();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={lookupUser}
                          disabled={isLookingUpUser}
                          aria-label="Find user"
                        >
                          {isLookingUpUser ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <UserPlus className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="max-h-[640px] overflow-y-auto p-2">
                    {isLoading && (
                      <div className="p-4 text-sm text-muted-foreground">Loading access...</div>
                    )}
                    {!isLoading && filteredPeople.length === 0 && (
                      <div className="p-4 text-sm text-muted-foreground">
                        No people match this search.
                      </div>
                    )}
                    {filteredPeople.map((person) => (
                      <button
                        key={person.userId}
                        type="button"
                        onClick={() => setSelectedUserId(person.userId)}
                        className={cn(
                          'mb-2 w-full rounded-md border border-transparent p-3 text-left transition hover:bg-muted/60',
                          selectedUserId === person.userId
                            ? 'border-primary/30 bg-primary/5'
                            : 'bg-background'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {person.userEmail ?? person.userId}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {person.userId}
                            </p>
                          </div>
                          {person.isSuperAdmin && (
                            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {person.isSuperAdmin ? (
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                              Super-admin
                            </Badge>
                          ) : person.explicitMachineCount > 0 ? (
                            <Badge variant="secondary">
                              {person.explicitMachineCount} machine
                              {person.explicitMachineCount === 1 ? '' : 's'}
                            </Badge>
                          ) : (
                            <Badge variant="outline">No machine grants</Badge>
                          )}
                          {person.inheritedGrantCount > 0 && (
                            <Badge variant="outline">{person.inheritedGrantCount} inherited</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border p-4">
                    {selectedPerson ? (
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold text-foreground">
                              {selectedPerson.userEmail ?? selectedPerson.userId}
                            </h2>
                            {selectedPerson.isSuperAdmin && (
                              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                                All machines via super-admin
                              </Badge>
                            )}
                            {!selectedPerson.isSuperAdmin &&
                              selectedPerson.explicitMachineCount === 0 && (
                                <Badge variant="outline">No machine grants</Badge>
                              )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {selectedPerson.isSuperAdmin
                              ? 'Reporting access is inherited from the super-admin role.'
                              : `${selectedMachineIds.size} selected machine${
                                  selectedMachineIds.size === 1 ? '' : 's'
                                }.`}
                          </p>
                        </div>
                        {selectedPerson.isSuperAdmin ? (
                          <Button asChild variant="outline">
                            <Link to="/admin/audit">Manage Super-Admins</Link>
                          </Button>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-[180px_minmax(260px,1fr)_auto]">
                            <div>
                              <Label htmlFor="access-level">New grant level</Label>
                              <select
                                id="access-level"
                                value={accessLevel}
                                onChange={(event) =>
                                  setAccessLevel(event.target.value as ReportingAccessLevel)
                                }
                                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                {accessLevels.map((level) => (
                                  <option key={level} value={level}>
                                    {level}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <Label htmlFor="access-reason">Save reason</Label>
                              <Input
                                id="access-reason"
                                value={accessReason}
                                onChange={(event) => setAccessReason(event.target.value)}
                                placeholder="Partner reporting access update"
                                className="mt-1"
                              />
                            </div>
                            <div className="flex items-end">
                              <Button
                                onClick={saveAccessChanges}
                                disabled={isSavingAccess || !hasAccessChanges}
                                className="w-full"
                              >
                                {isSavingAccess ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  'Save Access'
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <h2 className="font-semibold text-foreground">Select a person</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Find an existing user by email, then assign machine visibility.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="border-b border-border p-4">
                    <div className="relative max-w-xl">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={accessMachineSearch}
                        onChange={(event) => setAccessMachineSearch(event.target.value)}
                        placeholder="Filter machines by label, Sunze ID, account, or location"
                        className="pl-9"
                      />
                    </div>
                  </div>

                  <div className="max-h-[680px] overflow-y-auto p-4">
                    {groupedAccessMachines.length === 0 ? (
                      <div className="rounded-md border border-border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
                        No machines match this filter.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {groupedAccessMachines.map((group) => (
                          <div key={group.key}>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {group.accountName}
                              </p>
                              <span className="text-xs text-muted-foreground">/</span>
                              <p className="text-sm text-muted-foreground">{group.locationName}</p>
                            </div>
                            <div className="overflow-hidden rounded-md border border-border">
                              {group.machines.map((machine) => {
                                const checked = selectedMachineIds.has(machine.id);
                                const grant = selectedMachineGrantByMachineId.get(machine.id);

                                return (
                                  <label
                                    key={machine.id}
                                    className={cn(
                                      'flex cursor-pointer items-start gap-3 border-b border-border bg-background p-3 last:border-b-0',
                                      selectedPerson?.isSuperAdmin && 'cursor-default opacity-80'
                                    )}
                                  >
                                    <Checkbox
                                      checked={selectedPerson?.isSuperAdmin ? true : checked}
                                      disabled={!selectedPerson || selectedPerson.isSuperAdmin}
                                      onCheckedChange={(value) => toggleMachine(machine.id, Boolean(value))}
                                      className="mt-1"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-foreground">
                                          {machine.machineLabel}
                                        </span>
                                        {machineNeedsMapping(machine) && (
                                          <Badge variant="outline" className="text-amber-700">
                                            Needs mapping
                                          </Badge>
                                        )}
                                        {grant && (
                                          <Badge variant="secondary">{grant.accessLevel}</Badge>
                                        )}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                        <span>Sunze: {machine.sunzeMachineId ?? 'n/a'}</span>
                                        <span>Latest sale: {formatShortDate(machine.latestSaleDate)}</span>
                                        <span>
                                          Viewers: {machine.viewerCount}
                                        </span>
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="machines" className="mt-6">
              <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-semibold text-foreground">Machine Mapping</h2>
                      <p className="text-sm text-muted-foreground">
                        Assign Sunze machines to reporting account and location names.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-4">
                    <div>
                      <Label htmlFor="machine-account">Account</Label>
                      <Input
                        id="machine-account"
                        value={machineForm.accountName}
                        onChange={(event) =>
                          setMachineForm((current) => ({
                            ...current,
                            accountName: event.target.value,
                          }))
                        }
                        placeholder="Bubble Planet"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="machine-location">Location</Label>
                      <Input
                        id="machine-location"
                        value={machineForm.locationName}
                        onChange={(event) =>
                          setMachineForm((current) => ({
                            ...current,
                            locationName: event.target.value,
                          }))
                        }
                        placeholder="Bubble Planet"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="machine-label">Machine Label</Label>
                      <Input
                        id="machine-label"
                        value={machineForm.machineLabel}
                        onChange={(event) =>
                          setMachineForm((current) => ({
                            ...current,
                            machineLabel: event.target.value,
                          }))
                        }
                        placeholder="Bubble Planet Machine 1"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="machine-type">Machine Type</Label>
                      <select
                        id="machine-type"
                        value={machineForm.machineType}
                        onChange={(event) =>
                          setMachineForm((current) => ({
                            ...current,
                            machineType: event.target.value as ReportingMachineType,
                          }))
                        }
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {machineTypes.map((machineType) => (
                          <option key={machineType} value={machineType}>
                            {machineType}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="machine-sunze-id">Sunze Machine ID</Label>
                      <Input
                        id="machine-sunze-id"
                        value={machineForm.sunzeMachineId}
                        onChange={(event) =>
                          setMachineForm((current) => ({
                            ...current,
                            sunzeMachineId: event.target.value,
                          }))
                        }
                        placeholder="Machine code from Sunze"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="machine-reason">Save Reason</Label>
                      <Input
                        id="machine-reason"
                        value={machineForm.reason}
                        onChange={(event) =>
                          setMachineForm((current) => ({ ...current, reason: event.target.value }))
                        }
                        placeholder="Correct machine location"
                        className="mt-1"
                      />
                    </div>
                    <Button onClick={saveMachine} disabled={isSavingMachine}>
                      {isSavingMachine ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        'Save Mapping'
                      )}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card">
                  <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="font-semibold text-foreground">Reporting Machines</h2>
                      <p className="text-sm text-muted-foreground">
                        Current Sunze mapping and viewer counts.
                      </p>
                    </div>
                    <div className="relative md:w-80">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={machineSearch}
                        onChange={(event) => setMachineSearch(event.target.value)}
                        placeholder="Search machines"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Machine</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Viewers</TableHead>
                        <TableHead>Latest Sale</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMappingMachines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                            No reporting machines found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredMappingMachines.map((machine) => (
                          <TableRow key={machine.id}>
                            <TableCell>
                              <div className="font-medium text-foreground">
                                {machine.machineLabel}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Sunze: {machine.sunzeMachineId ?? 'n/a'}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge variant="secondary">{machine.machineType}</Badge>
                                {machineNeedsMapping(machine) ? (
                                  <Badge variant="outline" className="text-amber-700">
                                    Needs mapping
                                  </Badge>
                                ) : (
                                  <Badge className="bg-sage-light text-sage hover:bg-sage-light">
                                    Mapped
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-foreground">{machine.accountName}</div>
                              <div className="text-xs text-muted-foreground">
                                {machine.locationName}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-foreground">{machine.viewerCount}</div>
                              <div className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
                                {machine.viewers.map((viewer) => viewer.userEmail ?? viewer.userId).join(', ') ||
                                  'No explicit viewers'}
                              </div>
                            </TableCell>
                            <TableCell>{formatShortDate(machine.latestSaleDate)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startMachineEdit(machine)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => focusMachineAccess(machine)}
                                >
                                  Access
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="schedules" className="mt-6">
              <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
                <div className="rounded-lg border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Partner PDF Schedule</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create weekly PDF delivery for a machine filter.
                  </p>
                  <div className="mt-5 space-y-4">
                    <div>
                      <Label htmlFor="schedule-title">Title</Label>
                      <Input
                        id="schedule-title"
                        value={scheduleForm.title}
                        onChange={(event) =>
                          setScheduleForm((current) => ({ ...current, title: event.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="schedule-machine">Machine Filter</Label>
                      <select
                        id="schedule-machine"
                        value={scheduleForm.machineId}
                        onChange={(event) =>
                          setScheduleForm((current) => ({
                            ...current,
                            machineId: event.target.value,
                          }))
                        }
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">All machines in report filter</option>
                        {machineOptions.map((machine) => (
                          <option key={machine.id} value={machine.id}>
                            {machine.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="schedule-recipients">Recipients</Label>
                      <Input
                        id="schedule-recipients"
                        value={scheduleForm.recipients}
                        onChange={(event) =>
                          setScheduleForm((current) => ({
                            ...current,
                            recipients: event.target.value,
                          }))
                        }
                        placeholder="partner@example.com, finance@example.com"
                        className="mt-1"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="schedule-day">Day</Label>
                        <Input
                          id="schedule-day"
                          type="number"
                          min={0}
                          max={6}
                          value={scheduleForm.dayOfWeek}
                          onChange={(event) =>
                            setScheduleForm((current) => ({
                              ...current,
                              dayOfWeek: event.target.value,
                            }))
                          }
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="schedule-hour">Hour</Label>
                        <Input
                          id="schedule-hour"
                          type="number"
                          min={0}
                          max={23}
                          value={scheduleForm.sendHourLocal}
                          onChange={(event) =>
                            setScheduleForm((current) => ({
                              ...current,
                              sendHourLocal: event.target.value,
                            }))
                          }
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="schedule-timezone">Timezone</Label>
                      <Input
                        id="schedule-timezone"
                        value={scheduleForm.timezone}
                        onChange={(event) =>
                          setScheduleForm((current) => ({
                            ...current,
                            timezone: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <Button onClick={createSchedule} disabled={isCreatingSchedule}>
                      {isCreatingSchedule ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create Schedule'
                      )}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Active Schedules</h2>
                  <div className="mt-4 space-y-3">
                    {schedules.length === 0 ? (
                      <div className="rounded-md border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                        No scheduled PDFs yet.
                      </div>
                    ) : (
                      schedules.map((schedule) => (
                        <div key={schedule.id} className="rounded-md border border-border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-semibold text-foreground">{schedule.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {schedule.schedule_kind}, day {schedule.send_day_of_week} at{' '}
                                {schedule.send_hour_local}:00 {schedule.timezone}
                              </p>
                            </div>
                            <Badge variant={schedule.active ? 'default' : 'secondary'}>
                              {schedule.active ? 'active' : 'paused'}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">
                            Recipients:{' '}
                            {schedule.report_schedule_recipients
                              ?.map((recipient) => recipient.email)
                              .join(', ') || 'none'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="sync" className="mt-6">
              <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
                <div className="rounded-lg border border-border bg-card p-5">
                  <h2 className="font-semibold text-foreground">Sunze Sync</h2>
                  <div className="mt-5 space-y-4">
                    <div className="flex items-start gap-3">
                      {importRuns[0]?.status === 'completed' ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 text-sage" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {importRuns[0]?.status ?? 'No imports yet'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(importRuns[0]?.completed_at ?? importRuns[0]?.created_at ?? null)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Latest rows
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">
                        {importRuns[0] ? `${importRuns[0].rows_imported}/${importRuns[0].rows_seen}` : '0/0'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="font-semibold text-foreground">Recent Import Runs</h2>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Rows</TableHead>
                        <TableHead>Completed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importRuns.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                            No imports recorded yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        importRuns.map((run) => (
                          <TableRow key={run.id}>
                            <TableCell>
                              <div className="font-medium text-foreground">{run.source}</div>
                              <div className="text-xs text-muted-foreground">
                                {run.source_reference ?? run.id}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={run.status === 'completed' ? 'default' : 'outline'}>
                                {run.status}
                              </Badge>
                              {run.error_message && (
                                <p className="mt-1 text-xs text-destructive">{run.error_message}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              {run.rows_imported}/{run.rows_seen}
                            </TableCell>
                            <TableCell>{formatDate(run.completed_at ?? run.created_at)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </AppLayout>
  );
}

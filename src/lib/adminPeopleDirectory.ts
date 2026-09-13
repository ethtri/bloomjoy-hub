import { supabaseClient } from '@/lib/supabaseClient';

export type AdminAccessPersonStatus = 'needs_attention' | 'invited' | 'active' | 'inactive';

export type AdminAccessPerson = {
  personKey: string;
  userId: string | null;
  email: string | null;
  displayName: string;
  roles: string[];
  accountNames: string[];
  machineCount: number;
  status: AdminAccessPersonStatus;
  attentionReason: string | null;
  operatorProfileId: string | null;
  updatedAt: string;
};

export type AdminPeopleDirectory = {
  items: AdminAccessPerson[];
  totalCount: number;
  roles: string[];
  accounts: Array<{ id: string; name: string }>;
  machines: Array<{ id: string; label: string }>;
  updatedAt: string;
};

export type AdminPeopleDirectoryFilters = {
  search?: string;
  role?: string;
  accountId?: string;
  status?: AdminAccessPersonStatus;
  machineId?: string;
  limit?: number;
  offset?: number;
};

const emptyDirectory = (): AdminPeopleDirectory => ({
  items: [],
  totalCount: 0,
  roles: [],
  accounts: [],
  machines: [],
  updatedAt: new Date().toISOString(),
});

export async function fetchAdminPeopleDirectory(
  filters: AdminPeopleDirectoryFilters = {}
): Promise<AdminPeopleDirectory> {
  const { data, error } = await supabaseClient.rpc('admin_list_access_people', {
    p_search: filters.search?.trim() || null,
    p_role: filters.role || null,
    p_account_id: filters.accountId || null,
    p_status: filters.status || null,
    p_machine_id: filters.machineId || null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load the people directory.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyDirectory();

  const directory = data as unknown as Partial<AdminPeopleDirectory>;
  return {
    items: Array.isArray(directory.items) ? directory.items : [],
    totalCount: typeof directory.totalCount === 'number' ? directory.totalCount : 0,
    roles: Array.isArray(directory.roles) ? directory.roles : [],
    accounts: Array.isArray(directory.accounts) ? directory.accounts : [],
    machines: Array.isArray(directory.machines) ? directory.machines : [],
    updatedAt: typeof directory.updatedAt === 'string' ? directory.updatedAt : new Date().toISOString(),
  };
}

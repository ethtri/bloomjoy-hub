import { supabaseClient } from '@/lib/supabaseClient';
import type { CompanyChoice, CompanyChoices } from '@/lib/companyAssignment';

export const companyChoicesQueryKey = ['admin-reporting-company-choices'];
export const fetchCompanyChoices = async (): Promise<CompanyChoices> => {
  const { data, error } = await supabaseClient.rpc('admin_get_reporting_company_choices');
  if (error || !data) throw new Error(error?.message || 'Unable to load companies.');
  return data as CompanyChoices;
};

export const createReportingCompany = async (name: string): Promise<CompanyChoice & { created: boolean }> => {
  const { data, error } = await supabaseClient.rpc('admin_create_reporting_company', { p_name: name.trim() });
  if (error || !data) throw new Error(error?.message || 'Unable to create company. Your machine draft is still here.');
  return { ...(data as CompanyChoice & { created: boolean }), locations: [] };
};

export type CompanyManagementAction = 'rename' | 'archive' | 'restore';
export const manageReportingCompany = async (company: CompanyChoice, action: CompanyManagementAction, name?: string): Promise<CompanyChoice & { changed: boolean }> => {
  if (!company.updatedAt) throw new Error('Reload companies before making changes.');
  const { data, error } = await supabaseClient.rpc('admin_manage_reporting_company', {
    p_account_id: company.accountId,
    p_action: action,
    p_expected_updated_at: company.updatedAt,
    p_name: action === 'rename' ? name?.trim() : null,
    p_reason: null,
  });
  if (error || !data) throw new Error(error?.code === '40001' ? 'This company changed. Reload companies and review your changes before trying again.' : error?.message || 'Unable to save company changes. Try again.');
  return { ...(data as CompanyChoice & { changed: boolean }), locations: company.locations };
};

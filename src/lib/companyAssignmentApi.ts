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

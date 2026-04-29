import { supabaseClient } from '@/lib/supabaseClient';

export type EffectiveAccessContext = {
  userId: string | null;
  email: string | null;
  presets: string[];
  capabilities: string[];
  sources: Record<string, unknown>;
  scopes: {
    partnerIds?: string[];
    partnershipIds?: string[];
    machineIds?: string[];
    corporatePartnerMachineIds?: string[];
    technicianMachineIds?: string[];
    scopedAdminMachineIds?: string[];
  };
  warnings: string[];
};

export type CorporatePartnerMachine = {
  machineId: string;
  machineLabel: string;
  accountId: string;
  accountName: string;
  locationId: string | null;
  locationName: string | null;
  status: string;
};

export type CorporatePartnerPartnership = {
  partyId: string;
  partnershipId: string;
  partnershipName: string;
  partnershipStatus: string;
  portalAccessEnabled: boolean;
  machineCount: number;
  machines: CorporatePartnerMachine[];
};

export type CorporatePartnerMembership = {
  id: string;
  userId: string | null;
  memberEmail: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  grantReason: string;
  revokedAt: string | null;
  revokeReason: string | null;
  isActive: boolean;
};

export type CorporatePartnerOption = {
  partnerId: string;
  partnerName: string;
  partnerType: string;
  status: string;
  memberships: CorporatePartnerMembership[];
  portalPartnerships: CorporatePartnerPartnership[];
};

export type CorporatePartnerAccessOptions = {
  partners: CorporatePartnerOption[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asNullableString = (value: unknown) => (typeof value === 'string' ? value : null);
const asBoolean = (value: unknown) => Boolean(value);
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asArray = <T>(value: unknown, mapper: (item: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(mapper) : [];

const mapMachine = (item: unknown): CorporatePartnerMachine => {
  const record = isRecord(item) ? item : {};

  return {
    machineId: asString(record.machineId),
    machineLabel: asString(record.machineLabel, 'Unnamed machine'),
    accountId: asString(record.accountId),
    accountName: asString(record.accountName, 'Bloomjoy account'),
    locationId: asNullableString(record.locationId),
    locationName: asNullableString(record.locationName),
    status: asString(record.status, 'active'),
  };
};

const mapPartnership = (item: unknown): CorporatePartnerPartnership => {
  const record = isRecord(item) ? item : {};

  return {
    partyId: asString(record.partyId),
    partnershipId: asString(record.partnershipId),
    partnershipName: asString(record.partnershipName, 'Partnership'),
    partnershipStatus: asString(record.partnershipStatus, 'active'),
    portalAccessEnabled: asBoolean(record.portalAccessEnabled),
    machineCount: asNumber(record.machineCount),
    machines: asArray(record.machines, mapMachine).filter((machine) => machine.machineId),
  };
};

const mapMembership = (item: unknown): CorporatePartnerMembership => {
  const record = isRecord(item) ? item : {};

  return {
    id: asString(record.id),
    userId: asNullableString(record.userId),
    memberEmail: asString(record.memberEmail),
    status: asString(record.status, 'active'),
    startsAt: asString(record.startsAt),
    expiresAt: asNullableString(record.expiresAt),
    grantReason: asString(record.grantReason),
    revokedAt: asNullableString(record.revokedAt),
    revokeReason: asNullableString(record.revokeReason),
    isActive: asBoolean(record.isActive),
  };
};

const mapPartner = (item: unknown): CorporatePartnerOption => {
  const record = isRecord(item) ? item : {};

  return {
    partnerId: asString(record.partnerId),
    partnerName: asString(record.partnerName, 'Partner'),
    partnerType: asString(record.partnerType, 'other'),
    status: asString(record.status, 'active'),
    memberships: asArray(record.memberships, mapMembership).filter((membership) => membership.id),
    portalPartnerships: asArray(record.portalPartnerships, mapPartnership).filter(
      (partnership) => partnership.partnershipId
    ),
  };
};

export const fetchAdminCorporatePartnerAccessOptions =
  async (): Promise<CorporatePartnerAccessOptions> => {
    const { data, error } = await supabaseClient.rpc(
      'admin_get_corporate_partner_access_options'
    );

    if (error) {
      throw new Error(error.message || 'Unable to load Corporate Partner access options.');
    }

    const record = isRecord(data) ? data : {};
    return {
      partners: asArray(record.partners, mapPartner).filter((partner) => partner.partnerId),
    };
  };

export const fetchAdminEffectiveAccessContext = async (
  email: string
): Promise<EffectiveAccessContext> => {
  const { data, error } = await supabaseClient.rpc('admin_get_effective_access_context', {
    p_target_email: email.trim(),
  });

  if (error) {
    throw new Error(error.message || 'Unable to load effective access.');
  }

  const record = isRecord(data) ? data : {};
  const scopes = isRecord(record.scopes) ? record.scopes : {};

  return {
    userId: asNullableString(record.userId),
    email: asNullableString(record.email),
    presets: Array.isArray(record.presets) ? record.presets.filter(Boolean).map(String) : [],
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.filter(Boolean).map(String)
      : [],
    sources: isRecord(record.sources) ? record.sources : {},
    scopes: {
      partnerIds: Array.isArray(scopes.partnerIds) ? scopes.partnerIds.map(String) : [],
      partnershipIds: Array.isArray(scopes.partnershipIds)
        ? scopes.partnershipIds.map(String)
        : [],
      machineIds: Array.isArray(scopes.machineIds) ? scopes.machineIds.map(String) : [],
      corporatePartnerMachineIds: Array.isArray(scopes.corporatePartnerMachineIds)
        ? scopes.corporatePartnerMachineIds.map(String)
        : [],
      technicianMachineIds: Array.isArray(scopes.technicianMachineIds)
        ? scopes.technicianMachineIds.map(String)
        : [],
      scopedAdminMachineIds: Array.isArray(scopes.scopedAdminMachineIds)
        ? scopes.scopedAdminMachineIds.map(String)
        : [],
    },
    warnings: Array.isArray(record.warnings) ? record.warnings.filter(Boolean).map(String) : [],
  };
};

export const grantCorporatePartnerMembership = async (input: {
  email: string;
  partnerId: string;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_grant_corporate_partner_membership', {
    p_target_email: input.email.trim(),
    p_partner_id: input.partnerId,
    p_reason: input.reason.trim(),
    p_expires_at: null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to grant Corporate Partner access.');
  }

  return data;
};

export const revokeCorporatePartnerMembership = async (input: {
  membershipId: string;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_revoke_corporate_partner_membership', {
    p_membership_id: input.membershipId,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to revoke Corporate Partner access.');
  }

  return data;
};

export const setPartnershipPartyPortalAccess = async (input: {
  partyId: string;
  enabled: boolean;
  reason: string;
}) => {
  const { data, error } = await supabaseClient.rpc('admin_set_partnership_party_portal_access', {
    p_party_id: input.partyId,
    p_enabled: input.enabled,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update portal access.');
  }

  return data;
};

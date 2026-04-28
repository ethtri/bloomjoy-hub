import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabaseClient } from '@/lib/supabaseClient';
import { trackEvent, identifyUser } from '@/lib/analytics';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import {
  emptyPlusAccessSummary,
  hasTrainingAccess,
  normalizePortalAccessTier,
  type MembershipStatus,
  type PlusAccessSummary,
  type PortalAccessTier,
} from '@/lib/membership';
import { fetchMyPlusAccess } from '@/lib/plusAccess';
import {
  emptyReportingAccessContext,
  fetchReportingAccessContext,
  type ReportingAccessContext,
} from '@/lib/reporting';
import { resolveMyTechnicianEntitlements } from '@/lib/technicianEntitlements';

interface User {
  id: string;
  email: string;
  membershipStatus?: MembershipStatus;
  membershipPlan?: string;
  portalAccessTier: PortalAccessTier;
  isTrainingOperator: boolean;
  canManageOperatorTraining: boolean;
  isCorporatePartner: boolean;
  hasSupplyDiscount: boolean;
  canRequestSupport: boolean;
  canManageTechnicians: boolean;
  capabilities: string[];
  effectivePresets: string[];
  plusAccess: PlusAccessSummary;
  reportingAccess: ReportingAccessContext;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isScopedAdmin: boolean;
  adminAccess: AdminAccessContext;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithMagicLink: (email: string) => Promise<{ error: AuthError | null }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithGoogleIdToken: (idToken: string) => Promise<{ error: AuthError | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isMember: boolean;
  portalAccessTier: PortalAccessTier;
  canAccessTraining: boolean;
  isTrainingOperator: boolean;
  canManageOperatorTraining: boolean;
  isCorporatePartner: boolean;
  hasSupplyDiscount: boolean;
  canRequestSupport: boolean;
  canManageTechnicians: boolean;
  capabilities: string[];
  effectivePresets: string[];
  hasReportingAccess: boolean;
  reportingMachineCount: number;
  reportingLocationCount: number;
  canManageReporting: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isScopedAdmin: boolean;
  adminAccess: AdminAccessContext;
}

type AdminRoleRecord = {
  role: string;
};

type AdminAccessContext = {
  isSuperAdmin: boolean;
  isScopedAdmin: boolean;
  canAccessAdmin: boolean;
  allowedSurfaces: string[];
  scopedMachineIds: string[];
};

type AdminAccessContextRpc = {
  isSuperAdmin?: boolean | null;
  isScopedAdmin?: boolean | null;
  canAccessAdmin?: boolean | null;
  allowedSurfaces?: string[] | null;
  scopedMachineIds?: string[] | null;
};

type PortalAccessContextRecord = {
  access_tier: string | null;
  is_plus_member: boolean | null;
  is_training_operator: boolean | null;
  is_admin: boolean | null;
  can_manage_operator_training: boolean | null;
  is_corporate_partner?: boolean | null;
  has_supply_discount?: boolean | null;
  can_request_support?: boolean | null;
  can_manage_technicians?: boolean | null;
  capabilities?: string[] | null;
  effective_presets?: string[] | null;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getDevAdminEmailAllowlist = (): Set<string> => {
  if (!import.meta.env.DEV) {
    return new Set();
  }

  const configured = import.meta.env.VITE_DEV_ADMIN_EMAILS;
  if (typeof configured !== 'string' || configured.trim().length === 0) {
    return new Set();
  }

  return new Set(
    configured
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
};

const devAdminEmailAllowlist = getDevAdminEmailAllowlist();

const hasDevAdminEmailOverride = (email: string): boolean =>
  import.meta.env.DEV && devAdminEmailAllowlist.has(email.toLowerCase());

const emptyAdminAccessContext: AdminAccessContext = {
  isSuperAdmin: false,
  isScopedAdmin: false,
  canAccessAdmin: false,
  allowedSurfaces: [],
  scopedMachineIds: [],
};

const getIsAdmin = async (userId: string): Promise<boolean> => {
  const { data, error } = await supabaseClient
    .from('admin_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    return false;
  }

  return Boolean((data as AdminRoleRecord | null)?.role);
};

const mapAdminAccessContext = (
  record: AdminAccessContextRpc | null,
  fallbackIsSuperAdmin = false
): AdminAccessContext => {
  const isSuperAdmin = Boolean(record?.isSuperAdmin ?? fallbackIsSuperAdmin);
  const isScopedAdmin = Boolean(record?.isScopedAdmin);

  return {
    isSuperAdmin,
    isScopedAdmin,
    canAccessAdmin: Boolean(record?.canAccessAdmin ?? (isSuperAdmin || isScopedAdmin)),
    allowedSurfaces: Array.isArray(record?.allowedSurfaces) ? record.allowedSurfaces : [],
    scopedMachineIds: Array.isArray(record?.scopedMachineIds) ? record.scopedMachineIds : [],
  };
};

const getAdminAccess = async (userId: string): Promise<AdminAccessContext> => {
  try {
    const { data, error } = await supabaseClient.rpc('get_my_admin_access_context');

    if (!error && data) {
      return mapAdminAccessContext(data as AdminAccessContextRpc);
    }
  } catch {
    // Fall through to the legacy super-admin check for environments that have
    // not applied the scoped-admin migration yet.
  }

  return mapAdminAccessContext(null, await getIsAdmin(userId));
};

const getPlusAccess = async (): Promise<PlusAccessSummary> => {
  try {
    return await fetchMyPlusAccess();
  } catch {
    return emptyPlusAccessSummary;
  }
};

const getReportingAccess = async (): Promise<ReportingAccessContext> => {
  try {
    return await fetchReportingAccessContext();
  } catch {
    return emptyReportingAccessContext;
  }
};

const getPortalAccessContext = async (): Promise<PortalAccessContextRecord | null> => {
  const { data, error } = await supabaseClient.rpc('get_my_portal_access_context');

  if (error || !data) {
    return null;
  }

  return Array.isArray(data)
    ? ((data as PortalAccessContextRecord[])[0] ?? null)
    : ((data as PortalAccessContextRecord | null) ?? null);
};

const resolveTechnicianEntitlements = async (): Promise<void> => {
  try {
    await resolveMyTechnicianEntitlements();
  } catch {
    // Missing or failed resolution should not block login; access checks below
    // still reflect the database state already available to the session.
  }
};

const buildAuthUser = async (supabaseUser: SupabaseUser): Promise<User> => {
  const email = supabaseUser.email ?? '';

  if (email) {
    await resolveTechnicianEntitlements();
  }

  const [plusAccess, dbAdminAccess, portalAccessContext, reportingAccess] = await Promise.all([
    getPlusAccess(),
    getAdminAccess(supabaseUser.id),
    getPortalAccessContext(),
    getReportingAccess(),
  ]);
  const hasDevAdminOverride = hasDevAdminEmailOverride(email);
  const adminAccess: AdminAccessContext = hasDevAdminOverride
    ? {
        ...dbAdminAccess,
        isSuperAdmin: true,
        canAccessAdmin: true,
        allowedSurfaces: ['*'],
      }
    : dbAdminAccess;
  const isAdmin = adminAccess.canAccessAdmin;
  const hasFullPlusAccess = adminAccess.isSuperAdmin || plusAccess.hasPlusAccess;
  const effectiveReportingAccess: ReportingAccessContext = adminAccess.isSuperAdmin
    ? {
        ...reportingAccess,
        hasReportingAccess: true,
        canManageReporting: true,
      }
    : reportingAccess;
  const portalAccessTier = hasFullPlusAccess
    ? 'plus'
    : normalizePortalAccessTier(portalAccessContext?.access_tier ?? undefined, 'baseline');
  const isCorporatePartner = Boolean(portalAccessContext?.is_corporate_partner);
  const hasSupplyDiscount = Boolean(
    portalAccessContext?.has_supply_discount ?? hasFullPlusAccess
  );
  const canRequestSupport = Boolean(
    portalAccessContext?.can_request_support ?? hasFullPlusAccess
  );
  const canManageTechnicians = Boolean(portalAccessContext?.can_manage_technicians);

  return {
    id: supabaseUser.id,
    email,
    membershipStatus: plusAccess.membershipStatus,
    membershipPlan: hasFullPlusAccess ? 'Plus Basic' : isCorporatePartner ? 'Corporate Partner' : undefined,
    portalAccessTier,
    isTrainingOperator:
      portalAccessTier === 'training' || Boolean(portalAccessContext?.is_training_operator),
    canManageOperatorTraining:
      hasFullPlusAccess || Boolean(portalAccessContext?.can_manage_operator_training),
    isCorporatePartner,
    hasSupplyDiscount,
    canRequestSupport,
    canManageTechnicians,
    capabilities: Array.isArray(portalAccessContext?.capabilities)
      ? portalAccessContext.capabilities
      : [],
    effectivePresets: Array.isArray(portalAccessContext?.effective_presets)
      ? portalAccessContext.effective_presets
      : [],
    plusAccess,
    reportingAccess: effectiveReportingAccess,
    isAdmin,
    isSuperAdmin: adminAccess.isSuperAdmin,
    isScopedAdmin: adminAccess.isScopedAdmin,
    adminAccess,
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const activeAuthUserIdRef = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const clearQueryCacheForUserChange = (nextUserId: string | null) => {
      if (activeAuthUserIdRef.current === nextUserId) return;

      activeAuthUserIdRef.current = nextUserId;
      queryClient.clear();
    };

    const setUserFromSession = async (supabaseUser: SupabaseUser | null) => {
      if (!mounted) return;

      clearQueryCacheForUserChange(supabaseUser?.id ?? null);

      if (!supabaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const authUser = await buildAuthUser(supabaseUser);

      if (!mounted) return;
      setUser(authUser);
      identifyUser(authUser.id, {
        email: authUser.email,
        is_admin: authUser.isAdmin,
        portal_access_tier: authUser.portalAccessTier,
      });
      setLoading(false);
    };

    const hydrateSession = async () => {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      await setUserFromSession(session?.user ?? null);
    };

    void hydrateSession();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      void setUserFromSession(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const getAuthRedirectUrl = () =>
    typeof window !== 'undefined'
      ? getCanonicalUrlForSurface('app', '/portal', '', '', window.location)
      : undefined;
  const getRecoveryRedirectUrl = () =>
    typeof window !== 'undefined'
      ? getCanonicalUrlForSurface('app', '/reset-password', '', '', window.location)
      : undefined;

  const signInWithMagicLink = async (email: string): Promise<{ error: AuthError | null }> => {
    const redirectTo = getAuthRedirectUrl();

    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (!error) {
      trackEvent('login');
    }

    return { error };
  };

  const signInWithPassword = async (
    email: string,
    password: string
  ): Promise<{ error: AuthError | null }> => {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (!error) {
      trackEvent('login');
    }

    return { error };
  };

  const signUpWithPassword = async (
    email: string,
    password: string
  ): Promise<{ error: AuthError | null }> => {
    const redirectTo = getAuthRedirectUrl();
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });

    if (!error) {
      trackEvent('login');
    }

    return { error };
  };

  const signInWithGoogle = async (): Promise<{ error: AuthError | null }> => {
    const redirectTo = getAuthRedirectUrl();
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (!error) {
      trackEvent('login');
    }

    return { error };
  };

  const signInWithGoogleIdToken = async (
    idToken: string
  ): Promise<{ error: AuthError | null }> => {
    const { error } = await supabaseClient.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (!error) {
      trackEvent('login');
    }

    return { error };
  };

  const requestPasswordReset = async (
    email: string
  ): Promise<{ error: AuthError | null }> => {
    const redirectTo = getRecoveryRedirectUrl();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    return { error };
  };

  const updatePassword = async (password: string): Promise<{ error: AuthError | null }> => {
    const { error } = await supabaseClient.auth.updateUser({ password });
    return { error };
  };

  const signIn = signInWithMagicLink;

  const signOut = async () => {
    activeAuthUserIdRef.current = null;
    queryClient.clear();
    await supabaseClient.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signInWithMagicLink,
        signInWithPassword,
        signUpWithPassword,
        signInWithGoogle,
        signInWithGoogleIdToken,
        requestPasswordReset,
        updatePassword,
        signIn,
        signOut,
        isAuthenticated: !!user,
        isMember: user?.plusAccess.hasPlusAccess ?? false,
        portalAccessTier: user?.portalAccessTier ?? 'baseline',
        canAccessTraining: hasTrainingAccess(user?.portalAccessTier),
        isTrainingOperator: user?.isTrainingOperator ?? false,
        canManageOperatorTraining: user?.canManageOperatorTraining ?? false,
        isCorporatePartner: user?.isCorporatePartner ?? false,
        hasSupplyDiscount: user?.hasSupplyDiscount ?? false,
        canRequestSupport: user?.canRequestSupport ?? false,
        canManageTechnicians: user?.canManageTechnicians ?? false,
        capabilities: user?.capabilities ?? [],
        effectivePresets: user?.effectivePresets ?? [],
        hasReportingAccess: user?.reportingAccess.hasReportingAccess ?? false,
        reportingMachineCount: user?.reportingAccess.accessibleMachineCount ?? 0,
        reportingLocationCount: user?.reportingAccess.accessibleLocationCount ?? 0,
        canManageReporting: user?.reportingAccess.canManageReporting ?? false,
        isAdmin: user?.isAdmin ?? false,
        isSuperAdmin: user?.isSuperAdmin ?? false,
        isScopedAdmin: user?.isScopedAdmin ?? false,
        adminAccess: user?.adminAccess ?? emptyAdminAccessContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

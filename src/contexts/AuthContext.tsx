import React, { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  AuthContext,
  type AdminAccessContext,
  type AuthBootstrapStatus,
  type User,
} from '@/contexts/auth-context';
import { supabaseClient } from '@/lib/supabaseClient';
import { trackEvent, identifyUser } from '@/lib/analytics';
import { getCanonicalUrlForSurface, getSafeInternalAppPath } from '@/lib/appSurface';
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
import {
  beginPortalBootstrap,
  getPortalRouteCategory,
  markPortalAccessReady,
} from '@/lib/portalPerformance';
import { preloadPortalDashboard } from '@/lib/portalRouteModules';

type AdminRoleRecord = {
  role: string;
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
  const isCorporatePartner = Boolean(portalAccessContext?.is_corporate_partner);
  const portalAccessTier = hasFullPlusAccess
    ? 'plus'
    : isCorporatePartner
      ? 'corporate_partner'
      : normalizePortalAccessTier(portalAccessContext?.access_tier ?? undefined, 'baseline');
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
  const bootstrapStatusRef = useRef<AuthBootstrapStatus>('checking-session');
  const bootstrapGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const hydrationRef = useRef<{
    userId: string;
    promise: Promise<User>;
  } | null>(null);
  const pendingForcedHydrationRef = useRef<SupabaseUser | null>(null);
  const hydrateAccessForUserRef = useRef<
    (supabaseUser: SupabaseUser, force?: boolean) => Promise<void>
  >(async () => undefined);
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapStatus, setBootstrapStatus] =
    useState<AuthBootstrapStatus>('checking-session');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);

  const updateBootstrapStatus = useCallback((nextStatus: AuthBootstrapStatus) => {
    bootstrapStatusRef.current = nextStatus;
    setBootstrapStatus(nextStatus);
  }, []);

  const clearQueryCacheForUserChange = useCallback(
    (nextUserId: string | null) => {
      if (activeAuthUserIdRef.current === nextUserId) {
        return;
      }

      activeAuthUserIdRef.current = nextUserId;
      queryClient.clear();
    },
    [queryClient]
  );

  const moveToSignedOut = useCallback(() => {
    bootstrapGenerationRef.current += 1;
    hydrationRef.current = null;
    pendingForcedHydrationRef.current = null;
    clearQueryCacheForUserChange(null);
    setUser(null);
    setBootstrapError(null);
    setHasAuthenticatedSession(false);
    updateBootstrapStatus('signed-out');
  }, [clearQueryCacheForUserChange, updateBootstrapStatus]);

  const hydrateAccessForUser = useCallback(
    async (supabaseUser: SupabaseUser, force = false): Promise<void> => {
      if (!mountedRef.current) {
        return;
      }

      const sameUser = activeAuthUserIdRef.current === supabaseUser.id;
      const inFlight =
        hydrationRef.current?.userId === supabaseUser.id ? hydrationRef.current : null;

      if (!force && sameUser && bootstrapStatusRef.current === 'ready') {
        return;
      }

      if (!force && inFlight) {
        await inFlight.promise.catch(() => undefined);
        return;
      }

      clearQueryCacheForUserChange(supabaseUser.id);
      setHasAuthenticatedSession(true);
      setBootstrapError(null);
      setUser(null);
      updateBootstrapStatus('hydrating-access');

      const routeCategory = getPortalRouteCategory();
      if (!force) {
        beginPortalBootstrap(routeCategory);
      }
      if (routeCategory === 'portal-dashboard') {
        preloadPortalDashboard();
      }

      const generation = ++bootstrapGenerationRef.current;
      const hydrationPromise = buildAuthUser(supabaseUser);
      hydrationRef.current = {
        userId: supabaseUser.id,
        promise: hydrationPromise,
      };

      try {
        const authUser = await hydrationPromise;

        if (
          !mountedRef.current ||
          generation !== bootstrapGenerationRef.current ||
          activeAuthUserIdRef.current !== supabaseUser.id
        ) {
          return;
        }

        if (pendingForcedHydrationRef.current?.id === supabaseUser.id) {
          return;
        }

        setUser(authUser);
        identifyUser(authUser.id, {
          email: authUser.email,
          is_admin: authUser.isAdmin,
          portal_access_tier: authUser.portalAccessTier,
        });
        updateBootstrapStatus('ready');
        markPortalAccessReady();
      } catch {
        if (
          !mountedRef.current ||
          generation !== bootstrapGenerationRef.current ||
          activeAuthUserIdRef.current !== supabaseUser.id
        ) {
          return;
        }

        if (pendingForcedHydrationRef.current?.id === supabaseUser.id) {
          return;
        }

        setUser(null);
        setBootstrapError('We could not verify your account access. Please retry.');
        updateBootstrapStatus('error');
      } finally {
        if (hydrationRef.current?.promise === hydrationPromise) {
          hydrationRef.current = null;
        }

        const pendingUser = pendingForcedHydrationRef.current;
        if (
          pendingUser?.id === supabaseUser.id &&
          mountedRef.current &&
          generation === bootstrapGenerationRef.current &&
          activeAuthUserIdRef.current === supabaseUser.id
        ) {
          pendingForcedHydrationRef.current = null;
          const scheduledGeneration = bootstrapGenerationRef.current;
          setTimeout(() => {
            if (
              !mountedRef.current ||
              scheduledGeneration !== bootstrapGenerationRef.current ||
              activeAuthUserIdRef.current !== pendingUser.id
            ) {
              return;
            }

            void hydrateAccessForUserRef.current(pendingUser, true);
          }, 0);
        }
      }
    },
    [clearQueryCacheForUserChange, updateBootstrapStatus]
  );

  useEffect(() => {
    hydrateAccessForUserRef.current = hydrateAccessForUser;
  }, [hydrateAccessForUser]);

  useEffect(() => {
    mountedRef.current = true;

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;

      if (event === 'SIGNED_OUT' || !sessionUser) {
        moveToSignedOut();
        return;
      }

      setHasAuthenticatedSession(true);

      const sameUser = activeAuthUserIdRef.current === sessionUser.id;

      if (!sameUser) {
        bootstrapGenerationRef.current += 1;
        hydrationRef.current = null;
        pendingForcedHydrationRef.current = null;
        clearQueryCacheForUserChange(sessionUser.id);
        setUser(null);
        setBootstrapError(null);
        updateBootstrapStatus('hydrating-access');
      }

      const isAlreadyHydrating =
        sameUser &&
        hydrationRef.current?.userId === sessionUser.id &&
        bootstrapStatusRef.current === 'hydrating-access';
      const isAlreadyReady = sameUser && bootstrapStatusRef.current === 'ready';
      const force = event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY';

      if (force && sameUser && bootstrapStatusRef.current === 'hydrating-access') {
        pendingForcedHydrationRef.current = sessionUser;
        return;
      }

      if (
        (event === 'TOKEN_REFRESHED' && (isAlreadyHydrating || isAlreadyReady)) ||
        ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') &&
          (isAlreadyHydrating || isAlreadyReady))
      ) {
        return;
      }

      const scheduledGeneration = bootstrapGenerationRef.current;
      const scheduledUserId = sessionUser.id;
      setTimeout(() => {
        if (
          !mountedRef.current ||
          scheduledGeneration !== bootstrapGenerationRef.current ||
          activeAuthUserIdRef.current !== scheduledUserId
        ) {
          return;
        }

        void hydrateAccessForUser(sessionUser, force);
      }, 0);
    });

    return () => {
      mountedRef.current = false;
      bootstrapGenerationRef.current += 1;
      hydrationRef.current = null;
      pendingForcedHydrationRef.current = null;
      subscription.unsubscribe();
    };
  }, [
    clearQueryCacheForUserChange,
    hydrateAccessForUser,
    moveToSignedOut,
    updateBootstrapStatus,
  ]);

  const retryBootstrap = useCallback(async () => {
    const retryGeneration = ++bootstrapGenerationRef.current;
    const expectedUserId = activeAuthUserIdRef.current;
    hydrationRef.current = null;
    pendingForcedHydrationRef.current = null;
    setBootstrapError(null);
    updateBootstrapStatus('hydrating-access');

    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession();

    if (
      !mountedRef.current ||
      retryGeneration !== bootstrapGenerationRef.current ||
      (expectedUserId !== null &&
        session?.user?.id !== undefined &&
        session.user.id !== expectedUserId)
    ) {
      return;
    }

    if (error) {
      setBootstrapError('We could not recheck your secure session. Please retry.');
      updateBootstrapStatus('error');
      return;
    }

    if (!session?.user) {
      moveToSignedOut();
      return;
    }

    setHasAuthenticatedSession(true);
    await hydrateAccessForUser(session.user, true);
  }, [hydrateAccessForUser, moveToSignedOut, updateBootstrapStatus]);

  const getAuthRedirectPath = () => {
    if (typeof window === 'undefined') {
      return '/portal';
    }

    const params = new URLSearchParams(window.location.search);
    return getSafeInternalAppPath(params.get('next')) ?? '/portal';
  };

  const getAuthRedirectUrl = () =>
    typeof window !== 'undefined'
      ? getCanonicalUrlForSurface('app', getAuthRedirectPath(), '', '', window.location)
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
    moveToSignedOut();
    const { error } = await supabaseClient.auth.signOut();

    if (!error) {
      return;
    }

    const { error: localSignOutError } = await supabaseClient.auth.signOut({ scope: 'local' });
    if (localSignOutError) {
      setHasAuthenticatedSession(true);
      setBootstrapError('We could not complete sign out. Please retry.');
      updateBootstrapStatus('error');
    }
  };

  const loading =
    bootstrapStatus === 'checking-session' || bootstrapStatus === 'hydrating-access';
  const isAuthenticated = bootstrapStatus === 'ready' && Boolean(user);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        bootstrapStatus,
        bootstrapError,
        hasAuthenticatedSession,
        retryBootstrap,
        signInWithMagicLink,
        signInWithPassword,
        signUpWithPassword,
        signInWithGoogle,
        signInWithGoogleIdToken,
        requestPasswordReset,
        updatePassword,
        signIn,
        signOut,
        isAuthenticated,
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

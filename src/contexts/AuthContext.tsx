import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { supabaseClient } from '@/lib/supabaseClient';
import { trackEvent, identifyUser } from '@/lib/analytics';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import { hasPlusAccess, type MembershipStatus } from '@/lib/membership';
import {
  acceptPendingInvite,
  fetchPortalAccessContext,
  type PortalAccessContext,
} from '@/lib/customerAccounts';
import type { PortalAccessTier, PortalAccountRole } from '@/lib/portalAccess';

interface User {
  id: string;
  email: string;
  membershipStatus?: MembershipStatus;
  membershipPlan?: string;
  isAdmin: boolean;
  accessTier: PortalAccessTier;
  portalRole: PortalAccountRole;
  accountId: string | null;
  canManageOperators: boolean;
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
  isAdmin: boolean;
  accessTier: PortalAccessTier;
  portalRole: PortalAccountRole;
  canAccessTraining: boolean;
  canAccessPlus: boolean;
  canManageOperators: boolean;
}

type SubscriptionRecord = {
  status: string;
  current_period_end: string | null;
  updated_at: string;
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

const normalizeMembershipStatus = (status: string | undefined): MembershipStatus => {
  if (!status) return 'none';

  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'inactive':
    case 'none':
      return status;
    default:
      return 'none';
  }
};

const getMembershipStatus = async (userId: string): Promise<MembershipStatus> => {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('status,current_period_end,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error || !data || data.length === 0) {
    return 'none';
  }

  const records = data as SubscriptionRecord[];
  const now = Date.now();

  const activeMembership = records.find((subscription) => {
    const normalizedStatus = normalizeMembershipStatus(subscription.status);
    const isPlus = normalizedStatus === 'active' || normalizedStatus === 'trialing';
    const periodEnd =
      subscription.current_period_end !== null
        ? new Date(subscription.current_period_end).getTime()
        : null;

    return isPlus && (periodEnd === null || periodEnd > now);
  });

  if (activeMembership) {
    return normalizeMembershipStatus(activeMembership.status);
  }

  return normalizeMembershipStatus(records[0]?.status);
};

const getFallbackPortalAccessContext = (): PortalAccessContext => ({
  accountId: null,
  accountRole: null,
  accessTier: 'baseline',
  canManageOperators: false,
  isAdmin: false,
});

const resolvePortalAccessContext = async (): Promise<PortalAccessContext> => {
  try {
    return await acceptPendingInvite();
  } catch (error) {
    console.error('Unable to accept pending customer-account invite', error);
  }

  try {
    return await fetchPortalAccessContext();
  } catch (error) {
    console.error('Unable to fetch portal access context', error);
    return getFallbackPortalAccessContext();
  }
};

const buildAuthUser = async (supabaseUser: SupabaseUser): Promise<User> => {
  const email = supabaseUser.email ?? '';
  const [membershipStatus, portalAccessContext] = await Promise.all([
    getMembershipStatus(supabaseUser.id),
    resolvePortalAccessContext(),
  ]);

  const isAdmin = portalAccessContext.isAdmin || hasDevAdminEmailOverride(email);
  const accessTier: PortalAccessTier = isAdmin ? 'plus' : portalAccessContext.accessTier;

  return {
    id: supabaseUser.id,
    email,
    membershipStatus,
    membershipPlan: hasPlusAccess(membershipStatus) ? 'Plus Basic' : undefined,
    isAdmin,
    accessTier,
    portalRole: portalAccessContext.accountRole,
    accountId: portalAccessContext.accountId,
    canManageOperators: isAdmin || portalAccessContext.canManageOperators,
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const setUserFromSession = async (supabaseUser: SupabaseUser | null) => {
      if (!mounted) return;

      if (!supabaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const authUser = await buildAuthUser(supabaseUser);

        if (!mounted) return;

        setUser(authUser);
        identifyUser(authUser.id, {
          email: authUser.email,
          is_admin: authUser.isAdmin,
          access_tier: authUser.accessTier,
          portal_role: authUser.portalRole ?? 'none',
        });
      } catch (error) {
        console.error('Unable to build auth user', error);

        if (!mounted) return;
        setUser(null);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
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
  }, []);

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
    await supabaseClient.auth.signOut();
    setUser(null);
  };

  const accessTier = user?.accessTier ?? 'baseline';
  const canAccessTraining = accessTier === 'training' || accessTier === 'plus';
  const canAccessPlus = accessTier === 'plus';

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
        isMember: canAccessPlus,
        isAdmin: user?.isAdmin ?? false,
        accessTier,
        portalRole: user?.portalRole ?? null,
        canAccessTraining,
        canAccessPlus,
        canManageOperators: user?.canManageOperators ?? false,
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

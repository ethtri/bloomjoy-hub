import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { supabaseClient } from '@/lib/supabaseClient';
import { trackEvent, identifyUser } from '@/lib/analytics';
import { hasPlusAccess, type MembershipStatus } from '@/lib/membership';

interface User {
  id: string;
  email: string;
  membershipStatus?: MembershipStatus;
  membershipPlan?: string;
  isAdmin: boolean;
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
}

type SubscriptionRecord = {
  status: string;
  current_period_end: string | null;
  updated_at: string;
};

type AdminRoleRecord = {
  role: string;
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

const buildAuthUser = async (supabaseUser: SupabaseUser): Promise<User> => {
  const email = supabaseUser.email ?? '';
  const [membershipStatus, dbIsAdmin] = await Promise.all([
    getMembershipStatus(supabaseUser.id),
    getIsAdmin(supabaseUser.id),
  ]);
  const isAdmin = dbIsAdmin || hasDevAdminEmailOverride(email);

  return {
    id: supabaseUser.id,
    email,
    membershipStatus,
    membershipPlan: hasPlusAccess(membershipStatus) ? 'Plus Basic' : undefined,
    isAdmin,
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

      const authUser = await buildAuthUser(supabaseUser);

      if (!mounted) return;
      setUser(authUser);
      identifyUser(authUser.id, { email: authUser.email, is_admin: authUser.isAdmin });
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
  }, []);

  const getAuthRedirectUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}/portal` : undefined;
  const getRecoveryRedirectUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;

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
        isMember: hasPlusAccess(user?.membershipStatus) || (user?.isAdmin ?? false),
        isAdmin: user?.isAdmin ?? false,
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

import { createContext, useContext } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import type { MembershipStatus, PlusAccessSummary, PortalAccessTier } from '@/lib/membership';
import type { ReportingAccessContext } from '@/lib/reporting';

export type AdminAccessContext = {
  isSuperAdmin: boolean;
  isScopedAdmin: boolean;
  canAccessAdmin: boolean;
  allowedSurfaces: string[];
  scopedMachineIds: string[];
};

export interface User {
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

export type AuthBootstrapStatus =
  | 'checking-session'
  | 'hydrating-access'
  | 'ready'
  | 'signed-out'
  | 'error';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  bootstrapStatus: AuthBootstrapStatus;
  bootstrapError: string | null;
  hasAuthenticatedSession: boolean;
  retryBootstrap: () => Promise<void>;
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

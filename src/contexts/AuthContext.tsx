import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { trackEvent, identifyUser } from '@/lib/analytics';

// Mock user type - will be replaced with Supabase Auth user
interface User {
  id: string;
  email: string;
  membershipStatus?: 'active' | 'inactive' | 'none';
  membershipPlan?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isMember: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session (mock)
    const storedUser = localStorage.getItem('bloomjoy-user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      setUser(parsed);
      identifyUser(parsed.id, { email: parsed.email });
    }
    setLoading(false);
  }, []);

  const signIn = async (email: string): Promise<{ error: Error | null }> => {
    try {
      // Mock magic link flow - in production, this would call Supabase
      console.log('[Auth] Magic link sent to:', email);
      
      // For demo, immediately "sign in"
      const mockUser: User = {
        id: crypto.randomUUID(),
        email,
        membershipStatus: 'active',
        membershipPlan: 'plus-basic',
      };
      
      setUser(mockUser);
      localStorage.setItem('bloomjoy-user', JSON.stringify(mockUser));
      identifyUser(mockUser.id, { email: mockUser.email });
      trackEvent('login');
      
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    setUser(null);
    localStorage.removeItem('bloomjoy-user');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signOut,
        isAuthenticated: !!user,
        isMember: user?.membershipStatus === 'active',
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

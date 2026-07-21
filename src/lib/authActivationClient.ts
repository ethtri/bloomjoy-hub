import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/lib/config';

// Invite and password-recovery OTPs create a short-lived session that must not
// become the application's authenticated session before password setup is
// complete. Keeping it in memory makes abandoned or reloaded activation flows
// fail closed instead of opening the portal.
export const authActivationClient = createClient(
  appConfig.supabaseUrl,
  appConfig.supabaseAnonKey,
  {
    auth: {
      storageKey: 'bloomjoy-auth-activation',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

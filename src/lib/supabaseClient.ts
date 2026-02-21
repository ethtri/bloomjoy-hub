import { createClient } from '@supabase/supabase-js';
import { appConfig } from '@/lib/config';

export const supabaseClient = createClient(
  appConfig.supabaseUrl,
  appConfig.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

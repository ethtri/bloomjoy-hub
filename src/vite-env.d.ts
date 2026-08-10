/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_MICRO_CHECKOUT_ENABLED?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_GA_DEBUG_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

const requiredClientEnvKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

type RequiredClientEnvKey = (typeof requiredClientEnvKeys)[number];

const readRequiredClientEnv = (key: RequiredClientEnvKey): string => {
  const value = import.meta.env[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable "${key}". Copy .env.example to .env and set all required values.`
    );
  }

  return value;
};

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  ga4MeasurementId: string | null;
  isDev: boolean;
}

export const appConfig: AppConfig = {
  supabaseUrl: readRequiredClientEnv('VITE_SUPABASE_URL'),
  supabaseAnonKey: readRequiredClientEnv('VITE_SUPABASE_ANON_KEY'),
  ga4MeasurementId:
    typeof import.meta.env.VITE_GA4_MEASUREMENT_ID === 'string' &&
    import.meta.env.VITE_GA4_MEASUREMENT_ID.trim().length > 0
      ? import.meta.env.VITE_GA4_MEASUREMENT_ID.trim()
      : null,
  isDev: import.meta.env.DEV,
};

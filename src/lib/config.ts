const requiredClientEnvKeys = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

type RequiredClientEnvKey = (typeof requiredClientEnvKeys)[number];

const requiredClientEnv: Record<RequiredClientEnvKey, string | undefined> = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
};

const readRequiredClientEnv = (key: RequiredClientEnvKey): string => {
  const value = requiredClientEnv[key];

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
  isDev: boolean;
}

export const appConfig: AppConfig = {
  supabaseUrl: readRequiredClientEnv('VITE_SUPABASE_URL'),
  supabaseAnonKey: readRequiredClientEnv('VITE_SUPABASE_ANON_KEY'),
  isDev: import.meta.env.DEV,
};

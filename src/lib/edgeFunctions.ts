import { appConfig } from '@/lib/config';
import { supabaseClient } from '@/lib/supabaseClient';

export const EDGE_FUNCTION_AUTH_HEADER = 'x-supabase-auth-token';

type EdgeFunctionResponse = {
  error?: string;
};

type InvokeEdgeFunctionOptions = {
  requireUserAuth?: boolean;
  includeUserAuth?: boolean;
  authErrorMessage?: string;
};

const getAuthenticatedAccessToken = async (throwOnSessionError: boolean) => {
  const {
    data: { session },
    error,
  } = await supabaseClient.auth.getSession();

  if (error) {
    if (!throwOnSessionError) {
      console.warn('Unable to read optional auth session for Edge Function request.', error);
      return null;
    }

    throw new Error(error.message);
  }

  return session?.access_token ?? null;
};

export const invokeEdgeFunction = async <T extends EdgeFunctionResponse>(
  functionName: string,
  body: unknown,
  options: InvokeEdgeFunctionOptions = {}
) => {
  const headers: Record<string, string> = {
    apikey: appConfig.supabaseAnonKey,
    Authorization: `Bearer ${appConfig.supabaseAnonKey}`,
    'Content-Type': 'application/json',
  };

  if (options.requireUserAuth || options.includeUserAuth) {
    const accessToken = await getAuthenticatedAccessToken(Boolean(options.requireUserAuth));

    if (!accessToken && options.requireUserAuth) {
      throw new Error(options.authErrorMessage ?? 'Authentication required.');
    }

    if (accessToken) {
      headers[EDGE_FUNCTION_AUTH_HEADER] = accessToken;
    }
  }

  const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let data: T | null = null;

  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}.`);
  }

  return data;
};

import { appConfig } from '@/lib/config';
import { supabaseClient } from '@/lib/supabaseClient';

export const EDGE_FUNCTION_AUTH_HEADER = 'x-supabase-auth-token';

export type EdgeFunctionResponse = {
  error?: string;
  errorCode?: string;
  message?: string;
  blocks?: string[];
  [key: string]: unknown;
};

export class EdgeFunctionError<T extends EdgeFunctionResponse = EdgeFunctionResponse> extends Error {
  status: number;
  data: T | null;

  constructor(message: string, status: number, data: T | null) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.status = status;
    this.data = data;
  }
}

export const isEdgeFunctionError = <T extends EdgeFunctionResponse = EdgeFunctionResponse>(
  error: unknown
): error is EdgeFunctionError<T> => error instanceof EdgeFunctionError;

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
    throw new EdgeFunctionError(
      data?.error || data?.message || data?.errorCode || `Request failed with status ${response.status}.`,
      response.status,
      data
    );
  }

  return data;
};

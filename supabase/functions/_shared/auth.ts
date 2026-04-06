export const forwardedAccessTokenHeader = "x-supabase-auth-token";

const parseBearerToken = (authorizationHeader: string | null): string => {
  if (!authorizationHeader) return "";
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

export const resolveForwardedSupabaseAccessToken = (req: Request): string =>
  req.headers.get(forwardedAccessTokenHeader)?.trim() ?? "";

export const resolveSupabaseAccessToken = (req: Request): string => {
  const forwardedToken = resolveForwardedSupabaseAccessToken(req);
  if (forwardedToken) {
    return forwardedToken;
  }

  return parseBearerToken(req.headers.get("Authorization"));
};

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const artworkBucket = "custom-sticks-artwork";
const defaultSignedUrlTtlSeconds = 15 * 60;
const maxSignedUrlTtlSeconds = 15 * 60;
const artworkPathPattern = /^(private|public)\/[a-z0-9][a-z0-9._/-]{0,240}$/;

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeTtlSeconds = (value: unknown) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return defaultSignedUrlTtlSeconds;
  }

  return Math.min(Math.round(numericValue), maxSignedUrlTtlSeconds);
};

const isAllowedArtworkPath = (storagePath: string) =>
  artworkPathPattern.test(storagePath) &&
  !storagePath.includes("..") &&
  !storagePath.includes("//");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({ error: "Artwork link service is not configured." }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_super_admin", {
      uid: user.id,
    });

    if (adminError || !isAdmin) {
      return jsonResponse({ error: "Access denied." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const storagePath = sanitizeText((body as Record<string, unknown>)?.storagePath);
    const ttlSeconds = normalizeTtlSeconds((body as Record<string, unknown>)?.expiresInSeconds);

    if (!isAllowedArtworkPath(storagePath)) {
      return jsonResponse({ error: "Artwork storage path is invalid." }, 400);
    }

    const { data, error } = await supabase.storage
      .from(artworkBucket)
      .createSignedUrl(storagePath, ttlSeconds);

    if (error || !data?.signedUrl) {
      return jsonResponse({ error: "Unable to create artwork link." }, 404);
    }

    return jsonResponse({
      bucket: artworkBucket,
      expiresInSeconds: ttlSeconds,
      signedUrl: data.signedUrl,
      storagePath,
    });
  } catch (error) {
    console.error("custom-sticks-artwork-link error", error);
    return jsonResponse({ error: "Unable to create artwork link." }, 500);
  }
});

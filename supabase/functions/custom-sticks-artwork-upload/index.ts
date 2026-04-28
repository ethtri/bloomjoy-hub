import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const artworkBucket = "custom-sticks-artwork";
const privatePrefix = "private";
const maxArtworkSizeBytes = 5 * 1024 * 1024;
const signedUploadExpiresInSeconds = 2 * 60 * 60;
const signedReadUrlTtlSeconds = 15 * 60;
const maxStorageBaseNameLength = 80;
const allowedArtworkTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const extensionByContentType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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

const sanitizeFileBaseName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxStorageBaseNameLength);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({ error: "Artwork upload service is not configured." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const fileName = sanitizeText((body as Record<string, unknown>)?.fileName) || "artwork";
    const contentType = sanitizeText((body as Record<string, unknown>)?.contentType)
      .toLowerCase();
    const sizeBytes = Number((body as Record<string, unknown>)?.sizeBytes);

    if (!allowedArtworkTypes.has(contentType)) {
      return jsonResponse({ error: "Use PNG, JPG, or WEBP for custom sticks artwork." }, 400);
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxArtworkSizeBytes) {
      return jsonResponse({ error: "Artwork must be 5MB or smaller." }, 400);
    }

    const safeBaseName = sanitizeFileBaseName(fileName) || "artwork";
    const extension = extensionByContentType[contentType];
    const storagePath = `${privatePrefix}/${crypto.randomUUID()}-${safeBaseName}.${extension}`;

    const { data, error } = await supabase.storage
      .from(artworkBucket)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (error || !data?.token) {
      return jsonResponse({ error: "Unable to prepare artwork upload." }, 500);
    }

    return jsonResponse({
      access: "private",
      bucket: artworkBucket,
      contentType,
      fileName: fileName.slice(0, 160),
      signedUploadExpiresInSeconds,
      signedUploadToken: data.token,
      signedUrlTtlSeconds: signedReadUrlTtlSeconds,
      sizeBytes: Math.round(sizeBytes),
      storagePath,
    });
  } catch (error) {
    console.error("custom-sticks-artwork-upload error", error);
    return jsonResponse({ error: "Unable to prepare artwork upload." }, 500);
  }
});

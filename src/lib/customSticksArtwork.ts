import { supabaseClient } from '@/lib/supabaseClient';

export const CUSTOM_STICKS_ARTWORK_BUCKET = 'custom-sticks-artwork';
export const CUSTOM_STICKS_ARTWORK_PRIVATE_PREFIX = 'private';
export const CUSTOM_STICKS_ARTWORK_SIGNED_URL_TTL_SECONDS = 15 * 60;
export const MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type CustomSticksArtworkUpload = {
  access: 'private';
  bucket: typeof CUSTOM_STICKS_ARTWORK_BUCKET;
  contentType: (typeof ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES)[number];
  fileName: string;
  signedUrlTtlSeconds: typeof CUSTOM_STICKS_ARTWORK_SIGNED_URL_TTL_SECONDS;
  sizeBytes: number;
  storagePath: string;
};

const sanitizeFileName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const validateCustomSticksArtwork = (file: File): void => {
  if (!ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES.includes(file.type as (typeof ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES)[number])) {
    throw new Error('Use PNG, JPG, or WEBP for custom sticks artwork.');
  }

  if (file.size > MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES) {
    throw new Error('Artwork must be 5MB or smaller.');
  }
};

export const uploadCustomSticksArtwork = async (
  file: File
): Promise<CustomSticksArtworkUpload> => {
  validateCustomSticksArtwork(file);

  const uniqueId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const safeName = sanitizeFileName(file.name || 'artwork') || 'artwork';
  const storagePath = `${CUSTOM_STICKS_ARTWORK_PRIVATE_PREFIX}/${uniqueId}-${safeName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(CUSTOM_STICKS_ARTWORK_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Unable to upload artwork.');
  }

  return {
    access: 'private',
    bucket: CUSTOM_STICKS_ARTWORK_BUCKET,
    contentType: file.type as CustomSticksArtworkUpload['contentType'],
    fileName: file.name || safeName,
    signedUrlTtlSeconds: CUSTOM_STICKS_ARTWORK_SIGNED_URL_TTL_SECONDS,
    sizeBytes: file.size,
    storagePath,
  };
};

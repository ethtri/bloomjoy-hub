import { supabaseClient } from '@/lib/supabaseClient';

export const CUSTOM_STICKS_ARTWORK_BUCKET = 'custom-sticks-artwork';
export const MAX_CUSTOM_STICKS_ARTWORK_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_CUSTOM_STICKS_ARTWORK_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

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
): Promise<{ publicUrl: string; storagePath: string }> => {
  validateCustomSticksArtwork(file);

  const uniqueId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const safeName = sanitizeFileName(file.name || 'artwork');
  const storagePath = `public/${uniqueId}-${safeName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(CUSTOM_STICKS_ARTWORK_BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Unable to upload artwork.');
  }

  const { data } = supabaseClient.storage
    .from(CUSTOM_STICKS_ARTWORK_BUCKET)
    .getPublicUrl(storagePath);

  if (!data?.publicUrl) {
    throw new Error('Artwork uploaded but no public URL was returned.');
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
  };
};

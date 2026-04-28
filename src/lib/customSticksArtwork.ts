import { supabaseClient } from '@/lib/supabaseClient';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

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

type CustomSticksArtworkUploadTokenResponse = CustomSticksArtworkUpload & {
  error?: string;
  signedUploadExpiresInSeconds: number;
  signedUploadToken: string;
};

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

  const uploadToken = await invokeEdgeFunction<CustomSticksArtworkUploadTokenResponse>(
    'custom-sticks-artwork-upload',
    {
      contentType: file.type,
      fileName: file.name || 'artwork',
      sizeBytes: file.size,
    }
  );

  if (uploadToken.error) {
    throw new Error(uploadToken.error);
  }

  const { error: uploadError } = await supabaseClient.storage
    .from(uploadToken.bucket)
    .uploadToSignedUrl(uploadToken.storagePath, uploadToken.signedUploadToken, file, {
      contentType: file.type || undefined,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Unable to upload artwork.');
  }

  return {
    access: 'private',
    bucket: uploadToken.bucket,
    contentType: uploadToken.contentType,
    fileName: uploadToken.fileName,
    signedUrlTtlSeconds: uploadToken.signedUrlTtlSeconds,
    sizeBytes: uploadToken.sizeBytes,
    storagePath: uploadToken.storagePath,
  };
};

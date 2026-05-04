import {
  getAccessInviteLoginUrl as getAccessInviteLoginUrlRuntime,
  resolveAccessInviteLoginOrigin as resolveAccessInviteLoginOriginRuntime,
  validateAccessInvitePreflight as validateAccessInvitePreflightRuntime,
} from './accessInviteLoginUrls.mjs';

export type AccessInviteLoginIntent = 'corporate_partner' | 'technician';

export type AccessInviteLocationLike = {
  origin: string;
  hostname: string;
  protocol: string;
};

export type AccessInvitePreflight =
  | { ok: true; targetEmail: string; loginUrl: string }
  | { ok: false; message: string };

export type AccessInviteLoginOriginResult =
  | { ok: true; origin: string; originType: 'production' | 'local' | 'preview' }
  | { ok: false; message: string };

export type AccessInviteLoginUrlResult =
  | { ok: true; loginUrl: string }
  | { ok: false; message: string };

export const resolveAccessInviteLoginOrigin = resolveAccessInviteLoginOriginRuntime as (
  locationLike?: AccessInviteLocationLike | null
) => AccessInviteLoginOriginResult;

export const getAccessInviteLoginUrl = getAccessInviteLoginUrlRuntime as (
  inviteType: AccessInviteLoginIntent,
  email: string,
  locationLike?: AccessInviteLocationLike | null
) => AccessInviteLoginUrlResult;

export const validateAccessInvitePreflight = validateAccessInvitePreflightRuntime as (
  inviteType: AccessInviteLoginIntent,
  email: string,
  locationLike?: AccessInviteLocationLike | null
) => AccessInvitePreflight;

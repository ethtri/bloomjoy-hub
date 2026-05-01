import { invokeEdgeFunction } from '@/lib/edgeFunctions';

export type AccessInviteType = 'corporate_partner' | 'technician';

export const sendAccessInvite = async ({
  inviteType,
  sourceId,
  targetEmail,
  loginUrl,
}: {
  inviteType: AccessInviteType;
  sourceId: string;
  targetEmail: string;
  loginUrl: string;
}): Promise<void> => {
  await invokeEdgeFunction(
    'access-invite',
    {
      inviteType,
      sourceId,
      targetEmail,
      loginUrl,
    },
    {
      requireUserAuth: true,
      authErrorMessage: 'Log in as a Super Admin to send an access invite.',
    }
  );
};

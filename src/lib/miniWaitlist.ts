import { invokeEdgeFunction } from '@/lib/edgeFunctions';

type CreateMiniWaitlistInput = {
  email: string;
  sourcePage?: string;
  website?: string;
};

export const createMiniWaitlistSubmission = async ({
  email,
  sourcePage = '/machines/mini',
  website = '',
}: CreateMiniWaitlistInput) => {
  const data = await invokeEdgeFunction<{ error?: string; alreadyExists?: boolean }>(
    'mini-waitlist-intake',
    {
      email,
      sourcePage,
      website,
    }
  );

  if (data?.alreadyExists) {
    throw new Error("You're already on the Mini waitlist.");
  }

  if (data?.error) {
    throw new Error(data.error);
  }
};

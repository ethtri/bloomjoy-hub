import { supabaseClient } from '@/lib/supabaseClient';

type CreateMiniWaitlistInput = {
  email: string;
  sourcePage?: string;
};

export const createMiniWaitlistSubmission = async ({
  email,
  sourcePage = '/products/mini',
}: CreateMiniWaitlistInput) => {
  const { error } = await supabaseClient.from('mini_waitlist_submissions').insert({
    product_slug: 'mini',
    email,
    source_page: sourcePage,
  });

  if (error?.code === '23505') {
    throw new Error("You're already on the Mini waitlist.");
  }

  if (error) {
    throw new Error(error.message || 'Unable to join the waitlist right now.');
  }
};

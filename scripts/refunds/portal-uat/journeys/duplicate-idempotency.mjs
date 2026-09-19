export const duplicateIdempotencyJourney = {
  name: 'duplicate-idempotency',
  checks: [
    'email-duplicate',
    'official-action-version-reset',
    'transactional-delivery-truth',
  ],
};

export const authorizationJourney = {
  name: 'authorization',
  checks: [
    'dual-role-official-action',
    'acknowledgement-recovery',
    'customer-locale-correction',
    'internal-test-disposition',
    'inbound-case-link-review',
  ],
};

export const pluralizeTechnicianMachine = (count: number, noun = 'machine') =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

export const formatTechnicianScopePreview = (count: number) =>
  count > 0
    ? `Training plus read-only reporting for ${pluralizeTechnicianMachine(count, 'selected machine')}`
    : 'Training-only access';

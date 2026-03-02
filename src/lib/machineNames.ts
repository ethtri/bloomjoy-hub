export const MACHINE_NAMES = {
  commercial: 'Commercial Machine',
  mini: 'Mini Machine',
  micro: 'Micro Machine',
} as const;

export const MACHINE_INTEREST_OPTIONS = [
  MACHINE_NAMES.commercial,
  MACHINE_NAMES.mini,
  MACHINE_NAMES.micro,
] as const;

export const normalizeMachineInterest = (rawInterest: string | null): string => {
  if (!rawInterest) return '';

  const normalized = rawInterest
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (normalized.includes('commercial')) return MACHINE_NAMES.commercial;
  if (normalized === 'mini' || normalized === 'mini machine') return MACHINE_NAMES.mini;
  if (normalized === 'micro' || normalized === 'micro machine') return MACHINE_NAMES.micro;

  return rawInterest.trim();
};

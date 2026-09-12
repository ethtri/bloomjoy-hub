export const machineTypeOptions = [
  { value: 'commercial', label: 'Cotton Candy - Commercial' },
  { value: 'mini', label: 'Cotton Candy - Mini' },
  { value: 'micro', label: 'Cotton Candy Micro' },
  { value: 'snapcase', label: 'Snapcase' },
] as const;

export type CanonicalMachineType = (typeof machineTypeOptions)[number]['value'];
export type ReportingMachineType = CanonicalMachineType | 'unknown';

const machineTypeLabels = Object.fromEntries(
  machineTypeOptions.map(({ value, label }) => [value, label])
) as Record<CanonicalMachineType, string>;

const compactMachineType = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export const normalizeMachineType = (
  value: string | null | undefined
): CanonicalMachineType | null => {
  switch (compactMachineType(value ?? '')) {
    case 'commercial':
    case 'cottoncandycommercial':
      return 'commercial';
    case 'mini':
    case 'cottoncandymini':
      return 'mini';
    case 'micro':
    case 'cottoncandymicro':
      return 'micro';
    case 'snapcase':
      return 'snapcase';
    default:
      return null;
  }
};

export const formatMachineType = (value: string | null | undefined) => {
  const canonicalType = normalizeMachineType(value);
  return canonicalType ? machineTypeLabels[canonicalType] : 'Product unverified';
};

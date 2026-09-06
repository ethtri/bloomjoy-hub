const normalizeLabel = (value: string) => value.trim().replace(/\s+/g, ' ');

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsDelimitedLabel = (container: string, label: string) => {
  if (!label) return false;
  const escapedLabel = escapeRegularExpression(label);
  const prefixPattern = new RegExp(`^${escapedLabel}(?=$|[^\\p{L}\\p{N}])`, 'u');
  const suffixPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapedLabel}$`, 'u');
  return prefixPattern.test(container) || suffixPattern.test(container);
};

export const formatRefundMachineLocation = (locationName: string, machineLabel: string) => {
  const normalizedLocationName = normalizeLabel(locationName);
  const normalizedMachineLabel = normalizeLabel(machineLabel);
  const normalizedLocationKey = normalizedLocationName.toLocaleLowerCase();
  const normalizedMachineKey = normalizedMachineLabel.toLocaleLowerCase();
  const locationIsPlaceholder =
    !normalizedLocationName ||
    normalizedLocationKey === 'unmapped' ||
    normalizedLocationKey === 'unknown' ||
    normalizedLocationKey.startsWith('unmapped ') ||
    normalizedLocationKey.startsWith('unknown ');

  if (!normalizedMachineLabel) return locationIsPlaceholder ? '' : normalizedLocationName;
  if (
    locationIsPlaceholder ||
    containsDelimitedLabel(normalizedMachineKey, normalizedLocationKey)
  ) {
    return normalizedMachineLabel;
  }

  return `${normalizedLocationName} - ${normalizedMachineLabel}`;
};

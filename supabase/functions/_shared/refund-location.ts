const sanitizeText = (value: unknown, maxLength = 180) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

export const isPlaceholderRefundLocation = (value: unknown) => {
  const normalized = sanitizeText(value).toLowerCase();
  return normalized === "unmapped" ||
    normalized === "unknown" ||
    normalized.startsWith("unmapped ") ||
    normalized.startsWith("unknown ");
};

export const resolveRefundPublicLabels = ({
  locationName,
  publicMachineLabel,
  machineLabel,
}: {
  locationName: unknown;
  publicMachineLabel?: unknown;
  machineLabel?: unknown;
}) => {
  const explicitPublicLabel = sanitizeText(publicMachineLabel);
  const resolvedMachineLabel = explicitPublicLabel || sanitizeText(machineLabel) || "Bloomjoy machine";
  const resolvedLocationName = sanitizeText(locationName);

  return {
    machineLabel: resolvedMachineLabel,
    locationName: !resolvedLocationName || isPlaceholderRefundLocation(resolvedLocationName)
      ? explicitPublicLabel || "Bloomjoy location"
      : resolvedLocationName,
  };
};

// Retained location argument is internal context, never machine display identity.
export const formatRefundMachineLocation = (_locationName: string, machineLabel: string) => machineLabel.trim().replace(/\s+/g, ' ');

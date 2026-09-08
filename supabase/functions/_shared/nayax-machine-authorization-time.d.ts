export function parseNayaxMachineAuthorizationTime(value: unknown): string;
export function buildNayaxMachineAuthorizationTimeWireValue(input: {
  rawValue: unknown;
  normalizedInstant: unknown;
  mode: "exact_source" | "source_with_bound_offset";
}): string;

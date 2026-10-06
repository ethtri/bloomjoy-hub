const statusWords = /^(?:running|off|online|offline|normal|abnormal)$/i;
const placeholders = /^(?:no set name|unnamed(?: machine)?|not set)$/i;
export const usableSunzeMachineName = (value, explicitField = false) => {
  const name = String(value ?? '').replace(/\s+/g,' ').trim();
  if (!name || name.length > 200 || placeholders.test(name) || (!explicitField && statusWords.test(name))) return null;
  return name;
};

export const mergeSunzeMachineNames = (orderNames, visibleMachines) => {
  const names = new Map(orderNames);
  for (const machine of visibleMachines) {
    const name = usableSunzeMachineName(machine.machineName, machine.machineNameEvidence === 'explicit_field');
    if (name) names.set(machine.machineCode.toLowerCase(), name);
  }
  return names;
};

export const preserveSunzeMachineName = (validatedImportedName, previousName) =>
  validatedImportedName ?? usableSunzeMachineName(previousName) ?? null;

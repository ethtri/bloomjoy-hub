/** Retain one exact idempotent request across an uncertain transport result. */
export function createOwnerResolutionSubmission<T extends Record<string, unknown>, R>(save: (request: T) => Promise<R>) {
  let retained: T | null = null;
  return { async submit(build: () => Promise<T>) {
    if (!retained) retained = await build();
    const result = await save(retained); retained = null; return result;
  }, hasRetained() { return retained !== null; }, reset() { retained = null; } };
}

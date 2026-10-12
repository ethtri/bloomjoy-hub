export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export const withRequestTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Request timeout must be a positive number.');
  }

  const controller = new AbortController();
  if (parentSignal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
  let abortFromParent: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abortFromParent = () => { controller.abort(); reject(new DOMException('Request canceled.', 'AbortError')); };
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout, canceled]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
};

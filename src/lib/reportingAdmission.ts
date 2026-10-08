export class ReportingAdmissionCancelled extends Error {
  constructor() { super('Report request is no longer current.'); this.name = 'AbortError'; }
}

type Admission = { eligible: () => boolean; signal?: AbortSignal; priority?: number };
type Pending = Admission & { start: () => void; cancel: () => void };

/** One heavy request per browser, including a departing user's active request.
 * Cancellation never releases an active slot while its server work is running. */
export class ReportingAdmissionQueue {
  private active = false;
  private pending: Pending[] = [];

  revalidate() {
    for (const entry of [...this.pending]) {
      if (entry.signal?.aborted || !entry.eligible()) entry.cancel();
    }
  }

  run<T>(admission: Admission, request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => admission.signal?.removeEventListener('abort', cancel);
      const cancel = () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) return; // Active work retains the slot until settled.
        this.pending.splice(index, 1); cleanup(); reject(new ReportingAdmissionCancelled());
      };
      const finish = () => { cleanup(); this.active = false; this.drain(); };
      const entry: Pending = { ...admission, cancel, start: () => {
        this.active = true;
        Promise.resolve().then(() => {
          if (admission.signal?.aborted || !admission.eligible()) throw new ReportingAdmissionCancelled();
          return request();
        }).then(value => {
          if (admission.signal?.aborted || !admission.eligible()) reject(new ReportingAdmissionCancelled());
          else resolve(value);
          finish();
        }, error => { reject(error); finish(); });
      } };
      this.pending.push(entry);
      admission.signal?.addEventListener('abort', cancel, { once: true });
      queueMicrotask(() => this.drain());
    });
  }

  private drain() {
    this.revalidate();
    if (this.active) return;
    this.pending.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    this.pending.shift()?.start();
  }
}

export const reportingAdmission = new ReportingAdmissionQueue();

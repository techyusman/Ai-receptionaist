// Background work. A job is queued in the same transaction as the change that needs it, so a crash
// can't lose it, and handlers are plain functions of (deps, data) that tests call directly. In
// production the queue is pg-boss on the same Postgres; in tests and the dev stack it runs in-process.
import type { Tx } from "@receptionist/db";

export type JobData = {
  "catalog.sync": { locationId: string; kind: "FULL" | "INCREMENTAL"; trigger: "CONNECT" | "WEBHOOK" | "SCHEDULE" | "MANUAL" | "RECONCILE" };
  /** full: also re-download the whole catalog (the nightly pass), not just ask what changed. */
  "catalog.reconcile": { full?: boolean };
  "catalog.staleness": Record<string, never>;
  "square.refresh_tokens": Record<string, never>;
  "order.reconcile": { orderId: string };
  "webhook.process": { eventId: string };
  "call.finalize": { callId: string };
  "alerts.fanout": { alertId: string };
  "retention.purge": Record<string, never>;
  "usage.rollup": Record<string, never>;
};
export type JobName = keyof JobData;

export type EnqueueOptions = {
  /** Run the job no sooner than this many seconds from now. */
  delaySeconds?: number;
  /** Only one queued job per key (debouncing: a burst of Square webhooks becomes one sync). */
  singletonKey?: string;
  /** Join this transaction, so the job exists only if the change commits. */
  tx?: Tx;
};

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobData[N], options?: EnqueueOptions): Promise<void>;
}

export type JobHandler<N extends JobName> = (data: JobData[N]) => Promise<void>;
export type JobHandlers = { [N in JobName]: JobHandler<N> };

/** Collects jobs so a test (or the dev stack) can run them when it chooses. */
export class InlineQueue implements JobQueue {
  readonly pending: { name: JobName; data: unknown; options: EnqueueOptions; runAt: number }[] = [];
  handlers: Partial<JobHandlers> = {};
  readonly failures: { name: JobName; error: unknown }[] = [];

  async enqueue<N extends JobName>(name: N, data: JobData[N], options: EnqueueOptions = {}): Promise<void> {
    if (options.singletonKey && this.pending.some((j) => j.name === name && j.options.singletonKey === options.singletonKey)) return;
    this.pending.push({ name, data, options, runAt: Date.now() + (options.delaySeconds ?? 0) * 1000 });
  }

  /** Runs everything queued, including jobs that queue more, ignoring delays. */
  async drain(max = 50): Promise<number> {
    let ran = 0;
    while (this.pending.length && ran < max) {
      const job = this.pending.shift()!;
      const handler = this.handlers[job.name] as ((d: unknown) => Promise<void>) | undefined;
      if (!handler) continue;
      try {
        await handler(job.data);
      } catch (error) {
        this.failures.push({ name: job.name, error });
      }
      ran++;
    }
    return ran;
  }

  names(): JobName[] {
    return this.pending.map((j) => j.name);
  }
}

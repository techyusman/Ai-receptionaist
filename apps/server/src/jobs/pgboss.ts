// The production job queue: pg-boss, a queue stored in the same Postgres. A job is added inside the
// transaction of the change that needs it, so it exists if and only if that change committed. The worker
// process registers the handlers and the schedules; the web process only adds jobs.
import { PgBoss } from "pg-boss";
import type { Db } from "@receptionist/db";
import type { EnqueueOptions, JobData, JobHandlers, JobName, JobQueue } from "./queue.ts";

const NAMES: JobName[] = [
  "catalog.sync", "catalog.reconcile", "catalog.staleness", "square.refresh_tokens", "order.reconcile",
  "webhook.process", "call.finalize", "alerts.fanout", "retention.purge", "usage.rollup",
];

// Retries: a few, with growing gaps. Business-level retries (an unsure order) are scheduled by the job itself.
const RETRY = { retryLimit: 4, retryDelay: 20, retryBackoff: true, expireInSeconds: 15 * 60 } as const;

const SCHEDULES: { name: JobName; cron: string; data: object }[] = [
  { name: "catalog.reconcile", cron: "*/15 * * * *", data: {} },
  { name: "catalog.reconcile", cron: "30 7 * * *", data: { full: true } }, // 03:30 in New York; a full pass overnight
  { name: "catalog.staleness", cron: "*/5 * * * *", data: {} },
  { name: "square.refresh_tokens", cron: "17 5 * * *", data: {} },
  { name: "retention.purge", cron: "0 4 * * *", data: {} },
  { name: "usage.rollup", cron: "30 4 * * *", data: {} },
];

export class PgBossQueue implements JobQueue {
  readonly boss: PgBoss;
  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, application_name: "receptionist-jobs", max: 4 });
  }

  /** Creates the queue tables if needed. Needs a role that can create schemas. */
  async install(): Promise<void> {
    await this.boss.start();
    // The dead-letter queue must exist before any queue can name it. Only "already exists" is ignored.
    const ifNew = (e: unknown) => {
      if (!/exist/i.test((e as Error).message)) throw e;
    };
    await this.boss.createQueue("dead_letter").catch(ifNew);
    for (const n of NAMES) await this.boss.createQueue(n, { ...RETRY, deadLetter: "dead_letter" }).catch(ifNew);
  }

  async enqueue<N extends JobName>(name: N, data: JobData[N], options: EnqueueOptions = {}): Promise<void> {
    const tx = options.tx;
    await this.boss.send(name, data as object, {
      ...(options.delaySeconds ? { startAfter: options.delaySeconds } : {}),
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(tx ? { db: { executeSql: async (text: string, values?: unknown[]) => ({ rows: (await tx.query(text, values as never)).rows }) } } : {}),
    });
  }

  /** The worker: run handlers, and keep the recurring jobs scheduled. */
  async work(handlers: JobHandlers, log: (msg: string, extra?: object) => void): Promise<void> {
    for (const name of NAMES) {
      await this.boss.work(name, { batchSize: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
        if (!job) return;
        await (handlers[name] as (d: unknown) => Promise<void>)(job.data);
      });
    }
    await this.boss.work("dead_letter", { batchSize: 1 }, async ([job]) => {
      if (job) log("a job ran out of retries", { job: (job as { name?: string }).name, data: job.data });
    });
    for (const [i, s] of SCHEDULES.entries()) await this.boss.schedule(s.name, s.cron, s.data, { tz: "UTC", key: `${s.name}.${i}` });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }
}

/** The web and worker processes connect as the application role, which must be allowed to add jobs. */
export async function grantQueueAccess(admin: Db, role = "app_rw"): Promise<void> {
  await admin.query(`grant usage on schema pgboss to ${role}`);
  await admin.query(`grant select, insert, update, delete on all tables in schema pgboss to ${role}`);
  await admin.query(`grant usage, select on all sequences in schema pgboss to ${role}`);
  await admin.query(`grant execute on all functions in schema pgboss to ${role}`);
}

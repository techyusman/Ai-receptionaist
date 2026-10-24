// Live dashboard updates. A change calls signal() inside its own transaction; Postgres delivers the
// NOTIFY only if that transaction commits, to every server instance listening, and each pushes it to
// the browsers watching that location over SSE. No extra vendor, and nothing is announced that was
// rolled back.
import pg from "pg";
import type { LiveEvent } from "@receptionist/contracts";
import type { Tx } from "@receptionist/db";

const CHANNEL = "live";

export type LiveEnvelope = { locationId: string; event: LiveEvent };

export async function signal(tx: Pick<Tx, "query">, locationId: string, event: LiveEvent): Promise<void> {
  await tx.query("select pg_notify($1, $2)", [CHANNEL, JSON.stringify({ locationId, event } satisfies LiveEnvelope)]);
}

type Listener = (event: LiveEvent) => void;

export class LiveBus {
  readonly #url: string;
  readonly #listeners = new Map<string, Set<Listener>>();
  #client: pg.Client | null = null;
  #closed = false;
  #retry: NodeJS.Timeout | null = null;

  constructor(connectionString: string) {
    this.#url = connectionString;
  }

  async start(): Promise<void> {
    await this.#connect();
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    const client = new pg.Client({ connectionString: this.#url, application_name: "live-bus" });
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { locationId, event } = JSON.parse(msg.payload) as LiveEnvelope;
        for (const fn of this.#listeners.get(locationId) ?? []) fn(event);
      } catch {
        // a malformed payload is ignored; nothing else listens to this channel
      }
    });
    const lost = () => {
      if (this.#client === client) this.#client = null;
      client.removeAllListeners();
      client.end().catch(() => {});
      if (!this.#closed && !this.#retry) {
        // Browsers reconnect on their own and refetch; we only need to come back quickly.
        this.#retry = setTimeout(() => {
          this.#retry = null;
          this.#connect().catch(() => lost());
        }, 1000);
      }
    };
    client.on("error", lost);
    client.on("end", lost);
    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    this.#client = client;
  }

  subscribe(locationId: string, fn: Listener): () => void {
    let set = this.#listeners.get(locationId);
    if (!set) this.#listeners.set(locationId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.#listeners.delete(locationId);
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retry) clearTimeout(this.#retry);
    const c = this.#client;
    this.#client = null;
    await c?.end().catch(() => {});
  }
}

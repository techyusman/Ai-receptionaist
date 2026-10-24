import { can, listCallsQuery, PAGE_SIZE, type CallDetail, type CallEvent, type CallSummary, type Page, type Role, type Transfer, type TranscriptTurn } from "@receptionist/contracts";
import { many, maybeOne, one, type Tx } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { notFound } from "../errors.ts";
import { idParam, lidParam, parse, who } from "../http.ts";
import { tenant } from "./util.ts";

const RANGE_DAYS = { today: 0, "7d": 6, "30d": 29, all: null } as const;
export const mask = (phone: string | null): string | null => (phone ? `•••${phone.slice(-4)}` : null);
/** LIKE treats % and _ as wildcards; the "!" escape character (declared in the SQL) makes them literal. */
const escapeLike = (s: string) => s.replace(/[!%_]/g, "!$&");

type CallRow = {
  id: string; started_at: string; duration_seconds: number | null; from_e164: string | null; caller_name: string | null;
  outcome: CallSummary["outcome"]; status: CallSummary["status"]; summary: string | null; order_id: string | null;
  transferred: boolean; is_test: boolean;
};

const CALL_SELECT = `c.id, c.started_at, c.duration_seconds, c.from_e164, c.caller_name, c.outcome, c.status, c.summary, c.is_test,
  (select o.id from orders o where o.call_id = c.id order by o.created_at desc limit 1) as order_id,
  (c.outcome = 'TRANSFERRED' or c.transfer_status <> 'NONE') as transferred`;

function toSummary(r: CallRow, role: Role): CallSummary {
  return {
    id: r.id, startedAt: r.started_at, durationSeconds: r.duration_seconds, callerPhone: can(role, "calls.fullPhone") ? r.from_e164 : mask(r.from_e164),
    callerName: r.caller_name, outcome: r.outcome, status: r.status, summary: r.summary, orderId: r.order_id, transferred: r.transferred, isTest: r.is_test,
  };
}

export async function callDetail(tx: Tx, id: string, role: Role): Promise<CallDetail | null> {
  const r = await maybeOne<CallRow & { location_id: string }>(tx, `select ${CALL_SELECT}, c.location_id from calls c where c.id = $1`, [id]);
  if (!r) return null;
  const settings = await maybeOne<{ transcript_enabled: boolean }>(tx, "select transcript_enabled from location_settings where location_id = $1", [r.location_id]);
  const events = await many<{ occurred_at: string; event_type: string; actor_type: CallEvent["actor"]; payload_redacted: { detail?: string } }>(
    tx, "select occurred_at, event_type, actor_type, payload_redacted from call_events where call_id = $1 order by seq", [id]);
  const transfers = await many<{ id: string; destination_e164: string; label: string | null; reason: string; started_at: string; result: Transfer["result"] }>(
    tx,
    `select t.id, t.destination_e164, tt.label, t.reason, t.started_at, t.result from transfers t
       left join transfer_targets tt on tt.id = t.target_id where t.call_id = $1 order by t.started_at`, [id]);
  const allowTranscript = can(role, "calls.transcript") && (settings?.transcript_enabled ?? false);
  const transcript = allowTranscript
    ? await maybeOne<{ segments: { speaker: "CALLER" | "AI"; text: string; at_ms: number }[] }>(tx, "select segments from call_transcripts where call_id = $1", [id])
    : null;
  return {
    ...toSummary(r, role),
    events: events.map((e) => ({ at: e.occurred_at, type: e.event_type, actor: e.actor_type, detail: e.payload_redacted?.detail ?? "" })),
    transfers: transfers.map((t) => ({ id: t.id, destination: t.destination_e164, label: t.label, reason: t.reason, startedAt: t.started_at, result: t.result })),
    transcript: transcript ? transcript.segments.map((s): TranscriptTurn => ({ speaker: s.speaker, text: s.text, atMs: s.at_ms })) : null,
    transcriptsEnabled: settings?.transcript_enabled ?? false,
  };
}

export function registerCallRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/calls", async (req): Promise<Page<CallSummary>> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "calls.view");
    const q = parse(listCallsQuery, req.query);
    const offset = Math.max(0, Number(q.cursor) || 0);
    const where: string[] = ["c.location_id = $1"];
    const params: unknown[] = [lid];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (q.outcome !== "all") add("c.outcome = ?", q.outcome);
    if (q.transferred === "true") where.push("(c.outcome = 'TRANSFERRED' or c.transfer_status <> 'NONE')");
    const days = RANGE_DAYS[q.range];
    if (days !== null) {
      params.push(deps.now().toISOString(), days);
      where.push(`(c.started_at at time zone l.timezone)::date >= ((($${params.length - 1}::timestamptz) at time zone l.timezone)::date - $${params.length}::int)`);
    }
    if (q.q) {
      params.push(`%${escapeLike(q.q.toLowerCase())}%`);
      const n = `$${params.length}`;
      // Staff who can't see full numbers can't search by them either.
      where.push(
        can(a.role, "calls.fullPhone")
          ? `(lower(coalesce(c.summary,'')) like ${n} escape '!' or lower(coalesce(c.caller_name,'')) like ${n} escape '!' or coalesce(c.from_e164,'') like ${n} escape '!')`
          : `(lower(coalesce(c.summary,'')) like ${n} escape '!' or lower(coalesce(c.caller_name,'')) like ${n} escape '!')`,
      );
    }
    return tenant(deps, a, async (tx) => {
      const base = `from calls c join locations l on l.id = c.location_id where ${where.join(" and ")}`;
      const total = await one<{ n: number }>(tx, `select count(*)::int as n ${base}`, params);
      const rows = await many<CallRow>(tx, `select ${CALL_SELECT} ${base} order by c.started_at desc, c.id limit ${PAGE_SIZE} offset ${offset}`, params);
      return { items: rows.map((r) => toSummary(r, a.role)), total: total.n, nextCursor: offset + PAGE_SIZE < total.n ? String(offset + PAGE_SIZE) : null };
    });
  });

  api.get("/calls/:id", async (req): Promise<CallDetail> => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "call", id, "calls.view");
    const detail = await tenant(deps, a, (tx) => callDetail(tx, id, a.role));
    if (!detail) throw notFound();
    return detail;
  });
}

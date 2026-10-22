import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState, StatusPill } from "@/components/ui/display";
import type { CallDetail } from "@/data/types";
import { fmtDateTime, fmtDuration, fmtTime, prettyPhone } from "@/lib/format";

const actorLabel = { SYSTEM: "System", AI: "AI", CALLER: "Caller", STAFF: "Staff" } as const;
const transferLabel = { CONNECTED: "answered", NO_ANSWER: "not answered", BUSY: "line busy", FAILED: "failed", CANCELED: "cancelled" } as const;

/** S15 call summary: outcome, what the AI did, transfers, the linked order, transcript if enabled. */
export function CallDetailPanel({ call, timeZone }: { call: CallDetail | null; timeZone: string }) {
  if (!call) {
    return (
      <EmptyState icon={SearchX} title="Call not found">
        It may belong to another location, or the link is wrong.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {call.outcome ? <StatusPill domain="call" value={call.outcome} /> : <span className="text-sm text-muted">In progress</span>}
        {call.isTest && <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted">Test call</span>}
      </div>

      {call.summary && <p className="text-base text-fg">{call.summary}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Started</dt>
        <dd className="text-fg">{fmtDateTime(call.startedAt, timeZone)}</dd>
        <dt className="text-muted">Length</dt>
        <dd className="text-fg">{fmtDuration(call.durationSeconds)}</dd>
        <dt className="text-muted">Caller</dt>
        <dd className="text-fg">
          {call.callerName ? `${call.callerName}, ` : ""}
          {call.callerPhone ? (call.callerPhone.startsWith("+") ? prettyPhone(call.callerPhone) : call.callerPhone) : "Number withheld"}
        </dd>
      </dl>

      {call.orderId && (
        <Link href={`/orders?order=${call.orderId}`} className="text-sm text-accent underline underline-offset-2">
          Open the order from this call
        </Link>
      )}

      {call.transfers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">Transfers</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {call.transfers.map((t) => (
              <li key={t.id} className="text-fg">
                To {t.label ?? prettyPhone(t.destination)} at {fmtTime(t.startedAt, timeZone)}:{" "}
                <span className={t.result === "CONNECTED" ? "text-success" : "text-warning"}>{t.result ? transferLabel[t.result] : "ringing"}</span>
                <span className="text-muted"> · {t.reason.toLowerCase().replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">What happened</h3>
        <ol className="flex flex-col gap-2 border-l-2 border-border pl-4">
          {call.events.map((e, i) => (
            <li key={i} className="text-sm">
              <p className="text-fg">{e.detail}</p>
              <p className="text-xs text-muted">
                {fmtTime(e.at, timeZone)} · {actorLabel[e.actor]}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">Transcript</h3>
        {call.transcript ? (
          <ol className="flex flex-col gap-2">
            {call.transcript.map((t, i) => (
              <li key={i} className={t.speaker === "AI" ? "rounded-md bg-accent-subtle p-2 text-sm text-fg" : "rounded-md bg-surface-muted p-2 text-sm text-fg"}>
                <span className="font-semibold">{t.speaker === "AI" ? "AI" : "Caller"}: </span>
                {t.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">
            {call.transcriptsEnabled
              ? "No transcript for this call, or your role can't see transcripts."
              : "Transcripts are off for this location, so only the summary and steps above were kept. Owners can turn them on under AI agent → Call handling."}
          </p>
        )}
        <p className="text-xs text-muted">No audio is stored for this call.</p>
      </section>
    </div>
  );
}

import "server-only";
import { localClock } from "@receptionist/domain";
import type { FaqRow } from "@/app/(app)/knowledge/knowledge-list";
import type { Faq } from "@/data/types";
import { fmtDay } from "@/lib/format";

/** Adds local dates and status labels ("Until Nov 30", "Expired") as of now, in the restaurant's zone. */
export function toFaqRows(faqs: Faq[], timeZone: string, now = Date.now()): FaqRow[] {
  return faqs.map((f) => {
    const expired = !!f.validUntil && new Date(f.validUntil).getTime() < now;
    return {
      ...f,
      startsOn: f.validFrom ? localClock(new Date(f.validFrom), timeZone).date : null,
      endsOn: f.validUntil ? localClock(new Date(f.validUntil), timeZone).date : null,
      startsLabel: f.validFrom && new Date(f.validFrom).getTime() > now ? `Starts ${fmtDay(f.validFrom, timeZone)}` : null,
      endsLabel: f.validUntil ? (expired ? "Expired" : `Until ${fmtDay(f.validUntil, timeZone)}`) : null,
      expired,
    };
  });
}

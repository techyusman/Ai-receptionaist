"use client";

import { findOverlaps, toE164, WEEKDAYS, type Shift } from "@receptionist/domain";
import { Plus, Trash } from "lucide-react";
import { useState } from "react";
import { addSpecialHours, deleteSpecialHours, putHours, updateLocation } from "@/app/actions/content";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Card } from "@/components/ui/display";
import { controlClass, FormField, Input, NativeSelect, segmentedFocus, Textarea } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { Hours, Location, SpecialHours } from "@/data/types";
import { cn } from "@/lib/cn";
import { prettyPhone } from "@/lib/format";

/* Details ------------------------------------------------------------------- */

export function LocationDetails({ location, zones }: { location: Location; zones: string[] }) {
  const [d, setD] = useState({
    name: location.name,
    line1: location.address.line1,
    line2: location.address.line2 ?? "",
    city: location.address.city,
    region: location.address.region,
    postalCode: location.address.postalCode,
    directions: location.directions,
    publicPhone: location.publicPhone ? prettyPhone(location.publicPhone) : "",
    website: location.website ?? "",
    timezone: location.timezone,
  });
  const save = useAction();
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const phoneDigits = d.publicPhone.replace(/\D/g, "");
  // Read in the location's country (042 3500 0189 in Lahore); a full +country number works anywhere.
  const publicPhone = !phoneDigits ? null : (toE164(d.publicPhone, location.address.country) ?? `+${phoneDigits}`);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg text-fg">Location details</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Location name" hint="How staff tell locations apart, e.g. “Main Street”." error={save.fieldError("name")}>
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
        </FormField>
        <FormField label="Time zone" hint="Hours and order times use this zone.">
          <NativeSelect value={d.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Street address" error={save.fieldError("address")}>
          <Input value={d.line1} onChange={(e) => set("line1", e.target.value)} autoComplete="address-line1" />
        </FormField>
        <FormField label="Apartment, suite (optional)">
          <Input value={d.line2} onChange={(e) => set("line2", e.target.value)} autoComplete="address-line2" />
        </FormField>
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3 md:col-span-2">
          <FormField label="City">
            <Input value={d.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
          </FormField>
          <FormField label="State">
            <Input value={d.region} onChange={(e) => set("region", e.target.value)} autoComplete="address-level1" />
          </FormField>
          <FormField label="ZIP">
            <Input value={d.postalCode} onChange={(e) => set("postalCode", e.target.value)} autoComplete="postal-code" />
          </FormField>
        </div>
        <FormField label="Directions and parking" hint="What the AI says when someone asks how to find you." className="md:col-span-2">
          <Textarea value={d.directions} onChange={(e) => set("directions", e.target.value)} maxLength={500} />
        </FormField>
        <FormField label="Public phone number" hint="Your usual number. The AI gives it out if asked." error={save.fieldError("publicPhone")}>
          <Input value={d.publicPhone} onChange={(e) => set("publicPhone", e.target.value)} inputMode="tel" />
        </FormField>
        <FormField label="Website" error={save.fieldError("website")}>
          <Input value={d.website} onChange={(e) => set("website", e.target.value)} inputMode="url" placeholder="https://" />
        </FormField>
      </div>
      <Button
        className="self-start"
        loading={save.pending}
        onClick={() =>
          save.run(
            () =>
              updateLocation({
                name: d.name,
                timezone: d.timezone,
                directions: d.directions,
                publicPhone,
                website: d.website.trim() || null,
                address: { line1: d.line1, line2: d.line2 || undefined, city: d.city, region: d.region, postalCode: d.postalCode, country: location.address.country },
              }),
            { success: "Location saved" },
          )
        }
      >
        Save details
      </Button>
    </Card>
  );
}

/* Weekly hours ------------------------------------------------------------------ */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const complete = (s: Shift) => HHMM.test(s.opens) && HHMM.test(s.closes);

/** What's wrong with a week of shifts, first things first. A blank or half-typed time is a problem to
 * show, never something to parse. */
function weekProblems(shifts: Shift[]): string[] {
  const out: string[] = [];
  for (const s of shifts) {
    if (!complete(s)) out.push(`${WEEKDAYS[s.weekday]} needs an opening and a closing time.`);
    else if (s.opens === s.closes) out.push(`${WEEKDAYS[s.weekday]} opens and closes at ${s.opens}.`);
  }
  return [...out, ...findOverlaps(shifts.filter((s) => complete(s) && s.opens !== s.closes)).map((o) => o.message)];
}

function WeekEditor({ shifts, onChange }: { shifts: Shift[]; onChange: (s: Shift[]) => void }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const problems = weekProblems(shifts);
  return (
    <div className="flex flex-col gap-1">
      {order.map((weekday) => {
        const day = shifts.map((s, i) => ({ s, i })).filter(({ s }) => s.weekday === weekday);
        const update = (i: number, patch: Partial<Shift>) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
        return (
          <div key={weekday} className="grid gap-2 border-b border-border py-3 last:border-0 md:grid-cols-[8rem_1fr]">
            <div className="flex items-center">
              <Switch
                label={WEEKDAYS[weekday]!}
                description={day.length > 0 ? "Open" : "Closed"}
                checked={day.length > 0}
                onCheckedChange={(open) => onChange(open ? [...shifts, { weekday, opens: "08:00", closes: "16:00" }] : shifts.filter((s) => s.weekday !== weekday))}
                className="w-full justify-between gap-3 md:justify-start"
              />
            </div>
            <div className="flex flex-col gap-2">
              {day.map(({ s, i }, n) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`o-${weekday}-${n}`}>{`${WEEKDAYS[weekday]} shift ${n + 1} opens`}</label>
                  <input id={`o-${weekday}-${n}`} type="time" value={s.opens} onChange={(e) => update(i, { opens: e.target.value })} className={cn(controlClass, segmentedFocus, "h-10 w-32")} />
                  <span className="text-sm text-muted">to</span>
                  <label className="sr-only" htmlFor={`c-${weekday}-${n}`}>{`${WEEKDAYS[weekday]} shift ${n + 1} closes`}</label>
                  <input id={`c-${weekday}-${n}`} type="time" value={s.closes} onChange={(e) => update(i, { closes: e.target.value })} className={cn(controlClass, segmentedFocus, "h-10 w-32")} />
                  {complete(s) && s.closes < s.opens && <span className="text-xs text-muted">ends after midnight</span>}
                  <IconButton label={`Remove ${WEEKDAYS[weekday]} shift ${n + 1}`} size="sm" onClick={() => onChange(shifts.filter((_, j) => j !== i))}>
                    <Trash aria-hidden />
                  </IconButton>
                </div>
              ))}
              {day.length > 0 && day.length < 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    const last = day[day.length - 1]!.s;
                    onChange([...shifts, { weekday, opens: last.closes, closes: last.closes < "21:00" ? "22:00" : "23:30" }]);
                  }}
                >
                  <Plus aria-hidden /> Add a shift
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {problems.length > 0 && (
        <p role="alert" className="pt-2 text-sm text-danger">
          {problems[0]} Fix it to save.
        </p>
      )}
    </div>
  );
}

export function HoursEditor({ hours }: { hours: Hours }) {
  const [store, setStore] = useState(hours.store);
  const [ordering, setOrdering] = useState(hours.ordering);
  const save = useAction();
  const invalid = weekProblems(store).length > 0 || weekProblems(ordering).length > 0;
  const dirty = JSON.stringify({ store, ordering }) !== JSON.stringify(hours);
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg text-fg">Weekly hours</h2>
        <p className="text-sm text-muted">Opening hours are what the AI tells callers. Ordering hours are when it takes orders; end them before closing to give the kitchen time.</p>
      </div>
      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store">Opening hours</TabsTrigger>
          <TabsTrigger value="ordering">Ordering hours</TabsTrigger>
        </TabsList>
        <TabsContent value="store">
          <WeekEditor shifts={store} onChange={setStore} />
        </TabsContent>
        <TabsContent value="ordering">
          <WeekEditor shifts={ordering} onChange={setOrdering} />
        </TabsContent>
      </Tabs>
      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      <Button className="self-start" disabled={!dirty || invalid} loading={save.pending} onClick={() => save.run(() => putHours({ store, ordering }), { success: "Hours saved" })}>
        Save hours
      </Button>
    </Card>
  );
}

/* Special days --------------------------------------------------------------------- */

export function SpecialDays({ specials }: { specials: (SpecialHours & { label: string })[] }) {
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState("09:00");
  const [closes, setCloses] = useState("14:00");
  const [note, setNote] = useState("");
  const add = useAction();
  const toast = useToast();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg text-fg">Holidays and special days</h2>
        <p className="text-sm text-muted">These replace the weekly hours for that date.</p>
      </div>
      {specials.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {specials.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-fg">
                <span className="font-semibold">{s.label}</span>: {s.closed ? "Closed" : `${s.opens}–${s.closes}`}
                {s.note && <span className="text-muted"> · {s.note}</span>}
              </span>
              <IconButton
                label={`Remove ${s.label}`}
                size="sm"
                onClick={async () => {
                  const r = await deleteSpecialHours(s.id);
                  if (!r.ok) toast({ title: r.message, variant: "error" });
                }}
              >
                <Trash aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 md:grid-cols-[auto_auto_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.run(() => addSpecialHours({ date, closed, opens: closed ? null : opens, closes: closed ? null : closes, note: note || null }), {
            success: "Special day added",
            onDone: () => {
              setDate("");
              setNote("");
            },
          });
        }}
      >
        <FormField label="Date" error={add.fieldError("date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </FormField>
        <div className="flex h-10 items-center">
          <Switch label="Closed all day" checked={closed} onCheckedChange={setClosed} className="justify-start gap-2" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!closed && (
            <>
              <FormField label="Opens" error={add.fieldError("opens")}>
                <Input type="time" value={opens} onChange={(e) => setOpens(e.target.value)} className="w-32" />
              </FormField>
              <FormField label="Closes" error={add.fieldError("closes")}>
                <Input type="time" value={closes} onChange={(e) => setCloses(e.target.value)} className="w-32" />
              </FormField>
            </>
          )}
          <FormField label="Note (optional)" className="min-w-40 flex-1">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Thanksgiving" />
          </FormField>
        </div>
        <Button type="submit" variant="secondary" loading={add.pending} disabled={!date}>
          Add
        </Button>
      </form>
    </Card>
  );
}

"use client";

import { Copy, PhoneIncoming } from "lucide-react";
import { useState } from "react";
import { buyNumber, searchNumbers } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/controls";
import { Card, EmptyState } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import type { AvailableNumber, PhoneNumber } from "@/data/types";
import { prettyPhone } from "@/lib/format";

export function PhoneNumbers({ numbers, publicPhone, canBuy }: { numbers: PhoneNumber[]; publicPhone: string | null; canBuy: boolean }) {
  const active = numbers.filter((n) => n.enabled);
  const toast = useToast();
  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <Card>
          <EmptyState icon={PhoneIncoming} title="No AI number yet">
            Pick a local number below. Callers never see it if you forward your usual number to it.
          </EmptyState>
        </Card>
      ) : (
        active.map((n) => (
          <Card key={n.id} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted">Your AI number</p>
                <p className="text-xl text-fg">{prettyPhone(n.e164)}</p>
              </div>
              <Tooltip content="Copy number">
                <IconButton
                  label="Copy number"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(n.e164);
                      toast({ title: "Number copied", variant: "success" });
                    } catch {
                      toast({ title: "Couldn't copy. Select the number and copy it by hand.", variant: "error" });
                    }
                  }}
                >
                  <Copy aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
            <p className="text-sm text-muted">
              If our service is ever down, calls to this number ring{" "}
              <span className="font-semibold text-fg">{n.fallbackE164 ? prettyPhone(n.fallbackE164) : "nobody (add a fallback number)"}</span> instead, so callers
              always reach someone.
            </p>
          </Card>
        ))
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg text-fg">Forward your usual number</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
          <li>Call your phone provider, or open their app, and ask to forward calls{publicPhone ? ` from ${prettyPhone(publicPhone)}` : ""}.</li>
          <li>
            Forward to <span className="font-semibold">{active[0] ? prettyPhone(active[0].e164) : "your AI number"}</span>. Choose “all calls” for the AI to answer
            everything, or “when unanswered” to let staff pick up first.
          </li>
          <li>Call your usual number from a different phone. You should hear your greeting.</li>
        </ol>
        <p className="text-xs text-muted">Don&apos;t use the forwarded number as a transfer number. Transfers to it would loop back to the AI.</p>
      </Card>

      {canBuy ? <AddNumber /> : <p className="text-sm text-muted">Only owners can add phone numbers.</p>}
    </div>
  );
}

function AddNumber() {
  const [areaCode, setAreaCode] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [choice, setChoice] = useState<string | undefined>();
  const search = useAction();
  const buy = useAction();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg text-fg">Add a number</h2>
        <p className="text-sm text-muted">Choose a local area code. Callers only see it if you list it publicly.</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search.run(() => searchNumbers(areaCode), { onDone: (r) => { setResults(r); setChoice(r[0]?.e164); } });
        }}
      >
        <FormField label="Area code" error={search.fieldError("areaCode")}>
          <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className="w-28" placeholder="212" />
        </FormField>
        <Button type="submit" variant="secondary" loading={search.pending} disabled={areaCode.length !== 3}>
          Search
        </Button>
      </form>
      {results && results.length === 0 && <p className="text-sm text-muted">No numbers left in {areaCode}. Try a nearby area code.</p>}
      {results && results.length > 0 && (
        <>
          <RadioGroup
            legend="Available numbers"
            variant="cards"
            value={choice}
            onValueChange={setChoice}
            options={results.map((r) => ({ value: r.e164, title: prettyPhone(r.e164), description: r.locality }))}
          />
          <Button className="self-start" loading={buy.pending} disabled={!choice} onClick={() => choice && buy.run(() => buyNumber(choice), { success: "Number added", onDone: () => setResults(null) })}>
            Add this number
          </Button>
          {buy.error && <p className="text-sm text-danger">{buy.error.message}</p>}
        </>
      )}
    </Card>
  );
}

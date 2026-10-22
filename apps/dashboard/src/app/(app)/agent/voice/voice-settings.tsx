"use client";

import { Trash } from "lucide-react";
import { useState } from "react";
import { addPronunciation, deletePronunciation, updateSettings } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/controls";
import { Card } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import type { Pronunciation } from "@/data/types";

// Our own voice set. Each maps to a voice id at the speech provider in the voice gateway.
const voices = [
  { value: "warm", title: "Warm", description: "Friendly and unhurried. Good for cafés and neighbourhood spots." },
  { value: "bright", title: "Bright", description: "Upbeat and quick. Good for busy counters." },
  { value: "calm", title: "Calm", description: "Low and steady. Good for noisy lines and older callers." },
  { value: "clear", title: "Clear", description: "Crisp and neutral. Good for long menus and numbers." },
];

export function VoiceSettings({ voice, words }: { voice: string; words: Pronunciation[] }) {
  const [choice, setChoice] = useState(voice);
  const save = useAction();
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <RadioGroup legend="Voice" variant="cards" value={choice} onValueChange={setChoice} options={voices} />
        <p className="text-xs text-muted">Call your AI number after saving to hear it. Samples play here once the phone line is connected.</p>
        <Button className="self-start" disabled={choice === voice} loading={save.pending} onClick={() => save.run(() => updateSettings({ voice: choice }), { success: "Voice saved" })}>
          Save voice
        </Button>
      </Card>
      <Words words={words} />
    </div>
  );
}

function Words({ words }: { words: Pronunciation[] }) {
  const [term, setTerm] = useState("");
  const [spokenAs, setSpokenAs] = useState("");
  const add = useAction();
  const remove = useAction();
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg text-fg">Pronunciation</h2>
        <p className="text-sm text-muted">Spell words the way they should sound. The AI uses this on the next call.</p>
      </div>
      {words.length === 0 ? (
        <p className="text-sm text-muted">No words yet. Add your restaurant&apos;s name if the AI says it wrong.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {words.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm text-fg">
                <span className="font-semibold">{w.term}</span> <span className="text-muted">sounds like</span> “{w.spokenAs}”
              </span>
              <IconButton label={`Remove ${w.term}`} size="sm" disabled={remove.pending} onClick={() => remove.run(() => deletePronunciation(w.id))}>
                <Trash aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.run(() => addPronunciation(term, spokenAs), { success: `Added ${term}`, onDone: () => { setTerm(""); setSpokenAs(""); } });
        }}
      >
        <FormField label="Word" error={add.fieldError("term")}>
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Gnocchi" maxLength={80} />
        </FormField>
        <FormField label="Say it like">
          <Input value={spokenAs} onChange={(e) => setSpokenAs(e.target.value)} placeholder="NYOH-kee" maxLength={120} />
        </FormField>
        <Button type="submit" variant="secondary" loading={add.pending} disabled={!term.trim() || !spokenAs.trim()}>
          Add
        </Button>
      </form>
    </Card>
  );
}

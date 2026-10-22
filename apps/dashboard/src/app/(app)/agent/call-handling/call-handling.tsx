"use client";

import { useState } from "react";
import { updateSettings } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Banner, Card } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import type { Settings } from "@/data/types";

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

export function CallHandling({ settings, canEditPrivacy }: { settings: Settings; canEditPrivacy: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <Routing settings={settings} />
      <Privacy settings={settings} canEdit={canEditPrivacy} />
    </div>
  );
}

function Routing({ settings }: { settings: Settings }) {
  const [ringStaffFirst, setRing] = useState(settings.ringStaffFirst);
  const [ringSeconds, setRingSeconds] = useState(String(settings.ringStaffSeconds));
  const [silence, setSilence] = useState(String(settings.silenceTimeoutSeconds));
  const [maxMinutes, setMaxMinutes] = useState(String(settings.maxCallSeconds / 60));
  const [retries, setRetries] = useState(String(settings.maxClarificationRetries));
  const save = useAction();
  const patch = {
    ringStaffFirst,
    ringStaffSeconds: num(ringSeconds),
    silenceTimeoutSeconds: num(silence),
    maxCallSeconds: Math.round(num(maxMinutes) * 60),
    maxClarificationRetries: num(retries),
  };
  const dirty =
    patch.ringStaffFirst !== settings.ringStaffFirst ||
    patch.ringStaffSeconds !== settings.ringStaffSeconds ||
    patch.silenceTimeoutSeconds !== settings.silenceTimeoutSeconds ||
    patch.maxCallSeconds !== settings.maxCallSeconds ||
    patch.maxClarificationRetries !== settings.maxClarificationRetries;
  const incomplete = [patch.ringStaffSeconds, patch.silenceTimeoutSeconds, patch.maxCallSeconds, patch.maxClarificationRetries].some(Number.isNaN);

  return (
    <Card className="flex flex-col gap-5">
      <h2 className="text-lg text-fg">Answering</h2>
      <Switch
        label="Ring staff first"
        description="Your staff line rings first; the AI answers if nobody picks up in time. Use a different line from the one you forward to the AI."
        checked={ringStaffFirst}
        onCheckedChange={setRing}
      />
      {ringStaffFirst && (
        <FormField label="Seconds before the AI answers" error={save.fieldError("ringStaffSeconds")}>
          <Input type="number" min={5} max={60} value={ringSeconds} onChange={(e) => setRingSeconds(e.target.value)} className="w-28" />
        </FormField>
      )}
      <div className="grid gap-5 sm:grid-cols-3">
        <FormField label="Silence before checking in (seconds)" error={save.fieldError("silenceTimeoutSeconds")}>
          <Input type="number" min={5} max={60} value={silence} onChange={(e) => setSilence(e.target.value)} />
        </FormField>
        <FormField label="Longest call (minutes)" error={save.fieldError("maxCallSeconds")}>
          <Input type="number" min={2} max={60} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} />
        </FormField>
        <FormField label="Tries before passing to staff" hint="When the AI can't understand something." error={save.fieldError("maxClarificationRetries")}>
          <Input type="number" min={1} max={5} value={retries} onChange={(e) => setRetries(e.target.value)} />
        </FormField>
      </div>
      {incomplete && <p className="text-sm text-warning">Fill in every number to save.</p>}
      <Button className="self-start" disabled={!dirty || incomplete} loading={save.pending} onClick={() => save.run(() => updateSettings(patch), { success: "Saved" })}>
        Save changes
      </Button>
    </Card>
  );
}

function Privacy({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const [transcripts, setTranscripts] = useState(settings.transcriptEnabled);
  const [recordings, setRecordings] = useState(settings.recordingEnabled);
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const save = useAction();
  const dirty = transcripts !== settings.transcriptEnabled || recordings !== settings.recordingEnabled || num(retention) !== settings.retentionDays;
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg text-fg">What we keep after a call</h2>
        <p className="text-sm text-muted">
          A short summary and the steps the AI took are always kept. Transcripts and recordings are off unless you turn them on.
        </p>
      </div>
      {!canEdit && <p className="text-sm text-muted">Only owners can change these.</p>}
      <Switch label="Keep transcripts" description="Word-for-word text of each call. Managers and owners can read them." checked={transcripts} onCheckedChange={setTranscripts} disabled={!canEdit} />
      <Switch label="Record calls" description="Audio of each call. Off by default." checked={recordings} onCheckedChange={setRecordings} disabled={!canEdit} />
      {(transcripts || recordings) && (
        <Banner tone="warning" title="Tell callers first">
          Many places require callers to be told a call is recorded or transcribed. Add it to your greeting and check the rules where you are.
        </Banner>
      )}
      <FormField label="Delete call details after (days)" hint="Summaries, transcripts and recordings older than this are deleted every night." error={save.fieldError("retentionDays")}>
        <Input type="number" min={1} max={730} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-32" disabled={!canEdit} />
      </FormField>
      {canEdit && (
        <Button
          className="self-start"
          disabled={!dirty || Number.isNaN(num(retention))}
          loading={save.pending}
          onClick={() => save.run(() => updateSettings({ transcriptEnabled: transcripts, recordingEnabled: recordings, retentionDays: num(retention) }), { success: "Saved" })}
        >
          Save changes
        </Button>
      )}
    </Card>
  );
}

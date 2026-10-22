"use client";

import { useState } from "react";
import { updateSettings } from "@/app/actions/agent";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { RadioGroup, Select } from "@/components/ui/controls";
import { Banner, Card } from "@/components/ui/display";
import { FormField, Textarea } from "@/components/ui/field";
import type { AfterHoursMode, Settings } from "@/data/types";

// Spec §15.4: the greeting must say the caller is talking to an AI.
const DISCLOSES_AI = /\b(ai|a\.i\.|virtual|automated|digital assistant)\b/i;

export function GreetingSettings({ settings, restaurant }: { settings: Settings; restaurant: string }) {
  const [greeting, setGreeting] = useState(settings.greeting);
  const [extra, setExtra] = useState(settings.extraLanguages[0] ?? "none");
  const [afterHours, setAfterHours] = useState<AfterHoursMode>(settings.afterHoursMode);
  const save = useAction();
  const extraLanguages = extra === "none" ? [] : [extra];
  const dirty = greeting !== settings.greeting || extraLanguages.join() !== settings.extraLanguages.join() || afterHours !== settings.afterHoursMode;
  const discloses = DISCLOSES_AI.test(greeting);

  return (
    <Card className="flex flex-col gap-6">
      <FormField
        label="Greeting"
        hint="Say the restaurant's name and that you're an AI. Short greetings work best: long ones make callers ask for a person straight away."
        error={save.fieldError("greeting")}
      >
        <Textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={400} />
      </FormField>
      {!discloses && (
        <Banner tone="warning" title="Say it's an AI">
          Callers should know they&apos;re talking to an AI. Try: “Thanks for calling {restaurant}. I&apos;m the AI receptionist. How can I help?”
        </Banner>
      )}

      <FormField
        label="Extra language"
        hint="The greeting is always in English; the AI switches if the caller speaks another language you've turned on. One extra language at most: more makes it less accurate."
      >
        <Select
          value={extra}
          onValueChange={setExtra}
          options={[
            { value: "none", label: "English only" },
            { value: "es", label: "English and Spanish" },
            { value: "zh", label: "English and Mandarin" },
          ]}
        />
      </FormField>

      <RadioGroup
        legend="When you're closed"
        value={afterHours}
        onValueChange={(v) => setAfterHours(v as AfterHoursMode)}
        options={[
          { value: "INFO_ONLY", title: "Answer questions only", description: "The AI says you're closed and when you open next." },
          { value: "TAKE_CALLBACK", title: "Answer questions and take callback requests", description: "Requests show under Callbacks in the morning." },
          { value: "TRANSFER_FALLBACK", title: "Answer questions, then offer the after-hours line", description: "Uses a transfer number set to ring any time." },
        ]}
      />

      <Button
        className="self-start"
        disabled={!dirty}
        loading={save.pending}
        onClick={() => save.run(() => updateSettings({ greeting, extraLanguages, afterHoursMode: afterHours }), { success: "Saved. New calls use it straight away." })}
      >
        Save changes
      </Button>
    </Card>
  );
}

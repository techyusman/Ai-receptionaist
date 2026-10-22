"use client";

import { MessageCircleQuestionMark, Pencil, Plus, Search, Sparkles, Trash } from "lucide-react";
import { useState } from "react";
import { addFaqTemplates, deleteFaq, saveFaq } from "@/app/actions/content";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Banner, Card, EmptyState } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/field";
import { ConfirmDialog, Dialog, DialogClose } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";
import type { Faq } from "@/data/types";

export type FaqRow = Faq & { startsOn: string | null; endsOn: string | null; startsLabel: string | null; endsLabel: string | null; expired: boolean };

type Draft = { id?: string; question: string; answer: string; aliases: string; active: boolean; startsOn: string; endsOn: string };
const blank: Draft = { question: "", answer: "", aliases: "", active: true, startsOn: "", endsOn: "" };

function Chip({ tone, children }: { tone: "neutral" | "warning" | "accent"; children: React.ReactNode }) {
  const cls = tone === "warning" ? "bg-warning-subtle text-warning" : tone === "accent" ? "bg-accent-subtle text-accent" : "bg-surface-muted text-muted";
  return <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function KnowledgeList({ rows, liveCount }: { rows: FaqRow[]; liveCount: number }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const templates = useAction();
  const toast = useToast();
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.question} ${r.answer} ${r.aliases.join(" ")}`.toLowerCase().includes(q)) : rows;
  const drafts = rows.filter((r) => !r.reviewed).length;

  return (
    <div className="flex flex-col gap-4">
      {liveCount < 10 && (
        <Banner tone="info" title={`${liveCount} of 10 answers ready`}>
          Restaurants that start with at least ten answers get far fewer “let me pass you to someone” calls. Parking, allergies, Wi-Fi and payment are good first ones.
        </Banner>
      )}
      {drafts > 0 && (
        <Banner tone="warning" title={`${drafts} draft ${drafts === 1 ? "answer needs" : "answers need"} your words`}>
          Drafts stay off until you edit them and replace the parts in [brackets].
        </Banner>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <FormField label="Search answers" className="md:w-80">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. parking" />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={templates.pending}
            onClick={() => templates.run(() => addFaqTemplates(), { onDone: (n) => toast({ title: n ? `Added ${n} starter questions as drafts` : "You already have all the starter questions", variant: n ? "success" : "info" }) })}
          >
            <Sparkles aria-hidden /> Add starter questions
          </Button>
          <Button onClick={() => setEditing({ ...blank })}>
            <Plus aria-hidden /> Add an answer
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={MessageCircleQuestionMark} title="No answers yet">
            Add the questions your staff answer every day. Aim for ten before you go live.
          </EmptyState>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title="Nothing matches">
            Try another word, or add this as a new answer.
          </EmptyState>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li key={r.id}>
              <Card className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold break-words text-fg">{r.question}</h2>
                    {!r.reviewed && <Chip tone="warning">Draft</Chip>}
                    {r.reviewed && !r.active && <Chip tone="neutral">Off</Chip>}
                    {r.startsLabel && <Chip tone="accent">{r.startsLabel}</Chip>}
                    {r.endsLabel && <Chip tone={r.expired ? "warning" : "neutral"}>{r.endsLabel}</Chip>}
                  </div>
                  <p className="line-clamp-2 text-sm break-words text-muted">{r.answer}</p>
                  {r.aliases.length > 0 && <p className="text-xs text-muted">Also matches: {r.aliases.join(" · ")}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton
                    label={`Edit “${r.question}”`}
                    size="sm"
                    onClick={() =>
                      setEditing({ id: r.id, question: r.question, answer: r.answer, aliases: r.aliases.join("\n"), active: r.reviewed ? r.active : true, startsOn: r.startsOn ?? "", endsOn: r.endsOn ?? "" })
                    }
                  >
                    <Pencil aria-hidden />
                  </IconButton>
                  <ConfirmDialog
                    trigger={
                      <IconButton label={`Delete “${r.question}”`} size="sm">
                        <Trash aria-hidden />
                      </IconButton>
                    }
                    title="Delete this answer?"
                    description={`The AI stops answering “${r.question}” and offers to pass callers to staff instead.`}
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      const res = await deleteFaq(r.id);
                      toast(res.ok ? { title: "Answer deleted", variant: "success" } : { title: res.message, variant: "error" });
                    }}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <FaqDialog draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FaqDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const save = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const hasPlaceholder = /\[[^\]]+\]/.test(d.answer);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      locked={save.pending}
      title={draft.id ? "Edit answer" : "Add an answer"}
      description="Write it the way you'd say it on the phone. Short and specific works best."
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={save.pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            loading={save.pending}
            disabled={hasPlaceholder}
            onClick={() =>
              save.run(
                () =>
                  saveFaq({
                    id: d.id,
                    question: d.question,
                    answer: d.answer,
                    aliases: d.aliases.split("\n").map((a) => a.trim()).filter(Boolean),
                    active: d.active,
                    startsOn: d.startsOn || null,
                    endsOn: d.endsOn || null,
                  }),
                { success: "Saved. The AI uses it on the next call.", onDone: onClose },
              )
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Question" error={save.fieldError("question")}>
          <Input value={d.question} onChange={(e) => set("question", e.target.value)} maxLength={300} placeholder="Is there parking?" />
        </FormField>
        <FormField label="Other ways callers ask" hint="One per line. Optional: the AI matches meaning, not exact words." error={save.fieldError("aliases")}>
          <Textarea value={d.aliases} onChange={(e) => set("aliases", e.target.value)} className="min-h-16" placeholder="Where do I park?" />
        </FormField>
        <FormField label="Answer" error={save.fieldError("answer") ?? (hasPlaceholder ? "Replace the parts in [brackets] with your details." : undefined)}>
          <Textarea value={d.answer} onChange={(e) => set("answer", e.target.value)} maxLength={2000} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Use from" hint="Optional. Leave empty to start now.">
            <Input type="date" value={d.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
          </FormField>
          <FormField label="Use until" hint="Optional. Good for specials and holiday notes." error={save.fieldError("validUntil")}>
            <Input type="date" value={d.endsOn} onChange={(e) => set("endsOn", e.target.value)} />
          </FormField>
        </div>
        <Switch label="The AI can use this answer" checked={d.active} onCheckedChange={(v) => set("active", v)} />
      </div>
    </Dialog>
  );
}

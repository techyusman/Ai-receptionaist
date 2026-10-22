import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, Stepper } from "@/components/ui/display";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";

export const metadata: Metadata = { title: "Set up" };

// S04–S09 as a guided checklist. Each step opens the screen that does it, so there's one place to
// change each setting. Business verification and card-on-file steps (S07, S08) don't exist: no
// payments are taken (spec §3).
export default function SetupPage() {
  return (
    <>
      <PageHeader
        title="Set up your AI receptionist"
        description="Seven steps. Most restaurants finish in an afternoon. No payment details or business verification needed: the AI never takes payments."
      />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const tasks = await api.getSetupTasks();
  const current = tasks.findIndex((t) => !t.done);
  const next = current >= 0 ? tasks[current] : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <Card>
        <Stepper steps={tasks.map((t, i) => ({ title: t.title, state: t.done ? "done" : i === current ? "current" : "upcoming" }))} />
      </Card>
      <div className="flex flex-col gap-4">
        {next ? (
          <Card className="flex flex-col gap-3 border-accent">
            <p className="text-xs font-semibold text-accent">Next step</p>
            <h2 className="text-xl text-fg">{next.title}</h2>
            <p className="text-sm text-fg">{next.detail}</p>
            <Button asChild className="self-start">
              <Link href={next.href}>
                Start <ArrowRight aria-hidden />
              </Link>
            </Button>
          </Card>
        ) : (
          <Card className="flex flex-col gap-2 border-success">
            <h2 className="text-xl text-fg">You&apos;re set up</h2>
            <p className="text-sm text-fg">Forward your phone number to the AI number and it starts answering. Keep an eye on Calls for the first few days.</p>
          </Card>
        )}
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg text-fg">All steps</h2>
          <ul className="flex flex-col divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="flex items-center justify-between gap-3 py-3 hover:underline">
                  <span className="text-sm">
                    <span className={t.done ? "font-semibold text-muted line-through" : "font-semibold text-fg"}>{t.title}</span>
                    {t.done && <span className="sr-only"> (done)</span>}
                    <span className="block text-xs text-muted">{t.detail}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

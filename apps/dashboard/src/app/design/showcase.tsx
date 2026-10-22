"use client";

import { Ellipsis, Inbox, Phone, Plus } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, RadioGroup, Select, Switch } from "@/components/ui/controls";
import {
  Banner,
  Card,
  EmptyState,
  MobileDetail,
  Skeleton,
  StatTile,
  StatusPill,
  Stepper,
  Table,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/display";
import { FormField, Input, PhoneInput, Textarea } from "@/components/ui/field";
import { SyncIndicator, TicketCard, useNow, type Ticket } from "@/components/ui/live";
import { ConfirmDialog, Dialog, DialogClose, Drawer, DropdownMenu, Tooltip, TooltipProvider } from "@/components/ui/overlays";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Toaster, useToast } from "@/components/ui/toast";
import { statusVocabulary } from "@/lib/status";

const roles = [
  "bg", "surface", "surface-muted", "border", "border-input", "text", "text-muted", "accent", "accent-hover",
  "accent-subtle", "on-accent", "focus", "danger", "danger-subtle", "on-danger", "success", "success-subtle",
  "warning", "warning-subtle",
] as const;

const typeScale = [
  ["display", "text-display", "Live orders"],
  ["xl", "text-xl", "Calls this week"],
  ["lg", "text-lg", "Order for Sam"],
  ["base", "text-base", "2 × Cold brew, large, oat milk"],
  ["sm", "text-sm", "The AI answers after 20 seconds if no one picks up."],
  ["xs", "text-xs", "Updated 4 min ago"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <span className="w-32 shrink-0 text-xs font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ToastButtons() {
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" onClick={() => toast({ title: "Greeting saved", variant: "success" })}>
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: "Couldn't save hours", description: "Tuesday's shifts overlap.", variant: "error" })
        }
      >
        Error toast
      </Button>
    </>
  );
}

function sampleTickets(now: number | null): Ticket[] {
  const at = (mins: number) => new Date((now ?? 0) - mins * 60_000).toISOString();
  return [
    {
      id: "t1", customerName: "Sam Rivera", phoneLast4: "4567", pickup: "ASAP", createdAt: at(1), total: "$18.40",
      lines: [
        { qty: 2, name: "Cold brew", modifiers: ["Large", "Oat milk"] },
        { qty: 1, name: "Breakfast sandwich", modifiers: ["Sourdough", "No egg"], note: "Cut in half please" },
      ],
    },
    {
      id: "t2", customerName: "Priya N.", phoneLast4: "0193", pickup: "12:30 pm", createdAt: at(7), total: "$9.25",
      lines: [{ qty: 1, name: "Matcha latte", modifiers: ["Medium", "Extra shot"] }],
    },
  ];
}

export function DesignShowcase() {
  const now = useNow();
  const [t1, t2] = sampleTickets(now);
  return (
    <Toaster>
      <TooltipProvider>
        <main className="mx-auto flex max-w-(--ds-content-max) flex-col gap-12 px-4 py-8 md:px-6">
          <header className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl text-fg">Design system</h1>
              <p className="text-sm text-muted">
                Every primitive in every state. Values come from replica/design/tokens.json.
              </p>
            </div>
            <ThemeToggle />
          </header>

          <Section title="Colour roles">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {roles.map((r) => (
                <div key={r} className="flex flex-col gap-1">
                  <div className="h-12 rounded-md border border-border" style={{ background: `var(--ds-${r})` }} />
                  <span className="text-xs text-muted">{r}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Type scale">
            <Card className="flex flex-col gap-3">
              {typeScale.map(([name, cls, sample]) => (
                <div key={name} className="flex items-baseline gap-4">
                  <span className="w-16 shrink-0 text-xs text-muted">{name}</span>
                  <span className={`${cls} text-fg`}>{sample}</span>
                </div>
              ))}
            </Card>
          </Section>

          <Section title="Buttons">
            <Card className="flex flex-col gap-4">
              <Row label="Variants">
                <Button>Save changes</Button>
                <Button variant="secondary">Cancel</Button>
                <Button variant="ghost">Skip for now</Button>
                <Button variant="danger">Disconnect Square</Button>
              </Row>
              <Row label="Sizes">
                <Button size="sm">Small</Button>
                <Button>Medium</Button>
                <Button size="lg">Accept</Button>
              </Row>
              <Row label="States">
                <Button disabled>Disabled</Button>
                <Button loading>Saving</Button>
                <Button className="outline-2 outline-offset-2 outline-focus">Keyboard focus</Button>
                <Button variant="secondary">
                  <Plus aria-hidden /> Add entry
                </Button>
              </Row>
              <Row label="Icon buttons">
                <Tooltip content="More actions">
                  <IconButton label="More actions">
                    <Ellipsis aria-hidden />
                  </IconButton>
                </Tooltip>
                <Tooltip content="Call the AI number">
                  <IconButton label="Call the AI number" variant="secondary">
                    <Phone aria-hidden />
                  </IconButton>
                </Tooltip>
              </Row>
            </Card>
          </Section>

          <Section title="Form fields">
            <Card className="grid gap-6 md:grid-cols-2">
              <FormField label="Restaurant name" hint="This is what the AI calls you on the phone." required>
                <Input defaultValue="Third Space" />
              </FormField>
              <FormField label="Transfer number" error="That's your AI number. Transfers to it would loop back.">
                <Input defaultValue="+1 555 000 0001" />
              </FormField>
              <FormField label="Backup number" hint="Gets a text if a transfer isn't answered.">
                <PhoneInput defaultValue="5550123456" />
              </FormField>
              <FormField label="Website">
                <Input disabled placeholder="Disabled" />
              </FormField>
              <FormField label="Time zone">
                <Select
                  defaultValue="America/New_York"
                  options={[
                    { value: "America/New_York", label: "Eastern (New York)" },
                    { value: "America/Chicago", label: "Central (Chicago)" },
                    { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
                  ]}
                />
              </FormField>
              <FormField label="Greeting" hint="Say that you're an AI receptionist. Keep it short.">
                <Textarea
                  maxLength={400}
                  defaultValue="Thanks for calling Third Space. I'm the AI receptionist. How can I help?"
                />
              </FormField>
            </Card>
          </Section>

          <Section title="Choices">
            <Card className="grid gap-8 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <Switch label="Take pickup orders" description="The AI still answers questions when this is off." defaultChecked />
                <Switch label="Ring staff first" description="The AI answers after 20 seconds." />
                <Switch label="Record calls" description="Owner only. Check local consent rules first." disabled />
                <div className="flex flex-col gap-2">
                  <Checkbox label="Include test calls" />
                  <Checkbox label="All locations" checked="indeterminate" />
                  <Checkbox label="Main Street" defaultChecked />
                </div>
              </div>
              <div className="flex flex-col gap-6">
                <RadioGroup
                  legend="Where phone orders go"
                  variant="cards"
                  defaultValue="ticket"
                  options={[
                    { value: "ticket", title: "Live orders screen", description: "Staff accept each order on a tablet or computer." },
                    { value: "square", title: "Straight into Square", disabledReason: "Needs the Square test signed off first." },
                  ]}
                />
                <RadioGroup
                  legend="After hours"
                  defaultValue="info"
                  options={[
                    { value: "info", title: "Answer questions only" },
                    { value: "callback", title: "Take a callback request" },
                  ]}
                />
              </div>
            </Card>
          </Section>

          <Section title="Tabs">
            <Card className="flex flex-col gap-6">
              <Tabs defaultValue="greeting">
                <TabsList>
                  <TabsTrigger value="greeting">Greeting</TabsTrigger>
                  <TabsTrigger value="calls">Call handling</TabsTrigger>
                  <TabsTrigger value="orders">Orders</TabsTrigger>
                  <TabsTrigger value="voice" disabled>
                    Voice
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="greeting" className="text-sm text-muted">Greeting settings go here.</TabsContent>
                <TabsContent value="calls" className="text-sm text-muted">Call handling settings go here.</TabsContent>
                <TabsContent value="orders" className="text-sm text-muted">Ordering settings go here.</TabsContent>
              </Tabs>
              <Tabs defaultValue="open">
                <TabsList variant="pill" className="self-start">
                  <TabsTrigger value="open">Open</TabsTrigger>
                  <TabsTrigger value="accepted">Accepted</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </Card>
          </Section>

          <Section title="Status pills">
            <Card className="flex flex-col gap-4">
              <Row label="Orders">
                {(Object.keys(statusVocabulary.order) as (keyof typeof statusVocabulary.order)[]).map((v) => (
                  <StatusPill key={v} domain="order" value={v} />
                ))}
              </Row>
              <Row label="Calls">
                {(Object.keys(statusVocabulary.call) as (keyof typeof statusVocabulary.call)[]).map((v) => (
                  <StatusPill key={v} domain="call" value={v} />
                ))}
              </Row>
              <Row label="Menu sync">
                {(Object.keys(statusVocabulary.sync) as (keyof typeof statusVocabulary.sync)[]).map((v) => (
                  <StatusPill key={v} domain="sync" value={v} size="sm" />
                ))}
              </Row>
              <Row label="Square">
                <StatusPill domain="square" value="CONNECTED" size="sm" />
                <StatusPill domain="square" value="NEEDS_REAUTH" size="sm" />
              </Row>
            </Card>
          </Section>

          <Section title="Table, empty and loading">
            <Table>
              <caption className="sr-only">Recent phone orders</caption>
              <THead>
                <tr>
                  <Th>Customer</Th>
                  <Th desktopOnly>Items</Th>
                  <Th desktopOnly>Total</Th>
                  <Th>Status</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {[
                  ["Sam Rivera", "3 items", "$18.40", "SUBMITTED_TO_POS"],
                  ["Priya N.", "1 item", "$9.25", "RECEIVED_BY_RESTAURANT"],
                  ["Alex K.", "2 items", "$14.00", "SUBMISSION_UNKNOWN"],
                ].map(([name, items, total, status]) => (
                  <Tr key={name}>
                    <Td>
                      <a href="#" className="font-semibold text-fg hover:underline">
                        {name}
                      </a>
                      <MobileDetail>
                        {items} · {total}
                      </MobileDetail>
                    </Td>
                    <Td desktopOnly className="text-muted">
                      {items}
                    </Td>
                    <Td desktopOnly>{total}</Td>
                    <Td>
                      <StatusPill domain="order" value={status as keyof typeof statusVocabulary.order} size="sm" />
                    </Td>
                    <Td>
                      <DropdownMenu
                        trigger={
                          <IconButton label={`Actions for ${name}`} size="sm">
                            <Ellipsis aria-hidden />
                          </IconButton>
                        }
                        items={[{ label: "View order" }, { label: "Print ticket" }, "separator", { label: "Cancel order", destructive: true }]}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <EmptyState icon={Inbox} title="All caught up" action={<Button variant="secondary">Call your AI number</Button>}>
                  New phone orders will ring here.
                </EmptyState>
              </Card>
              <Card className="flex flex-col gap-3" aria-busy="true">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </Card>
            </div>
          </Section>

          <Section title="Overlays">
            <Card className="flex flex-wrap gap-2">
              <Dialog
                trigger={<Button variant="secondary">Open dialog</Button>}
                title="Add a question"
                description="The AI uses this answer word for word."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button>Save</Button>
                  </>
                }
              >
                <FormField label="Question">
                  <Input placeholder="Is there parking?" />
                </FormField>
              </Dialog>
              <ConfirmDialog
                trigger={<Button variant="danger">Confirm dialog</Button>}
                title="Disconnect Square from Main Street?"
                description="Phone orders stop until you reconnect. Menu data stays for 30 days."
                confirmLabel="Disconnect"
                onConfirm={() => new Promise((r) => setTimeout(r, 800))}
              />
              <Drawer trigger={<Button variant="secondary">Open drawer</Button>} title="Order for Sam Rivera">
                <div className="flex flex-col gap-3 text-sm text-fg">
                  <StatusPill domain="order" value="SUBMITTED_TO_POS" />
                  <p>2 × Cold brew (Large, Oat milk)</p>
                  <p>1 × Breakfast sandwich (Sourdough, No egg)</p>
                </div>
              </Drawer>
              <ToastButtons />
            </Card>
          </Section>

          <Section title="Banners">
            <div className="flex flex-col gap-3">
              <Banner tone="info" title="Square ordering isn't switched on yet">
                Orders go to Live orders until the Square test is signed off.
              </Banner>
              <Banner tone="warning" title="Menu out of date" action={<Button size="sm" variant="secondary">Sync now</Button>}>
                The menu hasn&apos;t synced for 2 hours, so the AI won&apos;t take orders until it does.
              </Banner>
              <Banner tone="danger" title="Square disconnected" critical>
                Phone orders are paused until you reconnect.
              </Banner>
              <Banner tone="success" title="You're live" onDismiss={() => {}}>
                Calls to your number are answered by the AI.
              </Banner>
            </div>
          </Section>

          <Section title="Status, metrics and setup">
            <div className="grid gap-4 md:grid-cols-3">
              <StatTile label="Calls answered" value="214" delta={{ text: "12% vs last week", direction: "up", good: true }} />
              <StatTile label="Transferred to staff" value="9%" delta={{ text: "3 pts vs last week", direction: "up", good: false }} />
              <StatTile label="Phone orders" loading />
            </div>
            <Card className="flex flex-col gap-3">
              <SyncIndicator state="fresh" updatedAt={now ? new Date(now - 4 * 60_000).toISOString() : undefined} onResync={() => {}} />
              <SyncIndicator state="running" updatedAt={now ? new Date(now - 4 * 60_000).toISOString() : undefined} onResync={() => {}} />
              <SyncIndicator state="failed" error="Square returned 401 (token expired)" onResync={() => {}} />
            </Card>
            <Card>
              <Stepper
                steps={[
                  { title: "Your restaurant", state: "done" },
                  { title: "Connect Square", state: "done" },
                  { title: "Get an AI phone number", state: "current", note: "Pick a local area code." },
                  { title: "Questions and hours", state: "upcoming" },
                  { title: "Turn on phone orders", state: "blocked", note: "Needs the Square test or written fallback approval." },
                ]}
              />
            </Card>
          </Section>

          <Section title="Live order tickets (S41)">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--ds-ticket-min),1fr))] gap-4">
              <TicketCard ticket={t1} state="new" />
              <TicketCard ticket={t2} state="check-needed" />
              <TicketCard ticket={{ ...t1, id: "t3", customerName: "Jordan Lee" }} state="accepted" />
              <TicketCard ticket={{ ...t2, id: "t4", customerName: "Test caller" }} test />
            </div>
          </Section>
        </main>
      </TooltipProvider>
    </Toaster>
  );
}

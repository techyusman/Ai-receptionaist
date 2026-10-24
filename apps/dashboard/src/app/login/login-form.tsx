"use client";

import { useEffect, useState, useTransition } from "react";
import { requestCode, verifyCode } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";

const RESEND_SECONDS = 30;

export function LoginForm({ sampleData, next }: { sampleData: boolean; next?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await requestCode({ email });
      if (!r.ok) return setError({ field: r.field, message: r.message });
      setEmail(r.data.email);
      setStep("code");
      setCooldown(RESEND_SECONDS);
    });

  const verify = () =>
    start(async () => {
      setError(null);
      const r = await verifyCode({ email, code, next });
      if (r && !r.ok) setError({ field: r.field, message: r.message });
    });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        {step === "email" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <FormField label="Work email" hint="We'll email you a 6-digit code. No password needed." error={error?.field === "email" ? error.message : undefined}>
              <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            </FormField>
            <Button type="submit" size="lg" loading={pending}>
              Email me a code
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
          >
            <p className="text-sm text-fg">
              A code is on its way to <strong className="font-semibold">{email}</strong>. It works for 10 minutes.
            </p>
            <FormField label="6-digit code" error={error ? error.message : undefined}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                required
                className="tracking-widest"
              />
            </FormField>
            <Button type="submit" size="lg" loading={pending}>
              Sign in
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
                Use a different email
              </button>
              <button type="button" className="text-accent underline-offset-2 hover:underline disabled:text-muted disabled:no-underline" disabled={cooldown > 0 || pending} onClick={send}>
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
              </button>
            </div>
          </form>
        )}
      </Card>
      {sampleData && (
        <aside className="rounded-md border border-dashed border-border p-4 text-xs text-muted">
          <p className="font-semibold text-fg">Local development</p>
          <p>
            No email is sent. Use code <span className="font-mono text-fg">246810</span> with maya@thirdspace.test (owner),
            jordan@thirdspace.test (manager) or sam@thirdspace.test (staff). Any other address signs up a new restaurant.
          </p>
        </aside>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { createRestaurant } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { controlClass, FormField, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

const US_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function WelcomeForm() {
  const [d, setD] = useState({ name: "", locationName: "Main location", timezone: "America/New_York", line1: "", city: "", region: "", postalCode: "" });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));
  const err = (f: string) => (error?.field === f ? error.message : undefined);

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createRestaurant({
        name: d.name,
        location: { name: d.locationName, timezone: d.timezone, address: { line1: d.line1, city: d.city, region: d.region, postalCode: d.postalCode, country: "US" } },
      });
      if (r && !r.ok) setError({ field: r.field, message: r.message });
    });

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormField label="Restaurant name" error={err("name")} required>
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoFocus required />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="First location" hint="You can add more later.">
            <Input value={d.locationName} onChange={(e) => set("locationName", e.target.value)} maxLength={120} required />
          </FormField>
          <FormField label="Time zone" hint="Hours and order times use this zone." error={err("timezone")}>
            <select value={d.timezone} onChange={(e) => set("timezone", e.target.value)} className={cn(controlClass, "h-10")}>
              {US_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Street address" error={err("line1")} required>
          <Input value={d.line1} onChange={(e) => set("line1", e.target.value)} autoComplete="address-line1" required />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="City" error={err("city")} required>
            <Input value={d.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" required />
          </FormField>
          <FormField label="State" error={err("region")} required>
            <Input value={d.region} onChange={(e) => set("region", e.target.value)} autoComplete="address-level1" maxLength={40} required />
          </FormField>
          <FormField label="ZIP code" error={err("postalCode")} required>
            <Input value={d.postalCode} onChange={(e) => set("postalCode", e.target.value)} autoComplete="postal-code" inputMode="numeric" maxLength={12} required />
          </FormField>
        </div>
        {error && !error.field && <p className="text-sm text-danger">{error.message}</p>}
        <Button type="submit" size="lg" loading={pending}>
          Create restaurant
        </Button>
      </form>
    </Card>
  );
}

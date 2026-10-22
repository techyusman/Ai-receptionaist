"use client";

import { CircleAlert } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { cn, focusRing } from "@/lib/cn";

type FieldContext = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const Ctx = createContext<FieldContext | null>(null);

/** Wires label, hint and error to the control inside it (id, aria-describedby, aria-invalid). */
export function FormField({
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <Ctx.Provider value={{ id, describedBy: note ? noteId : undefined, invalid: !!error, required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-sm font-semibold text-fg">
          {label}
          {required && (
            <span className="text-danger" aria-hidden>
              {" "}*
            </span>
          )}
        </label>
        {children}
        {note && (
          <p id={noteId} className={cn("flex items-center gap-1 text-xs", error ? "text-danger" : "text-muted")}>
            {error && <CircleAlert aria-hidden className="size-3.5 shrink-0" />}
            {note}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useFieldProps() {
  const f = useContext(Ctx);
  return f
    ? { id: f.id, "aria-describedby": f.describedBy, "aria-invalid": f.invalid || undefined, required: f.required }
    : {};
}

export const controlClass = cn(
  "w-full rounded-md border border-input bg-surface px-3 text-base text-fg placeholder:text-muted",
  "transition-colors duration-(--ds-motion-fast) hover:border-fg",
  "aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-muted disabled:hover:border-input",
  focusRing,
);

// :read-only matches every non-editable element (buttons too), so only text inputs get it.
const readOnlyClass = "read-only:bg-surface-muted";

/** Date and time fields focus an inner segment, so :focus-visible never matches the field itself. */
export const segmentedFocus = "focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-focus";
const segmented = new Set(["date", "time", "datetime-local", "month", "week"]);

export function Input({
  className,
  inputSize = "md",
  ...props
}: React.ComponentProps<"input"> & { inputSize?: "md" | "lg" }) {
  return (
    <input
      {...useFieldProps()}
      className={cn(controlClass, readOnlyClass, inputSize === "lg" ? "h-12" : "h-10", segmented.has(props.type ?? "") && segmentedFocus, className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  maxLength,
  defaultValue,
  value,
  onChange,
  ...props
}: React.ComponentProps<"textarea">) {
  // Controlled fields count their value; uncontrolled ones track typing.
  const [typedLength, setLength] = useState(String(defaultValue ?? "").length);
  const length = value !== undefined ? String(value).length : typedLength;
  const near = maxLength !== undefined && maxLength - length <= 20;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        {...useFieldProps()}
        maxLength={maxLength}
        defaultValue={defaultValue}
        value={value}
        onChange={(e) => {
          setLength(e.target.value.length);
          onChange?.(e);
        }}
        className={cn(controlClass, readOnlyClass, "min-h-24 py-2", className)}
        {...props}
      />
      {maxLength !== undefined && (
        <span
          className={cn("self-end text-xs", near ? "text-warning" : "text-muted")}
          aria-live={near ? "polite" : "off"}
        >
          {length} / {maxLength}
        </span>
      )}
    </div>
  );
}

/** North American numbers for now; replica-build swaps in libphonenumber-js for real parsing. */
export function toE164(raw: string, country = "1"): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+${country}${digits}`;
  if (digits.length === 11 && digits.startsWith(country)) return `+${digits}`;
  return null;
}

function pretty(e164: string) {
  const d = e164.slice(2);
  return `+1 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export function PhoneInput({
  defaultValue = "",
  onValueChange,
  ...props
}: Omit<React.ComponentProps<"input">, "defaultValue"> & {
  defaultValue?: string;
  onValueChange?: (e164: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const e164 = toE164(value);
  return (
    <div className="flex flex-col gap-1">
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onValueChange?.(toE164(e.target.value));
        }}
        {...props}
      />
      {e164 && <span className="text-xs text-muted">Saved as {pretty(e164)}</span>}
    </div>
  );
}

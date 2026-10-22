import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the token names that aren't t-shirt sizes, so `text-display`
// is read as a font size (not a colour) and `shadow-card` / `rounded-pill` merge correctly.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display"],
      radius: ["pill"],
      shadow: ["card", "pop"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Keyboard focus ring shared by every interactive primitive.
 *  No `outline-none` here: in Tailwind v4 it sets --tw-outline-style to none, which the
 *  focus-visible outline then inherits, so the ring never shows. Browsers already skip the
 *  outline for mouse focus, so we only need to style :focus-visible. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus";

import "server-only";
import { OrderRuleError } from "@receptionist/domain";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { Forbidden } from "./auth";
import { InputError, UnavailableError } from "./api";

import type { ActionResult } from "@/data/types";

export type { ActionResult };

/**
 * Runs a mutation for a Server Action: refreshes the page on success and turns expected failures
 * (bad input, no permission, an order rule) into a message for the form. Next's own redirect and
 * not-found signals pass through untouched. `refresh: false` for actions whose screen keeps its own
 * state (the test chat), so a message doesn't re-render the whole page.
 */
export async function run<T>(fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (opts.refresh !== false) refresh();
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      return { ok: false, message: issue?.message ?? "Check the form and try again.", field: issue?.path[0]?.toString() };
    }
    if (e instanceof InputError) return { ok: false, message: e.message, field: e.field };
    if (e instanceof UnavailableError) return { ok: false, message: e.message };
    if (e instanceof Forbidden) return { ok: false, message: "Your role can't do that. Ask an owner." };
    if (e instanceof OrderRuleError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Something went wrong on our side. Try again." };
  }
}

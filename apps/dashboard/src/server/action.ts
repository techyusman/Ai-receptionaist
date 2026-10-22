import "server-only";
import { OrderRuleError } from "@receptionist/domain";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { Forbidden } from "./auth";
import { InputError } from "./api";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string; field?: string };

/**
 * Runs a mutation for a Server Action: refreshes the page on success and turns expected failures
 * (bad input, no permission, an order rule) into a message for the form. Next's own redirect and
 * not-found signals pass through untouched.
 */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    refresh();
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      return { ok: false, message: issue?.message ?? "Check the form and try again.", field: issue?.path[0]?.toString() };
    }
    if (e instanceof InputError) return { ok: false, message: e.message, field: e.field };
    if (e instanceof Forbidden) return { ok: false, message: "Your role can't do that. Ask an owner." };
    if (e instanceof OrderRuleError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Something went wrong on our side. Try again." };
  }
}

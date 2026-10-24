// Turns anything a handler throws into the JSON error body and status code the dashboard expects.
import { OrderRuleError } from "@receptionist/domain";
import { pgError, PG, NotFoundError } from "@receptionist/db";
import type { ApiErrorBody } from "@receptionist/contracts";
import { z } from "zod";
import { HttpError } from "./errors.ts";

const CONSTRAINT_MESSAGES: Record<string, string> = {
  square_mode_needs_proof: "Square ordering needs the Square test to pass and be signed off first.",
  ticket_mode_needs_approval: "Live orders needs the restaurant's written approval recorded first.",
  special_hours_one_closure: "That day is already marked closed.",
  pronunciations_term_key: "That word is already on the list.",
  menu_aliases_phrase_key: "Another item already uses that phrase.",
  invitations_open_per_email: "There's already an open invite for that email.",
  memberships_one_per_scope: "That person is already on the team.",
  memberships_one_owner: "A restaurant has one owner.",
  catalog_syncs_one_running: "A menu sync is already running.",
  phone_numbers_route_key: "That number is already in use.",
  pos_integrations_claim: "That Square location is already connected to another restaurant.",
  orders_one_open_per_call: "This call already has an order in progress.",
  restaurants_slug_key: "A restaurant with that name already exists. Try adding the town.",
  alerts_open_dedupe: "That alert is already open.",
};

export type Problem = { status: number; body: ApiErrorBody };

export function toProblem(e: unknown): Problem {
  if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) } } };

  if (e instanceof z.ZodError) {
    const issue = e.issues[0];
    const field = issue?.path[0];
    return {
      status: 400,
      body: { error: { code: "VALIDATION", message: issue?.message ?? "Check the details and try again.", ...(field !== undefined ? { field: String(field) } : {}) } },
    };
  }

  if (e instanceof OrderRuleError) return { status: 422, body: { error: { code: "RULE", message: e.message } } };
  if (e instanceof NotFoundError) return { status: 404, body: { error: { code: "NOT_FOUND", message: "That doesn't exist, or you don't have access to it." } } };

  const pg = pgError(e);
  if (pg) {
    const known = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    if (pg.code === PG.checkViolation) return { status: 422, body: { error: { code: "RULE", message: known ?? "That change isn't allowed." } } };
    if (pg.code === PG.uniqueViolation) return { status: 409, body: { error: { code: "CONFLICT", message: known ?? "That already exists." } } };
    if (pg.code === PG.foreignKeyViolation) return { status: 409, body: { error: { code: "CONFLICT", message: known ?? "That is still in use." } } };
    if (pg.code === PG.serializationFailure || pg.code === PG.deadlock) {
      return { status: 409, body: { error: { code: "CONFLICT", message: "Someone else changed this at the same time. Try again." } } };
    }
  }

  const f = e as { statusCode?: number; code?: string } | null;
  if (f && typeof f.statusCode === "number") {
    if (f.statusCode === 429) return { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." } } };
    if (f.statusCode === 413) return { status: 413, body: { error: { code: "VALIDATION", message: "That request is too large." } } };
    if (f.statusCode >= 400 && f.statusCode < 500) return { status: f.statusCode, body: { error: { code: "VALIDATION", message: "That request couldn't be read." } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong on our side. Try again." } } };
}

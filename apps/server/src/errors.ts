// Errors the routes throw on purpose. The error handler in app.ts turns each into a JSON body
// the dashboard can show, so a person sees "Say why" and never a stack trace.
import type { ApiErrorCode } from "@receptionist/contracts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly field?: string;
  constructor(status: number, code: ApiErrorCode, message: string, field?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const invalid = (message: string, field?: string) => new HttpError(400, "VALIDATION", message, field);
export const unauthenticated = (message = "Sign in to continue.") => new HttpError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "Your role can't do that. Ask an owner.") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "That doesn't exist, or you don't have access to it.") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, field?: string) => new HttpError(409, "CONFLICT", message, field);
/** A business rule said no (an order rule, the Square gate). The caller can fix it. */
export const rule = (message: string, field?: string) => new HttpError(422, "RULE", message, field);
export const upstream = (message: string) => new HttpError(502, "UPSTREAM", message);
export const notConfigured = (what: string) => new HttpError(503, "UPSTREAM", `${what} isn't set up on this server yet.`);

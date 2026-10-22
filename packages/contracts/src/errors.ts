// The error body every non-2xx API answer carries, and the codes the dashboard can act on.
export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RULE"
  | "RATE_LIMITED"
  | "UPSTREAM"
  | "INTERNAL";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; field?: string } };

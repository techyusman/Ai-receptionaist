import "server-only";
import { redirect } from "next/navigation";
import type { ApiErrorBody } from "@/data/types";
import { getAuth } from "../session";

// Every read and write goes to the API with the signed-in person's own token. The API decides what they
// may see; this file only turns its answers into the errors the screens already understand.

export class InputError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "InputError";
    this.field = field;
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Your role can't do that. Ask an owner.") {
    super(message);
    this.name = "Forbidden";
  }
}

export class NotFoundError extends Error {}

function apiBase(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error("API_BASE_URL must be set.");
  return url.replace(/\/$/, "");
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function apiFetch<T>(method: string, path: string, opts: { body?: unknown; query?: Query; token?: string } = {}): Promise<T> {
  const token = opts.token ?? (await getAuth())?.access_token;
  if (!token) redirect("/login");
  const url = new URL(`${apiBase()}/api/v1${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (res.ok) return body as T;
  const err = body?.error;
  if (res.status === 401) redirect("/login");
  if (res.status === 403) throw new ForbiddenError(err?.message);
  if (res.status === 404) throw new NotFoundError(err?.message ?? "Not found");
  if (res.status >= 400 && res.status < 500) throw new InputError(err?.message ?? "Check the details and try again.", err?.field);
  throw new Error(`API ${method} ${path} failed with ${res.status}`);
}

export const get = <T>(path: string, query?: Query) => apiFetch<T>("GET", path, { query });
export const post = <T>(path: string, body?: unknown) => apiFetch<T>("POST", path, { body: body ?? {} });
export const put = <T>(path: string, body: unknown) => apiFetch<T>("PUT", path, { body });
export const patch = <T>(path: string, body: unknown) => apiFetch<T>("PATCH", path, { body });
export const del = (path: string, query?: Query) => apiFetch<void>("DELETE", path, { query });

/** For reads where "not found" is an answer (an order id from a link that no longer exists). */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

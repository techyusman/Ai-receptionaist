import { readSession } from "@/server/auth";
import { getAuth } from "@/server/session";

// Server-Sent Events for the signed-in location: new tickets, order changes, alerts, callbacks. This
// route opens the API's stream with the person's own token and passes it straight through, so the
// browser never holds an API credential. Closing the tab closes the upstream stream too.

export async function GET(request: Request) {
  const [session, auth] = await Promise.all([readSession(), getAuth()]);
  if (!session || !auth) return new Response("Sign in first.", { status: 401 });
  const base = process.env.API_BASE_URL?.replace(/\/$/, "");
  if (!base) return new Response("Live updates aren't configured.", { status: 503 });

  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort());
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/locations/${session.location.id}/live`, {
      headers: { authorization: `Bearer ${auth.access_token}`, accept: "text/event-stream" },
      signal: upstream.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("retry: 5000\n\n", { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  }
  if (!res.ok || !res.body) return new Response("Live updates are unavailable.", { status: res.status === 401 ? 401 : 502 });

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

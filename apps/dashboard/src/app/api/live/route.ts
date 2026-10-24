import { unstable_rethrow } from "next/navigation";
import { readSession } from "@/server/auth";
import { getAuth } from "@/server/session";

// Server-Sent Events for the signed-in location: new tickets, order changes, alerts, callbacks. This
// route opens the API's stream with the person's own token and passes it straight through, so the
// browser never holds an API credential. Closing the tab closes the upstream stream too.

// The browser gives up for good on any answer that isn't an event stream, so everything short of "signed
// out" is answered with a stream that tells it to come back in a few seconds.
const comeBackSoon = () => new Response("retry: 5000\n\n", { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });

export async function GET(request: Request) {
  let session: Awaited<ReturnType<typeof readSession>>;
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    [session, auth] = await Promise.all([readSession(), getAuth()]);
  } catch (e) {
    unstable_rethrow(e);
    return comeBackSoon();
  }
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
    return comeBackSoon();
  }
  if (res.status === 401) return new Response("Sign in first.", { status: 401 });
  if (!res.ok || !res.body) return comeBackSoon();

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

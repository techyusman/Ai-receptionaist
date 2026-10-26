import { isId } from "@/server/http/client";
import { getAuth } from "@/server/session";

// The AI's human-sounding voice on a browser call: one piece of a reply in, audio out. The browser asks
// this route (it never holds an API credential); the route asks the API with the person's own token and
// passes the audio straight through. Only the cookie is read here, not who is signed in: every piece of
// every reply comes through, and the API checks that the chat is this person's at this location anyway.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { locationId?: unknown; chatId?: unknown; text?: unknown } | null;
  const locationId = typeof body?.locationId === "string" ? body.locationId : "";
  const chatId = typeof body?.chatId === "string" ? body.chatId : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!isId(locationId) || !isId(chatId) || !text) return Response.json({ error: { message: "Say which chat, and what to say." } }, { status: 400 });

  const auth = await getAuth();
  if (!auth) return Response.json({ error: { message: "Sign in first." } }, { status: 401 });
  const base = process.env.API_BASE_URL?.replace(/\/$/, "");
  if (!base) return Response.json({ error: { message: "The API isn't configured." } }, { status: 503 });

  const res = await fetch(`${base}/api/v1/locations/${locationId}/test-chat/${chatId}/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ text }),
    cache: "no-store",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
  }).catch(() => null);
  if (!res) return Response.json({ error: { message: "The voice isn't available right now." } }, { status: 503 });
  if (!res.ok || !res.body) return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "audio/wav", "cache-control": "no-store" } });
}

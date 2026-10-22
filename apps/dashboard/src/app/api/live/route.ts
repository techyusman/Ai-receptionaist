import { readSession } from "@/server/auth";
import { subscribe } from "@/server/fake/store";

// Server-Sent Events for the signed-in location: new tickets, order changes, alerts, callbacks.
// With the real backend the browser subscribes to the API's SSE endpoint instead (architecture.md).

export async function GET(request: Request) {
  const session = await readSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send("retry: 3000\n\n");
      const unsubscribe = subscribe(session.location.id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const ping = setInterval(() => send(": keep-alive\n\n"), 25_000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

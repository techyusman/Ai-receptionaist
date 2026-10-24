// The real model connection: a WebSocket to OpenAI's Realtime API, authenticated with the project's
// own API key. The gateway talks to the small RealtimeSession interface, so this is the only file that
// knows the wire details. The model is pinned in configuration, never chosen at call time.
import WebSocket from "ws";
import type { RealtimeConnector, RealtimeSession } from "./realtime.ts";

export type OpenAiRealtimeOptions = { apiKey: string; model: string; url?: string; connectTimeoutMs?: number };

export function createOpenAiRealtime(o: OpenAiRealtimeOptions): RealtimeConnector {
  return {
    connect() {
      const url = new URL(o.url ?? "wss://api.openai.com/v1/realtime");
      url.searchParams.set("model", o.model);
      return new Promise<RealtimeSession>((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { authorization: `Bearer ${o.apiKey}` }, handshakeTimeout: o.connectTimeoutMs ?? 5000, maxPayload: 8 * 1024 * 1024 });
        let onEvent: (e: Record<string, unknown>) => void = () => {};
        let onClose: (code: number) => void = () => {};
        ws.once("error", (e) => reject(e));
        ws.once("open", () => {
          ws.removeAllListeners("error");
          ws.on("error", () => {
            // the close handler below reports it
          });
          ws.on("message", (data) => {
            try {
              onEvent(JSON.parse(data.toString()) as Record<string, unknown>);
            } catch {
              // a frame that isn't JSON is ignored
            }
          });
          ws.on("close", (code) => onClose(code));
          resolve({
            send(event) {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
            },
            onEvent(h) {
              onEvent = h;
            },
            onClose(h) {
              onClose = h;
            },
            close() {
              ws.removeAllListeners("close");
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
            },
          });
        });
      });
    },
  };
}

// The WebSocket Twilio opens for a call's audio. It does nothing until the first frame proves the call
// is ours (a signed one-time pass naming a live call); a connection that stays silent is dropped.
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { activeCalls } from "./active.ts";
import { VoiceSession } from "./session.ts";

const START_DEADLINE_MS = 5000;

export function registerVoiceGateway(app: FastifyInstance, deps: Deps) {
  const live = new Set<VoiceSession>();
  void app.register(async (scope) => {
    scope.get("/voice/media", { websocket: true }, (socket) => {
      const session = new VoiceSession(deps, {
        send: (d: string) => {
          if (socket.readyState === socket.OPEN) socket.send(d);
        },
        close: () => socket.close(),
      });
      live.add(session);
      activeCalls.count = live.size;
      let started = false;
      const deadline = setTimeout(() => {
        if (!started) socket.close();
      }, START_DEADLINE_MS);
      socket.on("message", (data: Buffer) => {
        const text = data.toString();
        if (!started && text.includes('"event":"start"')) started = true;
        void session.onTwilio(text);
      });
      const end = () => {
        clearTimeout(deadline);
        live.delete(session);
        activeCalls.count = live.size;
        void session.close("socket-closed");
      };
      socket.on("close", end);
      socket.on("error", end);
    });
  });
  // On shutdown (a deploy), calls in progress are given time to finish before the process exits.
  app.addHook("onClose", async () => {
    await Promise.all([...live].map((s) => s.close("server-stopping")));
  });
}


import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";
import { lidParam, parse, who } from "../http.ts";

const HEARTBEAT_MS = 25_000;

// Server-Sent Events for one location. The dashboard's own server opens this with the person's token
// and passes the stream to the browser, so the browser never holds an API credential.
export function registerLiveRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/live", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    await deps.access.forLocation(who(req), lid, "orders.view");

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": deps.config.DASHBOARD_ORIGIN,
    });
    res.write("retry: 3000\n: connected\n\n");

    const unsubscribe = deps.bus.subscribe(lid, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    const done = () => {
      clearInterval(beat);
      unsubscribe();
    };
    req.raw.on("close", done);
    res.on("error", done);
  });
}

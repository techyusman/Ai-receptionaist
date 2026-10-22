import "server-only";

// The data layer every screen calls. Today it's the in-memory fake with seed data. replica-backend
// swaps this one line for the HTTP client against the Fastify API (same function names and types),
// so no screen code changes.
export * from "./fake/api";

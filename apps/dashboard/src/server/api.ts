import "server-only";

// The data layer every screen calls: the HTTP client for the API (apps/server), with the same function
// names and types the fake layer had, so no screen code changed when it was swapped in.
export * from "./http/api";

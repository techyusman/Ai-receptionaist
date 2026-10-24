// Process-wide state for a graceful deploy: once draining, the health check fails so the load balancer
// sends new calls to the fresh machine, while calls already in progress finish here.
export const lifecycle = { draining: false };

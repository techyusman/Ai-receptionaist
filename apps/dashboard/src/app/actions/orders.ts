"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

const id = z.string().min(1).max(64);

export async function acceptOrder(orderId: string) {
  return run(() => api.acceptOrder(id.parse(orderId)));
}

export async function cancelOrder(orderId: string, reason: string) {
  return run(() => api.cancelOrder(id.parse(orderId), z.string().max(300).parse(reason)));
}

export async function updateCallback(callbackId: string, status: "OPEN" | "DONE" | "CANCELLED") {
  return run(() => api.updateCallback(id.parse(callbackId), z.enum(["OPEN", "DONE", "CANCELLED"]).parse(status)));
}

export async function acknowledgeAlert(alertId: string) {
  return run(() => api.ackAlert(id.parse(alertId)));
}

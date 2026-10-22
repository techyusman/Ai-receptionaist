"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

const orderId = z.string().min(1).max(64);

const selection = z.object({
  itemId: z.string().min(1),
  variationId: z.string().min(1).optional(),
  quantity: z.number().int().min(1, "At least 1.").max(99, "At most 99."),
  modifiers: z
    .array(z.object({ listId: z.string(), optionId: z.string(), quantity: z.number().int().min(1).max(20).optional(), parentOptionId: z.string().optional() }))
    .max(30),
});

export async function testSearch(query: string) {
  return run(() => api.testSearch(z.string().max(120).parse(query)));
}

export async function testStart() {
  return run(() => api.testStart());
}

export async function testAddLine(id: string, sel: z.input<typeof selection>) {
  return run(() => api.testAddLine(orderId.parse(id), selection.parse(sel)));
}

export async function testRemoveLine(id: string, lineNo: number) {
  return run(() => api.testRemoveLine(orderId.parse(id), z.number().int().min(1).parse(lineNo)));
}

export async function testSetCustomer(id: string, name: string, phone: string) {
  return run(() => api.testSetCustomer(orderId.parse(id), z.string().max(80).parse(name), z.string().max(30).parse(phone)));
}

export async function testReadBack(id: string) {
  return run(() => api.testReadBack(orderId.parse(id)));
}

export async function testConfirm(id: string, version: number) {
  return run(() => api.testConfirm(orderId.parse(id), z.number().int().min(1).parse(version)));
}

export async function testSubmit(id: string) {
  return run(() => api.testSubmit(orderId.parse(id)));
}

export async function testHangUp(id: string) {
  return run(() => api.testHangUp(orderId.parse(id)));
}

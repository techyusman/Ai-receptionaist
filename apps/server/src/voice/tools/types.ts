import type { z } from "zod";
import type { Deps } from "../../deps.ts";
import type { CallContext } from "../context.ts";

/** What a tool gives back to the model: plain JSON, never an id, a token or a stack trace. */
export type ToolResult = Record<string, unknown>;

/** Things only the gateway can do once the model has finished speaking. */
export type ToolEffects = {
  transfer?: { transferId: string; number: string; seconds: number; whisperUrl: string; actionUrl: string };
  endCall?: boolean;
};

export type ToolRun = { result: ToolResult; effects?: ToolEffects; /** The sentence written to the call's timeline. */ note?: string };

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  /** JSON Schema shown to the model. The zod schema below is what the server actually enforces. */
  parameters: Record<string, unknown>;
  schema: S;
  run(deps: Deps, ctx: CallContext, args: z.output<S>): Promise<ToolRun>;
};

export const ok = (result: ToolResult, effects?: ToolEffects): ToolRun => ({ result: { ok: true, ...result }, ...(effects ? { effects } : {}) });
export const refuse = (reason: string, say: string, extra: ToolResult = {}): ToolRun => ({ result: { ok: false, reason, say, ...extra } });

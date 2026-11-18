import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type ModelChoice, parseChoice } from "./model-settings.js";

type AgentAuth = typeof import("../agent-auth/agent-auth.js");
type AuthRuntime = import("../agent-auth/agent-auth.js").AuthRuntime;

/** The configure flags of the fallback worker models. */
export interface FallbackInput {
  /** The new full list, in order, as `provider/model` values. */
  fallbackWorkers?: readonly string[];
  clearFallbackWorkers?: boolean;
}

/** The validated fallback models, and the runtime that the validation started or got. */
export interface FallbackChoice {
  readonly runtime?: AuthRuntime;
  readonly choices?: readonly ModelChoice[];
}

/** Tells if the input changes the fallback worker models. */
export function hasFallbackInput(input: FallbackInput): boolean {
  return input.fallbackWorkers !== undefined || !!input.clearFallbackWorkers;
}

/** Rejects the flags that set and clear the list together, and values that are not `provider/model`. */
export function checkFallbackInput(input: FallbackInput): void {
  if (input.fallbackWorkers !== undefined && input.clearFallbackWorkers) {
    throw new ValidationError("Do not set the fallback worker models when you clear them");
  }

  if (input.fallbackWorkers !== undefined && input.fallbackWorkers.length === 0) {
    throw new ValidationError("Select at least one fallback worker model");
  }

  for (const value of input.fallbackWorkers ?? []) {
    parseChoice(value, undefined);
  }
}

/** Validates each fallback model in order with one auth runtime. The runtime starts only for a list. */
export async function chooseFallbacks(
  auth: AgentAuth,
  input: FallbackInput,
  runtime?: AuthRuntime,
): Promise<FallbackChoice> {
  if (!input.fallbackWorkers) {
    return { runtime };
  }

  const resolved = runtime ?? (await auth.authRuntime());
  const choices = await mapInOrder(input.fallbackWorkers, (value) =>
    auth.validateModelChoice(resolved, parseChoice(value, undefined)),
  );

  return { runtime: resolved, choices };
}

/** Gives the settings change of the fallback flags. A clear sets the key to undefined, so the write leaves it out. */
export function fallbackChange(
  input: FallbackInput,
  choices: readonly ModelChoice[] | undefined,
): { fallbackWorkerModels?: readonly ModelChoice[] } {
  if (input.clearFallbackWorkers) {
    return { fallbackWorkerModels: undefined };
  }

  return choices ? { fallbackWorkerModels: choices } : {};
}

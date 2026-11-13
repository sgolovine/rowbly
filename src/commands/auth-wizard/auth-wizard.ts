import { isCancel, log, password, select, text } from "@clack/prompts";
import type { AuthInteraction } from "../../services/agent-auth/agent-auth.js";
import { ValidationError } from "../../services/errors/errors.js";

type AuthPrompt = Parameters<AuthInteraction["prompt"]>[0];
type AuthEvent = Parameters<AuthInteraction["notify"]>[0];

/** Asks one Pi prompt with the matching terminal prompt. A cancel gives the cancel symbol. */
function ask(prompt: AuthPrompt, signal: AbortSignal): ReturnType<typeof text> {
  const opts = { message: prompt.message, signal };

  if (prompt.type === "select") {
    return select({
      ...opts,
      options: prompt.options.map((o) => ({ value: o.id, label: o.label, hint: o.description })),
    });
  }

  return prompt.type === "secret" ? password(opts) : text({ ...opts, placeholder: prompt.placeholder });
}

/** Asks one prompt. A cancel by the user stops the whole login flow. */
async function promptUser(controller: AbortController, prompt: AuthPrompt): Promise<string> {
  const signals = [controller.signal, ...(prompt.signal ? [prompt.signal] : [])];
  const signal = AbortSignal.any(signals);

  signal.throwIfAborted();

  const value = await ask(prompt, signal);

  if (signal.aborted) {
    throw signal.reason;
  }

  if (isCancel(value)) {
    controller.abort();
    throw new ValidationError("Login cancelled");
  }

  return value;
}

function eventText(event: AuthEvent): string {
  if (event.type === "auth_url") {
    return `${event.url}\n${event.instructions ?? ""}`;
  }

  if (event.type === "device_code") {
    return `${event.verificationUri}\nCode: ${event.userCode}`;
  }

  const links = event.type === "info" ? (event.links ?? []).map((l) => `\n${l.url}`).join("") : "";

  return `${event.message}${links}`;
}

/** Adapts Pi prompts to one cancellable terminal flow. */
export function createCliAuthInteraction(controller = new AbortController()): AuthInteraction {
  return {
    signal: controller.signal,
    prompt: (prompt) => promptUser(controller, prompt),
    notify: (event) => log.info(eventText(event)),
  };
}

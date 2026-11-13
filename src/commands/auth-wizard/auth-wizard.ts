import { isCancel, log, password, select, text } from "@clack/prompts";
import type { AuthInteraction } from "../../services/agent-auth/agent-auth.js";
import { ValidationError } from "../../services/errors/errors.js";

/** Adapts Pi prompts to one cancellable terminal flow. */
export function createCliAuthInteraction(controller = new AbortController()): AuthInteraction {
  return {
    signal: controller.signal,
    async prompt(prompt) {
      const signals = [controller.signal, ...(prompt.signal ? [prompt.signal] : [])];
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      const opts = { message: prompt.message, signal };
      const value =
        prompt.type === "select"
          ? await select({
              ...opts,
              options: prompt.options.map((o) => ({ value: o.id, label: o.label, hint: o.description })),
            })
          : prompt.type === "secret"
            ? await password(opts)
            : await text({ ...opts, placeholder: prompt.placeholder });
      if (signal.aborted) {
        throw signal.reason;
      }
      if (isCancel(value)) {
        controller.abort();
        throw new ValidationError("Login cancelled");
      }
      return value;
    },
    notify(event) {
      if (event.type === "auth_url") {
        log.info(`${event.url}\n${event.instructions ?? ""}`);
      } else if (event.type === "device_code") {
        log.info(`${event.verificationUri}\nCode: ${event.userCode}`);
      } else {
        log.info(
          `${event.message}${event.type === "info" ? (event.links ?? []).map((l) => `\n${l.url}`).join("") : ""}`,
        );
      }
    },
  };
}

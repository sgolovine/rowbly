import { isAbsolute } from "node:path";
import { ValidationError } from "../../services/errors/errors.js";
import { fileRecorder } from "../../services/outbox/outbox-file.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";

/** The environment variables of the outbox of a remote worker. */
export interface OutboxEnv {
  readonly ROWBLY_OUTBOX?: string;
  readonly ROWBLY_THREAD_ID?: string;
}

/**
 * The service context of a CLI command. With `ROWBLY_OUTBOX`, the context records each Story write in that outbox
 * folder, and the services refuse the writes that a remote worker cannot do. An incomplete outbox setting gives a
 * `ValidationError`, before the command writes.
 */
export function commandContext(cwd: string | undefined, env: OutboxEnv): ServiceContext {
  const dir = env.ROWBLY_OUTBOX?.trim();
  const threadId = env.ROWBLY_THREAD_ID?.trim();

  if (!dir) {
    return { cwd };
  }

  if (!threadId) {
    throw new ValidationError("ROWBLY_OUTBOX is set, but ROWBLY_THREAD_ID is not set", {
      hint: "Set ROWBLY_THREAD_ID to the Thread of the remote worker, or unset ROWBLY_OUTBOX.",
    });
  }

  if (!isAbsolute(dir)) {
    throw new ValidationError(`ROWBLY_OUTBOX must be an absolute path: ${dir}`);
  }

  return { cwd, recorder: fileRecorder({ dir, threadId }) };
}

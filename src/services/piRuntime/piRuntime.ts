import type { AgentSession, CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { RowblyError } from "../errors/errors.js";

export type PiSdk = typeof import("@earendil-works/pi-coding-agent");
export type PiLoader = () => Promise<PiSdk>;

/** Loads the SDK only for authentication or execution. */
export const loadPi: PiLoader = () => import("@earendil-works/pi-coding-agent");

export class PiPromptError extends RowblyError {
  readonly code = "PI_PROMPT";
}

export interface PiSession {
  session: AgentSession;
  prompt(text: string): Promise<void>;
  close(): Promise<void>;
}

/** Creates a session with explicit resources and no implicit discovery of user extensions or skills. */
export async function createPiSession(
  options: CreateAgentSessionOptions & {
    cwd: string;
    agentDir: string;
    modelRuntime: NonNullable<CreateAgentSessionOptions["modelRuntime"]>;
  },
  loader: PiLoader = loadPi,
): Promise<PiSession> {
  const sdk = await loader();
  const settingsManager =
    options.settingsManager ??
    sdk.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
      cacheWarming: "off",
    });
  const resourceLoader =
    options.resourceLoader ??
    new sdk.DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
  if (!options.resourceLoader) await resourceLoader.reload();
  const { session } = await sdk.createAgentSession({ ...options, settingsManager, resourceLoader });
  let settled = Promise.resolve();
  let resolveSettled: (() => void) | undefined;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start")
      settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
    if (event.type === "agent_settled") {
      resolveSettled?.();
      resolveSettled = undefined;
    }
  });
  let closing: Promise<void> | undefined;
  return {
    session,
    async prompt(text) {
      await session.prompt(text);
      await session.waitForIdle();
      await settled;
      const last = session.messages.findLast((message) => message.role === "assistant");
      if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
        throw new PiPromptError(last.errorMessage ?? `Assistant ${last.stopReason}`);
      }
    },
    close() {
      closing ??= (async () => {
        await session.abort();
        await session.waitForIdle();
        await settled;
        unsubscribe();
        session.dispose();
        await options.modelRuntime.settleCredentialWrites();
      })();
      return closing;
    },
  };
}

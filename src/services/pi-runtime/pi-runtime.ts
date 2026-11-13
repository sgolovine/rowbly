import type { AgentSession, AgentSessionEvent, CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { RowblyError } from "../errors/errors.js";
import { Store } from "../store/store.js";

export type PiSdk = typeof import("@earendil-works/pi-coding-agent");
export type PiLoader = () => Promise<PiSdk>;

/** Loads the SDK only for authentication or execution. */
export const loadPi: PiLoader = () => import("@earendil-works/pi-coding-agent");

/** A Pi prompt that ended with an error, an abort or a busy supervisor. */
export class PiPromptError extends RowblyError {
  readonly code = "PI_PROMPT";
}

export interface PiSession {
  session: AgentSession;
  prompt(text: string): Promise<void>;
  sendDigest(text: string): Promise<void>;
  close(): Promise<void>;
}

type SessionOptions = CreateAgentSessionOptions & {
  cwd: string;
  agentDir: string;
  modelRuntime: NonNullable<CreateAgentSessionOptions["modelRuntime"]>;
};

/** Tracks the current agent run, so that a prompt waits until Pi settles the run. */
interface RunState {
  readonly settled: Promise<void>;
  readonly resolveSettled?: () => void;
  readonly closing?: Promise<void>;
}

/** The fixed parts of one session, and the store of its run state. */
interface SessionEnv {
  readonly session: AgentSession;
  readonly options: SessionOptions;
  readonly unsubscribe: () => void;
  readonly store: Store<RunState>;
}

function defaultSettings(sdk: PiSdk): NonNullable<CreateAgentSessionOptions["settingsManager"]> {
  return sdk.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: "off",
  });
}

function defaultResources(
  sdk: PiSdk,
  options: SessionOptions,
  settingsManager: NonNullable<CreateAgentSessionOptions["settingsManager"]>,
): NonNullable<CreateAgentSessionOptions["resourceLoader"]> {
  return new sdk.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
}

function startRun(store: Store<RunState>): void {
  const settled = new Promise<void>((resolve) => {
    store.update(() => ({ resolveSettled: resolve }));
  });

  store.update(() => ({ settled }));
}

function settleRun(store: Store<RunState>): void {
  store.current.resolveSettled?.();
  store.update(() => ({ resolveSettled: undefined }));
}

function onSessionEvent(store: Store<RunState>, event: AgentSessionEvent): void {
  if (event.type === "agent_start") {
    startRun(store);
  }

  if (event.type === "agent_settled") {
    settleRun(store);
  }
}

/** Waits for the run to settle, and throws when the last assistant message stopped with an error. */
async function checkSettled(env: SessionEnv): Promise<void> {
  await env.session.waitForIdle();
  await env.store.current.settled;

  const last = env.session.messages.findLast((message) => message.role === "assistant");

  if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
    throw new PiPromptError(last.errorMessage ?? `Assistant ${last.stopReason}`);
  }
}

async function prompt(env: SessionEnv, text: string): Promise<void> {
  await env.session.prompt(text);
  await checkSettled(env);
}

async function sendDigest(env: SessionEnv, text: string): Promise<void> {
  if (!env.session.isIdle) {
    throw new PiPromptError("Supervisor is busy");
  }

  await env.session.sendCustomMessage(
    { customType: "rowbly:factory-digest", content: text, display: false },
    { triggerTurn: true },
  );
  await checkSettled(env);
}

async function shutdown(env: SessionEnv): Promise<void> {
  await env.session.abort();
  await env.session.waitForIdle();
  await env.store.current.settled;
  env.unsubscribe();
  env.session.dispose();
  await env.options.modelRuntime.settleCredentialWrites();
}

/** Closes the session one time. A second call gives the same promise. */
function close(env: SessionEnv): Promise<void> {
  const { closing } = env.store.current;

  if (closing) {
    return closing;
  }

  const next = shutdown(env);

  env.store.update(() => ({ closing: next }));

  return next;
}

/** Creates a session with explicit resources and no implicit discovery of user extensions or skills. */
export async function createPiSession(options: SessionOptions, loader: PiLoader = loadPi): Promise<PiSession> {
  const sdk = await loader();
  const settingsManager = options.settingsManager ?? defaultSettings(sdk);
  const resourceLoader = options.resourceLoader ?? defaultResources(sdk, options, settingsManager);

  if (!options.resourceLoader) {
    await resourceLoader.reload();
  }

  const { session } = await sdk.createAgentSession({ ...options, settingsManager, resourceLoader });
  const store = new Store<RunState>({ settled: Promise.resolve() });
  const unsubscribe = session.subscribe((event) => onSessionEvent(store, event));
  const env: SessionEnv = { session, options, unsubscribe, store };

  return {
    session,
    prompt: (text) => prompt(env, text),
    sendDigest: (text) => sendDigest(env, text),
    close: () => close(env),
  };
}

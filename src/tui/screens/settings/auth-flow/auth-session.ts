import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  type AuthInteraction,
  type AuthRuntime,
  type AuthType,
  loginProvider,
} from "../../../../services/agent-auth/agent-auth.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { showToast, type ToastStore } from "../../../hooks/index.js";
import type { AuthEvent, AuthPrompt, Pending } from "../auth-types.js";

/** The most messages of the provider that the Modal keeps; the newest stay. */
const EVENT_LIMIT = 4;

/** What one sign-in reads and changes. */
export interface AuthSession {
  readonly ctx: ServiceContext;
  readonly runtime: AuthRuntime;
  readonly provider: string;
  readonly method: AuthType;
  readonly toast: ToastStore;
  /** The `onDone` of the last render. */
  readonly done: RefObject<(signedIn: boolean) => void>;
  /** Aborts when the Modal closes or the person cancels. */
  readonly abort: AbortController;
  readonly setPending: Dispatch<SetStateAction<Pending | undefined>>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setEvents: Dispatch<SetStateAction<AuthEvent[]>>;
}

/** Runs the sign-in through Pi. Each result tells the AI section and shows a toast. */
export function startLogin(session: AuthSession): void {
  loginProvider(session.runtime, session.provider, session.method, authInteraction(session), session.ctx).then(
    () => signedIn(session),
    (error: unknown) => loginFailed(session, error),
  );
}

function signedIn(session: AuthSession): void {
  showToast(session.toast, "info", `Signed in to ${session.provider}`);
  session.done.current(true);
}

/** An abort is a cancel by the person, not an error. */
function loginFailed(session: AuthSession, error: unknown): void {
  if (session.abort.signal.aborted) {
    showToast(session.toast, "info", `Cancelled the sign-in to ${session.provider}`);
  } else {
    session.toast.error(error);
  }

  session.done.current(false);
}

function authInteraction(session: AuthSession): AuthInteraction {
  return {
    signal: session.abort.signal,
    prompt: (prompt) => new Promise<string>((resolve, reject) => askPrompt(session, prompt, resolve, reject)),
    notify: (event) => session.setEvents((list) => [...list, event].slice(-EVENT_LIMIT)),
  };
}

/** Shows a prompt until the person answers it, or until the sign-in or the provider cancels it. */
function askPrompt(
  session: AuthSession,
  prompt: AuthPrompt,
  resolve: (value: string) => void,
  reject: (reason: Error) => void,
): void {
  const signals = [session.abort.signal, ...(prompt.signal ? [prompt.signal] : [])];
  const cancel = promptCanceller(session, prompt, reject);

  if (signals.some((signal) => signal.aborted)) {
    cancel();

    return;
  }

  for (const signal of signals) {
    signal.addEventListener("abort", cancel, { once: true });
  }

  session.setText("");
  session.setPending({ prompt, resolve: (value) => answerPrompt(session, signals, cancel, resolve, value) });
}

/** One function for a prompt, so that an answer can remove it from the signals again. */
function promptCanceller(session: AuthSession, prompt: AuthPrompt, reject: (reason: Error) => void): () => void {
  return () => cancelPrompt(session, prompt, reject);
}

/** A cancelled prompt goes away, unless a newer prompt replaced it. */
function cancelPrompt(session: AuthSession, prompt: AuthPrompt, reject: (reason: Error) => void): void {
  session.setPending((current) => (current?.prompt === prompt ? undefined : current));
  session.setText("");
  reject(new Error("Prompt cancelled"));
}

function answerPrompt(
  session: AuthSession,
  signals: readonly AbortSignal[],
  cancel: () => void,
  resolve: (value: string) => void,
  value: string,
): void {
  for (const signal of signals) {
    signal.removeEventListener("abort", cancel);
  }

  session.setPending(undefined);
  session.setText("");
  resolve(value);
}

import { type Key, useInput } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import type { AuthRuntime, AuthType } from "../../../../services/agent-auth/agent-auth.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type Layout, useIsActive, useKeyCapture, useLatest, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { AuthEvent, Pending } from "../auth-types.js";
import { startLogin } from "./auth-session.js";

/** The inputs of the sign-in. */
interface AuthFlowInput {
  readonly ctx: ServiceContext;
  readonly runtime: AuthRuntime;
  readonly provider: string;
  readonly methods: readonly AuthType[];
  readonly onDone: (signedIn: boolean) => void;
}

/** What the keys of the sign-in read. */
interface AuthKeyEnv {
  readonly method: AuthType | undefined;
  readonly pending: Pending | undefined;
  readonly typing: boolean;
  readonly text: string;
  readonly controller: RefObject<AbortController>;
  readonly done: RefObject<(signedIn: boolean) => void>;
}

/** The state of the sign-in for one render. */
interface AuthFlowModel {
  readonly active: boolean;
  readonly layout: Layout;
  readonly method: AuthType | undefined;
  readonly events: readonly AuthEvent[];
  readonly pending: Pending | undefined;
  readonly text: string;
  readonly hints: readonly KeyHint[];
  readonly setMethod: Dispatch<SetStateAction<AuthType | undefined>>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly cancel: () => void;
}

/** A sign-in that runs aborts, and Pi ends it. Before a method is chosen, the Modal closes at once. */
function cancelAuth(env: AuthKeyEnv): void {
  if (env.method) {
    env.controller.current.abort();

    return;
  }

  env.done.current(false);
}

function handleAuthKey(env: AuthKeyEnv, key: Key): void {
  if (key.escape) {
    cancelAuth(env);

    return;
  }

  if (key.return && env.typing && env.pending && env.text.trim()) {
    env.pending.resolve(env.text.trim());
  }
}

function authHints(typing: boolean, method: AuthType | undefined, pending: Pending | undefined): KeyHint[] {
  return [
    ...(typing ? [{ key: "enter", description: "submit" }] : []),
    ...(!method || pending?.prompt.type === "select" ? [{ key: "enter", description: "choose" }] : []),
    { key: "esc", description: "cancel" },
  ];
}

/** The state, the keys and the sign-in of one AI provider. */
export function useAuthFlow({ ctx, runtime, provider, methods, onDone }: AuthFlowInput): AuthFlowModel {
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [method, setMethod] = useState<AuthType | undefined>(methods.length === 1 ? methods[0] : undefined);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [text, setText] = useState("");
  const controller = useRef(new AbortController());
  const done = useLatest(onDone);

  const typing = pending !== undefined && pending.prompt.type !== "select";
  const env: AuthKeyEnv = { method, pending, typing, text, controller, done };

  // One sign-in for each chosen method. Closing the Modal cancels it.
  useEffect(() => {
    if (!method) {
      return;
    }

    const abort = controller.current;

    startLogin({ ctx, runtime, provider, method, toast, done, abort, setPending, setText, setEvents });

    return () => abort.abort();
  }, [method, runtime, provider, ctx, toast, done]);
  useKeyCapture(active, { text: typing, escape: true });
  useInput((_input, key) => handleAuthKey(env, key), { isActive: active });

  return {
    active,
    layout,
    method,
    events,
    pending,
    text,
    hints: authHints(typing, method, pending),
    setMethod,
    setText,
    cancel: () => cancelAuth(env),
  };
}

import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import {
  type AuthInteraction,
  type AuthRuntime,
  type AuthType,
  loginProvider,
} from "../../../../services/agentAuth/agentAuth.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Modal, SelectList, TextInput } from "../../../components/index.js";
import { ActiveContext, useIsActive, useKeyCapture, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";

type AuthPrompt = Parameters<AuthInteraction["prompt"]>[0];
type AuthEvent = Parameters<AuthInteraction["notify"]>[0];

/** A prompt of the provider that waits for the user. */
interface Pending {
  prompt: AuthPrompt;
  resolve(value: string): void;
}

/** The words of each sign-in method. */
const METHODS: Record<AuthType, string> = { oauth: "Sign in with an account", api_key: "Enter an API key" };

/** The most messages of the provider that the Modal keeps; the newest stay. */
const EVENT_LIMIT = 4;

/**
 * The sign-in of one AI provider, in a generic Modal over the AI settings. It first asks for the method when
 * the provider has two. Then Pi runs the sign-in, and the Modal shows its messages: a URL to open, a device
 * code, information and progress. It asks the questions of the provider: text, a secret (each character
 * shows as `•`), a code or a choice. A prompt that the provider cancels, for example a manual code after the
 * browser callback, goes away. `esc` cancels the sign-in. The URL, the code and the typed text stay in this
 * Modal only, and go away when it closes. Pi keeps the credentials in its own store.
 */
export function AuthFlow({
  ctx,
  runtime,
  provider,
  methods,
  onDone,
}: {
  ctx: ServiceContext;
  runtime: AuthRuntime;
  provider: string;
  methods: readonly AuthType[];
  /** The sign-in ended: `true` when it completed. */
  onDone(signedIn: boolean): void;
}) {
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [method, setMethod] = useState<AuthType | undefined>(methods.length === 1 ? methods[0] : undefined);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [text, setText] = useState("");
  const controller = useRef(new AbortController());
  const done = useRef(onDone);
  done.current = onDone;

  // One sign-in for each chosen method. Closing the Modal cancels it.
  useEffect(() => {
    if (!method) return;
    const abort = controller.current;
    const interaction: AuthInteraction = {
      signal: abort.signal,
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          const signals = [abort.signal, ...(prompt.signal ? [prompt.signal] : [])];
          const cancel = () => {
            setPending((current) => (current?.prompt === prompt ? undefined : current));
            setText("");
            reject(new Error("Prompt cancelled"));
          };
          if (signals.some((signal) => signal.aborted)) return cancel();
          for (const signal of signals) signal.addEventListener("abort", cancel, { once: true });
          setText("");
          setPending({
            prompt,
            resolve: (value) => {
              for (const signal of signals) signal.removeEventListener("abort", cancel);
              setPending(undefined);
              setText("");
              resolve(value);
            },
          });
        }),
      notify: (event) => setEvents((list) => [...list, event].slice(-EVENT_LIMIT)),
    };
    loginProvider(runtime, provider, method, interaction, ctx).then(
      () => {
        toast.push("info", `Signed in to ${provider}`);
        done.current(true);
      },
      (error: unknown) => {
        if (abort.signal.aborted) toast.push("info", `Cancelled the sign-in to ${provider}`);
        else toast.error(error);
        done.current(false);
      },
    );
    return () => abort.abort();
  }, [method, runtime, provider, ctx, toast]);

  const cancel = () => {
    if (method) controller.current.abort();
    else done.current(false);
  };
  const typing = pending !== undefined && pending.prompt.type !== "select";
  useKeyCapture(active, { text: typing, escape: true });
  useInput(
    (_input, key) => {
      if (key.escape) cancel();
      else if (key.return && typing && pending && text.trim()) pending.resolve(text.trim());
    },
    { isActive: active },
  );

  const hints: KeyHint[] = [
    ...(typing ? [{ key: "enter", description: "submit" }] : []),
    ...(!method || pending?.prompt.type === "select" ? [{ key: "enter", description: "choose" }] : []),
    { key: "esc", description: "cancel" },
  ];
  const width = Math.max(20, layout.width);
  return (
    <Modal title={`AI › Sign in › ${provider}`} hints={hints} onClose={cancel}>
      <Box flexDirection="column" gap={1}>
        {!method && (
          <>
            <Text color={theme.inkMuted}>Select how to sign in.</Text>
            <ActiveContext.Provider value={active}>
              <SelectList
                items={methods.map((value) => ({ value, label: METHODS[value] }))}
                onSelect={(item) => setMethod(item.value)}
              />
            </ActiveContext.Provider>
          </>
        )}
        {method && events.length === 0 && !pending && <Text color={theme.inkFaint}>Starting the sign-in…</Text>}
        {events.map((event, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages have no identity beyond their order.
          <Box key={i} flexDirection="column">
            {event.type === "auth_url" && (
              <>
                <Text color={theme.inkMuted}>{event.instructions ?? "Open this URL in a browser:"}</Text>
                <Text color={theme.ink} wrap="wrap">
                  {event.url}
                </Text>
              </>
            )}
            {event.type === "device_code" && (
              <>
                <Text color={theme.inkMuted}>Open this URL and enter the code:</Text>
                <Text color={theme.ink} wrap="wrap">
                  {event.verificationUri}
                </Text>
                <Text color={theme.ink} bold>
                  {event.userCode}
                </Text>
              </>
            )}
            {event.type === "info" && (
              <>
                <Text color={theme.inkMuted} wrap="wrap">
                  {event.message}
                </Text>
                {event.links?.map((link) => (
                  <Text key={link.url} color={theme.ink} wrap="wrap">
                    {link.label ? `${link.label}: ` : ""}
                    {link.url}
                  </Text>
                ))}
              </>
            )}
            {event.type === "progress" && <Text color={theme.inkFaint}>{event.message}</Text>}
          </Box>
        ))}
        {pending && (
          <Box flexDirection="column">
            <Text color={theme.ink} wrap="wrap">
              {pending.prompt.message}
            </Text>
            {pending.prompt.type === "select" ? (
              <ActiveContext.Provider value={active}>
                <SelectList
                  items={pending.prompt.options.map((option) => ({
                    value: option.id,
                    label: option.label,
                    description: option.description,
                  }))}
                  onSelect={(item) => pending.resolve(item.value)}
                />
              </ActiveContext.Provider>
            ) : (
              <Box backgroundColor={theme.fieldFocus} paddingX={1}>
                <Text color={theme.accent}>› </Text>
                <TextInput
                  value={text}
                  onChange={setText}
                  width={width - 6}
                  mask={pending.prompt.type === "secret"}
                  placeholder={pending.prompt.placeholder}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Modal>
  );
}

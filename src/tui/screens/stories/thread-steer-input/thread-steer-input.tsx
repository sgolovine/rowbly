import { Box, type DOMElement, type Key, Text, useInput } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import { steerThread } from "../../../../services/factory/factory.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { TextInput } from "../../../components/index.js";
import { runExclusive, showToast, type ToastStore, useKeyCapture, useMouse, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

/** The rows of the steering input. */
export const STEER_INPUT_ROWS = 1;

/** The columns of the frame of the input: the padding and the `› ` glyph. */
const INPUT_CHROME = 4;

export interface ThreadSteerInputProps {
  readonly ctx: ServiceContext;
  /** The id of the running Thread that gets the message. */
  readonly threadId: string;
  /** The Story and the Thread, for the toasts, for example `ROW-7 In Development`. */
  readonly name: string;
  /** The input takes the keys. */
  readonly focused: boolean;
  /** A click on the input gives it the focus. */
  readonly clickable: boolean;
  readonly width: number;
  /** `m` or a click: the input gets the focus. */
  onFocus(): void;
  /** `esc`: the input gives the focus back. The text stays. */
  onLeave(): void;
}

/** The environment of the handlers of the input. */
interface SteerEnv {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  readonly name: string;
  readonly toast: ToastStore;
  /** True while a message waits for the factory, so that a second `enter` sends no second message. */
  readonly sending: RefObject<boolean>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly onLeave: () => void;
}

/** Sends `text` to the worker. On success, the input becomes empty, unless the user typed new text. */
async function sendTask(env: SteerEnv, text: string): Promise<void> {
  const progress = env.toast.pending(`Sending message to ${env.name}…`);

  try {
    await steerThread(env.threadId, text, {}, env.ctx);
    env.setText((current) => (current === text ? "" : current));
    showToast(env.toast, "info", `Sent message to ${env.name}`);
  } catch (error) {
    env.toast.error(error);
  } finally {
    env.toast.dismiss(progress);
  }
}

/** Sends the text, unless it is empty or an earlier message has not finished. */
function send(env: SteerEnv, text: string): void {
  if (text.trim().length === 0) {
    return;
  }

  void runExclusive(env.sending, () => sendTask(env, text));
}

/** `enter` sends the text, and `esc` leaves the input. */
function handleSteerKey(env: SteerEnv, text: string, key: Key): void {
  if (key.escape) {
    env.onLeave();

    return;
  }

  if (key.return) {
    send(env, text);
  }
}

/**
 * A one-line input under the conversation of a running worker Thread. The text goes to the agent as a steering
 * message through the running factory. The agent gets it after its current tool calls.
 */
export function ThreadSteerInput(props: ThreadSteerInputProps) {
  const { ctx, threadId, name, focused, clickable, width, onFocus, onLeave } = props;
  const toast = useToast();
  const [text, setText] = useState("");
  const sending = useRef(false);
  const ref = useRef<DOMElement>(null);

  const env: SteerEnv = { ctx, threadId, name, toast, sending, setText, onLeave };

  useKeyCapture(focused, { text: false, escape: true });
  useInput((_input, key) => handleSteerKey(env, text, key), { isActive: focused });
  useMouse(ref, { onClick: onFocus }, clickable && !focused);

  return (
    <Box ref={ref} backgroundColor={focused ? theme.fieldFocus : theme.field} paddingX={1} width={width} flexShrink={0}>
      <Text color={focused ? theme.accent : theme.inkFaint}>› </Text>
      <TextInput
        value={text}
        onChange={setText}
        focus={focused}
        width={Math.max(1, width - INPUT_CHROME)}
        placeholder="Send a message to the agent"
      />
    </Box>
  );
}

import type { EventEmitter } from "node:events";
import { render } from "ink";
import type { ReactNode } from "react";
import { RowblyError } from "../services/errors/errors.js";
import type { ToastStore } from "./hooks/index.js";
import { MOUSE_OFF, MOUSE_ON, MouseStdin } from "./mouse.js";

/** Stops mouse reporting, shows the cursor and leaves the alternate screen buffer. Harmless when already restored. */
// `CSI < u` pops the kitty keyboard mode; terminals without it ignore the sequence.
const RESTORE_SEQUENCE = `${MOUSE_OFF}\u001B[<u\u001B[?25h\u001B[?1049l`;

export interface TerminalIo {
  stdin: Pick<NodeJS.ReadStream, "isTTY"> & { setRawMode?(mode: boolean): unknown };
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

/** The parts of `process` the crash guards use, so tests can inject a fake. */
export type GuardedProcess = Pick<NodeJS.Process, "on" | "off" | "exit">;

/**
 * Returns an idempotent function that unmounts Ink and puts the terminal back as it was: cooked
 * mode, visible cursor, primary screen.
 */
function createTerminalCleanup(unmount: () => void, io: TerminalIo): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      unmount();
    } finally {
      if (io.stdin.isTTY) io.stdin.setRawMode?.(false);
      io.stdout.write(RESTORE_SEQUENCE);
    }
  };
}

/**
 * Restores the terminal on SIGINT/SIGTERM and on crashes. An unhandled `RowblyError` rejection
 * becomes a toast instead, because service errors must never crash the app. Returns an uninstaller.
 */
function installCrashGuards(
  cleanup: () => void,
  proc: GuardedProcess,
  io: Pick<TerminalIo, "stderr">,
  toasts: ToastStore,
): () => void {
  const crash = (err: unknown) => {
    cleanup();
    io.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    proc.exit(1);
  };
  const handlers: Record<string, (arg: unknown) => void> = {
    SIGINT: () => {
      cleanup();
      proc.exit(130);
    },
    SIGTERM: () => {
      cleanup();
      proc.exit(143);
    },
    uncaughtException: crash,
    unhandledRejection: (reason: unknown) => (reason instanceof RowblyError ? toasts.error(reason) : crash(reason)),
    exit: cleanup,
  };
  for (const [event, handler] of Object.entries(handlers)) proc.on(event, handler);
  return () => {
    for (const [event, handler] of Object.entries(handlers)) proc.off(event, handler);
  };
}

/**
 * Runs a full-screen Ink app until it exits: the alternate screen, the kitty keyboard protocol where
 * the terminal has it (so `ctrl+enter` reaches Forms), and mouse reporting on a TTY. `app` receives
 * the emitter of mouse events to hand to `TuiProviders`. The terminal is restored on exit, on
 * signals and on crashes.
 */
export async function runFullScreen(
  app: (mouse: EventEmitter | undefined) => ReactNode,
  toasts: ToastStore,
  io: TerminalIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  proc: GuardedProcess = process,
): Promise<void> {
  // On a terminal, clicks are read off stdin before Ink sees it.
  const stdin = io.stdin.isTTY ? new MouseStdin(io.stdin as NodeJS.ReadStream) : undefined;
  const instance = render(app(stdin?.mouse), {
    stdin: (stdin ?? io.stdin) as NodeJS.ReadStream,
    stdout: io.stdout as NodeJS.WriteStream,
    stderr: io.stderr as NodeJS.WriteStream,
    alternateScreen: true,
    kittyKeyboard: { mode: "auto" },
  });
  if (stdin) io.stdout.write(MOUSE_ON);
  const cleanup = createTerminalCleanup(() => instance.unmount(), io);
  const uninstall = installCrashGuards(cleanup, proc, io, toasts);
  try {
    await instance.waitUntilExit();
  } finally {
    cleanup();
    uninstall();
  }
}

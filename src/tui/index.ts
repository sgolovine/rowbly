import { homedir } from 'node:os';
import { render } from 'ink';
import { createElement } from 'react';
import { DataRootNotFoundError, RowblyError } from '../core';
import { createContext, createServices, type RowblyContext } from '../services';
import { App } from './app';
import { createToastStore, type ToastStore, type TuiPlugin } from './hooks';
import { type PluginLoader, withPlugins } from './loadPlugins';
import { MOUSE_OFF, MOUSE_ON, MouseStdin } from './mouse';
import type { Route } from './router';

/** Stops mouse reporting, shows the cursor and leaves the alternate screen buffer. Harmless when already restored. */
// `CSI < u` pops the kitty keyboard mode; terminals without it ignore the sequence.
export const RESTORE_SEQUENCE = `${MOUSE_OFF}\u001B[<u\u001B[?25h\u001B[?1049l`;

export interface TerminalIo {
  stdin: Pick<NodeJS.ReadStream, 'isTTY'> & { setRawMode?(mode: boolean): unknown };
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

/** The parts of `process` the crash guards use, so tests can inject a fake. */
export type GuardedProcess = Pick<NodeJS.Process, 'on' | 'off' | 'exit'>;

/**
 * Returns an idempotent function that unmounts Ink and puts the terminal back as it was: cooked
 * mode, visible cursor, primary screen.
 */
export function createTerminalCleanup(unmount: () => void, io: TerminalIo): () => void {
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
export function installCrashGuards(
  cleanup: () => void,
  proc: GuardedProcess,
  io: Pick<TerminalIo, 'stderr'>,
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

/** `demo` behind `ROWBLY_TUI_DEMO=1`, `setup` without a Data Root, otherwise `home`. */
export function initialRoute(ctx: RowblyContext | null, env: NodeJS.ProcessEnv): Route {
  if (env.ROWBLY_TUI_DEMO === '1') return { screen: 'demo', params: {} };
  return { screen: ctx ? 'home' : 'setup', params: {} };
}

export interface StartTuiOptions {
  io?: TerminalIo;
  proc?: GuardedProcess;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** `--data-root`. Like the default Data Root, a missing one fails instead of opening setup. */
  root?: string;
  /** Loads the Plugins that a Data Root turns on; without it no Plugin runs. */
  loadPlugins?: PluginLoader;
}

/**
 * Runs the full-screen app until the user quits. When `ctx` is omitted it is resolved from the
 * environment; a missing Data Root opens the setup screen instead of failing.
 */
export async function startTui(ctx?: RowblyContext | null, options: StartTuiOptions = {}): Promise<void> {
  const io = options.io ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  const proc = options.proc ?? process;
  const env = options.env ?? process.env;
  const toasts = createToastStore();
  const resolved =
    ctx === undefined ? await resolveContext(env, options.cwd ?? process.cwd(), options.root, toasts) : ctx;
  const plugins: TuiPlugin[] = resolved ? await withPlugins(resolved, options.loadPlugins, toasts) : [];
  const services = resolved ? createServices(resolved) : null;

  // On a terminal, clicks are read off stdin before Ink sees it.
  const stdin = io.stdin.isTTY ? new MouseStdin(io.stdin as NodeJS.ReadStream) : undefined;
  const instance = render(
    createElement(App, {
      ctx: resolved,
      services,
      initial: initialRoute(resolved, env),
      toasts,
      mouse: stdin?.mouse,
      plugins,
      loadPlugins: options.loadPlugins,
    }),
    {
      stdin: (stdin ?? io.stdin) as NodeJS.ReadStream,
      stdout: io.stdout as NodeJS.WriteStream,
      stderr: io.stderr as NodeJS.WriteStream,
      alternateScreen: true,
      // Terminals with the kitty keyboard protocol report `ctrl+enter`, which submits forms.
      kittyKeyboard: { mode: 'auto' },
      // Routing global console output through Ink only makes sense on the real process streams.
      patchConsole: options.io === undefined,
    },
  );
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

/**
 * The demo needs no data. Finding no Data Root routes to setup; a named one (`--data-root`, or the
 * Home Config's default) that is missing fails, so setup never hides it (ADR-0033 §1).
 */
async function resolveContext(
  env: NodeJS.ProcessEnv,
  cwd: string,
  root: string | undefined,
  toasts: ToastStore,
): Promise<RowblyContext | null> {
  if (env.ROWBLY_TUI_DEMO === '1') return null;
  try {
    return await createContext({ cwd, env, home: homedir(), root, warn: (message) => toasts.push('warning', message) });
  } catch (err) {
    if (err instanceof DataRootNotFoundError && !root && err.details.path === undefined) return null;
    throw err;
  }
}

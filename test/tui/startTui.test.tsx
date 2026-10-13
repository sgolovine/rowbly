import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/core';
import {
  createTerminalCleanup,
  type GuardedProcess,
  initialRoute,
  RESTORE_SEQUENCE,
  startTui,
  type TerminalIo,
} from '../../src/tui';
import { createToastStore } from '../../src/tui/hooks';
import { tick } from './helpers';

class FakeStdin extends EventEmitter {
  isTTY = true;
  rawMode: boolean[] = [];
  private data: string | null = null;
  setRawMode(mode: boolean) {
    this.rawMode.push(mode);
  }
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
  type(data: string) {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  }
}

class FakeStream extends EventEmitter {
  columns = 100;
  output = '';
  write = (chunk: string, ...rest: unknown[]) => {
    this.output += chunk;
    const callback = rest.find((arg) => typeof arg === 'function') as (() => void) | undefined;
    callback?.();
    return true;
  };
}

function fakeTerminal() {
  const stdin = new FakeStdin();
  const stdout = new FakeStream();
  const stderr = new FakeStream();
  const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
  const io = { stdin, stdout, stderr } as unknown as TerminalIo;
  return { stdin, stdout, stderr, proc, io, guarded: proc as unknown as GuardedProcess };
}

describe('startTui', () => {
  it('restores the terminal after q', async () => {
    const t = fakeTerminal();
    const done = startTui(null, { io: t.io, proc: t.guarded, env: {} });
    await tick(100);
    expect(t.proc.listenerCount('SIGINT')).toBe(1);
    t.stdin.type('q');
    await done;
    expect(t.stdout.output.endsWith(RESTORE_SEQUENCE)).toBe(true);
    expect(t.stdin.rawMode.at(-1)).toBe(false);
    // Guards are removed once the app has exited.
    expect(t.proc.listenerCount('SIGINT')).toBe(0);
    expect(t.proc.exit).not.toHaveBeenCalled();
  });

  it('restores the terminal and exits 1 after an injected crash', async () => {
    const t = fakeTerminal();
    const done = startTui(null, { io: t.io, proc: t.guarded, env: {} });
    await tick(100);
    t.proc.emit('uncaughtException', new Error('boom'));
    await done;
    expect(t.stdout.output).toContain(RESTORE_SEQUENCE);
    expect(t.stdin.rawMode.at(-1)).toBe(false);
    expect(t.stderr.output).toContain('boom');
    expect(t.proc.exit).toHaveBeenCalledWith(1);
  });

  it('restores the terminal and exits 130 on SIGINT', async () => {
    const t = fakeTerminal();
    const done = startTui(null, { io: t.io, proc: t.guarded, env: {} });
    await tick(100);
    t.proc.emit('SIGINT');
    await done;
    expect(t.stdout.output).toContain(RESTORE_SEQUENCE);
    expect(t.proc.exit).toHaveBeenCalledWith(130);
  });

  it('shows an unhandled RowblyError rejection as a toast instead of crashing', async () => {
    const t = fakeTerminal();
    const done = startTui(null, { io: t.io, proc: t.guarded, env: {} });
    await tick(100);
    t.proc.emit('unhandledRejection', new NotFoundError('board "web" not found'));
    await tick(100);
    expect(t.proc.exit).not.toHaveBeenCalled();
    t.stdin.type('q');
    await done;
    expect(t.stdout.output).toContain('error: board "web" not found');
  });
});

describe('createTerminalCleanup', () => {
  it('runs once even when called repeatedly, and restores even if unmount throws', () => {
    const t = fakeTerminal();
    const cleanup = createTerminalCleanup(() => {
      throw new Error('unmount failed');
    }, t.io);
    expect(cleanup).toThrow('unmount failed');
    cleanup();
    expect(t.stdout.output).toBe(RESTORE_SEQUENCE);
    expect(t.stdin.rawMode).toEqual([false]);
  });
});

describe('initialRoute', () => {
  const ctx = {} as Parameters<typeof initialRoute>[0];
  it('routes to setup without a Data Root, home with one, and demo behind ROWBLY_TUI_DEMO=1', () => {
    expect(initialRoute(null, {}).screen).toBe('setup');
    expect(initialRoute(ctx, {}).screen).toBe('home');
    expect(initialRoute(ctx, { ROWBLY_TUI_DEMO: '1' }).screen).toBe('demo');
    expect(initialRoute(null, { ROWBLY_TUI_DEMO: '1' }).screen).toBe('demo');
  });
});

it('createToastStore keeps the newest three toasts', () => {
  const store = createToastStore();
  for (const n of [1, 2, 3, 4]) store.push('info', `t${n}`);
  expect(store.list().map((t) => t.message)).toEqual(['t2', 't3', 't4']);
});

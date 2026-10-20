import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { type GuardedProcess, RESTORE_SEQUENCE, startTui, type TerminalIo } from '../../src/tui';

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

/** Waits until the app has installed its crash guards and started reading keys (raw mode on). */
async function started(t: ReturnType<typeof fakeTerminal>) {
  await vi.waitFor(
    () => {
      expect(t.proc.listenerCount('SIGINT')).toBe(1);
      expect(t.stdin.rawMode).toContain(true);
    },
    { timeout: 5_000, interval: 20 },
  );
}

describe('startTui', () => {
  it('restores the terminal and exits 1 after an injected crash', async () => {
    const t = fakeTerminal();
    const done = startTui(null, { io: t.io, proc: t.guarded, env: {} });
    await started(t);
    t.proc.emit('uncaughtException', new Error('boom'));
    await done;
    expect(t.stdout.output).toContain(RESTORE_SEQUENCE);
    expect(t.stdin.rawMode.at(-1)).toBe(false);
    expect(t.stderr.output).toContain('boom');
    expect(t.proc.exit).toHaveBeenCalledWith(1);
  });
});

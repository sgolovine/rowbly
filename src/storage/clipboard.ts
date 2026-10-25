import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export type ClipboardImageResult =
  | { bytes: Uint8Array; type: 'image/png' }
  | { reason: 'unsupported' | 'no-display' | 'no-image' | 'too-large' | 'timeout' };
type Failure = Extract<ClipboardImageResult, { reason: string }>;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let nativeLoadFailed = false;

// ADR-0037 §2: synchronous native calls and even loading the binding can crash or hang.
// Keep the child inline so both source execution and the packed bundle use the same program.
const NATIVE_READER = `
import { createWriteStream } from 'node:fs';
const send = (value) => new Promise((resolve) =>
  createWriteStream('', { fd: 3 }).end(JSON.stringify(value), resolve));
let clipboard;
try {
  clipboard = await import('@mariozechner/clipboard');
} catch {
  await send({ reason: 'unsupported', loadFailed: true });
  process.exit(0);
}
try {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    await send({ reason: 'no-display' });
  } else if (!clipboard.hasImage()) {
    await send({ reason: 'no-image' });
  } else {
    const base64 = await clipboard.getImageBase64();
    await send(typeof base64 === 'string' && base64.length > ${MAX_BASE64}
      ? { reason: 'too-large' } : { base64 });
  }
} catch {
  await send({ reason: 'no-display' });
}
process.exit(0);
`;

function png(bytes: Buffer): ClipboardImageResult {
  if (bytes.length > MAX_BYTES) return { reason: 'too-large' };
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { reason: 'unsupported' };
  return { bytes, type: 'image/png' };
}

function readNative(deadline: number): Promise<ClipboardImageResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', NATIVE_READER], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      // Do not inherit loaders or debugging flags into a short-lived native helper.
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    const pipe = child.stdio[3] as Readable;
    const chunks: Buffer[] = [];
    let length = 0;
    let finished = false;
    const finish = (result: ClipboardImageResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      pipe.destroy();
      child.kill('SIGKILL');
      resolve(result);
    };
    const timer = setTimeout(() => finish({ reason: 'timeout' }), Math.max(1, deadline - Date.now()));
    pipe.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BASE64 + 1024) finish({ reason: 'too-large' });
      else chunks.push(chunk);
    });
    pipe.on('error', () => finish({ reason: 'unsupported' }));
    child.on('error', () => finish({ reason: 'unsupported' }));
    child.on('close', (code) => {
      if (finished) return;
      if (code !== 0) return finish({ reason: 'unsupported' });
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object') return finish({ reason: 'unsupported' });
        if ('loadFailed' in value && value.loadFailed === true) nativeLoadFailed = true;
        if ('reason' in value) {
          const reason = value.reason;
          if (reason === 'unsupported' || reason === 'no-display' || reason === 'no-image' || reason === 'too-large')
            return finish({ reason });
        }
        if ('base64' in value && typeof value.base64 === 'string') {
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64) || value.base64.length % 4 === 1)
            return finish({ reason: 'unsupported' });
          return finish(png(Buffer.from(value.base64, 'base64')));
        }
      } catch {
        // A crash or malformed response is an unavailable reader, never a parent failure.
      }
      finish({ reason: 'unsupported' });
    });
  });
}

function wlPaste(args: string[], deadline: number): Promise<Buffer | Failure> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.resolve({ reason: 'timeout' });
  return new Promise((resolve) => {
    execFile(
      'wl-paste',
      args,
      { encoding: 'buffer', timeout: left, killSignal: 'SIGKILL', maxBuffer: MAX_BYTES },
      (error, stdout) => {
        if (!error) resolve(stdout);
        else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve({ reason: 'too-large' });
        else if (error.killed || Date.now() >= deadline) resolve({ reason: 'timeout' });
        else resolve({ reason: error.code === 'ENOENT' ? 'unsupported' : 'no-display' });
      },
    );
  });
}

/** Reads PNG bytes without touching the Data Root or printing. All attempts share a three-second deadline. */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  const deadline = Date.now() + 3000;
  const native = nativeLoadFailed ? ({ reason: 'unsupported' } as const) : await readNative(deadline);
  if (!('reason' in native) || !['unsupported', 'no-display'].includes(native.reason) || !process.env.WAYLAND_DISPLAY)
    return native;
  const types = await wlPaste(['--list-types'], deadline);
  if (!Buffer.isBuffer(types)) return types;
  if (!types.toString('utf8').split(/\r?\n/).includes('image/png')) return { reason: 'no-image' };
  const bytes = await wlPaste(['--type', 'image/png'], deadline);
  return Buffer.isBuffer(bytes) ? png(bytes) : bytes;
}

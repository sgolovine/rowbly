import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { basename } from 'node:path';
import { NotFoundError, UsageError, ValidationError } from '../core';

/** A bounded read of an explicitly chosen external file, before entering an operation. */
export async function readBinaryInput(path: string, maxBytes: number): Promise<{ name: string; bytes: Uint8Array }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 10 * 1024 * 1024)
    throw new ValidationError('binary input limit must be between 1 byte and 10 MiB');
  let file: FileHandle;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`file not found: ${path}`);
    throw error;
  }
  try {
    if (!(await file.stat()).isFile()) throw new ValidationError(`not a regular file: ${path}`);
    const bytes = new Uint8Array(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size > maxBytes) throw new ValidationError(`file exceeds ${maxBytes} bytes: ${path}`);
    return { name: basename(path), bytes: bytes.slice(0, size) };
  } finally {
    await file.close();
  }
}

/** Opens a checked, absolute Plugin file path with the platform's associated application. */
export async function openAssociatedFile(path: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd.exe' : 'xdg-open';
  // Keep the Windows command fixed: the path is expanded once from the environment inside quotes.
  const args = process.platform === 'win32' ? ['/d', '/v:off', '/s', '/c', 'start "" "%ROWBLY_OPEN_FILE%"'] : [path];
  await new Promise<void>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsVerbatimArguments: process.platform === 'win32',
        env: { ...process.env, ROWBLY_OPEN_FILE: path },
      },
      (error) => {
        if (error) reject(new UsageError(`could not open file with ${command}`, { cause: error }));
        else resolve();
      },
    );
  });
}

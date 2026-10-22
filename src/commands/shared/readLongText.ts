import { UsageError } from '../../core';
import { editTextInEditor, readTextFile } from '../../storage';

export interface LongTextFlags {
  text?: string;
  file?: string;
  edit?: boolean;
}

export async function readLongText(
  flags: LongTextFlags,
  { name, initial = '', stdin = process.stdin }: { name: string; initial?: string; stdin?: NodeJS.ReadableStream },
): Promise<string | undefined> {
  const given = [flags.text !== undefined, flags.file !== undefined, Boolean(flags.edit)].filter(Boolean).length;
  if (given > 1) throw new UsageError(`use only one of --${name}, --${name}-file and --edit`);
  if (flags.text !== undefined) return flags.text;
  if (flags.file === '-') return (await readStream(stdin)).trimEnd();
  if (flags.file !== undefined) return (await readTextFile(flags.file)).trimEnd();
  if (flags.edit) return (await editTextInEditor(initial)).trimEnd();
  return undefined;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

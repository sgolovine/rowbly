// Subprocess for textAtomicity.test.ts: `writeText.ts <path> <bytes>` replaces <path> with <bytes>
// characters of "NEW" through `writeTextFile`.
import { writeTextFile } from '../../../src/storage';

const [path, bytes] = process.argv.slice(2);
await writeTextFile(String(path), 'NEW'.repeat(Math.ceil(Number(bytes) / 3)).slice(0, Number(bytes)));

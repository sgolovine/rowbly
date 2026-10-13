import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Builds dist/cli.js once before the suite, so runCli() always exercises the current source. */
export default function setup(): void {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  execFileSync(process.execPath, ['node_modules/tsup/dist/cli-default.js', '--silent'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

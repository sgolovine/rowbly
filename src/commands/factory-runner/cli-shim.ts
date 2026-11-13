import { chmod } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ValidationError } from "../../services/errors/errors.js";
import { writeFileAtomic } from "../../services/files/files.js";
import { prepareRuntime, runtimePath } from "../../services/runtime-files/runtime-files.js";
import { findProject, type ServiceContext } from "../../services/workspace/workspace.js";

/** The Node executable, its flags and the entry file that start this exact version of the CLI. */
export interface LaunchDescriptor {
  executable: string;
  execArgv: string[];
  entry: string;
}

/** Quotes a value for `/bin/sh`, so that spaces, quotes and `$` stay literal. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** The shim script. A call without arguments and without a terminal is an error, not the TUI. */
function shimScript(command: string): string {
  return `#!/bin/sh\nif [ "$#" -eq 0 ] && [ ! -t 0 ]; then\n  echo 'Rowbly factory CLI requires a command' >&2\n  exit 1\nfi\nexec ${command} "$@"\n`;
}

/** Writes `runtime/bin/rowbly`, which runs the same CLI version as this process, and gives its path. */
export async function createCliShim(descriptor: LaunchDescriptor, ctx: ServiceContext = {}): Promise<string> {
  if (!isAbsolute(descriptor.entry) || !isAbsolute(descriptor.executable)) {
    throw new ValidationError("CLI launch paths must be absolute");
  }

  const paths = await findProject(ctx);

  await prepareRuntime(paths);

  const shim = await runtimePath(paths, "bin/rowbly");
  const command = [descriptor.executable, ...descriptor.execArgv, descriptor.entry]
    .map((value) => shellQuote(value))
    .join(" ");

  await writeFileAtomic(shim, shimScript(command), { mode: 0o700, durable: true });
  await chmod(shim, 0o700);

  return shim;
}

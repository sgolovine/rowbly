import { homedir } from 'node:os';
import type { Command } from 'commander';
import { DataRootNotFoundError } from '../../core';
import { printWarnings } from '../../output';
import type { RowblyContext, Services } from '../../services';
import { createContext, createServices } from '../../services';
import { type GlobalOptions, globalOptions } from './globalOptions';
import { pluginsOf } from './pluginsOf';

export interface CommandEnv {
  ctx: RowblyContext;
  services: Services;
  globals: GlobalOptions;
}
export interface OptionalCommandEnv {
  ctx: RowblyContext | null;
  services: Services | null;
  globals: GlobalOptions;
}

export async function runWithContext<T>(
  cmd: Command,
  optional: boolean,
  fn: (env: OptionalCommandEnv) => Promise<T>,
): Promise<T> {
  const globals = globalOptions(cmd);
  const warnings: string[] = [];
  try {
    const ctx = await createContext({
      cwd: process.cwd(),
      env: process.env,
      home: homedir(),
      root: globals.root,
      warn: (message) => warnings.push(message),
      plugins: pluginsOf(cmd)?.host,
    }).catch((err: unknown) => {
      // Only finding no Data Root: a named one that is missing still fails (ADR-0033 §1).
      if (optional && err instanceof DataRootNotFoundError && !globals.root && err.details.path === undefined)
        return null;
      throw err;
    });
    return await fn({ ctx, services: ctx && createServices(ctx), globals });
  } finally {
    printWarnings(warnings, { json: globals.json });
  }
}

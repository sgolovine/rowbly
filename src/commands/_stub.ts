import type { Command } from 'commander';

/** Declares a verb whose action fails with "not implemented" until its work package replaces it. */
export function stubVerb(parent: Command, nameAndArgs: string, description: string, workPackage: string): Command {
  return parent
    .command(nameAndArgs)
    .description(description)
    .allowUnknownOption()
    .action(() => {
      throw new Error(`not implemented: ${workPackage}`);
    });
}

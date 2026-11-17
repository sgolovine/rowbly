import { ValidationError } from "../errors/errors.js";

/** The `dependencies` section of the factory settings. */
export interface Dependencies {
  /** When true, the manager moves a stuck upstream Story out of the first Stage. The default is false. */
  readonly pullUpstream?: boolean;
}

/** The dependency value of `rowbly factory configure`: `on` or `off`. */
export interface DependencyInput {
  readonly pullUpstream?: string;
}

/** Tells if a value is an absent `dependencies` section, or a section with a boolean `pullUpstream`. */
export function validDependencies(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const { pullUpstream } = value as Dependencies;

  return pullUpstream === undefined || typeof pullUpstream === "boolean";
}

/** Tells if the manager moves a stuck upstream Story out of the first Stage. An absent key is false. */
export function pullUpstream(settings: { readonly dependencies?: Dependencies }): boolean {
  return settings.dependencies?.pullUpstream === true;
}

/** Parses `on` or `off`. Other values give a `ValidationError`. */
function parseSwitch(value: string): boolean {
  if (value === "on" || value === "off") {
    return value === "on";
  }

  throw new ValidationError("Use on or off for --pull-upstream", {
    details: { issues: [{ path: ["pullUpstream"], message: "must be on or off" }] },
  });
}

/**
 * Gives the `dependencies` key that the input sets, or no key without a dependency value. A value that is not
 * `on` or `off` gives a `ValidationError`, so a call before the write stops the write.
 */
export function dependencyChange(
  current: Dependencies | undefined,
  input: DependencyInput,
): { readonly dependencies?: Dependencies } {
  if (input.pullUpstream === undefined) {
    return {};
  }

  return { dependencies: { ...current, pullUpstream: parseSwitch(input.pullUpstream) } };
}

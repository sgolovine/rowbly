import { ValidationError } from "../errors/errors.js";

/** One named check of the factory settings. The absent keys have their defaults in `CheckSpec`. */
export interface CheckItem {
  readonly key: string;
  readonly label?: string;
  readonly command: string;
  readonly narrowCommand?: string;
  readonly memoryMb?: number;
  readonly timeoutMinutes?: number;
  readonly block?: readonly string[];
}

/** The `checks` key of the `factory` section of `rowbly.config.json`, as it is on disk. */
export interface CheckSettings {
  readonly maxConcurrent?: number;
  readonly reserveMemoryMb?: number;
  readonly items?: readonly CheckItem[];
}

/** One check with the defaults for the absent keys. */
export interface CheckSpec {
  readonly key: string;
  readonly label: string;
  readonly command: string;
  readonly narrowCommand?: string;
  readonly memoryMb: number;
  readonly timeoutMinutes: number;
  readonly block: readonly string[];
}

/** The `checks` section with the defaults for the absent keys. */
export interface CheckLimits {
  readonly maxConcurrent: number;
  readonly reserveMemoryMb: number;
  readonly items: readonly CheckSpec[];
}

/** The check values of `rowbly factory configure`. */
export interface CheckInput {
  readonly maxChecks?: number;
  readonly checkMemoryReserve?: number;
}

const CHECK_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAX_CONCURRENT_CHECKS = 32;
const MAX_CHECK_TIMEOUT_MINUTES = 240;
export const FILES_PLACEHOLDER = "{files}";
export const DEFAULT_CHECKS = { maxConcurrent: 2, reserveMemoryMb: 2048, memoryMb: 1024, timeoutMinutes: 30 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown): boolean {
  return typeof value === "string" && !!value.trim();
}

function optional(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === undefined || valid(value);
}

function integerIn(min: number, max: number): (value: unknown) => boolean {
  return (value) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function validNarrow(value: unknown): boolean {
  return validText(value) && (value as string).includes(FILES_PLACEHOLDER);
}

function validBlock(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 20 && value.every(validText);
}

/** Tells if a value is one check with a valid key, a command and keys in their ranges. */
function validCheckItem(value: unknown): value is CheckItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.key === "string" &&
    CHECK_KEY_PATTERN.test(value.key) &&
    optional(value.label, validText) &&
    validText(value.command) &&
    optional(value.narrowCommand, validNarrow) &&
    optional(value.memoryMb, integerIn(1, 1_048_576)) &&
    optional(value.timeoutMinutes, integerIn(1, MAX_CHECK_TIMEOUT_MINUTES)) &&
    optional(value.block, validBlock)
  );
}

function validItems(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(validCheckItem)) {
    return false;
  }

  return new Set(value.map((item) => item.key)).size === value.length;
}

/** Tells if a value is a `checks` section: limits in their ranges and items with unique keys. */
export function validChecks(value: unknown): value is CheckSettings {
  if (!isRecord(value)) {
    return false;
  }

  return (
    optional(value.maxConcurrent, integerIn(1, MAX_CONCURRENT_CHECKS)) &&
    optional(value.reserveMemoryMb, integerIn(0, 1_048_576)) &&
    optional(value.items, validItems)
  );
}

/** Gives one check with the defaults for the absent keys. */
function checkSpec(item: CheckItem): CheckSpec {
  return {
    key: item.key,
    label: item.label ?? item.key,
    command: item.command,
    ...(item.narrowCommand ? { narrowCommand: item.narrowCommand } : {}),
    memoryMb: item.memoryMb ?? DEFAULT_CHECKS.memoryMb,
    timeoutMinutes: item.timeoutMinutes ?? DEFAULT_CHECKS.timeoutMinutes,
    block: item.block ?? [],
  };
}

/** Gives the checks with their defaults. Without a `checks` section, there are no checks. */
export function checkLimits(checks: CheckSettings | undefined): CheckLimits | undefined {
  if (!checks) {
    return undefined;
  }

  return {
    maxConcurrent: checks.maxConcurrent ?? DEFAULT_CHECKS.maxConcurrent,
    reserveMemoryMb: checks.reserveMemoryMb ?? DEFAULT_CHECKS.reserveMemoryMb,
    items: (checks.items ?? []).map(checkSpec),
  };
}

/** Tells if the input changes the `checks` section. */
export function hasCheckInput(input: CheckInput): boolean {
  return input.maxChecks !== undefined || input.checkMemoryReserve !== undefined;
}

/** Applies the input to the `checks` section. Other keys stay. The section starts when the input sets a value. */
export function mergeChecks(current: CheckSettings | undefined, input: CheckInput): CheckSettings | undefined {
  if (!hasCheckInput(input)) {
    return current;
  }

  return {
    ...current,
    ...(input.maxChecks !== undefined ? { maxConcurrent: input.maxChecks } : {}),
    ...(input.checkMemoryReserve !== undefined ? { reserveMemoryMb: input.checkMemoryReserve } : {}),
  };
}

/** The hint of a `ValidationError` for a `checks` section that is not valid. */
const CHECKS_HINT =
  `Use 1 to ${MAX_CONCURRENT_CHECKS} for checks.maxConcurrent, lowercase keys, a command for each check, ` +
  `${FILES_PLACEHOLDER} in narrowCommand, and 1 to ${MAX_CHECK_TIMEOUT_MINUTES} for timeoutMinutes`;

/** Throws a `ValidationError` when the `checks` section is not valid. */
export function assertChecks(checks: unknown): void {
  if (checks !== undefined && !validChecks(checks)) {
    throw new ValidationError("Invalid factory checks", { hint: CHECKS_HINT });
  }
}

import { ConflictError, NotFoundError } from "../errors/errors.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type CheckItem, type CheckSettings, type CheckSpec, checkLimits } from "./check-settings.js";
import { type FactorySettings, getFactorySettings, writeSettings } from "./factory-settings.js";

/** The values of a check update. `null` removes an optional key. */
export interface CheckItemChange {
  readonly label?: string | null;
  readonly command?: string;
  readonly narrowCommand?: string | null;
  readonly memoryMb?: number | null;
  readonly timeoutMinutes?: number | null;
  readonly block?: readonly string[] | null;
}

function itemsOf(checks: CheckSettings | undefined): readonly CheckItem[] {
  return checks?.items ?? [];
}

function withItems(settings: FactorySettings, items: readonly CheckItem[]): FactorySettings {
  return { ...settings, checks: { ...settings.checks, items } };
}

/** Applies a change to one item. A `null` value removes the key, and an absent value keeps it. */
function changedItem(item: CheckItem, change: CheckItemChange): CheckItem {
  const merged = { ...item, ...change };
  const entries = Object.entries(merged).filter(([, value]) => value !== null && value !== undefined);

  return Object.fromEntries(entries) as unknown as CheckItem;
}

/** Lists the checks of the Project with their defaults. Without a `checks` section, the list is empty. */
export async function listChecks(ctx: ServiceContext = {}): Promise<readonly CheckSpec[]> {
  return checkLimits((await getFactorySettings(ctx)).checks)?.items ?? [];
}

/** Adds one check. A check with the same key gives a `ConflictError`. The other keys of `factory.json` stay. */
export async function addCheck(item: CheckItem, ctx: ServiceContext = {}): Promise<CheckSpec> {
  const written = await writeSettings((current) => {
    if (itemsOf(current.checks).some((existing) => existing.key === item.key)) {
      throw new ConflictError(`Check already exists: ${item.key}`);
    }

    return withItems(current, [...itemsOf(current.checks), changedItem(item, {})]);
  }, ctx);

  return findSpec(written, item.key);
}

/** Changes the keys of one check. An unknown key gives a `NotFoundError`. */
export async function updateCheck(key: string, change: CheckItemChange, ctx: ServiceContext = {}): Promise<CheckSpec> {
  const written = await writeSettings((current) => {
    const items = itemsOf(current.checks);

    if (!items.some((item) => item.key === key)) {
      throw new NotFoundError(`Unknown check: ${key}`);
    }

    return withItems(
      current,
      items.map((item) => (item.key === key ? changedItem(item, change) : item)),
    );
  }, ctx);

  return findSpec(written, key);
}

/** Removes one check. The `checks` section stays with its limits. An unknown key gives a `NotFoundError`. */
export async function removeCheck(key: string, ctx: ServiceContext = {}): Promise<readonly CheckSpec[]> {
  const written = await writeSettings((current) => {
    const items = itemsOf(current.checks);

    if (!items.some((item) => item.key === key)) {
      throw new NotFoundError(`Unknown check: ${key}`);
    }

    return withItems(
      current,
      items.filter((item) => item.key !== key),
    );
  }, ctx);

  return checkLimits(written.checks)?.items ?? [];
}

function findSpec(settings: FactorySettings, key: string): CheckSpec {
  const spec = checkLimits(settings.checks)?.items.find((item) => item.key === key);

  if (!spec) {
    throw new NotFoundError(`Unknown check: ${key}`);
  }

  return spec;
}

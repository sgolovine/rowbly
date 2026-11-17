import type { FactorySettings, ModelChoice } from "../factory-settings/factory-settings.js";

/** The connection state of the factory to its AI providers. */
export type Connectivity = "online" | "degraded" | "offline";

/** The text and codes of an error that show a lost connection to a provider. */
const CONNECTIVITY_PATTERN =
  /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|network error|connection error|terminated/i;

/** The text of a quota or an authentication error. These errors have their own pause. */
const QUOTA_PATTERN = /quota|usage.limit|billing|429/i;
const AUTH_PATTERN = /oauth|unauthorized|authentication|401/i;

/** The limit of nested causes that the classification reads. A cycle of causes stops at this limit. */
const CAUSE_DEPTH = 5;

const MINUTE = 60_000;
const FIRST_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 15;

/** Gives the message and the code of an error, and of each nested `cause`. */
function errorTexts(error: unknown, depth = 0): string[] {
  if (depth >= CAUSE_DEPTH || typeof error !== "object" || error === null) {
    return typeof error === "string" ? [error] : [];
  }

  const { message, code, cause } = error as { message?: unknown; code?: unknown; cause?: unknown };
  const own = [message, code].filter((value): value is string => typeof value === "string");

  return [...own, ...errorTexts(cause, depth + 1)];
}

/** Tells if an error shows a quota problem. */
export function isQuotaError(error: unknown): boolean {
  return QUOTA_PATTERN.test(error instanceof Error ? error.message : "");
}

/** Tells if an error shows an authentication problem. */
export function isAuthenticationError(error: unknown): boolean {
  return AUTH_PATTERN.test(error instanceof Error ? error.message : "");
}

/**
 * Tells if an error shows a lost connection to a provider: a network code or text in the error or in a nested
 * `cause`. A quota or an authentication error is not a connectivity error.
 */
export function isConnectivityError(error: unknown): boolean {
  if (isQuotaError(error) || isAuthenticationError(error)) {
    return false;
  }

  return errorTexts(error).some((text) => CONNECTIVITY_PATTERN.test(text));
}

/** Gives the delay of a network pause: 1 minute for the first pause in a row, then double, to a maximum of 15. */
export function networkPauseDelay(failures: number): number {
  const minutes = Math.min(FIRST_DELAY_MINUTES * 2 ** Math.max(0, failures - 1), MAX_DELAY_MINUTES);

  return minutes * MINUTE;
}

/** Gives the providers of the supervisor model, the worker model, the worker overrides and the tag rules. */
export function configuredProviders(settings: FactorySettings): string[] {
  const stageModels = Object.values(settings.stageWorkerModels ?? {});
  const storyModels = Object.values(settings.storyWorkerModels ?? {}).flatMap((stages) => Object.values(stages));
  const tagModels = Object.values(settings.tagWorkerModels ?? {});
  const overrides = [...stageModels, ...storyModels, ...tagModels];
  const models = [settings.supervisorModel, settings.workerModel, ...overrides].filter(
    (model): model is ModelChoice => !!model,
  );

  return [...new Set(models.map((model) => model.provider))];
}

/**
 * Gives the connectivity of the factory: `offline` when each configured provider has a network pause,
 * `degraded` when one or more has a network pause, else `online`.
 */
export function connectivityOf(
  settings: FactorySettings,
  providers: ReadonlyMap<string, { readonly reason: string }>,
): Connectivity {
  const configured = configuredProviders(settings);
  const paused = configured.filter((provider) => providers.get(provider)?.reason === "network");

  if (paused.length === 0) {
    return "online";
  }

  return paused.length === configured.length ? "offline" : "degraded";
}

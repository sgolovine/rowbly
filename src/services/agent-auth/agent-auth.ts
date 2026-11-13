import type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ValidationError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import { getDeviceId } from "../known-project/known-project.js";
import { createFactoryRuntime } from "../pi-runtime/factory-runtime.js";
import { Store } from "../store/store.js";
import type { ServiceContext } from "../workspace/workspace.js";

export type { AuthInteraction, AuthType } from "@earendil-works/pi-ai";

export type AuthRuntime = Pick<
  ModelRuntime,
  "getProviders" | "listCredentials" | "getAvailable" | "login" | "logout" | "settleCredentialWrites"
>;

// One login at a time for this process, because Pi prompts in the same terminal.
const login = new Store<{ active: boolean }>({ active: false });

/** Creates the Pi runtime that holds the credentials. */
export async function authRuntime(): Promise<AuthRuntime> {
  return (await createFactoryRuntime()).runtime;
}

/** Lists the providers and the login methods of each provider. */
export async function listProviders(runtime: AuthRuntime) {
  return runtime.getProviders().map((p) => ({
    id: p.id,
    methods: [...(p.auth.oauth ? ["oauth" as const] : []), ...(p.auth.apiKey?.login ? ["api_key" as const] : [])],
  }));
}

/** Lists the providers with their configured status. It does not check the health of a credential. */
export async function getAuthStatus(runtime: AuthRuntime) {
  const credentials = await runtime.listCredentials();
  const available = (await Promise.all(runtime.getProviders().map((p) => runtime.getAvailable(p.id)))).flat();
  return (await listProviders(runtime)).map((p) => ({
    ...p,
    configured: available.some((m) => m.provider === p.id),
    credentialType: credentials.find((c) => c.providerId === p.id)?.type,
    health: "unverified" as const,
  }));
}

/** Lists the configured models and the thinking levels of each model. */
export async function listAvailableModels(runtime: AuthRuntime, provider?: string) {
  const { getSupportedThinkingLevels } = await import("../pi-runtime/model-catalog.js");

  return (await runtime.getAvailable(provider)).map((m) => ({
    provider: m.provider,
    modelId: m.id,
    name: m.name,
    thinkingLevels: getSupportedThinkingLevels(m),
  }));
}

/** Gives the choice when the model is available and supports the thinking level. */
export async function validateModelChoice(runtime: AuthRuntime, choice: ModelChoice): Promise<ModelChoice> {
  const model = (await listAvailableModels(runtime, choice.provider)).find((m) => m.modelId === choice.modelId);

  if (!model) {
    throw new ValidationError(`Model unavailable: ${choice.provider}/${choice.modelId}`);
  }

  if (choice.thinkingLevel && !model.thinkingLevels.includes(choice.thinkingLevel)) {
    throw new ValidationError("The model does not support this thinking level");
  }

  return choice;
}

async function runLogin(
  runtime: AuthRuntime,
  provider: string,
  type: AuthType,
  interaction: AuthInteraction,
  ctx: ServiceContext,
): Promise<{ provider: string; type: AuthType }> {
  const deviceId = await getDeviceId(ctx);

  try {
    await runtime.login(provider, type, interaction, { agentName: "rowbly", getDeviceId: () => deviceId });

    return { provider, type };
  } catch {
    throw new ValidationError("Provider login did not complete", { hint: "Retry login in an interactive terminal." });
  } finally {
    await runtime.settleCredentialWrites().catch(() => {});
  }
}

/** Keeps credentials and credential-bearing errors inside the runtime boundary. */
export async function loginProvider(
  runtime: AuthRuntime,
  provider: string,
  type: AuthType,
  interaction: AuthInteraction,
  ctx: ServiceContext = {},
): Promise<{ provider: string; type: AuthType }> {
  if (login.current.active) {
    throw new ValidationError("Another login is active");
  }

  if (!(await listProviders(runtime)).find((p) => p.id === provider)?.methods.includes(type)) {
    throw new ValidationError("Provider does not support this login method");
  }

  login.update(() => ({ active: true }));

  try {
    return await runLogin(runtime, provider, type, interaction, ctx);
  } finally {
    login.update(() => ({ active: false }));
  }
}

/** Removes the stored credential of a provider. */
export async function logoutProvider(runtime: AuthRuntime, provider: string): Promise<{ provider: string }> {
  try {
    await runtime.logout(provider);

    return { provider };
  } catch {
    throw new ValidationError("Provider logout did not complete");
  } finally {
    await runtime.settleCredentialWrites().catch(() => {});
  }
}

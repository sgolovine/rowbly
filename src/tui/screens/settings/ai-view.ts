import type { getAuthStatus, listAvailableModels } from "../../../services/agent-auth/agent-auth.js";
import type { CheckSpec, FactorySettings, ModelChoice } from "../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { KeyHint } from "../../keymap.js";

/** The factory role of a model choice. */
export type Role = "supervisor" | "worker";

/** An AI provider of Pi with its sign-in methods and its status. */
export type AiProvider = Awaited<ReturnType<typeof getAuthStatus>>[number];

/** The task on top of the AI settings, or `null` for none. */
export type AiTask =
  | { readonly kind: "signIn" }
  | { readonly kind: "signOut" }
  | { readonly kind: "model"; readonly role: Role }
  | { readonly kind: "stageModel"; readonly stage: Stage }
  | { readonly kind: "limit" }
  | { readonly kind: "checkLimits" }
  /** Adds a check, or edits the check that it names. */
  | { readonly kind: "check"; readonly check?: CheckSpec }
  | { readonly kind: "removeCheck"; readonly check: CheckSpec }
  | null;

/** The providers and the models that the AI settings show. */
export interface AiStatus {
  readonly providers: readonly AiProvider[];
  readonly models: Awaited<ReturnType<typeof listAvailableModels>>;
}

/** One provider row: its status, from its stored credential or from a key in the environment. */
export function providerStatus(provider: { configured: boolean; credentialType?: string }): string {
  if (provider.credentialType === "oauth") {
    return "signed in with an account";
  }

  if (provider.credentialType === "api_key") {
    return "signed in with an API key";
  }

  if (provider.configured) {
    return "configured outside Rowbly";
  }

  return "not signed in";
}

/** `provider/model`, with its thinking level, or `Pi default`. */
export function modelText(choice: ModelChoice | undefined): string {
  if (!choice) {
    return "Pi default";
  }

  return `${choice.provider}/${choice.modelId}${choice.thinkingLevel ? ` · thinking ${choice.thinkingLevel}` : ""}`;
}

/** The text of a Stage without an override: the worker model applies. */
const WORKER_MODEL_TEXT = "Worker model";

/** One row for each Stage: its worker model override, or the worker model when it has none. */
export function stageModelItems(settings: FactorySettings | undefined, stages: readonly Stage[]) {
  return stages.map((stage) => {
    const override = settings?.stageWorkerModels?.[stage.key];

    return { stage, value: override ? modelText(override) : WORKER_MODEL_TEXT, inherited: !override };
  });
}

/** Where the sign-in keeps its credentials, under the provider lists. */
export const SIGN_IN_NOTE =
  "The sign-in is for this computer. Pi keeps the credentials; the Project keeps no secret. A configured provider is not a check of the account.";

/** The page of the AI settings: a tab, or the page that signs in to another provider under the Providers tab. */
export type AiPage = "providers" | "addProvider" | "models" | "limits" | "checks";

/** The tabs of the AI settings, in order. */
export const AI_TABS: readonly { readonly page: AiPage; readonly label: string }[] = [
  { page: "providers", label: "Providers" },
  { page: "models", label: "Models" },
  { page: "limits", label: "Limits" },
  { page: "checks", label: "Checks" },
];

/** The index of the tab of a page. The sign-in page is under the Providers tab. */
export function tabIndex(page: AiPage): number {
  return Math.max(
    0,
    AI_TABS.findIndex((tab) => tab.page === page),
  );
}

/** The tab next to the tab of a page, with a wrap at the ends. */
export function nextTab(page: AiPage, delta: number): AiPage {
  const count = AI_TABS.length;

  return AI_TABS[(tabIndex(page) + delta + count) % count]?.page ?? "providers";
}

/** True when Pi can use the provider: it has a stored credential, or a key in the environment. */
function isSignedIn(provider: { configured: boolean; credentialType?: string }): boolean {
  return provider.configured || provider.credentialType !== undefined;
}

/** The providers of a page: the signed-in providers, or the other providers on the sign-in page. */
export function pageProviders(page: AiPage, providers: readonly AiProvider[]): readonly AiProvider[] {
  if (page === "providers") {
    return providers.filter(isSignedIn);
  }

  if (page === "addProvider") {
    return providers.filter((provider) => !isSignedIn(provider));
  }

  return [];
}

/** What works now on the page of the AI settings. */
export interface AiAbilities {
  readonly idle: boolean;
  readonly list: boolean;
  readonly signIn: boolean;
  readonly signOut: boolean;
  readonly ready: boolean;
  /** The Models tab has Stages to select. */
  readonly stages?: boolean;
  /** The Checks tab has checks to select. */
  readonly checks?: boolean;
}

const TAB_HINT: KeyHint = { key: "←/→", description: "tab" };

function listHints(can: AiAbilities): KeyHint[] {
  if (!can.list) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "/", description: "filter" },
  ];
}

function providersHints(can: AiAbilities): KeyHint[] {
  return [
    ...listHints(can),
    ...(can.signOut ? [{ key: "d", description: "sign out" }] : []),
    ...(can.ready ? [{ key: "n", description: "sign in to another provider" }] : []),
    { key: "r", description: "reload" },
    TAB_HINT,
  ];
}

function addProviderHints(can: AiAbilities): KeyHint[] {
  return [
    ...listHints(can),
    ...(can.signIn ? [{ key: "enter", description: "sign in" }] : []),
    { key: "esc", description: "back to providers" },
  ];
}

function modelsHints(can: AiAbilities): KeyHint[] {
  return [
    ...(can.ready
      ? [
          { key: "s", description: "change supervisor model" },
          { key: "w", description: "change worker model" },
        ]
      : []),
    ...(can.ready && can.stages
      ? [
          { key: "↑/↓", description: "select Stage" },
          { key: "enter", description: "change Stage model" },
        ]
      : []),
    TAB_HINT,
  ];
}

function checksHints(can: AiAbilities): KeyHint[] {
  return [
    ...(can.checks
      ? [
          { key: "↑/↓", description: "select" },
          { key: "enter", description: "edit" },
          { key: "d", description: "remove" },
        ]
      : []),
    { key: "n", description: "add check" },
    { key: "c", description: "check limits" },
    TAB_HINT,
  ];
}

/** The keys of the page of the AI settings that work now. */
export function aiHints(page: AiPage, can: AiAbilities): KeyHint[] {
  if (!can.idle) {
    return [];
  }

  if (page === "addProvider") {
    return addProviderHints(can);
  }

  if (page === "models") {
    return modelsHints(can);
  }

  if (page === "checks") {
    return checksHints(can);
  }

  if (page === "limits") {
    return [{ key: "l", description: "edit worker limit" }, TAB_HINT];
  }

  return providersHints(can);
}

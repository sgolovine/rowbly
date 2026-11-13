import type { getAuthStatus, listAvailableModels } from "../../../services/agent-auth/agent-auth.js";
import type { ModelChoice } from "../../../services/factory-settings/factory-settings.js";
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
  | { readonly kind: "limit" }
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

/** The keys of the AI settings that work now. */
export function aiHints(can: {
  readonly idle: boolean;
  readonly list: boolean;
  readonly signIn: boolean;
  readonly signOut: boolean;
  readonly ready: boolean;
}): KeyHint[] {
  if (!can.idle) {
    return [];
  }

  return [
    ...(can.list
      ? [
          { key: "↑/↓", description: "select" },
          { key: "/", description: "filter" },
        ]
      : []),
    ...(can.signIn ? [{ key: "enter", description: "sign in" }] : []),
    ...(can.signOut ? [{ key: "d", description: "sign out" }] : []),
    ...(can.ready
      ? [
          { key: "s", description: "supervisor model" },
          { key: "w", description: "worker model" },
        ]
      : []),
    { key: "l", description: "worker limit" },
    { key: "r", description: "reload" },
  ];
}

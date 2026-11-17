import type { AuthInteraction } from "../../../services/agent-auth/agent-auth.js";

/** A question of the provider. */
export type AuthPrompt = Parameters<AuthInteraction["prompt"]>[0];

/** A message of the provider: a URL, a device code, information or progress. */
export type AuthEvent = Parameters<AuthInteraction["notify"]>[0];

/** A prompt of the provider that waits for the user. */
export interface Pending {
  readonly prompt: AuthPrompt;
  resolve(value: string): void;
}

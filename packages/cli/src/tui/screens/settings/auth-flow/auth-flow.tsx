import { Box, Text } from "ink";
import type { AuthRuntime, AuthType } from "../../../../services/agent-auth/agent-auth.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Modal, SelectList } from "../../../components/index.js";
import { ActiveContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { AuthEventView } from "../auth-event/index.js";
import { AuthPromptView } from "../auth-prompt/index.js";
import { useAuthFlow } from "./use-auth-flow.js";

/** The words of each sign-in method. */
const METHODS: Readonly<Record<AuthType, string>> = { oauth: "Sign in with an account", api_key: "Enter an API key" };

/**
 * The sign-in of one AI provider, in a generic Modal over the AI settings. It first asks for the method when
 * the provider has two. Then Pi runs the sign-in, and the Modal shows its messages: a URL to open, a device
 * code, information and progress. It asks the questions of the provider: text, a secret (each character
 * shows as `•`), a code or a choice. A prompt that the provider cancels, for example a manual code after the
 * browser callback, goes away. `esc` cancels the sign-in. The URL, the code and the typed text stay in this
 * Modal only, and go away when it closes. Pi keeps the credentials in its own store.
 */
export function AuthFlow({
  ctx,
  runtime,
  provider,
  methods,
  onDone,
}: {
  ctx: ServiceContext;
  runtime: AuthRuntime;
  provider: string;
  methods: readonly AuthType[];
  /** The sign-in ended: `true` when it completed. */
  onDone(signedIn: boolean): void;
}) {
  const model = useAuthFlow({ ctx, runtime, provider, methods, onDone });

  const { active, method, events, pending } = model;

  return (
    <Modal title={`AI › Sign in › ${provider}`} hints={model.hints} onClose={model.cancel}>
      <Box flexDirection="column" gap={1}>
        {!method && (
          <>
            <Text color={theme.inkMuted}>Select how to sign in.</Text>
            <ActiveContext.Provider value={active}>
              <SelectList
                items={methods.map((value) => ({ value, label: METHODS[value] }))}
                onSelect={(item) => model.setMethod(item.value)}
              />
            </ActiveContext.Provider>
          </>
        )}
        {method && events.length === 0 && !pending && <Text color={theme.inkFaint}>Starting the sign-in…</Text>}
        {events.map((event, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages have no identity beyond their order.
          <AuthEventView key={i} event={event} />
        ))}
        {pending && (
          <AuthPromptView
            pending={pending}
            text={model.text}
            onText={model.setText}
            width={Math.max(20, model.layout.width)}
            active={active}
          />
        )}
      </Box>
    </Modal>
  );
}

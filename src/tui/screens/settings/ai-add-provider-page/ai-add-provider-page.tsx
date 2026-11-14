import { Box, Text } from "ink";
import { Button } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiProviders } from "../ai-providers/index.js";
import { type AiProvider, SIGN_IN_NOTE } from "../ai-view.js";

/** The props of `AiAddProviderPage`. */
export interface AiAddProviderPageProps {
  /** False when Pi or the providers did not load. */
  readonly ready: boolean;
  /** The providers that are not signed in. */
  readonly providers: readonly AiProvider[];
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  readonly canSignIn: boolean;
  /** The rows of the terminal, for the length of the list. */
  readonly height: number | undefined;
  readonly onHighlight: (id: string | undefined) => void;
  readonly onFilteringChange: (filtering: boolean) => void;
  /** `enter` or a click on a provider. */
  readonly onPick: (id: string) => void;
  readonly onSignIn: () => void;
  readonly onBack: () => void;
}

/** The page under the Providers tab that signs in to a provider that Pi cannot use yet. */
export function AiAddProviderPage(props: AiAddProviderPageProps) {
  const { idle, canSignIn } = props;

  return (
    <Box flexDirection="column" gap={1}>
      <AiProviders
        title="Sign in to another provider"
        emptyText="All providers are signed in."
        loading={false}
        ready={props.ready}
        providers={props.providers}
        idle={idle}
        height={props.height}
        onHighlight={props.onHighlight}
        onSelect={props.onPick}
        onFilteringChange={props.onFilteringChange}
      />
      <Box flexWrap="wrap" gap={1}>
        {canSignIn && (
          <Button label="Sign in" keyName="enter" compact primary clickable={idle} onClick={props.onSignIn} />
        )}
        <Button label="Back" keyName="esc" compact clickable={idle} onClick={props.onBack} />
      </Box>
      <Text color={theme.inkFaint} wrap="wrap">
        {SIGN_IN_NOTE}
      </Text>
    </Box>
  );
}

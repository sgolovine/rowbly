import { Box, Text } from "ink";
import { Button } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiProviders } from "../ai-providers/index.js";
import { type AiProvider, SIGN_IN_NOTE } from "../ai-view.js";

/** The props of `AiProvidersPage`. */
export interface AiProvidersPageProps {
  readonly loading: boolean;
  /** False when Pi or the providers did not load. */
  readonly ready: boolean;
  /** The signed-in providers. */
  readonly providers: readonly AiProvider[];
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  readonly canSignOut: boolean;
  /** The rows of the terminal, for the length of the list. */
  readonly height: number | undefined;
  readonly onHighlight: (id: string | undefined) => void;
  readonly onFilteringChange: (filtering: boolean) => void;
  /** Opens the page that signs in to another provider. */
  readonly onAddProvider: () => void;
  readonly onSignOut: () => void;
  readonly onReload: () => void;
}

/**
 * The Providers tab: the providers that Pi can use now, at the top. Under the list, a link opens the page that
 * signs in to another provider.
 */
export function AiProvidersPage(props: AiProvidersPageProps) {
  const { ready, idle, canSignOut } = props;

  return (
    <Box flexDirection="column" gap={1}>
      <AiProviders
        title="Signed in"
        emptyText="No provider is signed in."
        loading={props.loading}
        ready={ready}
        providers={props.providers}
        idle={idle}
        height={props.height}
        onHighlight={props.onHighlight}
        onFilteringChange={props.onFilteringChange}
      />
      {ready && (
        <Box>
          <Button
            label="+ Sign in to another provider"
            keyName="n"
            compact
            primary
            clickable={idle}
            onClick={props.onAddProvider}
          />
        </Box>
      )}
      <Box flexWrap="wrap" gap={1}>
        {canSignOut && (
          <Button label="Sign out" keyName="d" compact destructive clickable={idle} onClick={props.onSignOut} />
        )}
        <Button label="Reload" keyName="r" compact clickable={idle} onClick={props.onReload} />
      </Box>
      <Text color={theme.inkFaint} wrap="wrap">
        {SIGN_IN_NOTE}
      </Text>
    </Box>
  );
}

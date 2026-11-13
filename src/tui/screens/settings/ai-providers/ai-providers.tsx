import { Box, Text } from "ink";
import { Loading, SelectList } from "../../../components/index.js";
import { ActiveContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { type AiProvider, providerStatus } from "../ai-view.js";

/** The props of `AiProviders`. */
export interface AiProvidersProps {
  readonly loading: boolean;
  /** False when Pi or the providers did not load. */
  readonly ready: boolean;
  readonly providers: readonly AiProvider[];
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  /** The rows of the terminal, for the length of the list. */
  readonly height: number | undefined;
  readonly onHighlight: (id: string | undefined) => void;
  readonly onSelect: (id: string) => void;
  readonly onFilteringChange: (filtering: boolean) => void;
}

/** The rows of the list that fit next to the rest of the section, from one to eight. */
function listLimit(height: number | undefined): number {
  return Math.max(1, Math.min(8, (height ?? 24) - 12));
}

/** The AI providers of Pi with their status. `enter` on a provider starts its sign-in. */
export function AiProviders(props: AiProvidersProps) {
  const { loading, ready, providers, idle, height } = props;

  if (loading) {
    return <Loading label="Loading the AI providers…" />;
  }

  if (!ready) {
    return <Text color={theme.inkFaint}>Rowbly cannot load the AI providers. Press r to try again.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>Providers</Text>
      <ActiveContext.Provider value={idle}>
        <SelectList
          items={providers.map((p) => ({ value: p.id, label: p.id, description: providerStatus(p) }))}
          emptyText="Pi has no AI providers."
          limit={listLimit(height)}
          onHighlight={(item) => props.onHighlight(item?.value)}
          onSelect={(item) => props.onSelect(item.value)}
          onFilteringChange={props.onFilteringChange}
        />
      </ActiveContext.Provider>
    </Box>
  );
}

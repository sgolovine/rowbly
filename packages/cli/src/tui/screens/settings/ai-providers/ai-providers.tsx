import { Box, Text } from "ink";
import { Loading, SelectList } from "../../../components/index.js";
import { ActiveContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { type AiProvider, providerStatus } from "../ai-view.js";

/** The props of `AiProviders`. */
export interface AiProvidersProps {
  /** The heading over the list. */
  readonly title: string;
  readonly emptyText: string;
  readonly loading: boolean;
  /** False when Pi or the providers did not load. */
  readonly ready: boolean;
  readonly providers: readonly AiProvider[];
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  /** The rows of the terminal, for the length of the list. */
  readonly height: number | undefined;
  readonly onHighlight: (id: string | undefined) => void;
  /** `enter` or a click on a provider. Without it, the list only highlights. */
  readonly onSelect?: (id: string) => void;
  readonly onFilteringChange: (filtering: boolean) => void;
}

/** The rows of the list that fit next to the rest of the page, from one to twelve. */
function listLimit(height: number | undefined): number {
  return Math.max(1, Math.min(12, (height ?? 24) - 11));
}

/** A list of AI providers of Pi with their status, under a heading. */
export function AiProviders(props: AiProvidersProps) {
  const { title, emptyText, loading, ready, providers, idle, height, onSelect } = props;

  if (loading) {
    return <Loading label="Loading the AI providers…" />;
  }

  if (!ready) {
    return <Text color={theme.inkFaint}>Rowbly cannot load the AI providers. Press r to try again.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.inkMuted}>{title}</Text>
      <ActiveContext.Provider value={idle}>
        <SelectList
          items={providers.map((p) => ({ value: p.id, label: p.id, description: providerStatus(p) }))}
          emptyText={emptyText}
          limit={listLimit(height)}
          onHighlight={(item) => props.onHighlight(item?.value)}
          onSelect={onSelect ? (item) => onSelect(item.value) : undefined}
          onFilteringChange={props.onFilteringChange}
        />
      </ActiveContext.Provider>
    </Box>
  );
}

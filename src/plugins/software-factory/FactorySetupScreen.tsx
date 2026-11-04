import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  theme,
  useAsync,
  useIsActive,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import { type SetupResult, setupFactory } from './setup';

const STAGE_TEXT = { added: 'added', present: 'kept', custom: 'kept with its own name' } as const;
const PROMPT_TEXT = { added: 'added', kept: 'kept', skipped: 'skipped' } as const;

/**
 * Sets up the context's Board for a software factory on request (ADR-0053 §2): adds the factory Stages
 * and default Stage Prompts it lacks, then lists what it added, kept and skipped. A host that draws it
 * inline can pass `params.onSetUp`, called after a successful run.
 */
export function FactorySetupScreen({ params, plugin, ui }: PluginScreenProps) {
  const active = useIsActive();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const board = useAsync(
    async () => (typeof params.boardId === 'string' ? params.boardId : await plugin.services.context.resolveBoard()),
    [plugin, params.boardId],
  );
  useKeyHints(active && board.data && !busy && !result ? [{ key: 'enter', description: 'set up Board' }] : []);
  if (board.loading && !board.data) return <Loading />;
  if (!board.data) return <Text color={theme.danger}>Choose a Board first.</Text>;
  const id = board.data;
  const run = async () => {
    setBusy(true);
    try {
      const done = await setupFactory(plugin, id);
      setResult(done);
      ui.toast(`Set up Board ${id} for a software factory`);
      // Onboarding, which shows this screen inline, marks its Factory setup step done (ADR-0057).
      if (typeof params.onSetUp === 'function') params.onSetUp();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Adds the Stages TODO, In Progress and In Review where Board {id} has none, and a default Stage Prompt for each
        of them that has no Stage Prompt yet. In Progress and In Review are turned on; TODO stays off until you turn it
        on.
      </Text>
      <Text color={theme.inkMuted}>
        Existing Stages keep their names and order. Stage Prompts of the Board or the global level and their files are
        never replaced.
      </Text>
      {result ? (
        <Box flexDirection="column">
          {result.stages.map((s) => (
            <Text key={`stage-${s.key}`}>
              Stage {s.name}: <Text color={theme.inkMuted}>{STAGE_TEXT[s.outcome]}</Text>
            </Text>
          ))}
          {result.prompts.map((p) => (
            <Text key={`prompt-${p.key}`}>
              Stage Prompt {p.key}:{' '}
              <Text color={theme.inkMuted}>
                {PROMPT_TEXT[p.outcome]}
                {p.reason ? ` (${p.reason})` : p.source ? ` · ${p.source} · ${p.enabled ? 'on' : 'off'}` : ''}
              </Text>
            </Text>
          ))}
        </Box>
      ) : busy ? (
        <Loading label="Setting up…" />
      ) : (
        <SelectList
          items={[{ value: 'setup', label: `Set up Board ${id}` }]}
          onSelect={() => void run()}
          isActive={active}
        />
      )}
    </Box>
  );
}

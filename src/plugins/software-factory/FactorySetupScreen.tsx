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
  useRef,
  useState,
} from '../../plugin-api/tui';
import { type SetupResult, setupFactory } from './setup';

const STAGE_TEXT = { added: 'added', present: 'kept', custom: 'kept with its own name' } as const;
const PROMPT_TEXT = { added: 'added', kept: 'kept', skipped: 'skipped' } as const;

/** Explicit factory setup, with onboarding's default/minimal choices and a result retained by its host. */
export function FactorySetupScreen({ params, plugin, ui }: PluginScreenProps) {
  const active = useIsActive();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(
    typeof params.result === 'object' && params.result !== null ? (params.result as SetupResult) : null,
  );
  const started = useRef(false);
  const board = useAsync(
    async () => (typeof params.boardId === 'string' ? params.boardId : await plugin.services.context.resolveBoard()),
    [plugin, params.boardId],
  );
  const onboarding = typeof params.onEdit === 'function';
  const run = async (id: string, prompts: 'default' | 'minimal') => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    try {
      const done = await setupFactory(plugin, id, prompts);
      setResult(done);
      ui.toast(`Set up Board ${id} for a software factory`);
      if (typeof params.onSetUp === 'function') await params.onSetUp(done, prompts);
    } catch (err) {
      ui.error(err);
    } finally {
      started.current = false;
      setBusy(false);
    }
  };
  useKeyHints(active && board.data && !busy ? [{ key: 'enter', description: 'choose' }] : []);
  if (board.loading && !board.data) return <Loading />;
  if (!board.data) return <Text color={theme.danger}>Choose a Board first.</Text>;
  const id = board.data;
  return (
    <Box flexDirection="column" gap={1}>
      {onboarding && (
        <Text>
          A Stage Prompt tells an agent what to do with a Story when it enters a Stage. A supervising agent (the
          rowbly-factory skill) starts a worker for each Story that arrives in a Stage whose Stage Prompt is on.
        </Text>
      )}
      <Text>
        Adds the factory Stages TODO, In Progress and In Review that Board {id} lacks. Existing Stages keep their names
        and order; existing Stage Prompts and files are never replaced.
      </Text>
      {onboarding ? (
        <>
          <Text color={theme.inkMuted}>
            Default prompts are pre-built instructions written by the Rowbly team: In Progress and In Review on, TODO
            off. Minimal prompts are placeholders to edit later, all off. Edit Stage Prompts at any time here or in
            Settings › Stage Prompts.
          </Text>
          <SelectList
            items={[
              { value: 'default', label: 'Populate Stage Prompts with default prompts' },
              { value: 'minimal', label: 'Populate Stage Prompts with minimal prompts' },
              { value: 'edit', label: 'Edit Stage Prompts' },
            ]}
            onSelect={(item) => {
              if (item.value === 'edit') {
                if (typeof params.onEdit === 'function') params.onEdit();
              } else void run(id, item.value === 'minimal' ? 'minimal' : 'default');
            }}
            isActive={active && !busy}
          />
        </>
      ) : !result && !busy ? (
        <SelectList
          items={[{ value: 'setup', label: `Set up Board ${id}` }]}
          onSelect={() => void run(id, params.prompts === 'minimal' ? 'minimal' : 'default')}
          isActive={active && !busy}
        />
      ) : null}
      {busy && <Loading label="Setting up…" />}
      {result && (
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
      )}
    </Box>
  );
}

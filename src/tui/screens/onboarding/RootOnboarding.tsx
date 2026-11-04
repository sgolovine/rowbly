import { Box, Text, useInput } from 'ink';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { keyPrefixFromName, slugFromName, UsageError } from '../../../core';
import { Form, Loading, SelectList, Tabs } from '../../components';
import {
  ActiveContext,
  ShellContext,
  useAsync,
  useIsActive,
  useKeyHints,
  usePlugins,
  useReloadOnReturn,
  useServices,
  useToast,
} from '../../hooks';
import type { KeyHint } from '../../keymap';
import { theme } from '../../theme';
import { OnboardingNav } from './OnboardingNav';
import { OnboardingPluginStep } from './OnboardingPluginStep';
import {
  completedSteps,
  firstIncomplete,
  type Mode,
  ONBOARDING_STEPS,
  type StepId,
  visibleSteps,
} from './onboardingSteps';
import { SkillInstall } from './SkillInstall';

const MODE_LABEL: Record<Mode, string> = { kanban: 'Plain Kanban', factory: 'Software Factory', both: 'Both' };
const NAV_HINT: KeyHint = { key: 'shift+←/→', description: 'back/next step' };

/**
 * Data Root onboarding as step tabs with Back, Next and Skip onboarding. Each action changes only the
 * selected records and stays on its step with its result; done steps are saved in `onboardingSteps`
 * (ADR-0057). Completion is saved by the parent.
 */
export function RootOnboarding({ onDone }: { onDone(): Promise<void> }) {
  const services = useServices();
  const plugins = usePlugins();
  const toast = useToast();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [chosenMode, setMode] = useState<Mode | null>(null);
  const [chosenStep, setStep] = useState<StepId | null>(null);
  const [marked, setMarked] = useState<StepId[]>([]);
  const [results, setResults] = useState<Partial<Record<StepId, string>>>({});
  const [editingPrompts, setEditingPrompts] = useState(false);
  const [installed, setInstalled] = useState<{ name: string; path: string }[]>([]);
  const [visited, setVisited] = useState<StepId[]>([]);
  const [boardChoice, setBoardChoice] = useState<string | null>(null);
  const [promptChoice, setPromptChoice] = useState<string | null>(null);
  const autoBoard = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  // Saves run one after another, each adding to the list the previous one saved.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saved = useRef<string[] | null>(null);
  // Factory setup's result, kept here because its screen remounts when saving progress reloads the Plugins.
  const [setup, setSetup] = useState<unknown>(null);
  const createdBoard = useRef<string | null>(null);
  const data = useAsync(
    async () => ({
      boards: await services.boards.list(),
      plugins: await services.plugins.list(),
      steps: (await services.config.global()).config.onboardingSteps ?? [],
      board: await services.context.resolveBoard().catch((err: unknown) => {
        if (err instanceof UsageError) return null;
        throw err;
      }),
    }),
    // The Plugins load after the first render, and their statuses change when one is turned on or off.
    [services, plugins.plugins],
  );
  const factoryOn = data.data?.plugins.some((p) => p.id === 'software-factory' && p.enabled) ?? false;
  // Not saved (ADR-0057 §2): reopened onboarding shows every step that Software Factory's state allows.
  const mode = chosenMode ?? (factoryOn ? 'both' : 'kanban');
  const steps = visibleSteps(mode, data.data?.boards.length);
  const doneSteps = completedSteps([...(data.data?.steps ?? []), ...marked]);
  const opened = chosenStep ?? firstIncomplete(steps, doneSteps);
  const step = steps.includes(opened) ? opened : firstIncomplete(steps, doneSteps);
  const index = steps.indexOf(step);

  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast.error(err);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  /** Adds `ids` to the saved steps, keeping ids this version does not know. */
  const persist = useCallback(
    (ids: readonly StepId[]) => {
      const save = saving.current.then(async () => {
        const stored = saved.current ?? data.data?.steps ?? [];
        const missing = ids.filter((id) => !stored.includes(id));
        if (missing.length === 0) return;
        const next = [...stored, ...missing];
        await services.config.updateRootConfig({ onboardingSteps: next });
        saved.current = next;
      });
      saving.current = save.catch(() => undefined);
      return save;
    },
    [services, data.data?.steps],
  );
  /** Marks `id` done, shows `result` on its step and saves the mark at once. */
  const complete = (id: StepId, result?: string) => {
    // Keeps the step open even when the saved marks would now open another; never moves away from one.
    setStep((current) => current ?? id);
    if (result) setResults((prev) => ({ ...prev, [id]: result }));
    setMarked((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // Factory setup runs again for another Board.
    if (id === 'board') {
      setSetup(null);
      setPromptChoice(null);
    }
    return persist([id]);
  };
  const open = (id: StepId) => {
    setEditingPrompts(false);
    setStep(id);
  };
  // The same path as the ctrl+k key of the parent: every mark is already saved.
  const finish = () => run(onDone);
  const back = () => {
    const prev = steps[index - 1];
    if (prev) open(prev);
  };
  const next = () =>
    void run(async () => {
      if (step === 'stage-prompts' || step === 'skills') await complete(step);
      const following = steps[index + 1];
      if (following) open(following);
      else await onDone();
    });

  useReloadOnReturn(data.reload);
  useEffect(() => {
    if (data.data) setVisited((prev) => (prev.includes(step) ? prev : [...prev, step]));
  }, [step, data.data]);
  const onlyBoard = data.data?.boards.length === 1 ? data.data.boards[0] : undefined;
  useEffect(() => {
    if (!onlyBoard) {
      autoBoard.current = null;
      return;
    }
    if (autoBoard.current === onlyBoard.id) return;
    autoBoard.current = onlyBoard.id;
    void (async () => {
      await services.context.use(onlyBoard.id);
      setBoardChoice(onlyBoard.id);
      setSetup(null);
      setPromptChoice(null);
      setResults((prev) => ({ ...prev, board: `Board ${onlyBoard.name} is in context.` }));
      setMarked((prev) => (prev.includes('board') ? prev : [...prev, 'board']));
      await persist(['board']);
    })().catch((err: unknown) => {
      autoBoard.current = null;
      toast.error(err);
    });
  }, [onlyBoard, services, toast, persist]);

  useInput(
    (_input, key) => {
      // A text field being edited keeps its keys.
      if (!key.shift || shell.captured().text) return;
      if (key.leftArrow) back();
      else if (key.rightArrow) next();
    },
    { isActive: active && !busy },
  );
  useKeyHints(
    step === 'plugins'
      ? [
          { key: '↑/↓', description: 'select' },
          { key: 'space', description: 'toggle Plugin' },
          { key: 'enter', description: 'save choices' },
          NAV_HINT,
        ]
      : step === 'stage-prompts' || step === 'skills'
        ? [NAV_HINT]
        : [{ key: 'enter', description: step === 'finish' ? 'finish' : 'choose' }, NAV_HINT],
  );

  if (data.loading && !data.data) return <Loading label="Preparing onboarding…" />;
  if (!data.data)
    return <SelectList items={[{ value: 'retry', label: 'Retry reading Data Root' }]} onSelect={data.reload} />;
  const choices = data.data.plugins.filter((plugin) => plugin.id !== 'software-factory');
  const result = results[step] ?? (doneSteps.includes(step) ? 'Done earlier. You can do it again here.' : undefined);
  const afterBoard = (text: string) => run(() => complete('board', text));

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Set up this Data Root</Text>
      <Text color={theme.inkFaint}>
        Completion and finished steps are shared with everyone using its committed configuration. Existing Boards and
        Plugin Data are kept.
      </Text>
      <Tabs
        tabs={steps.map((id) => {
          const label = ONBOARDING_STEPS.find((s) => s.id === id)?.label ?? id;
          return doneSteps.includes(id) ? `✓ ${label}` : label;
        })}
        selected={index}
        onSelect={(i) => {
          const id = steps[i];
          if (id) open(id);
        }}
        active={active}
      />
      {busy ? <Loading label="Saving…" /> : result && <Text color={theme.accent}>✓ {result}</Text>}
      {/* The step stays mounted while its work runs, keeping its list's highlight, but takes no keys. */}
      <ActiveContext.Provider value={active && !busy}>
        {step === 'mode' ? (
          <>
            <Text>How will you use this Data Root?</Text>
            <SelectList<Mode>
              items={(['kanban', 'factory', 'both'] as const).map((value) => ({ value, label: MODE_LABEL[value] }))}
              onSelect={(item) =>
                void run(async () => {
                  if (item.value === 'kanban') await services.plugins.disable('software-factory');
                  else await services.plugins.enable('software-factory');
                  await plugins.reload();
                  setMode(item.value);
                  await complete(
                    'mode',
                    `${MODE_LABEL[item.value]} chosen: Software Factory is turned ${item.value === 'kanban' ? 'off' : 'on'}.`,
                  );
                })
              }
            />
          </>
        ) : step === 'board' ? (
          data.data.boards.length ? (
            <>
              <Text>Choose a Board for this introduction.</Text>
              <SelectList
                items={data.data.boards.map((board) => ({ value: board.id, label: board.name }))}
                onSelect={(item) =>
                  void run(async () => {
                    await services.context.use(item.value);
                    setBoardChoice(item.value);
                    await complete('board', `Board ${item.label} is in context.`);
                  })
                }
              />
            </>
          ) : (
            <>
              <Text>Create your first Board. Its name supplies its id and Story Key prefix.</Text>
              <Form
                fields={[{ name: 'name', label: 'Board name', kind: 'text', required: true }]}
                submitLabel="create Board"
                onSubmit={async (values) => {
                  const boards = await services.boards.list();
                  if (createdBoard.current && boards.some((b) => b.id === createdBoard.current)) {
                    await services.context.use(createdBoard.current);
                    await afterBoard(`Board ${createdBoard.current} is in context.`);
                    return;
                  }
                  const name = String(values.name).trim();
                  const board = await services.boards.create({
                    name,
                    id: slugFromName(name, new Set(boards.map((b) => b.id))),
                    keyPrefix: keyPrefixFromName(name, new Set(boards.map((b) => b.keyPrefix))),
                  });
                  createdBoard.current = board.id;
                  // Retry selection rather than creating another Board if the Local State save fails.
                  data.reload();
                  await services.context.use(board.id);
                  await afterBoard(
                    `Created Board ${board.name} (Story Keys ${board.keyPrefix}-1, …); it is in context.`,
                  );
                }}
              />
            </>
          )
        ) : step === 'plugins' ? (
          <>
            <Text>
              Choose optional Plugins. Space toggles; enter saves. Unchecked Plugins are turned off; their data is kept.
            </Text>
            <SelectList
              // Checks what is on once the Plugin statuses arrive, also when they arrive after the step opened.
              key={choices.length}
              multi
              items={choices.map((p) => ({ value: p.id, label: p.name, description: p.description }))}
              defaultSelected={choices.filter((p) => p.enabled).map((p) => p.id)}
              onSubmit={(selected) =>
                void run(async () => {
                  for (const plugin of choices) {
                    if (selected.includes(plugin.id)) await services.plugins.enable(plugin.id);
                    else await services.plugins.disable(plugin.id);
                  }
                  await plugins.reload();
                  const on = choices.filter((p) => selected.includes(p.id)).map((p) => p.name);
                  await complete('plugins', `Saved Plugin choices. On: ${on.length ? on.join(', ') : 'none'}.`);
                })
              }
            />
          </>
        ) : step === 'skills' ? (
          <SkillInstall
            installedThisVisit={installed}
            onDone={next}
            onInstalled={async (skill) => {
              setInstalled((prev) => [...prev, skill]);
              await complete('skills');
            }}
          />
        ) : step === 'stage-prompts' ? (
          editingPrompts ? (
            <OnboardingPluginStep
              title="Stage Prompts"
              plugin="software-factory"
              screen="stage-prompts"
              onBack={() => setEditingPrompts(false)}
            />
          ) : (
            <OnboardingPluginStep
              title="Stage Prompts"
              plugin="software-factory"
              screen="factory-setup"
              params={{
                result: setup ?? undefined,
                onEdit: () => {
                  setEditingPrompts(true);
                  setPromptChoice('edited');
                },
                onSetUp: async (done: unknown, prompts: string) => {
                  setSetup(done);
                  setPromptChoice(prompts);
                  await complete(
                    'stage-prompts',
                    'Stage Prompts populated. What was added, kept and skipped is below.',
                  );
                },
              }}
            />
          )
        ) : (
          <>
            <Text bold>Summary</Text>
            <Text>
              Usage:{' '}
              {chosenMode
                ? MODE_LABEL[chosenMode]
                : `Software Factory ${factoryOn ? 'on' : 'off'}${visited.includes('mode') ? '' : ' · not changed in this visit'}`}
            </Text>
            <Text>
              Board in context:{' '}
              {data.data.boards.find((b) => b.id === (boardChoice ?? data.data?.board))?.name ?? 'none'}
              {boardChoice ? '' : ' · not changed in this visit'}
            </Text>
            <Text>
              Plugins on:{' '}
              {data.data.plugins
                .filter((p) => p.enabled)
                .map((p) => p.name)
                .join(', ') || 'none'}
              {visited.includes('plugins') ? '' : ' · not changed in this visit'}
            </Text>
            <Text>
              Agent skills:{' '}
              {installed.length
                ? installed.map((s) => `${s.name} · ${s.path}`).join(', ')
                : visited.includes('skills')
                  ? 'none installed in this visit'
                  : 'not changed in this visit'}
            </Text>
            {mode !== 'kanban' && (
              <Text>
                Stage Prompts:{' '}
                {promptChoice ?? (visited.includes('stage-prompts') ? 'not set up' : 'not changed in this visit')}
              </Text>
            )}
            <Text>
              Finishing saves completion in this Data Root’s rowbly.config.json, so onboarding does not open again for
              anyone sharing it. Reopen it from Settings › Onboarding.
            </Text>
            <SelectList items={[{ value: 'done', label: 'Finish onboarding' }]} onSelect={() => void finish()} />
          </>
        )}
      </ActiveContext.Provider>
      <OnboardingNav
        onBack={back}
        onNext={next}
        onSkip={() => void finish()}
        first={index === 0}
        last={index === steps.length - 1}
        clickable={active && !busy}
      />
    </Box>
  );
}

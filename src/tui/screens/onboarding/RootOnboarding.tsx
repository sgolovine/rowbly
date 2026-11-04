import { Box, Text, useInput } from 'ink';
import { useContext, useRef, useState } from 'react';
import { keyPrefixFromName, slugFromName } from '../../../core';
import { Form, Loading, SelectList, Tabs } from '../../components';
import {
  ActiveContext,
  ShellContext,
  useAsync,
  useIsActive,
  useKeyHints,
  usePlugins,
  useServices,
  useToast,
} from '../../hooks';
import type { KeyHint } from '../../keymap';
import { theme } from '../../theme';
import { OnboardingNav } from './OnboardingNav';
import { OnboardingPluginStep } from './OnboardingPluginStep';
import { firstIncomplete, type Mode, ONBOARDING_STEPS, type StepId, visibleSteps } from './onboardingSteps';
import { SkillInstall } from './SkillInstall';

const MODE_LABEL: Record<Mode, string> = { kanban: 'Plain Kanban', factory: 'Software Factory', both: 'Both' };
const NAV_HINT: KeyHint = { key: 'ctrl+←/→', description: 'back/next step' };

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
  const [skills, setSkills] = useState(false);
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
    }),
    // The Plugins load after the first render, and their statuses change when one is turned on or off.
    [services, plugins.plugins],
  );
  const factoryOn = data.data?.plugins.some((p) => p.id === 'software-factory' && p.enabled) ?? false;
  // Not saved (ADR-0057 §2): reopened onboarding shows every step that Software Factory's state allows.
  const mode = chosenMode ?? (factoryOn ? 'both' : 'kanban');
  const steps = visibleSteps(mode);
  const doneSteps = [...(data.data?.steps ?? []), ...marked];
  const opened = chosenStep ?? firstIncomplete(steps, doneSteps);
  const step = steps.includes(opened) ? opened : 'mode';
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
  const persist = (ids: readonly StepId[]) => {
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
  };
  /** Marks `id` done, shows `result` on its step and saves the mark at once. */
  const complete = (id: StepId, result?: string) => {
    // Keeps the step open even when the saved marks would now open another; never moves away from one.
    setStep((current) => current ?? id);
    if (result) setResults((prev) => ({ ...prev, [id]: result }));
    setMarked((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // Factory setup runs again for another Board.
    if (id === 'board') setSetup(null);
    return persist([id]);
  };
  const open = (id: StepId) => {
    setSkills(false);
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
      if (step === 'stage-prompts') await complete('stage-prompts');
      const following = steps[index + 1];
      if (following) open(following);
      else await onDone();
    });

  useInput(
    (_input, key) => {
      // A text field being edited keeps its keys.
      if (!key.ctrl || shell.captured().text) return;
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
      : step === 'factory-setup' || step === 'stage-prompts' || (step === 'ai' && skills)
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
                  if (createdBoard.current) {
                    await services.context.use(createdBoard.current);
                    await afterBoard(`Board ${createdBoard.current} is in context.`);
                    return;
                  }
                  const name = String(values.name).trim();
                  const boards = await services.boards.list();
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
        ) : step === 'ai' ? (
          skills ? (
            <SkillInstall onDone={next} />
          ) : (
            <>
              <Text>Will you use AI agents with this Data Root?</Text>
              <Text color={theme.inkMuted}>
                Skills teach an agent how to use Rowbly and your workflow. They can be used with Kanban as well as a
                Software Factory.
              </Text>
              <SelectList
                items={[
                  { value: 'yes', label: 'Yes — choose agent skills' },
                  { value: 'no', label: 'No — not now' },
                ]}
                onSelect={(item) =>
                  void run(async () => {
                    if (item.value === 'yes') {
                      await complete('ai', 'You will use AI agents. Install the skills they need.');
                      setSkills(true);
                    } else await complete('ai', 'No AI agents for now. Choose Yes to install agent skills later.');
                  })
                }
              />
            </>
          )
        ) : step === 'factory-setup' ? (
          <>
            <Text>
              Stage Prompts tell agents what to do when a Story enters each Stage. Factory setup gives this Board the
              Stages and default Stage Prompts a software factory needs.
            </Text>
            <OnboardingPluginStep
              title="Factory setup"
              plugin="software-factory"
              screen="factory-setup"
              params={{
                run: true,
                result: setup ?? undefined,
                onSetUp: (done: unknown) => {
                  setSetup(done);
                  void complete('factory-setup', 'Factory setup ran. What it added and kept is below.').catch(
                    toast.error,
                  );
                },
              }}
            />
          </>
        ) : step === 'stage-prompts' ? (
          <>
            <Text>
              Edit your instructions and turn on the Stages agents should work. Install rowbly-factory for a supervising
              agent and choose skills for the work in each Stage. Write your shared working agreements in ROWBLY.md.
            </Text>
            <OnboardingPluginStep title="Stage Prompts" plugin="software-factory" screen="stage-prompts" />
          </>
        ) : (
          <>
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

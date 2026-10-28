import { Box, Text } from 'ink';
import { useRef, useState } from 'react';
import { keyPrefixFromName, slugFromName } from '../../../core';
import { Form, Loading, SelectList } from '../../components';
import { pluginRoute, useAsync, useKeyHints, usePlugins, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import { SkillInstall } from './SkillInstall';

type Mode = 'kanban' | 'factory' | 'both';
type Step = 'mode' | 'board' | 'plugins' | 'ai' | 'skills' | 'factory' | 'done';

/** Setup choices change only the selected records; completion is saved by the parent. */
export function RootOnboarding({ onDone }: { onDone(): Promise<void> }) {
  const services = useServices();
  const plugins = usePlugins();
  const toast = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('kanban');
  const [step, setStep] = useState<Step>('mode');
  const [aiAsked, setAiAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const createdBoard = useRef<string | null>(null);
  useKeyHints(
    step === 'plugins'
      ? [
          { key: '↑/↓', description: 'select' },
          { key: 'space', description: 'toggle Plugin' },
          { key: 'enter', description: 'save choices' },
        ]
      : step === 'skills'
        ? []
        : [{ key: 'enter', description: 'continue' }],
  );
  const data = useAsync(
    async () => ({ boards: await services.boards.list(), plugins: await services.plugins.list() }),
    [services],
  );
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
  const afterBoard = () => setStep(mode === 'factory' ? 'factory' : 'plugins');
  const afterAi = () => {
    setAiAsked(true);
    setStep(mode === 'kanban' ? 'done' : 'factory');
  };
  if (busy || (data.loading && !data.data)) return <Loading label="Preparing onboarding…" />;
  if (!data.data)
    return <SelectList items={[{ value: 'retry', label: 'Retry reading Data Root' }]} onSelect={data.reload} />;
  const choices = data.data.plugins.filter((plugin) => plugin.id !== 'software-factory');
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Set up this Data Root</Text>
      <Text color={theme.inkFaint}>
        Completion is shared with everyone using its committed configuration. Existing Boards and Plugin Data are kept.
      </Text>
      {step === 'mode' ? (
        <>
          <Text>How will you use this Data Root?</Text>
          <SelectList<Mode>
            items={[
              { value: 'kanban', label: 'Plain Kanban' },
              { value: 'factory', label: 'Software Factory' },
              { value: 'both', label: 'Both' },
            ]}
            onSelect={(item) =>
              void run(async () => {
                if (item.value === 'kanban') await services.plugins.disable('software-factory');
                else await services.plugins.enable('software-factory');
                await plugins.reload();
                setMode(item.value);
                setStep('board');
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
                  afterBoard();
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
                  afterBoard();
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
                afterBoard();
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
                setStep('ai');
              })
            }
          />
        </>
      ) : step === 'ai' ? (
        <>
          <Text>Will you use AI agents with this Data Root?</Text>
          <Text color={theme.inkMuted}>
            Skills teach an agent how to use Rowbly and your workflow. They can be used with Kanban as well as a
            Software Factory.
          </Text>
          <SelectList
            items={[
              { value: 'yes', label: 'Yes — choose agent skills' },
              { value: 'no', label: 'No — continue' },
            ]}
            onSelect={(item) => {
              setAiAsked(true);
              if (item.value === 'yes') setStep('skills');
              else afterAi();
            }}
          />
        </>
      ) : step === 'skills' ? (
        <SkillInstall
          onDone={() => {
            if (mode !== 'kanban' && !aiAsked) setStep('ai');
            else afterAi();
          }}
        />
      ) : step === 'factory' ? (
        <>
          <Text bold>Guide your Software Factory</Text>
          <Text>
            Stage Prompts tell agents what to do when a Story enters each Stage. Edit your instructions and turn on the
            Stages agents should work. No starter prompts are added by onboarding.
          </Text>
          <Text color={theme.inkMuted}>
            Install rowbly-factory for a supervising agent and choose skills for the work in each Stage. Write your
            shared working agreements in ROWBLY.md.
          </Text>
          <SelectList
            items={[
              { value: 'prompts', label: 'Open Stage Prompt editing' },
              { value: 'skills', label: 'Choose agent skills' },
              ...(aiAsked
                ? [{ value: 'done', label: 'Finish onboarding' }]
                : [{ value: 'ai', label: 'Continue to AI usage' }]),
            ]}
            onSelect={(item) =>
              void run(async () => {
                if (item.value === 'prompts') {
                  await plugins.reload();
                  const route = pluginRoute('software-factory', 'stage-prompts');
                  router.push(route.screen, route.params);
                } else if (item.value === 'skills') setStep('skills');
                else if (item.value === 'ai') setStep('ai');
                else await onDone();
              })
            }
          />
        </>
      ) : (
        <SelectList items={[{ value: 'done', label: 'Finish onboarding' }]} onSelect={() => void onDone()} />
      )}
    </Box>
  );
}

import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { colorByCategory } from '../../../output';
import { stagesByBoard, storiesByBoard } from '../../../services/epics';
import { ConfirmDialog, DetailView, Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { ProgressBar } from './ProgressBar';

/** An Epic, its progress and its Stories grouped by Board; `enter` opens a Story's detail screen. */
export function EpicDetail({ id }: { id: string }) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [confirming, setConfirming] = useState(false);
  const epic = useAsync(async () => {
    const ws = await services.context.resolveWorkspace();
    const view = await services.epics.get(ws, id);
    return { view, stages: await stagesByBoard(services.config, view) };
  }, [services, id, active]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast.error(err);
    }
  };

  useKeyHints([
    { key: 'enter', description: 'open story' },
    { key: 'e', description: 'edit' },
    { key: 'c', description: epic.data?.view.closed ? 'reopen' : 'close' },
    { key: 'd', description: 'delete' },
  ]);
  useInput(
    (input) => {
      const view = epic.data?.view;
      if (!view || confirming || shell.captured().text) return;
      if (input === 'e') router.push('epics', { view: 'form', id, title: 'Edit' });
      else if (input === 'd') setConfirming(true);
      else if (input === 'c') {
        void run(async () => {
          await services.epics.setClosed(view.workspaceId, id, !view.closed);
          toast.push('info', `${view.closed ? 'Reopened' : 'Closed'} Epic ${id}`);
          epic.reload();
        });
      }
    },
    { isActive: active },
  );

  if (!epic.data) return epic.loading ? <Loading label="Loading Epic…" /> : null;
  const { view, stages } = epic.data;
  const items = [...storiesByBoard(view.stories)].flatMap(([boardId, stories]) =>
    stories.map((story) => {
      const stage = stages.get(boardId)?.find((s) => s.key === story.stage);
      const badge = stage ? colorByCategory(stage.category, `● ${stage.name}`) : `? ${story.stage}`;
      return { value: story.key, label: `${story.key}  ${story.name}`, description: `${boardId} · ${badge}` };
    }),
  );

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: 'Epic', value: `${view.name} (${view.id})` },
          { label: 'Status', value: view.closed ? 'closed' : 'open' },
          { label: 'Progress', value: <ProgressBar progress={view.progress} /> },
        ]}
        body={view.description}
      />
      <Box flexDirection="column">
        <Text bold>Stories</Text>
        <SelectList
          items={items}
          emptyText="No Stories in this Epic."
          isActive={!confirming}
          onSelect={(item) => router.push('story', { key: item.value, title: item.value })}
        />
      </Box>
      {confirming && (
        <ConfirmDialog
          message={`Delete Epic "${id}"? Its ${view.stories.length} Stories will be unlinked.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(async () => {
              await services.epics.remove(view.workspaceId, id);
              toast.push('info', `Deleted Epic ${id}`);
              router.pop();
            });
          }}
        />
      )}
    </Box>
  );
}

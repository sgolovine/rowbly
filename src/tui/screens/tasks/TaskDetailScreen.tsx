import { Box, Text } from 'ink';
import { type DetailRow, DetailView, Loading } from '../../components';
import { useAsync, useServices } from '../../hooks';
import { CommentsPanel } from '../comments/CommentsPanel';
import { StoryStage, useReloadOnReturn } from '../stories/shared';
import type { ScreenProps } from '../types';

/** One Task (`params.id`) with its Comments. Tasks have no Assignees of their own: the Story's are shown. */
export function TaskDetailScreen({ params }: ScreenProps) {
  const services = useServices();
  const id = String(params.id ?? '');
  const data = useAsync(async () => {
    const { story, task } = await services.tasks.get(id);
    const config = await services.config.effective({ workspaceId: story.workspaceId, boardId: story.boardId });
    return { story, task, stages: config.stages };
  }, [services, id]);
  useReloadOnReturn(data.reload);

  if (!data.data) return data.loading ? <Loading label={`Loading ${id}…`} /> : <Text color="red">No Task.</Text>;
  const { story, task, stages } = data.data;
  const rows: DetailRow[] = [
    { label: 'Story', value: `${story.key} ${story.name}` },
    { label: 'Stage', value: <StoryStage stages={stages} story={task} /> },
    {
      label: 'Assignees',
      value: story.assignees.length ? (
        <Text>
          {story.assignees.join(', ')} <Text dimColor>(from the Story)</Text>
        </Text>
      ) : (
        <Text dimColor>—</Text>
      ),
    },
    { label: 'Created', value: task.createdAt },
    { label: 'Updated', value: task.updatedAt },
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text bold color="cyan">
          {task.id}
        </Text>{' '}
        <Text bold>{task.name}</Text>
      </Text>
      <DetailView rows={rows} body={task.description} />
      <Text bold>Comments</Text>
      <CommentsPanel target={task.id} />
    </Box>
  );
}

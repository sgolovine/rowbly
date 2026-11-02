import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { Story } from '../../schemas';
import { readStoryFinderAllBoards } from '../../services';
import { Loading, Modal, modalSize, SelectListRow, TextInput } from '../components';
import { useAsync, useLayout, usePlugins, useRowblyContext, useServices } from '../hooks';
import { theme } from '../theme';
import { findStories, loadStorySearch } from './storySearch';

export function StoryFinder({
  boardId,
  onClose,
  onSelect,
}: {
  boardId?: string;
  onClose(): void;
  onSelect(story: Story): Promise<void>;
}) {
  const ctx = useRowblyContext();
  const services = useServices();
  const { plugins } = usePlugins();
  const outer = useLayout();
  const { body } = modalSize(outer, { footer: true });
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [opening, setOpening] = useState(false);
  const index = useAsync(async () => {
    const allBoards = await readStoryFinderAllBoards(ctx?.home ?? homedir());
    const entries =
      !allBoards && !boardId ? [] : await loadStorySearch(services, plugins, allBoards ? null : (boardId ?? null));
    return { entries, allBoards };
  }, [services, plugins, boardId, ctx?.home]);
  const results = useMemo(() => findStories(index.data?.entries ?? [], query), [index.data, query]);
  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  const limit = Math.max(1, Math.min(10, (body.height ?? 18) - 7));
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), results.length - limit));
  const pick = async (story: Story) => {
    if (opening) return;
    setOpening(true);
    try {
      await onSelect(story);
    } finally {
      setOpening(false);
    }
  };
  useInput((_input, key) => {
    if (opening) return;
    if (key.escape) onClose();
    else if (key.downArrow) setCursor(Math.min(results.length - 1, selected + 1));
    else if (key.upArrow) setCursor(Math.max(0, selected - 1));
    else if (key.return && results[selected]) void pick(results[selected].story);
  });
  return (
    <Modal
      title="Find Stories"
      onClose={opening ? undefined : onClose}
      hints={[
        { key: '↑/↓', description: 'select' },
        { key: 'enter', description: 'open Story' },
        { key: 'esc', description: 'close' },
      ]}
    >
      <Box flexDirection="column" gap={1} width={body.width}>
        <Box backgroundColor={theme.fieldFocus} paddingX={1}>
          <Text color={theme.accent}>🔎 </Text>
          <TextInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setCursor(0);
            }}
            focus={!opening}
            width={Math.max(8, body.width - 5)}
            placeholder="Find Stories…"
          />
        </Box>
        <Text color={theme.inkMuted}>
          {index.data?.allBoards ? 'Full Data Root' : 'Current Board'} · {results.length}{' '}
          {results.length === 1 ? 'Story' : 'Stories'}
        </Text>
        {index.loading && <Loading label="Loading Stories…" />}
        {index.error !== undefined && !index.loading && <Text color={theme.danger}>Could not load Stories.</Text>}
        {index.data && !results.length && (
          <Text color={theme.inkFaint}>
            {!index.data.allBoards && !boardId
              ? 'Select a Board, or enable full Data Root search in Preferences.'
              : 'No matching Stories.'}
          </Text>
        )}
        <Box flexDirection="column">
          {results.slice(start, start + limit).map((entry, i) => (
            <SelectListRow
              key={entry.story.key}
              highlighted={start + i === selected}
              active={!opening}
              onClick={() => void pick(entry.story)}
            >
              <Text wrap="truncate-end">
                {entry.story.key} {entry.story.name}
                {index.data?.allBoards && <Text color={theme.inkMuted}> · {entry.boardName}</Text>}
              </Text>
            </SelectListRow>
          ))}
        </Box>
        {results.length > limit && (
          <Text color={theme.inkFaint}>
            {selected + 1}/{results.length}
          </Text>
        )}
      </Box>
    </Modal>
  );
}

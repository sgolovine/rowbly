import { Box, Text, useInput } from 'ink';
import { type ReactNode, useState } from 'react';
import { ValidationError } from '../../../core';
import { DEFAULT_STAGES } from '../../../schemas';
import {
  ConfirmDialog,
  DetailView,
  Form,
  type FormField,
  Loading,
  SelectList,
  StageBadge,
  TextArea,
  TextInput,
} from '../../components';
import { useIsActive, useKeyHints, useToast } from '../../hooks';
import type { ScreenRegistry } from '../types';

const SECTIONS = ['SelectList', 'TextInput', 'TextArea', 'Form', 'ConfirmDialog'] as const;
type Section = (typeof SECTIONS)[number];

const FIELDS: FormField[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'description', label: 'Description', kind: 'multiline' },
  { name: 'points', label: 'Points', kind: 'number' },
  { name: 'blocked', label: 'Blocked', kind: 'boolean' },
  { name: 'dueDate', label: 'Due date', kind: 'date' },
  { name: 'priority', label: 'Priority', kind: 'select', options: ['P0', 'P1', 'P2', 'P3', 'P4'] },
  { name: 'labels', label: 'Labels', kind: 'multiselect', options: ['api', 'ui', 'docs'] },
];

const ASSIGNEES = [
  { value: 'ada', label: 'ada', description: 'Ada Lovelace' },
  { value: 'grace', label: 'grace', description: 'Grace Hopper' },
  { value: 'linus', label: 'linus', description: 'Linus Torvalds' },
];

/**
 * Dev-only (`ROWBLY_TUI_DEMO=1`): every primitive on one screen, with static sample data.
 * `ctrl+n` moves keyboard focus between the interactive sections. Submit the form with the name
 * "invalid" to see a `ValidationError` shown inline.
 */
function DemoScreen() {
  const toast = useToast();
  const active = useIsActive();
  const [section, setSection] = useState<Section>('SelectList');
  const [line, setLine] = useState('Fix login focus');
  const [text, setText] = useState('The login form loses focus\nafter submit.');
  useKeyHints([{ key: 'ctrl+n', description: 'next section' }]);
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'n') setSection((s) => SECTIONS[(SECTIONS.indexOf(s) + 1) % SECTIONS.length] ?? s);
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Panel title="StageBadge">
        <Box gap={2}>
          {DEFAULT_STAGES.map((stage) => (
            <StageBadge key={stage.key} stage={stage} />
          ))}
        </Box>
      </Panel>
      <Panel title="DetailView">
        <DetailView
          rows={[
            { label: 'Key', value: 'WEB-42' },
            { label: 'Stage', value: <StageBadge stage={{ name: 'In Progress', category: 'in_progress' }} /> },
            { label: 'Assignees', value: 'ada, grace' },
            { label: 'Priority', value: 'P1' },
          ]}
          body={'## Context\nThe **login form** loses focus after `submit`.\n- reproduce on Safari'}
        />
      </Panel>
      <Panel title="Spinner / Loading">
        <Loading label="Loading stories…" />
      </Panel>
      <Panel title="SelectList (multi-select, / filters)" focused={section === 'SelectList'}>
        <SelectList
          items={ASSIGNEES}
          multi
          defaultSelected={['ada']}
          onSubmit={(values) => toast.push('info', `selected: ${values.join(', ') || 'none'}`)}
          isActive={section === 'SelectList'}
        />
      </Panel>
      <Panel title="TextInput" focused={section === 'TextInput'}>
        <Box width={40}>
          <TextInput
            value={line}
            onChange={setLine}
            focus={active && section === 'TextInput'}
            width={40}
            placeholder="Name"
          />
        </Box>
      </Panel>
      <Panel title="TextArea" focused={section === 'TextArea'}>
        <TextArea value={text} onChange={setText} focus={active && section === 'TextArea'} width={40} rows={3} />
      </Panel>
      <Panel title="Form" focused={section === 'Form'}>
        <Form
          fields={FIELDS}
          initialValues={{ name: 'Fix login focus', priority: 'P1', labels: ['ui'] }}
          isActive={section === 'Form'}
          onSubmit={(values) => {
            if (values.name === 'invalid') {
              throw new ValidationError('story is invalid', {
                details: { issues: [{ path: ['name'], message: 'name is already taken' }] },
              });
            }
            toast.push('info', `submitted ${JSON.stringify(values)}`);
          }}
        />
      </Panel>
      <Panel title="ConfirmDialog" focused={section === 'ConfirmDialog'}>
        <ConfirmDialog
          message="Delete story WEB-42?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          isActive={section === 'ConfirmDialog'}
          onConfirm={() => toast.push('info', 'confirmed')}
          onCancel={() => toast.push('info', 'cancelled')}
        />
      </Panel>
    </Box>
  );
}

function Panel({ title, focused = false, children }: { title: string; focused?: boolean; children: ReactNode }) {
  return (
    <Box flexDirection="column">
      <Text bold color={focused ? 'cyan' : undefined}>
        {focused ? '▸ ' : '  '}
        {title}
      </Text>
      <Box paddingLeft={2} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

export const demoScreens: ScreenRegistry = {
  demo: DemoScreen,
};

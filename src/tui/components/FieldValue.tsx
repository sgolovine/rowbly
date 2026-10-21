import { Box, Text } from 'ink';
import type { FormField } from './Form';
import { TextArea } from './TextArea';
import { TextInput } from './TextInput';

type Raw = string | boolean | string[] | null;

export function FieldValue({
  field,
  raw,
  focused,
  optionCursor,
  width,
  onChange,
  onLeave,
}: {
  field: FormField;
  raw: Raw;
  focused: boolean;
  optionCursor: number;
  width: number;
  onChange(raw: Raw): void;
  onLeave(direction: -1 | 1): void;
}) {
  switch (field.kind) {
    case 'boolean':
      return <Text>{raw === true ? '[x] yes' : '[ ] no'}</Text>;
    case 'select':
      return <Text>{`‹ ${typeof raw === 'string' ? (field.optionLabels?.[raw] ?? raw) : '—'} ›`}</Text>;
    case 'multiselect': {
      const checked = Array.isArray(raw) ? raw : [];
      return (
        <Box columnGap={2} flexWrap="wrap">
          {(field.options ?? []).map((option, i) => (
            <Text key={option} underline={focused && i === optionCursor}>
              {checked.includes(option) ? '[x] ' : '[ ] '}
              {field.optionLabels?.[option] ?? option}
            </Text>
          ))}
        </Box>
      );
    }
    case 'multiline':
      return (
        <TextArea
          value={typeof raw === 'string' ? raw : ''}
          onChange={onChange}
          focus={focused}
          width={width}
          rows={5}
          placeholder="(empty)"
          onLeave={onLeave}
          title={field.label}
        />
      );
    default:
      return (
        <TextInput
          value={String(raw)}
          onChange={onChange}
          focus={focused}
          width={width}
          placeholder={field.kind === 'date' ? 'YYYY-MM-DD' : undefined}
        />
      );
  }
}

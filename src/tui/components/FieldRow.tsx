import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';
import { FieldValue } from './FieldValue';
import type { FormField } from './Form';

type Raw = string | boolean | string[] | null;
const FOCUSED_BACKGROUND = theme.fieldFocus;
const INPUT_BACKGROUND = theme.field;

export function FieldRow({
  field,
  raw,
  focused,
  active,
  error,
  labelWidth,
  inputWidth,
  optionCursor,
  onChange,
  onLeave,
  onClick,
}: {
  field: FormField;
  raw: Raw;
  focused: boolean;
  active: boolean;
  error?: string;
  labelWidth: number;
  inputWidth: number;
  optionCursor: number;
  onChange(raw: Raw): void;
  onLeave(direction: -1 | 1): void;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active);
  const lit = focused && active;
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      <Box>
        <Box width={labelWidth} flexShrink={0}>
          <Text color={lit ? theme.accent : undefined} bold={lit}>
            {focused ? '› ' : '  '}
            {field.label}
            {field.required ? '*' : ''}
          </Text>
        </Box>
        <Box
          width={inputWidth}
          flexShrink={0}
          paddingX={1}
          backgroundColor={lit ? FOCUSED_BACKGROUND : INPUT_BACKGROUND}
        >
          <FieldValue
            field={field}
            raw={raw}
            focused={lit}
            optionCursor={optionCursor}
            width={inputWidth - 2}
            onChange={onChange}
            onLeave={onLeave}
          />
        </Box>
      </Box>
      {error && <Text color={theme.danger}>{`${' '.repeat(labelWidth)}${error}`}</Text>}
    </Box>
  );
}

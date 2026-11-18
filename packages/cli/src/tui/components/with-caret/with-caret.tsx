import { Text } from "ink";
import { theme } from "../../theme.js";

export interface WithCaretProps {
  readonly text: string;
  readonly at: number;
}

/** `text` with the character at `at` (or a space after the end) shown as the caret. */
export function WithCaret({ text, at }: WithCaretProps) {
  return (
    <>
      {text.slice(0, at)}
      <Text backgroundColor={theme.accent} color={theme.onAccent}>
        {text[at] ?? " "}
      </Text>
      {text.slice(at + 1)}
    </>
  );
}

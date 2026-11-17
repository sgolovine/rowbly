import { Text } from "ink";
import { theme } from "../../../theme.js";

/**
 * The outcome line of one thread: the error in `danger`, or the summary of the result in `color`. The thread row and
 * the thread detail use it.
 */
export function ThreadOutcomeText({
  outcome,
  color,
}: {
  /** The outcome from `threadOutcome`. */
  outcome: { readonly text: string; readonly error: boolean };
  /** The colour of an outcome that is not an error. */
  color: string;
}) {
  return (
    <Text wrap="truncate-end" color={outcome.error ? theme.danger : color}>
      {outcome.text}
    </Text>
  );
}

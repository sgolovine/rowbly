import { FactoryAttention } from "../factory-attention/index.js";
import type { FactoryAttention as AttentionModel } from "../factory-modal/use-factory-attention.js";
import { FactoryProblemDetail } from "../factory-problem-detail/index.js";

/** The props of `FactoryWarnings`. */
export interface FactoryWarningsProps {
  readonly attention: AttentionModel;
  /** The height of the area around the Modal. */
  readonly height: number | undefined;
  readonly active: boolean;
}

/** The views of the warnings: the detail view of one warning when it is open, or else the list of all warnings. */
export function FactoryWarnings({ attention, height, active }: FactoryWarningsProps) {
  const { problem, actions } = attention;

  if (problem) {
    return (
      <FactoryProblemDetail
        problem={problem}
        story={attention.story}
        thread={attention.thread}
        can={attention.can}
        busy={attention.busy}
        clickable={active}
        onStory={actions.openStory}
        onThread={actions.openThread}
        onDismiss={actions.dismiss}
      />
    );
  }

  return (
    <FactoryAttention
      problems={attention.problems}
      height={height}
      active={active}
      onFilteringChange={actions.setFiltering}
      onPick={actions.pick}
    />
  );
}

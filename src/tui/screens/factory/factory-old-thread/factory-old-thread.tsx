import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConversationView, modalSize } from "../../../components/index.js";
import type { Layout } from "../../../hooks/index.js";

/** The props of `FactoryOldThread`. */
export interface FactoryOldThreadProps {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  readonly active: boolean;
  /** The area around the Modal. */
  readonly layout: Layout;
}

/** The read-only conversation of an old Thread from the history. It fills the body of the Modal that holds it. */
export function FactoryOldThread({ ctx, threadId, active, layout }: FactoryOldThreadProps) {
  const body = modalSize(layout, { footer: true }).body;

  return (
    <ConversationView
      ctx={ctx}
      threadId={threadId}
      live={false}
      active={active}
      width={body.width}
      height={body.height}
    />
  );
}

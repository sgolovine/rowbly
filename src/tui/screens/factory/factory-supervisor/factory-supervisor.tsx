import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConversationView, modalSize } from "../../../components/index.js";
import type { Layout } from "../../../hooks/index.js";

/** The props of `FactorySupervisor`. */
export interface FactorySupervisorProps {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  /** True while the supervisor runs, so that the conversation follows new messages. */
  readonly live: boolean;
  readonly active: boolean;
  /** The area around the Modal. */
  readonly layout: Layout;
}

/** The conversation of the supervisor. It fills the body of the Modal that holds it. */
export function FactorySupervisor({ ctx, threadId, live, active, layout }: FactorySupervisorProps) {
  const body = modalSize(layout, { footer: true }).body;

  return (
    <ConversationView
      ctx={ctx}
      threadId={threadId}
      live={live}
      active={active}
      width={body.width}
      height={body.height}
    />
  );
}

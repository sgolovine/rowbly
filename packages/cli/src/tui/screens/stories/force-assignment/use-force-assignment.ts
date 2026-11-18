import { useCallback, useRef, useState } from "react";
import { type FactoryStatus, getFactoryStatus, sameFactoryStatus } from "../../../../services/factory/factory.js";
import { listThreads } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  useAsync,
  useFactoryChanges,
  useSharedFactoryStatus,
  useThreadChanges,
  useToast,
} from "../../../hooks/index.js";
import { forceAssignment } from "./force-assignment-actions.js";
import { canForceAssignment } from "./force-assignment-view.js";

/** The `Force assignment` control of the Story view. */
export interface ForceAssignmentState {
  /** The Button shows: the factory is live, its queue has the Story, and the Story has no active Thread. */
  readonly shown: boolean;
  /** A request runs. */
  readonly busy: boolean;
  /** Sends the request. It does nothing when the Button does not show. */
  readonly send: () => void;
}

/** Reads the factory status, only when no shell shares its status read. */
function loadOwnStatus(ctx: ServiceContext, own: boolean): Promise<FactoryStatus | undefined> {
  return own ? getFactoryStatus(ctx).catch(() => undefined) : Promise.resolve(undefined);
}

/** True when the Story has a pending or running Thread. A list that cannot be read counts as active. */
function hasActiveThread(ctx: ServiceContext, storyId: string): Promise<boolean> {
  return listThreads({ story: storyId }, ctx).then(
    ({ threads }) => threads.some((thread) => thread.status === "pending" || thread.status === "running"),
    () => true,
  );
}

/** The shared factory status of the shell, or a status read of its own, read again when the factory changes. */
function useStatus(ctx: ServiceContext): FactoryStatus | undefined {
  const shared = useSharedFactoryStatus();
  const own = shared === undefined;
  const status = useAsync(() => loadOwnStatus(ctx, own), [ctx, own], { isEqual: sameFactoryStatus });

  useFactoryChanges(own ? (ctx.cwd ?? process.cwd()) : undefined, status.refresh);

  return own ? status.data : shared.data;
}

/** The active Thread state of the Story, read again when a Thread changes, also from a different process. */
function useActiveThread(ctx: ServiceContext, storyId: string): boolean {
  const active = useAsync(() => hasActiveThread(ctx, storyId), [ctx, storyId], { isEqual: (a, b) => a === b });

  useThreadChanges(ctx.cwd ?? process.cwd(), active.refresh);

  // A Thread list that is not read yet hides the Button.
  return active.data ?? true;
}

/** The state and the operation of the `Force assignment` Button of the Story view. */
export function useForceAssignment(ctx: ServiceContext, storyId: string): ForceAssignmentState {
  const toast = useToast();
  const status = useStatus(ctx);
  const activeThread = useActiveThread(ctx, storyId);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const shown = canForceAssignment(status, storyId, activeThread);
  const send = useCallback(() => {
    if (shown) {
      forceAssignment({ ctx, storyId, toast, sending, setBusy });
    }
  }, [shown, ctx, storyId, toast]);

  return { shown, busy, send };
}

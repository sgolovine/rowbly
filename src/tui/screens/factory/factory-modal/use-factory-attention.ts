import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useEscape, useToast } from "../../../hooks/index.js";
import { problemStory, problemThread } from "../factory-problem-links.js";
import { type FactoryProblem, factoryProblems } from "../factory-status.js";
import {
  type AttentionEnv,
  dismissProblem,
  handleProblemKey,
  openProblemStory,
  openProblemThread,
} from "./factory-attention-actions.js";

/** The inputs of the Attention views. */
export interface FactoryAttentionInput {
  readonly ctx: ServiceContext;
  readonly status: FactoryStatus | undefined;
  readonly stories: readonly Story[];
  /** All Threads of the Project, the oldest first. */
  readonly threads: readonly ThreadRecord[];
  /** True when the Modal has the keys and no dialog or other view is on top of the Attention views. */
  readonly active: boolean;
  readonly onOpenStory: ((story: Story) => void) | undefined;
  readonly onOpenThread: ((thread: ThreadRecord) => void) | undefined;
}

/** What the detail view of the warning can do now. */
interface AttentionAbilities {
  readonly story: boolean;
  readonly thread: boolean;
  readonly dismiss: boolean;
}

/** The handlers of the Attention views. */
interface AttentionActions {
  readonly openList: () => void;
  readonly closeList: () => void;
  /** Opens the detail view of the warning with this key. */
  readonly pick: (key: string) => void;
  readonly closeDetail: () => void;
  readonly openStory: () => void;
  readonly openThread: () => void;
  readonly dismiss: () => void;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
}

/** The state of the Attention views for one render. */
export interface FactoryAttention {
  /** All warnings of the live factory. */
  readonly problems: readonly FactoryProblem[];
  /** True while the list of the warnings is open. */
  readonly listOpen: boolean;
  /** The warning of the detail view. It is `undefined` when no detail is open, or when the warning went away. */
  readonly problem: FactoryProblem | undefined;
  readonly story: Story | undefined;
  readonly thread: ThreadRecord | undefined;
  /** True while a dismiss waits for the factory. */
  readonly busy: boolean;
  readonly can: AttentionAbilities;
  readonly actions: AttentionActions;
}

function attentionAbilities(env: AttentionEnv, busy: boolean): AttentionAbilities {
  return {
    story: env.story !== undefined && env.onOpenStory !== undefined,
    thread: env.thread !== undefined && env.onOpenThread !== undefined,
    dismiss: env.problem?.dismissible === true && !busy,
  };
}

function attentionActions(
  env: AttentionEnv,
  setListOpen: Dispatch<SetStateAction<boolean>>,
  setFiltering: Dispatch<SetStateAction<boolean>>,
): AttentionActions {
  return {
    openList: () => setListOpen(true),
    closeList: () => setListOpen(false),
    pick: (key) => env.setProblemKey(key),
    closeDetail: () => env.setProblemKey(undefined),
    openStory: () => openProblemStory(env),
    openThread: () => openProblemThread(env),
    dismiss: () => void dismissProblem(env),
    setFiltering,
  };
}

/**
 * The list of the warnings of the factory and the detail view of one warning. `esc` closes the detail view
 * first, then the list.
 */
export function useFactoryAttention(input: FactoryAttentionInput): FactoryAttention {
  const { ctx, status, stories, threads, active, onOpenStory, onOpenThread } = input;
  const toast = useToast();
  const [listOpen, setListOpen] = useState(false);
  const [problemKey, setProblemKey] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [busy, setBusy] = useState(false);
  const dismissing = useRef(false);

  const problems = factoryProblems(status);
  const problem = problems.find((item) => item.key === problemKey);
  const story = problem && problemStory(problem, stories);
  const thread = problem && problemThread(problem, threads, status?.supervisorThreadId);
  const detail = active && problem !== undefined;

  const env: AttentionEnv = {
    ctx,
    toast,
    problem,
    story,
    thread,
    dismissing,
    setBusy,
    setProblemKey,
    onOpenStory,
    onOpenThread,
  };

  useEscape(detail, () => setProblemKey(undefined));
  useEscape(active && problem === undefined && listOpen && !filtering, () => setListOpen(false));
  useInput((text, key) => handleProblemKey(env, text, key), { isActive: detail });

  return {
    problems,
    listOpen,
    problem,
    story,
    thread,
    busy,
    can: attentionAbilities(env, busy),
    actions: attentionActions(env, setListOpen, setFiltering),
  };
}

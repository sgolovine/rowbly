import { z } from "zod";
import { getThreadLog } from "../conversation/conversation.js";
import { ConflictError } from "../errors/errors.js";
import { releaseStory } from "../factory-policy/factory-policy.js";
import { updateFactoryState } from "../factory-state/factory-state.js";
import { withEntry, withoutEntry } from "../store/store.js";
import { getStory, getStoryDetails, listStoryRefs, type StoryRef, storyUidField } from "../story/story.js";
import { getThread } from "../thread/thread.js";
import { toolParameters } from "../tool-schema/tool-schema.js";
import { changeThread, getState, type Manager, notify, serial, setState } from "./manager-state.js";
import { buildSnapshot, persistStatus } from "./manager-status.js";
import { type ReserveWorkerInput, reserveWorker } from "./worker-reservation.js";

const MODEL_CHOICE_SCHEMA = z.object({
  provider: z.string(),
  modelId: z.string(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
});

interface HoldInput {
  storyId: string;
  stage: string;
  reason: string;
  reconsiderAt: string;
}

/** Formats a tool result as JSON text, and truncates a result longer than 16,000 characters. */
function textResult(value: unknown) {
  const json = JSON.stringify(value);
  const text = json?.length > 16_000 ? JSON.stringify({ truncated: true, text: json.slice(0, 12_000) }) : json;

  return { content: [{ type: "text" as const, text }], details: {} };
}

/** The tools that the supervisor session uses to read the factory and to control workers. */
export function createSupervisorTools(manager: Manager) {
  return [...readTools(manager), ...workerTools(manager), ...policyTools(manager), ...noteTools(manager)];
}

/** Tools that read the factory, a Thread, a Story or a Stage. */
function readTools(manager: Manager) {
  return [
    {
      name: "factory_snapshot",
      label: "Factory snapshot",
      description: "Read bounded policy decisions and worker metadata",
      parameters: toolParameters(
        z.object({
          cursor: z.int().min(0).optional(),
          limit: z.int().min(1).max(12).optional(),
        }),
      ),
      execute: async (_id: string, args: { cursor?: number; limit?: number }) =>
        textResult(await serial(manager, () => buildSnapshot(manager, args.cursor, args.limit))),
    },
    {
      name: "inspect_worker",
      label: "Inspect worker",
      description: "Read metadata; request bounded history explicitly",
      parameters: toolParameters(
        z.object({
          threadId: z.string(),
          history: z.boolean().optional(),
          limit: z.int().min(1).max(20).optional(),
        }),
      ),
      execute: async (_id: string, args: { threadId: string; history?: boolean; limit?: number }) =>
        textResult(await inspectWorker(manager, args)),
    },
    {
      name: "story_get",
      label: "Read Story",
      description: "Read a bounded current Story",
      parameters: toolParameters(z.object({ storyId: z.string() })),
      execute: async (_id: string, args: { storyId: string }) => textResult(await boundedStory(manager, args.storyId)),
    },
  ];
}

/**
 * Reads a Story as JSON text of at most 8192 characters. The dependency lists come before the description, so that
 * the limit does not cut them.
 */
async function boundedStory(manager: Manager, storyId: string): Promise<string> {
  const { id, title, stage, dependsOn, blocks, waitingFor, ...rest } = await getStoryDetails(
    { id: storyId },
    manager.ctx,
  );

  return JSON.stringify({ id, title, stage, dependsOn, blocks, waitingFor, ...rest }).slice(0, 8192);
}

/** Tools that start and stop workers. */
function workerTools(manager: Manager) {
  return [
    {
      name: "start_worker",
      label: "Start worker",
      description:
        "Reserve an eligible worker. A Story or Stage worker model override in the factory settings has priority over the model argument. Without a host, the placement policy selects one. A host must be connected, have a free slot and the worker provider; unpushed local work stays on local, and a Story stays on the host of its last worker",
      parameters: toolParameters(
        z.object({
          storyId: z.string(),
          stage: z.string(),
          requestId: z.string().min(1).max(128),
          resumeThreadId: z.string().optional(),
          model: MODEL_CHOICE_SCHEMA.optional(),
          host: z.string().min(1).max(64).optional(),
        }),
      ),
      execute: async (_id: string, args: ReserveWorkerInput) => textResult(await reserveWorker(manager, args)),
    },
    {
      name: "stop_worker",
      label: "Stop worker",
      description: "Interrupt only the expected active run",
      parameters: toolParameters(
        z.object({
          threadId: z.string(),
          expectedRunId: z.string(),
          reason: z.string().max(500),
        }),
      ),
      execute: async (_id: string, args: { threadId: string; expectedRunId: string; reason: string }) =>
        textResult(await stopWorker(manager, args.threadId, args.expectedRunId)),
    },
  ];
}

/** Tools that hold or release Stories. */
function policyTools(manager: Manager) {
  return [
    {
      name: "release_story",
      label: "Release Story",
      description: "Release policy parking and holds",
      parameters: toolParameters(z.object({ storyId: z.string() })),
      execute: async (_id: string, args: { storyId: string }) =>
        textResult(await serial(manager, () => releaseHeldStory(manager, args.storyId))),
    },
    {
      name: "hold_candidate",
      label: "Hold candidate",
      description: "Hold a current Story for at most thirty minutes",
      parameters: toolParameters(
        z.object({
          storyId: z.string(),
          stage: z.string(),
          reason: z.string().max(500),
          reconsiderAt: z.string(),
        }),
      ),
      execute: async (_id: string, args: HoldInput) =>
        textResult(await serial(manager, () => holdCandidate(manager, args))),
    },
  ];
}

/** Tools that record notes and problems for later turns. */
function noteTools(manager: Manager) {
  return [
    {
      name: "save_note",
      label: "Save note",
      description: "Save a bounded operational note",
      parameters: toolParameters(z.object({ text: z.string().min(1).max(1000) })),
      execute: async (_id: string, args: { text: string }) =>
        textResult(await serial(manager, () => saveNote(manager, args.text))),
    },
    {
      name: "clear_notes",
      label: "Clear notes",
      description: "Clear operational notes",
      parameters: toolParameters(z.object({})),
      execute: async () => textResult(await serial(manager, () => clearNotes(manager))),
    },
    {
      name: "raise_attention",
      label: "Raise attention",
      description: "Record a bounded problem and continue other work",
      parameters: toolParameters(
        z.object({
          key: z.string().max(128),
          text: z.string().max(1000),
          storyId: z.string().optional(),
        }),
      ),
      execute: async (_id: string, args: { key: string; text: string; storyId?: string }) =>
        textResult(await serial(manager, () => raiseAttention(manager, args))),
    },
  ];
}

async function inspectWorker(manager: Manager, args: { threadId: string; history?: boolean; limit?: number }) {
  const thread = await getThread(args.threadId, manager.ctx);

  if (!args.history) {
    return thread;
  }

  const log = await getThreadLog(args.threadId, { tail: args.limit ?? 20 }, manager.ctx);

  return { thread, history: JSON.stringify(log).slice(0, 4096) };
}

/** The ID and the `uid` of the Story. A Story that cannot be read gives only the ID. */
async function heldStoryRef(manager: Manager, storyId: string): Promise<StoryRef> {
  return getStory({ id: storyId }, manager.ctx).then(
    (story) => ({ id: storyId, ...storyUidField(story) }),
    () => ({ id: storyId }),
  );
}

async function releaseHeldStory(manager: Manager, storyId: string) {
  setState(manager, (state) => ({ holds: withoutEntry(state.holds, storyId) }));

  const story = await heldStoryRef(manager, storyId);
  // A Story file that cannot be read does not stop the release. The match then uses only the held Story.
  const stories = await listStoryRefs(manager.ctx).catch(() => []);

  await updateFactoryState(manager.paths.root, (state) => releaseStory(state, story, stories), manager.ctx);
  notify(manager);

  return { released: storyId };
}

async function saveNote(manager: Manager, text: string) {
  await updateFactoryState(
    manager.paths.root,
    (state) => ({
      ...state,
      notes: [...(Array.isArray(state.notes) ? state.notes.slice(-11) : []), text],
    }),
    manager.ctx,
  );

  return { saved: true };
}

async function clearNotes(manager: Manager) {
  await updateFactoryState(manager.paths.root, (state) => ({ ...state, notes: [] }), manager.ctx);

  return { cleared: true };
}

async function holdCandidate(manager: Manager, args: HoldInput) {
  const deadline = Date.parse(args.reconsiderAt);

  if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 30 * 60_000) {
    throw new ConflictError("Invalid hold deadline");
  }

  if ((await getStory({ id: args.storyId }, manager.ctx)).stage !== args.stage) {
    throw new ConflictError("Story Stage changed");
  }

  setState(manager, (state) => ({ holds: withEntry(state.holds, args.storyId, args) }));
  await persistStatus(manager);

  return { held: args.storyId };
}

async function raiseAttention(manager: Manager, args: { key: string; text: string; storyId?: string }) {
  const { attention } = getState(manager);

  if (!attention.has(args.key) && attention.size >= 100) {
    throw new ConflictError("Attention capacity is full");
  }

  setState(manager, (state) => ({
    attention: withEntry(state.attention, args.key, { text: args.text, storyId: args.storyId }),
  }));
  await persistStatus(manager);

  return { saved: true };
}

async function stopWorker(manager: Manager, threadId: string, expectedRunId: string) {
  const control = await serial(manager, async () => {
    const thread = await getThread(threadId, manager.ctx);

    if (thread.runs.at(-1)?.id !== expectedRunId || !getState(manager).active.has(thread.id)) {
      throw new ConflictError("Worker run changed");
    }

    await changeThread(manager, thread.id, "interrupted", { resumable: !!thread.session.file });

    return getState(manager).active.get(thread.id)?.control;
  });

  await control?.stop();

  return { interrupted: threadId };
}

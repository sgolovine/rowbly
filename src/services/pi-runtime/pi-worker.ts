import { isMainThread, type MessagePort, parentPort, workerData } from "node:worker_threads";
import { type AuthRuntime, getAuthStatus, listAvailableModels } from "../agent-auth/agent-auth.js";
import { RowblyError } from "../errors/errors.js";
import { createFactoryRuntime } from "./factory-runtime.js";
import { isPiWorkerData, type PiWorkerKind, type PiWorkerReply, type PiWorkerRequest } from "./pi-worker-protocol.js";

/** Gives a Pi runtime for one request. Tests replace it. */
export type PiRuntimeLoader = () => Promise<AuthRuntime>;

const FAILURES: Readonly<Record<PiWorkerKind, string>> = {
  models: "Pi could not list the models",
  authStatus: "Pi could not read the providers",
};

/**
 * A new runtime for each request, so that a login or a logout in the main thread or in a different process shows
 * in the next answer. A new runtime costs little, and it does not run on the render thread.
 */
async function freshRuntime(): Promise<AuthRuntime> {
  return (await createFactoryRuntime()).runtime;
}

function readKind(runtime: AuthRuntime, kind: PiWorkerKind): Promise<unknown> {
  return kind === "models" ? listAvailableModels(runtime) : getAuthStatus(runtime);
}

/** A Rowbly error has a safe message. A different error can hold credential text, so it gets a fixed message. */
function failureMessage(kind: PiWorkerKind, error: unknown): string {
  return error instanceof RowblyError ? error.message : (FAILURES[kind] ?? "Pi could not answer");
}

/** Answers one request of the Pi worker with plain data, or with an error message without a stack. */
export async function answerPiRequest(
  request: PiWorkerRequest,
  loadRuntime: PiRuntimeLoader = freshRuntime,
): Promise<PiWorkerReply> {
  try {
    if (!(request.kind in FAILURES)) {
      throw new Error("Unknown request");
    }

    const data = await readKind(await loadRuntime(), request.kind);

    return { id: request.id, ok: true, data };
  } catch (error) {
    return { id: request.id, ok: false, message: failureMessage(request.kind, error) };
  }
}

async function answerAndPost(port: MessagePort, request: PiWorkerRequest): Promise<void> {
  port.postMessage(await answerPiRequest(request));
}

function serve(port: MessagePort): void {
  port.on("message", (request: PiWorkerRequest) => answerAndPost(port, request));
}

// Only the thread that the client starts serves requests. An import in a test or in the main thread does nothing.
if (!isMainThread && parentPort && isPiWorkerData(workerData)) {
  serve(parentPort);
}

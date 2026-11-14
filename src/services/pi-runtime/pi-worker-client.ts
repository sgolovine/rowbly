import { Worker } from "node:worker_threads";
import { RowblyError } from "../errors/errors.js";
import type { CatalogModels, CatalogProviders } from "../pi-catalog-cache/pi-catalog-cache.js";
import type { PiCatalogSource } from "../pi-catalog-cache/pi-catalog-refresh.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import { isPiWorkerReply, PI_WORKER_DATA, type PiWorkerKind, type PiWorkerRequest } from "./pi-worker-protocol.js";

/** A request to the Pi worker that failed, or a worker that stopped or did not start. */
export class PiWorkerError extends RowblyError {
  readonly code = "PI_WORKER";
}

/** The part of a `Worker` that the client uses. Tests give a faux worker. */
export interface WorkerLike {
  postMessage(message: PiWorkerRequest): void;
  on(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  unref(): void;
  terminate(): Promise<unknown>;
}

/** A request that waits for its reply, and the worker that has it. */
interface Pending {
  readonly worker: WorkerLike;
  resolve(data: unknown): void;
  reject(error: Error): void;
}

interface ClientState {
  /** The running worker. It is `undefined` before the first request and after a crash or a stop. */
  readonly worker?: WorkerLike;
  readonly nextId: number;
  readonly pending: ReadonlyMap<number, Pending>;
}

/** A client of the Pi worker: how to start a worker, and the state of the worker and its requests. */
export interface PiWorkerClient {
  readonly createWorker: () => WorkerLike;
  readonly store: Store<ClientState>;
}

/** The worker file next to this module: `pi-worker.js` in `dist/`, or `pi-worker.ts` when tsx runs the sources. */
function workerFile(): URL {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";

  return new URL(`./pi-worker${extension}`, import.meta.url);
}

/** Starts the worker thread. The loader flags of this process apply, so that tsx also runs the worker. */
function startWorkerThread(): WorkerLike {
  // Pi output from the worker must not write over the TUI, so the worker gets its own streams and they are dropped.
  const worker = new Worker(workerFile(), {
    execArgv: process.execArgv,
    workerData: PI_WORKER_DATA,
    stdout: true,
    stderr: true,
  });

  worker.stdout.resume();
  worker.stderr.resume();

  return worker;
}

/** Makes a client with its own state. The worker starts at the first request, not here. */
export function createPiWorkerClient(createWorker: () => WorkerLike): PiWorkerClient {
  return { createWorker, store: new Store<ClientState>({ nextId: 1, pending: new Map() }) };
}

// The client of this process. Its worker starts at the first request.
const shared = createPiWorkerClient(startWorkerThread);

function takePending(client: PiWorkerClient, id: number): Pending | undefined {
  const pending = client.store.current.pending.get(id);

  client.store.update((state) => ({ pending: withoutEntry(state.pending, id) }));

  return pending;
}

function onReply(client: PiWorkerClient, message: unknown): void {
  if (!isPiWorkerReply(message)) {
    return;
  }

  const pending = takePending(client, message.id);

  if (message.ok) {
    pending?.resolve(message.data);

    return;
  }

  pending?.reject(new PiWorkerError(message.message));
}

/** Rejects each request of `worker`, and forgets the worker, so that the next request starts a new one. */
function failWorker(client: PiWorkerClient, worker: WorkerLike, message: string): void {
  const failed = [...client.store.current.pending].filter(([, pending]) => pending.worker === worker);

  client.store.update((state) => ({
    worker: state.worker === worker ? undefined : state.worker,
    pending: new Map([...state.pending].filter(([, pending]) => pending.worker !== worker)),
  }));

  for (const [, pending] of failed) {
    pending.reject(new PiWorkerError(message));
  }
}

function startWorker(client: PiWorkerClient): WorkerLike {
  const worker = client.createWorker();

  worker.on("message", (message) => onReply(client, message));
  worker.on("error", () => failWorker(client, worker, "The Pi worker failed"));
  worker.on("exit", () => failWorker(client, worker, "The Pi worker stopped"));
  // The worker must not keep the process alive after the TUI quits.
  worker.unref();
  client.store.update(() => ({ worker }));

  return worker;
}

function currentWorker(client: PiWorkerClient): WorkerLike {
  return client.store.current.worker ?? startWorker(client);
}

function send(client: PiWorkerClient, worker: WorkerLike, kind: PiWorkerKind, settle: Omit<Pending, "worker">): void {
  const id = client.store.current.nextId;

  client.store.update((state) => ({
    nextId: state.nextId + 1,
    pending: withEntry(state.pending, id, { ...settle, worker }),
  }));
  worker.postMessage({ id, kind });
}

/** Sends one request to the worker, and starts the worker when none runs. A worker that cannot start rejects. */
export function requestPiWorker(client: PiWorkerClient, kind: PiWorkerKind): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      send(client, currentWorker(client), kind, { resolve, reject });
    } catch {
      reject(new PiWorkerError("The Pi worker did not start"));
    }
  });
}

/** Terminates the worker of `client` and rejects its requests. A later request starts a new worker. */
export async function stopWorkerOf(client: PiWorkerClient): Promise<void> {
  const { worker } = client.store.current;

  if (!worker) {
    return;
  }

  failWorker(client, worker, "The Pi worker stopped");
  await worker.terminate().catch(() => {});
}

/** The catalog reads of `client`. Each read is a request to its worker. */
export function workerSource(client: PiWorkerClient): PiCatalogSource {
  return {
    listAvailableModels: async () => (await requestPiWorker(client, "models")) as CatalogModels,
    getAuthStatus: async () => (await requestPiWorker(client, "authStatus")) as CatalogProviders,
  };
}

const sharedSource = workerSource(shared);

/** Gives the catalog reads of the Pi worker of this process. The Pi import runs off the render thread. */
export function piWorkerSource(): PiCatalogSource {
  return sharedSource;
}

function ignoreFailure(): undefined {
  return undefined;
}

/** Starts the Pi worker in the background with one cheap read, so that a later read does not wait. */
export async function warmPiWorker(): Promise<void> {
  await requestPiWorker(shared, "authStatus").then(ignoreFailure, ignoreFailure);
}

/** Terminates the Pi worker of this process. The TUI calls it when it quits. */
export function stopPiWorker(): Promise<void> {
  return stopWorkerOf(shared);
}

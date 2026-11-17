import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWorkerRequest } from "./pi-worker-protocol.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The Pi worker client must not load Pi");
});

const started = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:worker_threads", async (original) => {
  const actual = await original<typeof import("node:worker_threads")>();
  return {
    ...actual,
    Worker: vi.fn(function Worker() {
      started.count += 1;
      throw new Error("A real worker must not start in this test");
    }),
  };
});

/** A faux worker that records its requests. A test answers them, or emits `error` or `exit`. */
class FauxWorker extends EventEmitter {
  readonly requests: PiWorkerRequest[] = [];
  readonly unref = vi.fn();
  readonly terminate = vi.fn(async () => {
    this.emit("exit", 1);
    return 1;
  });

  postMessage(message: PiWorkerRequest): void {
    this.requests.push(message);
  }

  reply(request: PiWorkerRequest | undefined, data: unknown): void {
    this.emit("message", { id: request?.id, ok: true, data });
  }
}

async function load() {
  return import("./pi-worker-client.js");
}

function fauxFactory() {
  const workers: FauxWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = new FauxWorker();
    workers.push(worker);
    return worker;
  });
  return { workers, createWorker };
}

afterEach(() => {
  started.count = 0;
});

describe("pi worker client", () => {
  it("starts no worker at import", async () => {
    const client = await load();
    expect(client.piWorkerSource()).toBe(client.piWorkerSource());
    expect(started.count).toBe(0);
  });

  it("starts one worker at the first request, shares it, and matches each reply by id", async () => {
    const { createPiWorkerClient, workerSource } = await load();
    const { workers, createWorker } = fauxFactory();
    const client = createPiWorkerClient(createWorker);
    const source = workerSource(client);
    expect(createWorker).not.toHaveBeenCalled();

    const models = source.listAvailableModels();
    const status = source.getAuthStatus();
    expect(createWorker).toHaveBeenCalledOnce();
    const [worker] = workers;
    expect(worker?.unref).toHaveBeenCalledOnce();
    expect(worker?.requests.map((r) => r.kind)).toEqual(["models", "authStatus"]);
    expect(new Set(worker?.requests.map((r) => r.id)).size).toBe(2);

    // The replies come in the other order.
    worker?.reply(worker.requests[1], [{ id: "acme" }]);
    worker?.reply(worker.requests[0], [{ modelId: "fast-1" }]);
    await expect(models).resolves.toEqual([{ modelId: "fast-1" }]);
    await expect(status).resolves.toEqual([{ id: "acme" }]);
  });

  it("rejects a request with the message of a failed reply", async () => {
    const { createPiWorkerClient, requestPiWorker } = await load();
    const { workers, createWorker } = fauxFactory();
    const client = createPiWorkerClient(createWorker);
    const request = requestPiWorker(client, "models");
    workers[0]?.emit("message", { id: workers[0].requests[0]?.id, ok: false, message: "Pi could not list the models" });
    await expect(request).rejects.toThrow("Pi could not list the models");
  });

  it.each(["error", "exit"])(
    "rejects each pending request on `%s`, and the next request starts a new worker",
    async (event) => {
      const { createPiWorkerClient, requestPiWorker } = await load();
      const { workers, createWorker } = fauxFactory();
      const client = createPiWorkerClient(createWorker);
      const first = requestPiWorker(client, "models");
      const second = requestPiWorker(client, "authStatus");

      workers[0]?.emit(event, event === "error" ? new Error("crash") : 1);
      await expect(first).rejects.toThrow(/Pi worker/);
      await expect(second).rejects.toThrow(/Pi worker/);

      const next = requestPiWorker(client, "models");
      expect(createWorker).toHaveBeenCalledTimes(2);
      workers[1]?.reply(workers[1].requests[0], []);
      await expect(next).resolves.toEqual([]);
    },
  );

  it("stops the worker, rejects the pending requests, and starts a new worker on a later request", async () => {
    const { createPiWorkerClient, requestPiWorker, stopWorkerOf } = await load();
    const { workers, createWorker } = fauxFactory();
    const client = createPiWorkerClient(createWorker);
    await stopWorkerOf(client);
    expect(createWorker).not.toHaveBeenCalled();

    const pending = requestPiWorker(client, "models");
    await stopWorkerOf(client);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    await expect(pending).rejects.toThrow("The Pi worker stopped");

    const later = requestPiWorker(client, "authStatus");
    expect(createWorker).toHaveBeenCalledTimes(2);
    workers[1]?.reply(workers[1].requests[0], ["ok"]);
    await expect(later).resolves.toEqual(["ok"]);
  });

  it("rejects when the worker cannot start, and does not fall back to Pi in this thread", async () => {
    const { createPiWorkerClient, requestPiWorker } = await load();
    const client = createPiWorkerClient(() => {
      throw new Error("missing pi-worker.js");
    });
    await expect(requestPiWorker(client, "models")).rejects.toThrow("The Pi worker did not start");
  });

  it("warms and stops the shared worker without an error when the worker cannot start", async () => {
    const { warmPiWorker, stopPiWorker } = await load();
    await expect(warmPiWorker()).resolves.toBeUndefined();
    expect(started.count).toBe(1);
    await expect(stopPiWorker()).resolves.toBeUndefined();
  });
});

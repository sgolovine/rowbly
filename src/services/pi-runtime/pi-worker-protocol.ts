/** The reads that the Pi worker answers. */
export type PiWorkerKind = "models" | "authStatus";

/** A request to the Pi worker. The client matches the reply to the request by `id`. */
export interface PiWorkerRequest {
  readonly id: number;
  readonly kind: PiWorkerKind;
}

/**
 * A reply of the Pi worker. A failure has only a message, not an `Error` object or a stack, so that no
 * credential text crosses the thread boundary.
 */
export type PiWorkerReply =
  | { readonly id: number; readonly ok: true; readonly data: unknown }
  | { readonly id: number; readonly ok: false; readonly message: string };

/** The `workerData` that marks a thread as the Pi worker. */
export const PI_WORKER_DATA = { rowblyPiWorker: true } as const;

/** True when `data` is the `workerData` of the Pi worker. */
export function isPiWorkerData(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { rowblyPiWorker?: unknown }).rowblyPiWorker === true;
}

/** True when `value` is a reply of the Pi worker. */
export function isPiWorkerReply(value: unknown): value is PiWorkerReply {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

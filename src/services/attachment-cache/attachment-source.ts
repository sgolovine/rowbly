/** One attachment file that a remote worker reads and that is not in the copy of its Thread. */
export interface AttachmentFetch {
  readonly storyId: string;
  readonly id: string;
}

/**
 * Gives the attachment files that are not in the copy of a remote worker. The host agent gives it to the CLI of its
 * workers. A local worker and the main machine have none.
 */
export interface RemoteAttachmentSource {
  /** Gives the bytes of the file. When the file is not available on the host, it throws a ConflictError. */
  readonly fetch: (request: AttachmentFetch) => Promise<Uint8Array>;
}

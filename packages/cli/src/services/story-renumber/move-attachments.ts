import { mkdir, rename, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type Attachment,
  attachmentDir,
  readAttachments,
  writeAttachments,
} from "../attachment-files/attachment-files.js";
import { attachmentFileName } from "../attachment-files/attachment-type.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store } from "../store/store.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** The attachment move of one Story that gets a new number. */
export interface AttachmentFollow {
  /** The old Story ID: `ROW-77`. */
  readonly from: string;
  /** The new Story ID: `ROW-79`. */
  readonly to: string;
  readonly storyUid: string;
}

/** The two folders of a move. */
interface MoveDirs {
  readonly from: string;
  readonly to: string;
}

/** The attachment files that moved so far, for the rollback. */
interface FileProgress {
  readonly moved: readonly string[];
}

async function moveFile(dirs: MoveDirs, name: string, progress: Store<FileProgress>): Promise<void> {
  if (!(await pathExists(join(dirs.from, name)))) {
    return;
  }

  await rename(join(dirs.from, name), join(dirs.to, name));
  progress.update((state) => ({ moved: [...state.moved, name] }));
}

function moveBack(dirs: MoveDirs, name: string): Promise<void> {
  return rename(join(dirs.to, name), join(dirs.from, name));
}

/** Removes the old folder when it has no other files. A folder with other files stays for `doctor`. */
async function removeEmptyDir(dir: string): Promise<void> {
  await rm(join(dir, "manifest.json"), { force: true });
  await rmdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") {
      throw error;
    }
  });
}

/** Writes the manifest of the old folder with the entries that stay, or removes it when no entry stays. */
function writeRest(dir: string, rest: Attachment[]): Promise<void> {
  return rest.length > 0 ? writeAttachments(dir, rest) : removeEmptyDir(dir);
}

/** Moves the files of the entries, then writes the two manifests. A failure moves the files back. */
async function moveEntries(dirs: MoveDirs, moving: Attachment[], rest: Attachment[]): Promise<void> {
  const progress = new Store<FileProgress>({ moved: [] });
  const names = moving.map(attachmentFileName);

  try {
    const existing = await readAttachments(dirs.to);

    await mkdir(dirs.to, { recursive: true });
    await mapInOrder(names, (name) => moveFile(dirs, name, progress));
    await writeAttachments(dirs.to, [...existing, ...moving]);
  } catch (error) {
    await mapInOrder(progress.current.moved.toReversed(), (name) => moveBack(dirs, name));
    throw error;
  }

  await writeRest(dirs.from, rest);
}

/**
 * Moves the attachment entries with the `uid` of the Story from `attachments/<from>/` to `attachments/<to>/`. The
 * other entries stay. Gives the names of the moved attachments.
 */
export async function moveStoryAttachments(paths: ProjectPaths, follow: AttachmentFollow): Promise<string[]> {
  const dirs = { from: await attachmentDir(paths, follow.from), to: await attachmentDir(paths, follow.to) };
  const records = await readAttachments(dirs.from);
  const moving = records.filter((record) => record.storyUid === follow.storyUid);

  if (moving.length === 0) {
    return [];
  }

  await moveEntries(
    dirs,
    moving,
    records.filter((record) => record.storyUid !== follow.storyUid),
  );

  return moving.map((record) => record.name);
}

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type Attachment,
  attachmentDir,
  attachmentOwners,
  noSymlink,
  readAttachments,
  writeAttachments,
} from "../attachment-files/attachment-files.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store } from "../store/store.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report } from "./doctor-run.js";

/**
 * The scan of one attachment folder. The issues stay in the store, so that a later failure in the same
 * folder keeps the issues that the scan found before it.
 */
interface OwnerScan {
  readonly issues: readonly DoctorIssue[];
  readonly kept: readonly Attachment[];
}

/** The attachment folder of one Story, and what the scan knows about it. */
interface OwnerFolder {
  readonly dir: string;
  readonly records: readonly Attachment[];
  readonly scan: Store<OwnerScan>;
}

function addIssue(scan: Store<OwnerScan>, issue: DoctorIssue): void {
  scan.update((state) => ({ issues: [...state.issues, issue] }));
}

/** A record without its PNG has a fix that removes only that record. */
async function checkRecord(run: DoctorRun, folder: OwnerFolder, record: Attachment): Promise<void> {
  const { dir, records, scan } = folder;
  const png = join(dir, `${record.id}.png`);

  await noSymlink(png);

  if (await pathExists(png)) {
    scan.update((state) => ({ kept: [...state.kept, record] }));

    return;
  }

  const issue = await report(
    run,
    {
      severity: "error",
      message: `Attachment ${record.name} has no PNG`,
      file: rel(run, png),
      fix: "Remove the missing-file reference",
    },
    () =>
      writeAttachments(
        dir,
        records.filter((entry) => entry.id !== record.id),
      ),
  );

  addIssue(scan, issue);
}

/** Write the combined repair, so multiple missing files are removed together. */
async function checkManifest(run: DoctorRun, folder: OwnerFolder, file: string): Promise<void> {
  const { kept } = folder.scan.current;

  if (kept.length === folder.records.length) {
    return;
  }

  const issue = await report(
    run,
    {
      severity: "warning",
      message: "Attachment metadata references missing PNGs",
      file: rel(run, file),
      fix: "Remove missing-file references",
    },
    () => writeAttachments(folder.dir, [...kept]),
  );

  addIssue(folder.scan, issue);
}

/** A PNG without a record, or in the folder of a Story that does not exist, stays for recovery. */
async function checkOrphans(run: DoctorRun, folder: OwnerFolder, owned: boolean): Promise<void> {
  const { dir, records } = folder;
  const names = await readdir(dir);
  const orphans = names.filter(
    (name) => name.endsWith(".png") && (!owned || !records.some((a) => `${a.id}.png` === name)),
  );
  const issues = orphans.map((name) =>
    noted({ severity: "warning", message: "Orphan PNG: preserve it for recovery", file: rel(run, join(dir, name)) }),
  );

  folder.scan.update((state) => ({ issues: [...state.issues, ...issues] }));
}

async function scanOwner(run: DoctorRun, owner: string, file: string, scan: Store<OwnerScan>): Promise<void> {
  const dir = await attachmentDir(run.paths, owner);
  const records = await readAttachments(dir);
  const owned = await pathExists(join(run.paths.storiesDir, `${owner}.md`));

  const folder: OwnerFolder = { dir, records, scan };

  await mapInOrder(records, (record) => checkRecord(run, folder, record));
  await checkManifest(run, folder, file);
  await checkOrphans(run, folder, owned);
}

async function checkOwner(run: DoctorRun, owner: string): Promise<DoctorIssue[]> {
  const file = join(run.paths.dir, "attachments", owner, "manifest.json");
  const scan = new Store<OwnerScan>({ issues: [], kept: [] });

  try {
    await scanOwner(run, owner, file, scan);

    return [...scan.current.issues];
  } catch (err) {
    const message = `Malformed attachment metadata: ${err instanceof Error ? err.message : String(err)}`;

    return [...scan.current.issues, noted({ severity: "error", message, file: rel(run, file) })];
  }
}

/** The Story IDs with an attachment folder, or the error issue when the folder cannot be read. */
async function readOwners(run: DoctorRun): Promise<string[] | DoctorIssue> {
  try {
    return await attachmentOwners(run.paths);
  } catch (err) {
    return noted({ severity: "error", message: String(err), file: rel(run, join(run.paths.dir, "attachments")) });
  }
}

/** Each attachment record must have its PNG. A folder that cannot be read gives one error. */
export async function checkAttachments(run: DoctorRun): Promise<DoctorIssue[]> {
  const owners = await readOwners(run);

  if (!Array.isArray(owners)) {
    return [owners];
  }

  const issues = await mapInOrder(owners, (owner) => checkOwner(run, owner));

  return issues.flat();
}

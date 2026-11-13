import { createHash } from "node:crypto";

/** A bounded page of one list section. `nextCursor` is the index of the first item that the page left out. */
interface DigestPage {
  readonly key: string;
  readonly items: readonly unknown[];
  readonly total: number;
  readonly nextCursor: number | null;
}

/** One top-level key of the digest: a page for a list, or a bounded value. */
interface Section {
  readonly key: string;
  readonly value: unknown;
  readonly page?: DigestPage;
}

interface Digest {
  readonly hash: string;
  readonly text: string;
  readonly deliveredCounts: Record<string, number>;
}

const PAGE_ITEMS = 12;
const MAX_ITEM_BYTES = 1024;
const TRUNCATED_ITEM_BYTES = 450;
const MAX_DIGEST_BYTES = 16 * 1024;

/** Gives a short hash of a prompt, to find a changed prompt. */
export function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function boundedItem(value: unknown): unknown {
  const text = JSON.stringify(value);

  if (Buffer.byteLength(text) <= MAX_ITEM_BYTES) {
    return value;
  }

  return { truncated: true, text: Buffer.from(text).subarray(0, TRUNCATED_ITEM_BYTES).toString("utf8") };
}

function section(key: string, value: unknown): Section {
  if (!Array.isArray(value)) {
    return { key, value: boundedItem(value) };
  }

  const page: DigestPage = {
    key,
    items: value.slice(0, PAGE_ITEMS).map(boundedItem),
    total: value.length,
    nextCursor: value.length > PAGE_ITEMS ? PAGE_ITEMS : null,
  };

  return { key, value, page };
}

function render(sections: readonly Section[]): string {
  return JSON.stringify(Object.fromEntries(sections.map(({ key, value, page }) => [key, page ?? value])));
}

function itemBytes(page: DigestPage | undefined): number {
  return Buffer.byteLength(JSON.stringify(page?.items));
}

/** Gives the page with the most item bytes. The first of equal pages wins. */
function largestPage(sections: readonly Section[]): Section | undefined {
  return sections
    .filter(({ page }) => page && page.items.length > 0)
    .toSorted((a, b) => itemBytes(b.page) - itemBytes(a.page))[0];
}

function withoutLastItem(page: DigestPage): DigestPage {
  const items = page.items.slice(0, -1);

  return { ...page, items, nextCursor: items.length };
}

/** Removes the last item of the largest page until the digest fits. Each list has at most twelve items. */
function fitDigest(sections: readonly Section[]): readonly Section[] {
  if (Buffer.byteLength(render(sections)) <= MAX_DIGEST_BYTES) {
    return sections;
  }

  const largest = largestPage(sections);

  if (!largest?.page) {
    throw new Error("Supervisor digest has too many scalar sections");
  }

  const page = withoutLastItem(largest.page);

  return fitDigest(sections.map((current) => (current === largest ? { ...current, page } : current)));
}

/** Hashes operational facts. Heartbeats and scan counters never enter this input. */
export function supervisorDigest(input: Record<string, unknown>): Digest {
  const sections = fitDigest(Object.entries(input).map(([key, value]) => section(key, value)));
  const text = render(sections);
  const pages = sections.flatMap(({ page }) => (page ? [page] : []));

  return {
    hash: createHash("sha256").update(text).digest("hex"),
    text,
    deliveredCounts: Object.fromEntries(pages.map((page) => [page.key, page.items.length])),
  };
}

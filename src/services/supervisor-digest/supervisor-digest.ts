import { createHash } from "node:crypto";

export const promptHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function boundedItem(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) <= 1024) {
    return value;
  }
  return { truncated: true, text: Buffer.from(text).subarray(0, 450).toString("utf8") };
}

/** Hashes operational facts. Heartbeats and scan counters never enter this input. */
export function supervisorDigest(input: Record<string, unknown>) {
  const sections: Record<string, unknown> = {};
  const pages: { key: string; items: unknown[]; total: number; nextCursor: number | null }[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      const page = {
        key,
        items: value.slice(0, 12).map(boundedItem),
        total: value.length,
        nextCursor: value.length > 12 ? 12 : null,
      };
      pages.push(page);
      sections[key] = page;
    } else {
      sections[key] = boundedItem(value);
    }
  }
  let text = JSON.stringify(sections);
  while (Buffer.byteLength(text) > 16 * 1024) {
    const largest = pages
      .filter((page) => page.items.length > 0)
      .sort((a, b) => Buffer.byteLength(JSON.stringify(b.items)) - Buffer.byteLength(JSON.stringify(a.items)))[0];
    if (!largest) {
      throw new Error("Supervisor digest has too many scalar sections");
    }
    largest.items.pop();
    largest.nextCursor = largest.items.length;
    text = JSON.stringify(sections);
  }
  return {
    hash: createHash("sha256").update(text).digest("hex"),
    text,
    deliveredCounts: Object.fromEntries(pages.map((page) => [page.key, page.items.length])),
  };
}

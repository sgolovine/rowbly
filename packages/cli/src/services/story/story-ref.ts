// The shared rule that finds the Story of a record. A record keeps the Story ID and, when the Story has one, the
// Story `uid`. This module does no I/O, so that the pure factory policy can use it.

/** The reference of a record to its Story. */
export interface StoryRef {
  /** The Story ID when the record was made, for example `ROW-01`. */
  readonly id: string;
  /** The permanent `uid` of the Story. An old record or a Story without a `uid` has none. */
  readonly uid?: string;
}

/**
 * Gives the Story of the reference. The Story with the `uid` of the reference comes first. When the reference has no
 * `uid`, or no Story has it, the Story with the ID of the reference comes next. Gives `undefined` when neither matches.
 */
export function matchStoryRef<T extends StoryRef>(stories: readonly T[], ref: StoryRef): T | undefined {
  const byUid = ref.uid === undefined ? undefined : stories.find((story) => story.uid === ref.uid);

  return byUid ?? stories.find((story) => story.id === ref.id);
}

/** Tells if the reference finds `story` among `stories`. `story` must be an item of `stories`. */
export function refersToStory<T extends StoryRef>(stories: readonly T[], ref: StoryRef, story: T): boolean {
  return matchStoryRef(stories, ref) === story;
}

/** The reference of a record with a Story ID and an optional `storyUid`. A missing `storyUid` gives no `uid` key. */
export function recordRef(storyId: string, storyUid: string | undefined): StoryRef {
  return storyUid === undefined ? { id: storyId } : { id: storyId, uid: storyUid };
}

/** The `storyUid` key of a new record: the `uid` of the Story, or no key when the Story has no `uid`. */
export function storyUidField(story: { readonly uid?: unknown }): { storyUid?: string } {
  return typeof story.uid === "string" ? { storyUid: story.uid } : {};
}

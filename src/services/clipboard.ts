import { readClipboardImage } from '../storage/clipboard';

export type { ClipboardImageResult } from '../storage/clipboard';
export { readClipboardImage };
/** Clipboard reads run outside operations and do not acquire the Data Root lock. */
export const clipboard = { readImage: readClipboardImage };

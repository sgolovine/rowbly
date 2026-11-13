/** Removes terminal escape sequences and control characters: a conversation is text, never terminal commands. */
export function safeText(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the sequences to remove.
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-_]/g, "")
      .replaceAll("\t", "  ")
      .replaceAll("\r\n", "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters to remove.
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
  );
}

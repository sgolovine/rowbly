/** The columns of the widest value and `pad` spaces. */
export function columnWidth(values: readonly string[], pad = 2): number {
  return Math.max(0, ...values.map((value) => value.length)) + pad;
}

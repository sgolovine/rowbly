/** Replaces the named fields in a worker message. */
export function renderWorkerMessage(template, fields) {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name) => fields[name] ?? "").trimEnd();
}

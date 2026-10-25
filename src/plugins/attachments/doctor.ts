import { type PluginDoctor, type PluginFinding, toTimestamp } from '../../plugin-api';
import { requireAttachments } from './attachments';
import { AttachmentsBag } from './model';

export const doctor: PluginDoctor<unknown> = {
  async check({ data, plugin }) {
    const findings: PluginFinding[] = [];
    for (const story of data.stories) {
      const bag = plugin.inspectBag(story, AttachmentsBag);
      // Core reports PLUGIN_DATA_INVALID; unknown data cannot be repaired safely.
      if (bag.kind === 'invalid') continue;
      const entries = bag.kind === 'valid' ? bag.value.attachments : [];
      const files = new Set(await plugin.files.list({ story: story.key }));
      const folder = `boards/${story.boardId}/stories/${story.key}`;
      const expected = new Set(entries.map((entry) => `${entry.id}.png`));
      for (const entry of entries) {
        if (files.has(`${entry.id}.png`)) continue;
        findings.push({
          code: 'MISSING_FILE',
          severity: 'warning',
          path: `${folder}/story.json`,
          message: `${story.key} Attachment ${entry.id} has no PNG file`,
          details: { id: entry.id },
          async fix(changes) {
            // A prior repair or transform may have restored it; read the pending file again.
            if ((await changes.readBinaryFile({ story: story.key }, `${entry.id}.png`)) !== null)
              return `kept restored Attachment ${entry.id}`;
            await changes.updateStory(story.key, (current) => {
              const attachments = requireAttachments(plugin, current).filter((value) => value.id !== entry.id);
              return {
                ...plugin.writeBag(current, attachments.length ? { attachments } : undefined),
                updatedAt: toTimestamp(plugin.now()),
              };
            });
            return `removed missing Attachment ${entry.id} from ${story.key}`;
          },
        });
      }
      for (const file of files) {
        if (expected.has(file)) continue;
        findings.push({
          code: 'ORPHAN_FILE',
          severity: 'warning',
          path: `${folder}/plugins/attachments/${file}`,
          message: `${story.key} has an unreferenced Attachment file; kept for recovery`,
        });
      }
    }
    return findings;
  },
};

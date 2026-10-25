import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { doctor } from './doctor';
import { AttachmentsBag } from './model';

export const attachments = definePlugin({
  id: 'attachments',
  name: 'Attachments',
  description: 'PNG Attachments on Stories',
  bags: { story: AttachmentsBag },
  commands,
  doctor,
});

import {makeRoot,makeStory,show} from './lib';
import {CoreChangeSet} from '/home/sgolovine/Projects/rowbly/src/services/plugins/changeSet';
import {createRepositories} from '/home/sgolovine/Projects/rowbly/src/storage';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const t=await makeRoot();const s=await makeStory(t.path,{boardId:'web',key:'WEB-1'});
const c=new CoreChangeSet(t.root,createRepositories(t.root));await c.forPlugin('fixture').writeFile({story:'WEB-1'},'note.txt','new');c.recordStory(s,{...s,key:'WEB-2'});await c.save();
show('folders after move + earlier file write',await readdir(join(t.path,'boards/web/stories')));
show('file remains at old folder',await readFile(join(t.path,'boards/web/stories/WEB-1/plugins/fixture/note.txt'),'utf8'));await t.cleanup();

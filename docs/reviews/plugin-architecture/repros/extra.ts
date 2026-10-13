import { definePlugin } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { createProgram, main } from '/home/sgolovine/Projects/rowbly/src/main';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScreenBoundary } from '/home/sgolovine/Projects/rowbly/src/tui/shell/ScreenBoundary';

const boundary = new ScreenBoundary({ onError: () => {}, children: null });
boundary.state = { error: new TypeError('plugin render bug') };
try { boundary.render(); } catch(e) { show('render boundary rethrows ordinary plugin error', String(e)); }

const corruptBefore = definePlugin({id:'before', name:'Before', description:'', hooks:{'stories.remove':{transform({changes}){ const c=changes.story('WEB-1'); if(c?.before) c.before.key='WEB-2'; }}}});
{
 const t=await makeRoot({before:true});
 await makeStory(t.path,{boardId:'web',key:'WEB-1'}); await makeStory(t.path,{boardId:'web',key:'WEB-2'});
 const {services}=await withPlugins(t,[corruptBefore]); await services.stories.remove('WEB-1');
 show('mutating before changes deletion target', (await services.stories.list('web',{})).map(s=>s.key)); await t.cleanup();
}
const filter = definePlugin({id:'filter-bug',name:'Filter',description:'',filterStories(){throw new TypeError('filter bug');},options:{'stories list':{options:[{flags:'--boom',description:'boom'}],input:()=>true}}});
const command = definePlugin({id:'command-bug',name:'Command',description:'',commands(group,cli){group.command('go').action((_o,c)=>cli.run(c,async()=>{throw new Error('command bug');}));}});
{
 const t=await makeRoot({'filter-bug':true,'command-bug':true}); await makeStory(t.path,{boardId:'web',key:'WEB-1'});
 show('filter CLI exit',await main(['--root',t.path,'--json','stories','list','--board','web','--boom'],[filter,command]));
 show('command CLI exit',await main(['--root',t.path,'--json','command-bug','go'],[filter,command])); await t.cleanup();
}
const duplicate=definePlugin({id:'duplicates',name:'Duplicate',description:'',options:{'stories create':{options:[{flags:'--foo-bar <x>',description:'x'},{flags:'--fooBar <x>',description:'x'}],input:()=>undefined}}});
const collisions=definePlugin({id:'collisions',name:'Collision',description:'',options:{'stories create':{options:[{flags:'--foo <x>',description:'x'},{flags:'--foo <y>',description:'y'}],input:()=>undefined}}});
{
const t=await makeRoot({collisions:true}); const {host}=await withPlugins(t,[collisions]);show('duplicate flags load',host.status());try{createProgram(host); show('duplicate flags attached','yes');}catch(e){show('attachment error',String(e));} await t.cleanup();
}
const resurrect=definePlugin({id:'resurrect',name:'Resurrect',description:'',hooks:{'stories.remove':{async transform({changes}){await changes.writeFile({story:'WEB-1'},'left.txt','left');}}}});
{
 const t=await makeRoot({resurrect:true});await makeStory(t.path,{boardId:'web',key:'WEB-1'});const {services}=await withPlugins(t,[resurrect]);await services.stories.remove('WEB-1');show('file write after deletion',await services.plugins.context('resurrect').files.list('dataRoot')); const s=await services.stories.create('web',{name:'New'});show('new story adopted deleted plugin file',await services.plugins.context('resurrect').files.read({story:s.key},'left.txt'));await t.cleanup();
}

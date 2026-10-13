import { definePlugin } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { makeRoot,makeStory,withPlugins,show,readJson } from './lib';
import { mkdir,symlink,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
const pathPlugin=definePlugin({id:'paths',name:'Paths',description:''});
{
 const t=await makeRoot({paths:true});await mkdir(join(t.path,'plugins'),{recursive:true});await mkdir(join(t.dir,'outside'));await writeFile(join(t.dir,'outside','secret.txt'),'secret');await symlink(join(t.dir,'outside'),join(t.path,'plugins/paths'));
 const {services}=await withPlugins(t,[pathPlugin]);const p=services.plugins.context('paths');show('symlink read outside root',await p.files.read('dataRoot','secret.txt'));await p.operation('write',{},async c=>c.writeFile('dataRoot','secret.txt','overwritten'));show('symlink write outside root',await readFile(join(t.dir,'outside','secret.txt'),'utf8'));await t.cleanup();
}
const move=definePlugin({id:'move',name:'Move',description:'',hooks:{'doctor.fix':{async transform({changes}){const c=changes.story('WEB-1');if(c?.after) await changes.writeFile({story:c.after.key},'x.txt','new');}}}});
const hyphen=definePlugin({id:'two-words',name:'Two words',description:'',doctor:{check:()=>[{code:'BROKEN',severity:'warning',path:'x',message:'x',fix:async()=>{throw Error('oops');}}]}});
{
 const t=await makeRoot({'two-words':true});const {services}=await withPlugins(t,[hyphen]);try{await services.doctor.fix();}catch(e){show('hyphenated doctor plugin identity',(e as any).details);}await t.cleanup();
}
const hang=definePlugin({id:'hang',name:'Hang',description:'',hooks:{'boards.update':{react:()=>new Promise<void>(()=>{})}}});
if(process.argv.includes('--hang')){const t=await makeRoot({hang:true});const {services}=await withPlugins(t,[hang]);await services.boards.update('web',{name:'Saved'});}

import { definePlugin, z } from '/home/sgolovine/Projects/rowbly/src/plugin-api';
import { makeRoot, makeStory, withPlugins, show, readJson } from './lib';
import { reservedNames, createProgram } from '/home/sgolovine/Projects/rowbly/src/main';
import { loadPlugins } from '/home/sgolovine/Projects/rowbly/src/services';
import { withPlugins as loadTui } from '/home/sgolovine/Projects/rowbly/src/tui/loadPlugins';
import { CoreChangeSet } from '/home/sgolovine/Projects/rowbly/src/services/plugins/changeSet';
import { createRepositories } from '/home/sgolovine/Projects/rowbly/src/storage';
import { comments } from '/home/sgolovine/Projects/rowbly/src/plugins/comments';
import { addComment } from '/home/sgolovine/Projects/rowbly/src/plugins/comments/comments';
const bad=definePlugin({id:'bad',name:'Bad',description:'',start(){throw Error('start bug');}});
{
 const p=definePlugin({id:'prompt-clash',name:'Prompt clash',description:'',options:{'stories create':{options:[{flags:'--prompt <x>',description:'x'}],input:()=>undefined}}});
 const t=await makeRoot({'prompt-clash':true});const {host}=await withPlugins(t,[p]);show('global negation base clash',host.status());const program=createProgram(host);await program.parseAsync(['--no-prompt','stories','create','--help'],{from:'user'}).catch(()=>{});await t.cleanup();
}
{
 const t=await makeRoot({bad:true}); const warnings:string[]=[];const ctx=(await withPlugins(t,[bad])).ctx;
 const toasts={push(_kind:string,msg:string){warnings.push(msg);}} as any;
 const load=(root:any)=>loadPlugins({root,registry:[bad],reserved:reservedNames()});
 await loadTui(ctx,load,toasts);await loadTui(ctx,load,toasts);show('same failed plugin warns twice after reload',warnings.length);
 const ctx2=(await withPlugins(t,[bad])).ctx;await loadTui(ctx2,undefined,toasts);show('no-loader backgroundReactions',ctx2.backgroundReactions??false);await t.cleanup();
}
{
 const options={'stories create':{options:[{flags:'--shared <x>',description:'x'}],input:()=>undefined}} as const;
 const fails=definePlugin({id:'fails',name:'Fails',description:'',options,commands(){throw Error('commands bug');}});
 const later=definePlugin({id:'later',name:'Later',description:'',options});const t=await makeRoot({fails:true,later:true});const {host}=await withPlugins(t,[fails,later]);createProgram(host);show('late registration failure retains name claims',host.status());await t.cleanup();
}
{
 const t=await makeRoot({comments:true});await makeStory(t.path,{boardId:'web',key:'WEB-1',plugins:{comments:{comments:[{id:'old',body:'old',author:null,createdAt:'bad date',updatedAt:'bad date'}],future:'keep'},other:{invalid:17}}});
 const {services}=await withPlugins(t,[comments]);await addComment(services.plugins.context('comments'),'WEB-1','new');show('add comment replaces invalid existing thread',(await readJson(t.path,'boards/web/stories/WEB-1/story.json')).plugins);await t.cleanup();
}
{
 const t=await makeRoot();const repos=createRepositories(t.root);const c=new CoreChangeSet(t.root,repos);const board={...(await repos.boards.get('web')),id:'new',keyPrefix:'NEW'};await c.putBoard(board);try{await c.forPlugin('fixture').writeFile({board:'new'},'note.txt','x');}catch(e){show('pending new board file scope',String(e));}await t.cleanup();
}
{
 const p=definePlugin({id:'fixture',name:'Fixture',description:''});const t=await makeRoot({fixture:true});const {services}=await withPlugins(t,[p]);const ctx=services.plugins.context('fixture');
 for(const name of ['../x','/tmp/x','a/../x','./x','a//x']){try{await ctx.files.read('dataRoot',name);show(name,'accepted');}catch(e){show(name,(e as any).code);}}
 const original={plugins:{fixture:{bad:'invalid'},other:{expected:'any nested object',nested:[1,{a:2}]}}};show('writing own bag preserves other raw object',ctx.writeBag(original,{ok:true}).plugins.other);await t.cleanup();
}

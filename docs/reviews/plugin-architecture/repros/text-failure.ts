import {writeFile,readFile,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const dir=await mkdtemp('/tmp/rowbly-text-');const file=join(dir,'spec.md');await writeFile(file,'OLD'.repeat(10000));
await writeFile(join(dir,'write.mts'),`import {writeTextFile} from '/home/sgolovine/Projects/rowbly/src/storage/system'; await writeTextFile(process.argv[2], 'NEW'.repeat(100000));`);
const result=spawnSync('bash',['-c','ulimit -f 2; exec "$1" "$2" "$3"','review','/home/sgolovine/Projects/rowbly/node_modules/.bin/tsx',join(dir,'write.mts'),file],{encoding:'utf8'});
console.log(JSON.stringify({status:result.status,signal:result.signal,length:(await readFile(file)).length,oldLength:30000,stderr:result.stderr}));

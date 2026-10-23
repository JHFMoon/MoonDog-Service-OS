const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const maintenance = require('../assets/maintenance.js');

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function run() {
  const now=Date.parse('2026-10-12T14:00:00Z');
  const names=[1,2,3,4].map(n=>
    `MoonDog-Update-Backup-2026-10-${String(n+5).padStart(2,'0')}T10-00-00-000Z-00000000-0000-4000-8000-00000000000${n}`);
  const contents=new Map();
  const content=Buffer.from('previous verified runtime');
  for(let i=0;i<names.length;i++) {
    const base='backups/system-updates/'+names[i];
    contents.set(base+'/assets/app.js',{bytes:content,modified:now-(8-i)*120000});
    contents.set(base+'/journal.json',{bytes:Buffer.from(JSON.stringify({status:'verified',inventory:[
      {path:'assets/app.js',existed:true,sha256:digest(content)}
    ]})),modified:now-(8-i)*120000});
  }
  const suspect='backups/system-updates/'+names[0].replace('000000000001','000000000099');
  contents.set(suspect+'/assets/app.js',{bytes:content,modified:now-999999});
  const removed=[];let completed;
  const io={
    list:async(dir,recursive)=>dir==='backups'?[...contents.keys()]:[],
    stat:async p=>({modified:contents.get(p).modified}),
    read:async p=>contents.get(p).bytes,
    hash:async bytes=>digest(bytes),
    exists:async()=>false,
    removeTree:async p=>{removed.push(p);for(const key of [...contents.keys()])if(key.startsWith(p+'/'))contents.delete(key);},
    listDirectories:async()=>[],
  };
  const api={
    now:()=>now,day:()=> '2026-10-12',recovery:()=>({housekeeping:{}}),references:()=>[],
    busy:()=>false,ensureFolders:async()=>{},validateCurrent:async()=>{throw Error('unrelated operational state not verified');},
    currentWorkbook:()=> 'exports/current.xlsx',validateBackup:async()=>{},
    checkpoint:async()=>{},finish:async x=>{completed=x;},diagnostic:async()=>{},changed:()=>{},
  };
  const outcome=await maintenance.create(io,api).run({force:true});
  assert.equal(outcome.failed,undefined);
  assert.deepEqual(removed,['backups/system-updates/'+names[0]],'only the oldest of four completed snapshots should be removed');
  assert(contents.has(suspect+'/assets/app.js'),'unknown/incomplete backup must remain untouched');
  assert.equal(completed.filesRemoved,2);
  assert(completed.bytesReclaimed>0);
  assert(completed.issues.some(x=>x.reason.includes('invalid or incomplete')),'unverified backup must be reported');
  const context={day:'2026-10-12',references:[],currentValid:false,restoreBusy:false};
  assert.equal(maintenance.policy([{path:'backups/pre-change.json',area:'automatic',valid:true,modified:1,day:'2026-09-01'}],context).length,0,'invalid operational state must continue to protect operational backups');
  console.log('PASS completed-only rollback pruning, with incomplete and operational data preserved');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

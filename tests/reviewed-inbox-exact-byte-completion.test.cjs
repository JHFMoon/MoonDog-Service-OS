"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function completeExactReviewedInboxSource(");
const end=app.indexOf("  async function reconcileLearnedFiles(",start);
assert.ok(start>=0&&end>start,"production exact-byte Inbox completion helper exists");
const helper=app.slice(start,end);
const clone=x=>JSON.parse(JSON.stringify(x));
const bytes=values=>Uint8Array.from(values).buffer;
function fixture({pending=true,kind="csi",inboxValues=[1,2,3],selectedValues=[1,2,3],readError=null,
                 mutateRootOnRead=false,failWrite=false}={}){
  const root={name:"synthetic-workspace-A"};
  const otherRoot={name:"synthetic-workspace-B"};
  const filename="synthetic-report.csv",signature="01 - DROP REPORTS HERE/"+filename+"|3|123";
  const marker={kind,manualImportRequired:pending,relativePath:"01 - DROP REPORTS HERE/"+filename,
    sourceStoreConfidence:"configured-destination-only"};
  const model={root,autoImport:{seen:{[signature]:marker}}};
  const events=[],selected=bytes(selectedValues);
  let saved=null;
  const ctx=vm.createContext({
    model,REPORT_INBOX:"01 - DROP REPORTS HERE",
    AUTO_IMPORT_PATH:["data","auto-import.json"],Uint8Array,ArrayBuffer,
    now:()=>"2026-11-04T12:00:00Z",
    sameByteContent:(a,b)=>{
      const x=new Uint8Array(a),y=new Uint8Array(b);
      return x.length===y.length&&x.every((value,i)=>value===y[i]);
    },
    reportInbox:async()=>({
      getFileHandle:async(name)=>{
        assert.equal(name,filename);
        if(readError)throw Object.assign(new Error("synthetic source unavailable"),{name:readError});
        return{getFile:async()=>{
          if(mutateRootOnRead)model.root=otherRoot;
          return{size:3,lastModified:123,arrayBuffer:async()=>bytes(inboxValues)};
        }};
      }
    }),
    writeJson:async(_path,value)=>{
      events.push("ledger-write");
      if(failWrite)throw Error("synthetic durable write refused");
      saved=clone(value);
    }
  });
  vm.runInContext(helper+"\nthis.complete=completeExactReviewedInboxSource;",ctx);
  return {run:(incomingKind=kind,originalRoot=root)=>ctx.complete(filename,incomingKind,selected,originalRoot),
    model,events,marker,signature,saved:()=>saved,root,otherRoot};
}
test("exact bytes complete held review only after verified import and durable ledger save",async()=>{
  const f=fixture();
  assert.equal(await f.run(),true);
  assert.deepEqual(f.events,["ledger-write"]);
  const saved=f.saved().seen[f.signature];
  assert.equal(saved.manualImportRequired,false);
  assert.equal(saved.manualImportCompletedAt,"2026-11-04T12:00:00Z");
  assert.equal(saved.sourceStoreConfidence,"configured-destination-only");
  assert.equal(f.model.autoImport.seen[f.signature].manualImportRequired,false);
});
test("same filename with different bytes never completes held report",async()=>{
  const f=fixture({inboxValues:[9,9,9]});
  assert.equal(await f.run(),false);
  assert.deepEqual(f.events,[]);
  assert.equal(f.model.autoImport.seen[f.signature].manualImportRequired,true);
});
test("non-review and mismatched source family never clears an unrelated source",async()=>{
  for(const config of [{pending:false},{kind:"csi"}]){
    const f=fixture(config);
    assert.equal(await f.run(config.pending===false?"csi":"vir"),false);
    assert.deepEqual(f.events,[]);
    assert.equal(f.saved(),null);
  }
});
test("missing Inbox source does not become a new report or a false clearance",async()=>{
  const f=fixture({readError:"NotFoundError"});
  assert.equal(await f.run(),false);
  assert.equal(f.saved(),null);
});
test("source-root change while reading Inbox cannot clear new workspace",async()=>{
  const f=fixture({mutateRootOnRead:true});
  assert.equal(await f.run(),false);
  assert.equal(f.saved(),null);
  assert.equal(f.model.autoImport.seen[f.signature].manualImportRequired,true);
});
test("failed durable ledger write leaves review pending and original untouched",async()=>{
  const f=fixture({failWrite:true});
  await assert.rejects(f.run(),/synthetic durable write refused/);
  assert.equal(f.model.autoImport.seen[f.signature].manualImportRequired,true);
  assert.deepEqual(f.events,["ledger-write"]);
});
test("unknown report families never modify review authority",async()=>{
  const f=fixture();
  assert.equal(await f.run("open-ro"),false);
  assert.equal(f.saved(),null);
});
test("Daily importer runs approved source persistence before optional exact-byte completion",()=>{
  const entry=app.indexOf("    importFile: async function(file) {");
  const end=app.indexOf("  const physicalWorkspacePath",entry);
  assert.ok(entry>0&&end>entry);
  const code=app.slice(entry,end);
  const committed=code.indexOf("await processClassifiedCandidate({name:file.name,location:'picked'},kind,bytes,false)");
  const cleared=code.indexOf("await completeExactReviewedInboxSource(file.name,kind,bytes,requestedRoot)");
  assert.ok(committed>=0&&cleared>committed,"manager-approved actual import must succeed before ledger clearing");
  assert.match(code,/catch\(error\) \{[\s\S]*?Completed report import but source review marker was retained/);
  assert.match(code,/finally \{ dailyPickedSources\.clear\(\); dailyImportBusy=false/);
  new vm.Script(app);
});

test("completed unsigned Inbox review does not replay on the next watcher poll",async()=>{
  for(const kind of ["performance","csi","vir","next-appointments","supplemental-csv"]){
    const f=fixture({kind});
    assert.equal(await f.run(),true);
    const a=app.indexOf("  function candidateNeedsImport(");
    const b=app.indexOf("  function transientWorkspaceState(",a);
    assert.ok(a>=0&&b>a);
    const ctx=vm.createContext({model:f.model});
    vm.runInContext(app.slice(a,b)+"\nthis.needs=candidateNeedsImport;",ctx);
    assert.equal(ctx.needs({signature:f.signature,location:"inbox"}),false,
      kind+" already reviewed Inbox must not be auto-imported");
    assert.equal(ctx.needs({signature:f.signature+"-modified",location:"inbox"}),true,
      kind+" changed original must be re-reviewed");
  }
});

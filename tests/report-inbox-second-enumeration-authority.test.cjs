"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=source.indexOf("  async function autoSurveyFolder(");
const end=source.indexOf("  async function ",start+10);
assert.ok(start>=0&&end>start,"actual production autoSurveyFolder function exists");
const production=source.slice(start,end);

function harness({pauseAt="",candidates=[]}={}){
  const root={name:"Synthetic A"},state={root,canWrite:true,watch:true,importing:false};
  const model={root,autoImport:{inboxVersion:1,initializedAt:"2026-10-31T12:00:00Z"}};
  const calls={enumerations:0,metadataReads:0,writes:0,imports:0};
  let ready,release;
  const entered=new Promise(resolve=>{ready=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const pause=async step=>{if(pauseAt===step){ready();await gate;}};
  const context=vm.createContext({
    model,now:()=>"2026-10-31T12:00:01Z",
    watchCandidates:async()=>{calls.enumerations++;await pause("enumeration");return candidates;},
    candidateNeedsImport:()=>true,
    sourceLocations:new Map(),
    writeJson:async()=>{calls.writes++;},
    processClassifiedCandidate:async()=>{calls.imports++;return{saved:true};},
    recordDiagnostic(){},status(){},
    Map,Set,Object,Array,Promise,Boolean,JSON,Date,console
  });
  vm.runInContext(production+"\nthis.run=autoSurveyFolder",context);
  const eligible=()=>model.root===root&&state.canWrite&&state.watch&&!state.importing;
  return{model,root,state,calls,entered,release:()=>release(),
    run:()=>context.run(new Set(["Report Inbox/synthetic.csv|10|1"]),eligible)};
}

test("root switch during the second candidate enumeration cannot mutate intake ledger",async()=>{
  const h=harness({pauseAt:"enumeration",candidates:[{
    name:"synthetic.csv",signature:"Report Inbox/synthetic.csv|10|1",
    location:"inbox",file:{lastModified:1}
  }]});
  const running=h.run();
  await h.entered;
  h.model.root={name:"Synthetic B"};
  h.release();
  const result=await running;
  assert.equal(result,null);
  assert.equal(h.calls.enumerations,1);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.imports,0);
  assert.equal(h.model.autoImport.seen,undefined);
});

test("permission or manual-import transition while the second enumeration awaits fails closed",async()=>{
  for(const transition of [
    h=>{h.state.canWrite=false;},
    h=>{h.state.watch=false;},
    h=>{h.state.importing=true;}
  ]){
    const h=harness({pauseAt:"enumeration",candidates:[]});
    const running=h.run();
    await h.entered;transition(h);h.release();
    assert.equal(await running,null);
    assert.equal(h.calls.writes,0);
    assert.equal(h.model.autoImport.seen,undefined);
  }
});

test("switch during asynchronous CSV preview cannot initialize another Workspace intake ledger",async()=>{
  const h=harness({candidates:[{
    name:"synthetic.csv",relativePath:"Report Inbox/synthetic.csv",
    signature:"Report Inbox/synthetic.csv|10|1",location:"inbox",
    file:{lastModified:1,slice(){return{text:async()=>{h.calls.metadataReads++;await previewGate;return"next appointments scheduled summary";}}}}
  }]});
  let previewRelease;
  const previewGate=new Promise(resolve=>{previewRelease=resolve;});
  const running=h.run();
  // Ensure the first metadata read has started before changing roots.
  while(!h.calls.metadataReads)await Promise.resolve();
  h.model.root={name:"Synthetic B"};
  previewRelease();
  assert.equal(await running,null);
  assert.equal(h.calls.writes,0);
  assert.equal(h.model.autoImport.seen,undefined);
});

test("unchanged eligible empty second enumeration preserves ordinary no-write outcome",async()=>{
  const h=harness({candidates:[]});
  const outcome=await h.run();
  assert.deepEqual([...outcome.imported],[]);
  assert.deepEqual([...outcome.retained],[]);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.imports,0);
  assert.deepEqual(Object.keys(h.model.autoImport.seen),[]);
});

test("unchanged root still ignores a candidate outside the stable signature set",async()=>{
  const h=harness({candidates:[{
    name:"other.xlsx",relativePath:"Report Inbox/other.xlsx",
    signature:"different|10|1",location:"inbox",file:{lastModified:1}
  }]});
  const outcome=await h.run();
  assert.equal(outcome.imported.length,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.calls.imports,0);
});

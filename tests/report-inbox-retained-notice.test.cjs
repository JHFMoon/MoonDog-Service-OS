"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const app=fs.readFileSync(path.join(__dirname,"..","assets/app.js"),"utf8");
const begin=app.indexOf("  async function autoSurveyFolder(");
const end=app.indexOf("  async function importReturnedWorkbook(",begin);
assert.ok(begin>0&&end>begin,"Production Report Inbox scanner found");
const scanner=app.slice(begin,end);

function harness(names=["stuck-one.xlsx","stuck-two.xlsx"]){
  const notices=[],moves=[],reads=[];
  const candidates=names.map((name,i)=>({
    name,location:"inbox",relativePath:"Report Inbox/"+name,signature:"test-"+i,
    file:{lastModified:100+i,arrayBuffer:async()=>new Uint8Array([i+1]).buffer}
  }));
  const failures=new Map(names.map(name=>[name,Object.assign(new Error("OneDrive file unavailable"),{name:"NotAllowedError"})]));
  const folderWatch={lastRetainedNotice:""};
  const model={autoImport:{seen:{}}};
  const ctx={
    model,folderWatch,
    watchCandidates:async()=>candidates,
    candidateNeedsImport:()=>true,
    sourceLocations:new Map(),
    classifyImportFile:async()=>null,
    referenceOnlyHint:()=>false,
    recognizedFamilyHint:()=>false,
    moveToLearn:async(candidate)=>{
      moves.push(candidate.name);
      if(failures.has(candidate.name))throw failures.get(candidate.name);
      return candidate.name;
    },
    transientIntakeError:error=>error?.name==="NotAllowedError",
    recordDiagnostic:()=>{},addHistory:async()=>{},
    now:()=>new Date(0).toISOString(),
    status:(message,type)=>notices.push({message,type}),
    console:{warn:()=>{}},
    AUTO_IMPORT_PATH:["data","auto-import.json"],
    writeJson:async()=>{},
    sha256:async()=>"",
  };
  vm.runInNewContext(scanner+"\nthis.scan=autoSurveyFolder",ctx);
  return {scan:()=>ctx.scan(),notices,moves,failures,folderWatch,model};
}

test("same retained files retry without flooding the global status banner",async()=>{
  const h=harness();
  const first=await h.scan();
  assert.equal(first.retained.length,2);
  assert.equal(first.retainedDetails.length,2);
  assert.equal(first.retainedDetails[0].name,"stuck-one.xlsx");
  assert.match(first.retainedDetails[0].reason,/NotAllowedError: OneDrive file unavailable/);
  assert.equal(first.retainedDetails[0].disposition,"retry");
  await h.scan();
  assert.equal(h.moves.length,4,"both files remain eligible for safe retries");
  assert.equal(h.notices.length,1,"unchanged failures are not repeatedly announced");
  assert.match(h.notices[0].message,/2 files remain in place/);
});

test("new failure information is reported once and then clears after verified processing",async()=>{
  const h=harness(["stuck-one.xlsx"]);
  await h.scan();
  const modified=Object.assign(new Error("Access changed"),{name:"NotAllowedError"});
  h.failures.set("stuck-one.xlsx",modified);
  await h.scan();
  assert.equal(h.notices.length,2,"changed reason is user-visible");
  h.failures.delete("stuck-one.xlsx");
  const complete=await h.scan();
  assert.deepEqual(Array.from(complete.retained),[]);
  assert.equal(h.folderWatch.lastRetainedNotice,"");
  assert.equal(h.notices.length,3,"successful move creates fresh notice");
});

test("nontransient move failures stay flagged for review and preserve original",async()=>{
  const h=harness(["locked.xlsx"]);
  h.failures.set("locked.xlsx",Object.assign(new Error("No verified destination"),{name:"IntegrityError"}));
  const result=await h.scan();
  assert.equal(result.retainedDetails[0].disposition,"review");
  assert.match(result.retainedDetails[0].reason,/IntegrityError/);
  assert.ok(h.moves.length>=1);
});

test("watch surface exposes actual file failure, retries remain enabled, and move safety is unchanged",()=>{
  assert.match(app,/const retainedDetail=\(result\.retainedDetails\|\|\[\]\)\.map\(/);
  assert.match(app,/REPORT INBOX NEEDS REVIEW/);
  assert.match(app,/lastRetainedNotice/);
  const moveBegin=app.indexOf("  async function moveToLearn(");
  const moveEnd=app.indexOf("  const PDF_READ_TIMEOUT_MS",moveBegin);
  const move=app.slice(moveBegin,moveEnd);
  assert.match(move,/if \(currentSignature !== candidate\.signature\) throw/);
  assert.ok(move.indexOf("await writeBytes(")<move.indexOf("await removeSourceEntry("),"verified copy precedes source removal");
});

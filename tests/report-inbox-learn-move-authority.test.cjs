"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// #59-03: actual production Files To Learn copy/verify/delete code under
// synthetic root switches and permission revocation at each awaited phase.
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const first=app.indexOf("  async function moveToLearn(");
const last=app.indexOf("  const PDF_READ_TIMEOUT_MS=",first);
assert.ok(first>=0&&last>first,"production Files To Learn relocation exists");
const source=app.slice(first,last);
const raw=new Uint8Array([8,9,10]);

function harness({pauseAt="none"}={}){
  const initial={name:"Synthetic first Workspace"},next={name:"Synthetic second Workspace"};
  const model={root:initial},authority={valid:true};
  const locations=new Map();
  const events=[];
  let signal,release;
  const entered=new Promise(resolve=>{signal=resolve;});
  const latch=new Promise(resolve=>{release=resolve;});
  const pause=async phase=>{if(pauseAt===phase){signal();await latch;}};
  const bytes=()=>raw.slice().buffer;
  let written=false;
  const folder={
    async getFileHandle(){
      await pause("lookup");
      if(!written)throw Object.assign(new Error("not found"),{name:"NotFoundError"});
      return{async getFile(){await pause("staged-file");return{
        async arrayBuffer(){await pause("verify");return bytes();}
      };}};
    }
  };
  const file={
    size:3,lastModified:123,
    async arrayBuffer(){await pause("original-bytes");return bytes();}
  };
  const context=vm.createContext({
    model,sourceLocations:locations,DOMException,Error,Uint8Array,
    sourceFileHandle:async()=>({async getFile(){await pause("original-file");return file;}}),
    directory:async()=>{await pause("folder");return folder;},
    writeBytes:async()=>{events.push("write");await pause("write");written=true;},
    sameByteContent:(a,b)=>Buffer.from(a).equals(Buffer.from(b)),
    removeSourceEntryWithByteGuard:async()=>{events.push("delete");},
    addHistory:async()=>{events.push("history");}
  });
  vm.runInContext(source+"\nthis.move=moveToLearn;",context);
  const candidate={name:"synthetic.txt",relativePath:"Report Inbox/synthetic.txt",
    signature:"Report Inbox/synthetic.txt|3|123",location:"inbox"};
  return{model,next,authority,events,entered,release:()=>release(),
    move:()=>context.move(candidate,"Synthetic unsupported source",
      ()=>model.root===initial&&authority.valid)};
}

for(const phase of ["original-file","folder","original-bytes","lookup","write","staged-file","verify"]){
  test("Workspace replacement during "+phase+" prevents later cleanup",async()=>{
    const h=harness({pauseAt:phase});
    const pending=h.move();
    await h.entered;
    h.model.root=h.next;
    h.release();
    await assert.rejects(pending,error=>error.name==="InvalidStateError"&&
      error.reportInboxAuthorityRevoked===true);
    assert.equal(h.events.includes("delete"),false,"source deletion must not run on stale Workspace");
    assert.equal(h.events.includes("history"),false,"stale move must not claim completion");
    if(phase!=="write"&&phase!=="staged-file"&&phase!=="verify")
      assert.equal(h.events.includes("write"),false,"must not start learning-file write after revocation");
  });
}

test("revoked scan authority during an awaited copy cannot delete source",async()=>{
  const h=harness({pauseAt:"folder"});
  const pending=h.move();
  await h.entered;
  h.authority.valid=false;
  h.release();
  await assert.rejects(pending,error=>error.name==="InvalidStateError"&&
    error.reportInboxAuthorityRevoked===true);
  assert.deepEqual(h.events,[]);
});

test("valid source relocation still copies verifies deletes and audits in order",async()=>{
  const h=harness();
  assert.equal(await h.move(),"synthetic.txt");
  assert.deepEqual(h.events,["write","delete","history"]);
});

test("stale scan cancellation is propagated out of the automatic intake catch",()=>{
  const start=app.indexOf("  async function autoSurveyFolder(");
  const end=app.indexOf("  async function importReturnedWorkbook(",start);
  const watcher=app.slice(start,end);
  assert.match(watcher,/moveToLearn\(candidate,reason,scanEligible\)/);
  assert.match(watcher,/moveToLearn\(candidate,diagnostic,scanEligible\)/);
  assert.match(watcher,/error\?\.reportInboxAuthorityRevoked&&!scanEligible\(\)\)return null/);
});

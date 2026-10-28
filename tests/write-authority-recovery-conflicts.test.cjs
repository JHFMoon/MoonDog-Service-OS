"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets/moondog-write-authority.js"),"utf8");
const begin=source.indexOf("  async function at("),end=source.indexOf("  async function validate(",begin);
assert.ok(begin>=0&&end>begin,"exercise actual production recovery and file operations");
const production=source.slice(begin,end);
const validationEnd=source.indexOf("  async function provision(",end);
assert.ok(validationEnd>end,"execute the production validate gate");
const validation=source.slice(end,validationEnd);
const mutationBegin=source.indexOf("  let tail = Promise.resolve(), activeToken = null;",validationEnd);
const mutationEnd=source.indexOf("  const originals =",mutationBegin);
assert.ok(mutationBegin>=0&&mutationEnd>mutationBegin,"exercise actual production journaled delete/create");
const mutation=source.slice(mutationBegin,mutationEnd);
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const asBytes=value=>value===null?null:new Uint8Array(value);
const missing=()=>Object.assign(Error("Synthetic missing"),{name:"NotFoundError"});
const before=encode({value:"prior"});
const after=encode({value:"interrupted write"});
const another=encode({value:"independent writer"});

function fixture(current=after,options={}){
  const prefix=options.physicalWorkspace?"System Files/Workspace/":"";
  const statePath=prefix+"data/state.json",journalPath=prefix+"data/.moondog-txn-synthetic.json",revisionPath=prefix+"data/store-revision.json";
  const files=new Map(),dirs=new Set(options.physicalWorkspace?["System Files","System Files/Workspace",prefix+"data"]:["data"]),actions=[];
  let permissionState=options.permissionState||"granted",permissionRequests=0,transientReads=Number(options.transientReadFailures||0),revisionReads=0;
  if(current!==null)files.set(statePath,asBytes(current));
  const journal=options.journalFormat==="moondog-delete-v1"?
    {format:"moondog-delete-v1",target:statePath,kind:"file",before:[...before],revisionBefore:4}:
    options.journalFormat==="moondog-create-v1"?
    {format:"moondog-create-v1",target:statePath,kind:"file",revisionBefore:4}:
    {format:"moondog-write-v1",target:statePath,
      before:options.beforeNull?null:[...before],after:[...after],
      revisionBefore:4};
  if(!options.noInitialJournal)files.set(journalPath,encode(journal));
  files.set(revisionPath,encode({schemaVersion:1,revision:4}));
  if(options.restoreMarker){
    const marker=prefix+"data/restore-in-progress.json";
    files.set(marker,options.restoreMarker==="invalid"?encode({restoreId:"broken-marker"}):
      encode({schemaVersion:1,restoreId:"123e4567-e89b-42d3-a456-426614174000",
        sourceFile:"synthetic-source.zip",safetyBackup:"synthetic-safety.zip"}));
  }
  const directory=(prefix="")=>({
    kind:"directory",
    queryPermission:async()=>(permissionState),
    requestPermission:async()=>{permissionRequests++;permissionState=options.permissionAfterRequest||"granted";return permissionState;},
    async getDirectoryHandle(name,{create=false}={}){
      const k=prefix?prefix+"/"+name:name;
      if(!dirs.has(k)){if(!create)throw missing();dirs.add(k);}
      return directory(k);
    },
    async getFileHandle(name,{create=false}={}){
      const k=prefix?prefix+"/"+name:name;
      if(!files.has(k)){
        if(!create)throw missing();
        if(k===statePath&&options.foreignOnCreate){
          files.set(k,new Uint8Array(another));
          throw Error("synthetic competing replacement after create");
        }
        files.set(k,new Uint8Array());
      }
      return {
        kind:"file",
        async getFile(){if(k===revisionPath){revisionReads++;if(transientReads>0){transientReads--;throw Object.assign(Error("synthetic OneDrive busy"),{name:options.transientErrorName||"NotReadableError"});}}const b=files.get(k);if(!b)throw missing();return{
          text:async()=>new TextDecoder().decode(b),
          arrayBuffer:async()=>b.slice().buffer
        };},
        async createWritable(){
          let pending=new Uint8Array();
          return{
            async write(bytes){actions.push(["write",k]);pending=typeof bytes==="string"?new TextEncoder().encode(bytes):new Uint8Array(bytes);},
            async close(){
              actions.push(["close",k]);files.set(k,pending);
              if(k.includes("/.moondog-txn-")&&
                (options.foreignBeforeDelete||options.foreignBeforeCreate))
                files.set(statePath,new Uint8Array(another));
            },
            async abort(){actions.push(["abort",k]);}
          };
        }
      };
    },
    async removeEntry(name){
      const k=prefix?prefix+"/"+name:name;
      actions.push(["remove",k]);
      if(k===statePath&&options.foreignOnDelete){
        files.delete(k);files.set(k,new Uint8Array(another));
        throw Error("synthetic competing replacement after delete");
      }
      if(!files.delete(k))throw missing();
    },
    async *entries(){
      const parent=prefix?prefix+"/":"",seen=new Set();
      for(const name of [...files.keys(),...dirs]){
        if(!name.startsWith(parent)||name===prefix)continue;
        const suffix=name.slice(parent.length),child=suffix.split("/")[0];
        if(!child||seen.has(child))continue;
        seen.add(child);
        yield [child,dirs.has(parent+child)?directory(parent+child):{kind:"file",name:child}];
      }
    }
  });
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Promise,crypto:globalThis.crypto,
    console:{warn(){}},setTimeout});
  const setup="const encoder=new TextEncoder();const REVISION="+JSON.stringify(revisionPath.split("/"))+";"+
    "const originals=new WeakMap();let localRestoreOwner=null,nativeRoot=null,loadedRevision=null,interruptedRecovery=false;"+
    "let validationReason=\"NO_WORKSPACE\",validationFailureName=\"\",validationGeneration=0,validationInFlight=null;"+
    "const WORKSPACE=['System Files','Workspace'];const testEnabled=false;"+
    "let editable=true;const transientValidationDelays=[0];"+
    "const sleep=async()=>{};const denied=()=>new Error('read only');"+
    "const transientInterfaceState=error=>[\"AbortError\",\"InvalidStateError\",\"NotReadableError\",\"UnknownError\",\"TimeoutError\"].includes(error?.name);"+
    "function setEditable(value){editable=value;}function setTransientValidation(_){};function setValidationReason(value){validationReason=value;}"+
    "function protectedPath(_){return false;}function requireWrite(restoreId){if(interruptedRecovery){if(!localRestoreOwner||restoreId!==localRestoreOwner)throw denied();return;}if(!editable||localRestoreOwner&&restoreId!==localRestoreOwner)throw denied();}";
  const root=directory();
  vm.runInContext(setup+"\n"+production+"\n"+validation+"\n"+mutation+
    "\nglobalThis.recoverPending=recoverPending;globalThis.validate=validate;"+
    "globalThis.isEditable=()=>editable;globalThis.reason=()=>validationReason;globalThis.deleteTarget=journaledDelete;"+
    "globalThis.createTarget=journaledCreate;globalThis.setRestoreOwner=id=>{localRestoreOwner=id;};",context);
  return{
    files,dirs,actions,journal,
    recover:revision=>context.recoverPending(root,{schemaVersion:1,revision}),
    validate:(ask=false)=>context.validate(root,ask),
    editable:()=>context.isEditable(),
    reason:()=>context.reason(),
    setPermission:value=>{permissionState=value;},
    permissionRequests:()=>permissionRequests,
    revisionReads:()=>revisionReads,
    current:()=>files.get(statePath),
    pending:()=>[...files.keys()].some(p=>p.startsWith(prefix+"data/.moondog-txn-")),
    deleteTarget:()=>context.deleteTarget(statePath),
    createTarget:()=>context.createTarget(statePath,"file"),
    setRestoreOwner:id=>context.setRestoreOwner(id)
  };
}

test("unfinished journal never destructively rolls back recorded after bytes",async()=>{
  const f=fixture(after);
  await assert.rejects(f.recover(4),/requires controlled recovery/i);
  assert.deepEqual(f.current(),after);
  assert.equal(f.pending(),true);
  assert.equal(f.actions.some(([act,name])=>name==="data/state.json"&&["write","remove"].includes(act)),false);
});

test("uncommitted journal with intact prior bytes is removed without affecting state",async()=>{
  const f=fixture(before);
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
});

test("conflicting replacement by a separate writer MUST NOT be overwritten on recovery",async()=>{
  const f=fixture(another);
  await assert.rejects(f.recover(4),/conflict|differs|changed|unrecognized/i);
  assert.deepEqual(f.current(),another,"independent writer bytes survive unchanged");
  assert.equal(f.pending(),true,"uncertain journal retained for manual review");
  assert.equal(f.actions.some(([act,name])=>name==="data/state.json"&&["write","remove"].includes(act)),false);
});

test("a journal from an unfinished new-file creation cannot delete unrelated bytes",async()=>{
  const f=fixture(another,{beforeNull:true});
  await assert.rejects(f.recover(4),/conflict|differs|changed|unrecognized/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("uncommitted new-file save cannot automatically delete bytes",async()=>{
  const f=fixture(after,{beforeNull:true});
  await assert.rejects(f.recover(4),/requires controlled recovery/i);
  assert.deepEqual(f.current(),after);
  assert.equal(f.pending(),true);
});

test("uncommitted new-file write with already absent target clears stale journal safely",async()=>{
  const f=fixture(null,{beforeNull:true});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});

test("committed journal with verified after bytes keeps committed value",async()=>{
  const f=fixture(after);
  await f.recover(5);
  assert.deepEqual(f.current(),after);
  assert.equal(f.pending(),false);
});

test("committed journal with contradictory bytes is blocked without rewriting data",async()=>{
  const f=fixture(another);
  await assert.rejects(f.recover(5),/differs|conflict/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("malformed journal prior-byte arrays never trigger recovery writes",async()=>{
  const f=fixture(another);
  f.journal.before=[300];
  f.files.set("data/.moondog-txn-synthetic.json",encode(f.journal));
  await assert.rejects(f.recover(4),/bytes are invalid/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted file deletion never overwrites different independent bytes",async()=>{
  const f=fixture(another,{journalFormat:"moondog-delete-v1"});
  await assert.rejects(f.recover(4),/conflicts with independent/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted file deletion does not race another writer by recreating the original",async()=>{
  const f=fixture(null,{journalFormat:"moondog-delete-v1"});
  await assert.rejects(f.recover(4),/requires controlled recovery/i);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),true);
});

test("interrupted deletion before touching target does not rewrite the prior bytes",async()=>{
  const f=fixture(before,{journalFormat:"moondog-delete-v1"});
  await f.recover(4);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
  assert.equal(f.actions.some(([act,name])=>act==="write"&&name==="data/state.json"),false);
});

test("interrupted creation never deletes a new independently populated file",async()=>{
  const f=fixture(another,{journalFormat:"moondog-create-v1"});
  await assert.rejects(f.recover(4),/requires controlled recovery/i);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
});

test("interrupted creation preserves even an empty file until controlled recovery",async()=>{
  const f=fixture(new Uint8Array(),{journalFormat:"moondog-create-v1"});
  await assert.rejects(f.recover(4),/requires controlled recovery/i);
  assert.deepEqual(f.current(),new Uint8Array());
  assert.equal(f.pending(),true);
});

test("interrupted creation with already missing target clears journal",async()=>{
  const f=fixture(null,{journalFormat:"moondog-create-v1"});
  await f.recover(4);
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
});

test("actual write-authority validation disables editing when pending write needs controlled recovery",async()=>{
  const f=fixture(after);
  assert.equal(f.editable(),true);
  assert.equal(await f.validate(),false);
  assert.equal(f.reason(),"PENDING_TRANSACTION","an unresolved journal has a distinct recovery reason");
  assert.equal(f.editable(),false,"unverified transaction leaves write authority read-only");
  assert.deepEqual(f.current(),after,"unverified bytes cannot be automatically rolled back");
  assert.equal(f.pending(),true,"journal must be retained for deliberate verified recovery");
});

test("actual write-authority validation permits intact original and journal cleanup",async()=>{
  const f=fixture(before);
  assert.equal(await f.validate(),true);
  assert.equal(f.editable(),true);
  assert.deepEqual(f.current(),before);
  assert.equal(f.pending(),false);
});

test("physical Workspace journal blocks subsequent writes after an independent replacement",async()=>{
  const f=fixture(another,{physicalWorkspace:true});
  assert.equal(f.journal.target,"System Files/Workspace/data/state.json");
  assert.equal(await f.validate(),false,
    "actual production validator must reject an uncertain physical-path journal");
  assert.equal(f.editable(),false);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
  assert.equal(f.actions.some(([operation,name])=>name==="System Files/Workspace/data/state.json"&&
    ["write","remove"].includes(operation)),false);
});

test("uncertain journaled deletion never overwrites an independent writer's replacement",async()=>{
  const f=fixture(before,{physicalWorkspace:true,noInitialJournal:true,foreignOnDelete:true});
  assert.equal(await f.validate(),true);
  await assert.rejects(f.deleteTarget(),/synthetic competing replacement after delete/);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true,"uncommitted deletion journal must survive");
  assert.equal(f.editable(),false);
  assert.equal(await f.validate(),false,"subsequent edits must fail closed");
  assert.equal(f.actions.some(([action,path])=>action==="write"&&path==="System Files/Workspace/data/state.json"),false);
});

test("uncertain journaled creation never removes an independently populated file",async()=>{
  const f=fixture(null,{physicalWorkspace:true,noInitialJournal:true,foreignOnCreate:true});
  assert.equal(await f.validate(),true);
  await assert.rejects(f.createTarget(),/synthetic competing replacement after create/);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),true);
  assert.equal(f.editable(),false);
  assert.equal(await f.validate(),false);
  assert.equal(f.actions.some(([action,path])=>action==="remove"&&path==="System Files/Workspace/data/state.json"),false);
});

test("pre-delete foreign write is preserved without an unnecessary retained journal",async()=>{
  const f=fixture(before,{physicalWorkspace:true,noInitialJournal:true,foreignBeforeDelete:true});
  assert.equal(await f.validate(),true);
  await assert.rejects(f.deleteTarget(),/File changed during deletion/);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),false,"no target mutation began");
  assert.equal(f.actions.some(([action,path])=>action==="write"&&path==="System Files/Workspace/data/state.json"),false);
});

test("pre-create foreign write is preserved without deleting the other writer's bytes",async()=>{
  const f=fixture(null,{physicalWorkspace:true,noInitialJournal:true,foreignBeforeCreate:true});
  assert.equal(await f.validate(),true);
  await assert.rejects(f.createTarget(),/File or directory changed during creation/);
  assert.deepEqual(f.current(),another);
  assert.equal(f.pending(),false);
  assert.equal(f.actions.some(([action,path])=>action==="remove"&&path==="System Files/Workspace/data/state.json"),false);
});

test("successful journaled delete commits and cleans up without leaving read-only state",async()=>{
  const f=fixture(before,{physicalWorkspace:true,noInitialJournal:true});
  assert.equal(await f.validate(),true);
  await f.deleteTarget();
  assert.equal(f.current(),undefined);
  assert.equal(f.pending(),false);
  assert.equal(await f.validate(),true);
});

test("successful journaled create commits and cleans up without leaving read-only state",async()=>{
  const f=fixture(null,{physicalWorkspace:true,noInitialJournal:true});
  assert.equal(await f.validate(),true);
  await f.createTarget();
  assert.deepEqual(f.current(),new Uint8Array());
  assert.equal(f.pending(),false);
  assert.equal(await f.validate(),true);
});

test("uncommitted empty-directory deletion stays read-only and cannot recreate a missing directory",async()=>{
  const f=fixture(null,{physicalWorkspace:true,journalFormat:"moondog-delete-v1"});
  const dir="System Files/Workspace/data/old-empty-folder";
  f.journal.target=dir;
  f.journal.kind="empty-directory";
  f.journal.before=null;
  f.files.set("System Files/Workspace/data/.moondog-txn-synthetic.json",encode(f.journal));
  assert.equal(f.dirs.has(dir),false);
  assert.equal(await f.validate(),false,"uncommitted directory removal must require controlled recovery");
  assert.equal(f.editable(),false);
  assert.equal(f.dirs.has(dir),false,"recovery must not recreate the deleted directory");
  assert.equal(f.pending(),true,"uncommitted journal must remain intact");
});

test("uncommitted empty-directory journal does not dismiss a competing directory replacement",async()=>{
  const f=fixture(null,{physicalWorkspace:true,journalFormat:"moondog-delete-v1"});
  const dir="System Files/Workspace/data/old-empty-folder";
  f.journal.target=dir;
  f.journal.kind="empty-directory";
  f.journal.before=null;
  f.files.set("System Files/Workspace/data/.moondog-txn-synthetic.json",encode(f.journal));
  f.dirs.add(dir);
  f.files.set(dir+"/independent-state.json",encode({owner:"external-writer"}));
  assert.equal(await f.validate(),false);
  assert.equal(f.editable(),false);
  assert.equal(f.dirs.has(dir),true);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(f.files.get(dir+"/independent-state.json"))),{owner:"external-writer"});
  assert.equal(f.pending(),true,"do not silently clear an uncertain delete journal");
});

test("orphaned restore marker blocks journal cleanup before any recovery write",async()=>{
  const f=fixture(before,{physicalWorkspace:true,restoreMarker:true});
  const journal="System Files/Workspace/data/.moondog-txn-synthetic.json";
  const marker="System Files/Workspace/data/restore-in-progress.json";
  const originalJournal=new Uint8Array(f.files.get(journal));
  const originalMarker=new Uint8Array(f.files.get(marker));
  assert.equal(await f.validate(),false,"a reconnecting tab must remain read-only");
  assert.equal(f.editable(),false);
  assert.deepEqual(f.current(),before);
  assert.deepEqual(f.files.get(journal),originalJournal,"no automatic journal recovery/cleanup during restore hold");
  assert.deepEqual(f.files.get(marker),originalMarker);
  assert.deepEqual(f.actions,[],"no rollback, deletion or revision writes may precede the hold check");
});

test("invalid or unowned restore marker forbids revision initialization and edits",async()=>{
  for(const restoreMarker of [true,"invalid"]){
    const f=fixture(before,{physicalWorkspace:true,noInitialJournal:true,restoreMarker});
    const revision="System Files/Workspace/data/store-revision.json";
    f.files.set(revision,encode({schemaVersion:1,revision:-2}));
    const old=new Uint8Array(f.files.get(revision));
    assert.equal(await f.validate(),false);
    assert.equal(f.editable(),false);
    assert.deepEqual(f.files.get(revision),old,"revision bootstrap must not run through an orphaned hold");
    assert.deepEqual(f.actions,[]);
  }
});

test("currently owning restore session retains its scoped validation behavior",async()=>{
  const f=fixture(before,{physicalWorkspace:true,restoreMarker:true});
  f.setRestoreOwner("123e4567-e89b-42d3-a456-426614174000");
  assert.equal(await f.validate(),true,"initiating tab may continue a known restore");
  assert.equal(f.editable(),true);
  assert.equal(f.pending(),false,"verified original journal is recovered by its still-running owner");
  assert.equal(f.files.has("System Files/Workspace/data/restore-in-progress.json"),true,
    "validation itself must never dismiss an active restore hold");
});


test("transient OneDrive read failures retry with bounded attempts and restore verified write authority",async()=>{
  const f=fixture(before,{noInitialJournal:true,transientReadFailures:2});
  assert.equal(await f.validate(),true);
  assert.equal(f.reason(),"READY");
  assert.equal(f.editable(),true);
  assert.ok(f.revisionReads()>=3,"validator should retry transient interface failures");
  assert.equal(f.permissionRequests(),0,"background recovery must never prompt Edge");
  assert.equal(f.pending(),false);
});

test("a saved folder handle after refresh or browser restart is revalidated without losing identity",async()=>{
  const f=fixture(before,{noInitialJournal:true});
  assert.equal(await f.validate(),true,"new page context may validate the persisted handle");
  assert.equal(f.reason(),"READY");
  assert.equal(f.permissionRequests(),0,"granted access does not require a user click");
});

test("lost browser permission remains a distinct hold and restoration reuses the same handle",async()=>{
  const f=fixture(before,{noInitialJournal:true,permissionState:"prompt"});
  assert.equal(await f.validate(),false);
  assert.equal(f.reason(),"PERMISSION_REQUIRED");
  assert.equal(f.permissionRequests(),0,"automatic validation must not call requestPermission");
  f.setPermission("granted");
  assert.equal(await f.validate(),true);
  assert.equal(f.reason(),"READY");
  assert.equal(f.permissionRequests(),0,"restored permission is detected without a prompt");
});

test("a real user-initiated permission recovery may ask Edge and then validate",async()=>{
  const f=fixture(before,{noInitialJournal:true,permissionState:"prompt",permissionAfterRequest:"granted"});
  assert.equal(await f.validate(true),true);
  assert.equal(f.permissionRequests(),1);
  assert.equal(f.reason(),"READY");
});

test("interrupted restore marker has its own read-only reason and is never cleared by validation",async()=>{
  const f=fixture(before,{noInitialJournal:true,restoreMarker:true,physicalWorkspace:true});
  assert.equal(await f.validate(),false);
  assert.equal(f.reason(),"INTERRUPTED_RESTORE");
  assert.equal(f.files.has("System Files/Workspace/data/restore-in-progress.json"),true);
  assert.equal(f.editable(),false);
});

test("concurrent validation calls for one Workspace share the same bounded recovery operation",async()=>{
  const f=fixture(before,{noInitialJournal:true,transientReadFailures:1});
  const results=await Promise.all([f.validate(),f.validate(),f.validate()]);
  assert.deepEqual(results,[true,true,true]);
  assert.equal(f.reason(),"READY");
  assert.equal(f.editable(),true);
  assert.equal(f.permissionRequests(),0);
});

test("production transient suspension revokes writes immediately and retains the saved root",()=>{
  const start=source.indexOf("  function suspendForTransient("),end=source.indexOf("  const authority =",start);
  assert.ok(start>=0&&end>start,"extract production transient suspension");
  const root={name:"Synthetic Workspace"};
  const context=vm.createContext({root});
  vm.runInContext(`
    let nativeRoot=root,validationGeneration=4,validationFailureName="",loadedRevision=12;
    let validationReason="READY",transientValidation=false,editable=true;
    const transientInterfaceState=error=>["AbortError","InvalidStateError","NotReadableError","UnknownError","TimeoutError"].includes(error?.name);
    function setTransientValidation(value){transientValidation=Boolean(value);}
    function setEditable(value){editable=Boolean(value);}
    function setValidationReason(value){validationReason=value;}
    ${source.slice(start,end)}
    globalThis.suspend=suspendForTransient;
    globalThis.state=()=>({nativeRoot,validationGeneration,validationFailureName,loadedRevision,validationReason,transientValidation,editable});
  `,context);
  assert.equal(context.suspend(Object.assign(Error("OneDrive sync lock"),{name:"NotReadableError"})),true);
  assert.deepEqual(context.state(),{
    nativeRoot:root,validationGeneration:5,validationFailureName:"NotReadableError",loadedRevision:null,
    validationReason:"WORKSPACE_BUSY",transientValidation:true,editable:false
  });
  assert.equal(context.suspend(Object.assign(Error("unrelated"),{name:"TypeError"})),false);
});

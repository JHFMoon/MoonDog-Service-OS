"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const site=path.join(__dirname,"..","distribution","site");
const landing=fs.readFileSync(path.join(site,"index.html"),"utf8");
const checker=fs.readFileSync(path.join(site,"check-installation.html"),"utf8");
const match=checker.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,"read-only checker script is present");
const source=match[1];

test("repair center is the primary landing flow and retains safe downloads",()=>{
  assert.match(landing,/Fix your dashboard/);
  assert.match(landing,/href="\.\/check-installation\.html"/);
  assert.match(landing,/repair-moondog\.html/);
  assert.match(landing,/releases\/latest\/download\/Service-Operations-Dashboard\.zip/);
});

test("repair checker compiles without escaped newline syntax defects",()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.doesNotMatch(source,/selectedSystemFiles\\n/);
});

function missing(){return Object.assign(new Error("not found"),{name:"NotFoundError"});}
function file(value){return {kind:"file",getFile:async()=>({size:value.length,text:async()=>value})};}
function dir(name,entries={}){
  return {kind:"directory",name,
    getDirectoryHandle:async(n,opts={})=>{
      assert.equal(opts.create,false,"inspection never creates directories");
      if(entries[n]?.kind==="directory")return entries[n];
      if(entries[n])throw Object.assign(Error("wrong entry type"),{name:"TypeMismatchError"});
      throw missing();
    },
    getFileHandle:async(n,opts={})=>{
      assert.equal(opts.create,false,"inspection never creates files");
      if(entries[n]?.kind==="file")return entries[n];
      if(entries[n])throw Object.assign(Error("wrong entry type"),{name:"TypeMismatchError"});
      throw missing();
    },
    entries:async function*(){for(const item of Object.entries(entries))yield item;}
  };
}
function synthetic({
  missingJournal=false,unfinished=false,missingApp=false,missingWorkspace=false,
  freshHold=false,restoreHold=false,holdAsDirectory=false
}={}){
  const marker=name=>holdAsDirectory?dir(name):{
    kind:"file",getFile:()=>assert.fail("The public checker should not read a private recovery marker")
  };
  const journal=unfinished?{status:"applying",inventory:[]}:{status:"verified",inventory:[]};
  const backup=dir("MoonDog-Update-Backup-SYNTHETIC",missingJournal?{}:{
    "journal.json":file(JSON.stringify(journal))
  });
  const updates=dir("system-updates",{"MoonDog-Update-Backup-SYNTHETIC":backup});
  const workspace=dir("Workspace",{
    "backups":dir("backups",{"system-updates":updates}),
    ...(restoreHold?{"data":dir("data",{"restore-in-progress.json":marker("restore-in-progress.json")})}:{})
  });
  const system=dir("System Files",{
    "index.html":file("generic synthetic software"),
    "assets":dir("assets",missingApp?{}:{"app.js":file("generic synthetic software")}),
    ...(freshHold?{"MOONDOG_FRESH_RESET_PENDING.json":marker("MOONDOG_FRESH_RESET_PENDING.json")}:{}),
    ...(!missingWorkspace?{"Workspace":workspace}:{})
  });
  return dir("Dashboard Interface",{
    "00 - OPEN DASHBOARD.html":file("synthetic launcher"),
    "INSTALLATION-MANIFEST.json":file("synthetic manifest"),
    "System Files":system
  });
}
async function check(options){
  const button={disabled:false,addEventListener(event,cb){assert.equal(event,"click");this.click=cb;}};
  const result={className:"",textContent:"",style:{}};
  const document={getElementById:id=>id==="check"?button:result};
  const window={showDirectoryPicker:async()=>synthetic(options)};
  vm.runInNewContext(source,{window,document});
  await button.click();
  assert.equal(button.disabled,false);
  assert.match(result.textContent,/No files were changed or uploaded/);
  return result.textContent;
}
test("complete synthetic installation passes read-only structure and journal check",async()=>{
  const result=await check({});
  assert.match(result,/FOLDER CHECK PASSED/);
});
test("missing recovery journal blocks update without altering backups",async()=>{
  const result=await check({missingJournal:true});
  assert.match(result,/UPDATE BLOCKED/);
  assert.match(result,/has no journal\.json/);
});
test("unfinished recovery journal blocks update",async()=>{
  const result=await check({unfinished:true});
  assert.match(result,/UPDATE BLOCKED/);
  assert.match(result,/unfinished update/);
});
test("missing approved software file calls for verified repair only",async()=>{
  const result=await check({missingApp:true});
  assert.match(result,/SOFTWARE REPAIR NEEDED/);
  assert.match(result,/MISSING: System Files\/assets\/app.js/);
});
test("missing protected Workspace stops recovery rather than recreating it",async()=>{
  const result=await check({missingWorkspace:true});
  assert.match(result,/UPDATE BLOCKED/);
  assert.match(result,/Workspace is missing/);
});

test("an interrupted Fresh installation blocks repair even when application paths are present",async()=>{
  for(const holdAsDirectory of [false,true]){
    const result=await check({freshHold:true,holdAsDirectory});
    assert.match(result,/UPDATE BLOCKED/);
    assert.match(result,/interrupted Fresh installation/i);
  }
});

test("an interrupted Workspace restore blocks repair without reading the private marker",async()=>{
  for(const holdAsDirectory of [false,true]){
    const result=await check({restoreHold:true,holdAsDirectory});
    assert.match(result,/UPDATE BLOCKED/);
    assert.match(result,/interrupted Workspace restore/i);
  }
});

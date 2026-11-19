"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const site=path.join(__dirname,"..","distribution","site");
const landing=fs.readFileSync(path.join(site,"index.html"),"utf8");
const checker=fs.readFileSync(path.join(site,"check-installation.html"),"utf8");
const repair=fs.readFileSync(path.join(site,"repair-moondog.html"),"utf8");
const approvedRepair=fs.readFileSync(path.join(__dirname,"..","repair-moondog.html"),"utf8");
const match=checker.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,"read-only checker script is present");
const source=match[1];

test("homepage has one safe first action and essential progressive help",()=>{
  assert.match(landing,/Fix your dashboard/);
  assert.match(landing,/Keep your data/);
  assert.match(landing,/href="\.\/check-installation\.html">Check my installation/);
  assert.match(landing,/I don't know where MoonDog is saved/);
  assert.match(landing,/Start on the/);
  assert.match(landing,/Microsoft Edge/);
  assert.match(landing,/Get verified repair tool/);
  assert.match(landing,/releases\/latest\/download\/Service-Operations-Dashboard\.zip/);
  assert.match(landing,/0\.10\.17 bridge/);
  assert.match(landing,/id="releaseMeta"/);
  assert.match(landing,/aria-live="polite"/);
  assert.match(landing,/focus-visible/);
});


test("public one-click repair is byte-identical to the reviewed source, not a substitute tool",()=>{
  assert.equal(repair,approvedRepair,"Never publish a modified or stale repair engine");
  assert.match(repair,/MoonDogPackageVerification/);
  assert.match(repair,/MoonDogUpdateInstall/);
  assert.match(repair,/showDirectoryPicker\(\{mode:"readwrite"/);
  assert.match(repair,/global\.confirm\(/);
  assert.match(landing,/href="\.\/repair-moondog\.html">Get verified repair tool/);
  assert.match(checker,/href="\.\/repair-moondog\.html">Get verified repair tool/);
  assert.doesNotMatch(landing,/github\.com\/JHFMoon\/MoonDog-Service-OS\/blob\/main\/repair-moondog\.html/);
  assert.doesNotMatch(checker,/Download raw file/);
});

test("checker labels safe read-only action, hides technical details, and shows contextual next step",()=>{
  assert.match(checker,/id="check" type="button">Choose folder and check/);
  assert.match(checker,/id="quickResult"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(checker,/id="technicalDetails" hidden/);
  assert.match(checker,/id="nextBlocked" class="next blocked" hidden/);
  assert.match(checker,/id="nextRepair" class="next" hidden/);
  assert.match(checker,/id="copyReport"/);
  assert.match(checker,/only with your authorized MoonDog support person/);
  assert.match(checker,/Microsoft Edge/);
  assert.match(checker,/focus-visible/);
});

test("checker script compiles without escaped newline syntax defects",()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.doesNotMatch(source,/selectedSystemFiles\\n/);
});
test("checker cannot create/write/upload files or bypass blocked recovery",()=>{
  assert.match(source,/showDirectoryPicker\(\{mode:"read"/);
  assert.match(source,/getFileHandle\("journal.json",\{create:false\}\)/);
  assert.match(source,/if\(recovery\.blocked\)/);
  assert.doesNotMatch(source,/createWritable|\.createWritable\(|requestPermission|fetch\(|XMLHttpRequest|sendBeacon/);
});

function missing(){return Object.assign(new Error("not found"),{name:"NotFoundError"});}
function file(value,unreadable=false){return {kind:"file",getFile:async()=>{
  if(unreadable)throw Object.assign(new Error("synthetic unavailable"),{name:"NotReadableError"});
  return {size:value.length,text:async()=>value};
}};}
function dir(name,entries={}){
  return {kind:"directory",name,
    getDirectoryHandle:async(n,opts={})=>{
      assert.equal(opts.create,false,"inspection never creates directories");
      if(entries[n]?.kind==="directory")return entries[n];
      throw missing();
    },
    getFileHandle:async(n,opts={})=>{
      assert.equal(opts.create,false,"inspection never creates files");
      if(entries[n]?.kind==="file")return entries[n];
      throw missing();
    },
    entries:async function*(){for(const item of Object.entries(entries))yield item;}
  };
}
function synthetic({missingJournal=false,unfinished=false,invalidJournal=false,unreadable=false,
                    missingApp=false,missingWorkspace=false,missingSystem=false,
                    noBackups=false,selectedSystem=false,workspaceOnly=false,wrongFolder=false}={}){
  const journal=invalidJournal?"{not json}":JSON.stringify({status:unfinished?"applying":"verified",inventory:[]});
  const backup=dir("MoonDog-Update-Backup-SYNTHETIC",missingJournal?{}:{"journal.json":file(journal,unreadable)});
  const updates=dir("system-updates",{"MoonDog-Update-Backup-SYNTHETIC":backup});
  const workspace=dir("Workspace",noBackups?{}:{"backups":dir("backups",{"system-updates":updates})});
  const system=dir("System Files",{
    "index.html":file("synthetic generic software"),
    "assets":dir("assets",missingApp?{}:{"app.js":file("synthetic generic software")}),
    ...(!missingWorkspace?{"Workspace":workspace}:{})
  });
  if(workspaceOnly)return workspace;
  if(wrongFolder)return dir("My Documents",{});
  if(selectedSystem)return system;
  return dir("Dashboard Interface",{
    "00 - OPEN DASHBOARD.html":file("synthetic launcher"),
    "INSTALLATION-MANIFEST.json":file("synthetic manifest"),
    ...(!missingSystem?{"System Files":system}:{})
  });
}
function element(){return {className:"",textContent:"",style:{},hidden:false,open:false,disabled:false,
  addEventListener(event,cb){this[event]=cb;},focus(){}};
}
async function check(options={}){
  const nodes=new Map();
  const document={getElementById:id=>{
    if(!nodes.has(id))nodes.set(id,element());
    return nodes.get(id);
  }};
  const window=options.noPicker?{}:{showDirectoryPicker:async()=>{
    if(options.cancelled)throw Object.assign(new Error("cancelled"),{name:"AbortError"});
    if(options.denied)throw Object.assign(new Error("denied"),{name:"NotAllowedError"});
    return synthetic(options);
  }};
  const clipboard=[];
  const navigator={clipboard:{writeText:async value=>{clipboard.push(value);}}};
  vm.runInNewContext(source,{window,document,navigator});
  await document.getElementById("check").click();
  assert.equal(document.getElementById("check").disabled,false);
  const report=document.getElementById("result").textContent;
  const summary=document.getElementById("quickResult").textContent;
  assert.match(report,/No files were changed or uploaded/);
  assert.match(summary,/No files were changed or uploaded/);
  assert.equal(document.getElementById("technicalDetails").hidden,false);
  assert.equal(document.getElementById("initialNext").hidden,true);
  const shown=["Passed","Repair","Blocked","Wrong","Partial","Unsupported","Cancelled","Error"]
    .filter(k=>document.getElementById("next"+k).hidden===false);
  assert.equal(shown.length,1,"exactly one next step visible");
  return {report,summary,next:shown[0],nodes,clipboard};
}
test("complete synthetic installation passes read-only structure/journal check",async()=>{
  const r=await check();
  assert.equal(r.next,"Passed");
  assert.match(r.report,/FOLDER CHECK PASSED/);
});
test("no prior updates is not incorrectly flagged as corruption",async()=>{
  const r=await check({noBackups:true});
  assert.equal(r.next,"Passed");
  assert.match(r.report,/No system-update backup folder was found/);
});
test("missing recovery journal blocks repair",async()=>{
  const r=await check({missingJournal:true});
  assert.equal(r.next,"Blocked");
  assert.match(r.report,/UPDATE BLOCKED[\s\S]*has no journal\.json/);
  assert.equal(r.nodes.get("nextRepair").hidden,true);
});
test("unfinished recovery journal blocks repair",async()=>{
  const r=await check({unfinished:true});
  assert.equal(r.next,"Blocked");
  assert.match(r.report,/unfinished update/);
});
test("corrupt or unreadable journals stop rather than guess",async()=>{
  for(const opts of [{invalidJournal:true},{unreadable:true}]){
    const r=await check(opts);
    assert.equal(r.next,"Blocked");
    assert.match(r.report,/could not be verified/);
  }
});
test("missing approved application file points to safe repair path",async()=>{
  const r=await check({missingApp:true});
  assert.equal(r.next,"Repair");
  assert.match(r.report,/SOFTWARE REPAIR NEEDED[\s\S]*MISSING: System Files\/assets\/app\.js/);
});
test("missing private Workspace takes precedence over missing app files",async()=>{
  const r=await check({missingWorkspace:true,missingApp:true});
  assert.equal(r.next,"Blocked");
  assert.match(r.report,/Workspace is missing/);
  assert.equal(r.nodes.get("nextRepair").hidden,true);
});
test("wrong folders are distinguished from a damaged installation",async()=>{
  for(const opts of [{workspaceOnly:true},{wrongFolder:true},{missingSystem:true}]){
    const r=await check(opts);
    assert.equal(r.next,"Wrong");
    assert.match(r.summary,/WRONG FOLDER/);
  }
});
test("selecting System Files is only a partial check",async()=>{
  const r=await check({selectedSystem:true});
  assert.equal(r.next,"Partial");
  assert.match(r.report,/outer launcher and manifest were NOT checked/);
});
test("unsupported browser, cancelled picker and denied permission give useful outcomes",async()=>{
  for(const [opts,kind] of [[{noPicker:true},"Unsupported"],[{cancelled:true},"Cancelled"],[{denied:true},"Error"]]){
    const r=await check(opts);
    assert.equal(r.next,kind);
  }
});
test("copy is an explicit local-only action, not an automatic upload",async()=>{
  const r=await check();
  assert.equal(r.clipboard.length,0);
  await r.nodes.get("copyReport").click();
  assert.equal(r.clipboard.length,1);
  assert.equal(r.clipboard[0],r.report);
});

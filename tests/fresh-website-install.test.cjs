"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const zlib=require("node:zlib");

const source=fs.readFileSync(path.join(__dirname,"..","distribution","site","fresh-install-writer.js"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"..","distribution","site","fresh-install.html"),"utf8");
const PREFIX="Service Operations Dashboard/";
const DIRS=[
 "System Files/Workspace/","System Files/Workspace/data/",
 "System Files/Workspace/data/history/","System Files/Workspace/backups/",
 "System Files/Workspace/imports/","System Files/Workspace/exports/",
 "System Files/Workspace/support/","System Files/Workspace/01 - DROP REPORTS HERE/"
];
const b=s=>Buffer.from(s,"utf8"),sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const appHtml='<!doctype html><html lang="en"><head><title>Synthetic MoonDog</title></head><body></body></html>';
const compatibilityHtml=appHtml.replace("<head>",'<head><base href="System Files/">');
const zipData={
 "00 - OPEN DASHBOARD.html":b("<html>Open synthetic MoonDog</html>"),
 "index.html":b(compatibilityHtml),
 "System Files/index.html":b(appHtml),
 "System Files/Workspace/README.txt":b("Protected private Workspace; starts without store data.")
};
function crc32(data) {
 let crc=0xffffffff;
 for(const byte of data){
  crc^=byte;
  for(let j=0;j<8;j++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;
 }
 return (crc^0xffffffff)>>>0;
}
function makeZip(extraFiles={},omitDirectory="",originalStableLayout=false) {
 // The original immutable Stable 0.10.17 builder predates the optional root index.html.
 const packageFiles=originalStableLayout
   ? Object.fromEntries(Object.entries(zipData).filter(([name])=>name!=="index.html"))
   : zipData;
 const inventory=Object.entries(packageFiles).map(([name,data])=>({
   path:name,size:data.byteLength,sha256:sha(data)
 }));
 const manifest={
   format:"service-operations-dashboard-clean-install",formatVersion:1,
   version:"0.10.17",packageRoot:"Service Operations Dashboard",
   launcher:"00 - OPEN DASHBOARD.html",applicationRoot:"System Files",
   workspaceRoot:"System Files/Workspace",updateChannel:"stable",
   workspaceProtectedFromUpdates:true,files:inventory
 };
 const entries=[
   {name:PREFIX,bytes:Buffer.alloc(0)},
   ...DIRS.filter(x=>x!==omitDirectory).map(name=>({name:PREFIX+name,bytes:Buffer.alloc(0)})),
   ...Object.entries({...packageFiles,...extraFiles}).map(([name,bytes])=>({name:PREFIX+name,bytes})),
   {name:PREFIX+"INSTALLATION-MANIFEST.json",bytes:b(JSON.stringify(manifest))}
 ];
 const locals=[],centrals=[];let offset=0;
 for(const entry of entries){
   const name=b(entry.name),body=Buffer.from(entry.bytes),packed=zlib.deflateRawSync(body);
   const crc=crc32(body);
   const local=Buffer.alloc(30);
   local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
   local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);
   local.writeUInt32LE(packed.length,18);local.writeUInt32LE(body.length,22);
   local.writeUInt16LE(name.length,26);
   locals.push(local,name,packed);
   const central=Buffer.alloc(46);
   central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(0x0314,4);
   central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);
   central.writeUInt32LE(crc,16);central.writeUInt32LE(packed.length,20);
   central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
   central.writeUInt32LE((entry.name.endsWith("/")?0o755:0o644)<<16,38);
   central.writeUInt32LE(offset,42);
   centrals.push(central,name);
   offset+=local.length+name.length+packed.length;
 }
 const directory=Buffer.concat(centrals),eocd=Buffer.alloc(22);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(entries.length,8);
 eocd.writeUInt16LE(entries.length,10);eocd.writeUInt32LE(directory.length,12);
 eocd.writeUInt32LE(offset,16);
 const bytes=Buffer.concat([...locals,directory,eocd]);
 return {bytes,hash:sha(bytes),manifest};
}
function missing(){return Object.assign(new Error("Not found"),{name:"NotFoundError"});}
function mismatch(){return Object.assign(new Error("Wrong entry type"),{name:"TypeMismatchError"});}
class FakeFile {
 constructor(name,dir){this.kind="file";this.name=name;this.dir=dir;this.bytes=new Uint8Array(0);}
 async createWritable(){
   let staged=null;
   return {
     write:async bytes=>{
       if(this.dir.shared.failWrite===this.name)throw Error("synthetic write denied");
       staged=new Uint8Array(bytes);
     },
     close:async()=>{
       if(staged===null)throw Error("nothing written");
       this.bytes=staged;this.dir.shared.writes++;
       if(typeof this.dir.shared.afterClose==="function")
         await this.dir.shared.afterClose(this.name,this.dir);
     },
     abort:async()=>{}
   };
 }
 async getFile(){return {arrayBuffer:async()=>this.bytes.slice().buffer};}
}
class FakeDirectory {
 constructor(name,shared={writes:0,failWrite:"",permission:"granted"}){
  this.kind="directory";this.name=name;this.shared=shared;this.entriesMap=new Map();
 }
 async queryPermission(){return this.shared.permission;}
 async getDirectoryHandle(name,{create=false}={}){
   let entry=this.entriesMap.get(name);
   if(!entry){if(!create)throw missing();entry=new FakeDirectory(name,this.shared);this.entriesMap.set(name,entry);}
   if(entry.kind!=="directory")throw mismatch();
   return entry;
 }
 async getFileHandle(name,{create=false}={}){
   let entry=this.entriesMap.get(name);
   if(!entry){if(!create)throw missing();entry=new FakeFile(name,this);this.entriesMap.set(name,entry);}
   if(entry.kind!=="file")throw mismatch();
   return entry;
 }
 async *values(){
  await this.shared.beforeValues?.(this);
  for(const entry of this.entriesMap.values())yield entry;
 }
 async removeEntry(name){
  if(!this.entriesMap.delete(name))throw missing();
  if(typeof this.shared.afterRemove==="function")
    await this.shared.afterRemove(name,this);
 }
}
function load(parent,showDirectoryPicker=async()=>parent){
 const context={
   crypto:crypto.webcrypto,TextDecoder,TextEncoder,Blob,DecompressionStream,
   confirm:()=>{throw Error("Redundant confirmation");},showDirectoryPicker
 };
 vm.runInNewContext(source,context,{filename:"fresh-install-writer.js"});
 return context.MoonDogFreshInstall;
}
const localFile=bytes=>({size:bytes.byteLength,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
const installOptions=(fixture,extra={})=>({
  file:localFile(fixture.bytes),sha256:fixture.hash,version:"0.10.17",
  folderName:"MoonDog Synthetic Store",...extra
});
test("fresh install creates a separate complete verifiable folder, preserving unconfigured private Workspace",async()=>{
 const parent=new FakeDirectory("Synthetic Installations"),api=load(parent),fixture=makeZip();
 const progress=[];
 const out=await api.install(installOptions(fixture,{onProgress:msg=>progress.push(msg)}));
 assert.equal(out.status,"installed");assert.equal(out.version,"0.10.17");
 assert.equal(parent.shared.writes,Object.keys(zipData).length+2,"all package files, manifest and transient marker written");
 const root=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 const app=await root.getDirectoryHandle("System Files");
 const workspace=await app.getDirectoryHandle("Workspace");
 assert.equal(workspace.entriesMap.has("settings.json"),false);
 assert.equal((await workspace.getDirectoryHandle("data")).entriesMap.has("settings.json"),false);
 assert.equal(root.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),false);
 for(const [name,expected] of Object.entries(zipData)){
   const parts=name.split("/"),file=parts.pop();let dir=root;
   for(const part of parts)dir=await dir.getDirectoryHandle(part);
   assert.deepEqual(Buffer.from((await dir.getFileHandle(file)).bytes),expected);
 }
 assert.equal((await root.getFileHandle("INSTALLATION-MANIFEST.json")).bytes.length>50,true);
 assert.match(progress.at(-1),/Verified installation created/);
 assert.equal(parent.entriesMap.size,1,"no files installed outside the one requested child");
});
test("two new store folders remain separate even under one selected parent",async()=>{
 const parent=new FakeDirectory("Workspace"),api=load(parent),fixture=makeZip();
 const first=await api.install(installOptions(fixture,{folderName:"MoonDog Store A"}));
 const second=await api.install(installOptions(fixture,{folderName:"MoonDog Store B"}));
 assert.equal(first.status,"installed");assert.equal(second.status,"installed");
 assert.equal(parent.entriesMap.size,2);
 const a=await parent.getDirectoryHandle("MoonDog Store A");
 const b=await parent.getDirectoryHandle("MoonDog Store B");
 assert.notStrictEqual(a,b);
 const fileA=await a.getFileHandle("00 - OPEN DASHBOARD.html");
 const fileB=await b.getFileHandle("00 - OPEN DASHBOARD.html");
 const beforeB=Buffer.from(fileB.bytes);
 fileA.bytes=new Uint8Array([1,2,3]);
 assert.deepEqual(Buffer.from(fileB.bytes),beforeB,
   "changing one synthetic installation cannot mutate the other");
 assert.equal((await b.getDirectoryHandle("System Files")).entriesMap.has("Workspace"),true);
});
test("existing installation folder is never overwritten, even when empty or name is reused",async()=>{
 const parent=new FakeDirectory("Synthetic Parent"),api=load(parent),fixture=makeZip();
 const original=await parent.getDirectoryHandle("MoonDog Synthetic Store",{create:true});
 await assert.rejects(api.install(installOptions(fixture)),/already exists/);
 assert.equal(original.entriesMap.size,0);
 assert.equal(parent.shared.writes,0);
});
test("private Workspace or existing app root cannot be selected as installation parent",async()=>{
 const fixture=makeZip();
 for(const mode of ["workspace","app","partial-app","partial-workspace","data-settings"]){
   const parent=new FakeDirectory("Synthetic "+mode);
   if(mode==="workspace" || mode==="partial-workspace"){
     await parent.getDirectoryHandle("data",{create:true});
     await parent.getDirectoryHandle(mode==="workspace"?"backups":"imports",{create:true});
   }else if(mode==="partial-app"){
     const system=await parent.getDirectoryHandle("System Files",{create:true});
     await system.getDirectoryHandle("Workspace",{create:true});
   }else if(mode==="data-settings"){
     const data=await parent.getDirectoryHandle("data",{create:true});
     await data.getFileHandle("settings.json",{create:true});
   }else await parent.getFileHandle("00 - OPEN DASHBOARD.html",{create:true});
   await assert.rejects(load(parent).install(installOptions(fixture)),/existing MoonDog or private Workspace/);
   assert.equal(parent.shared.writes,0);
 }
});
test("unverified and malformed archives do not create anything",async()=>{
 const fixture=makeZip();
 const badCases=[
   {...fixture,hash:"f".repeat(64)},
   makeZip({"System Files/Workspace/data/settings.json":b("Synthetic forbidden initialized state")}),
   makeZip({"System Files/extra-unknown.js":b("Unlisted software file")}),
   makeZip({"System Files/../Outside.txt":b("Attempted traversal")}),
   makeZip({},"System Files/Workspace/backups/")
 ];
 for(const data of badCases){
   const parent=new FakeDirectory("Synthetic Parent"),api=load(parent);
   await assert.rejects(api.install(installOptions(data)));
   assert.equal(parent.entriesMap.size,0,"reject invalid archive before directory creation");
   assert.equal(parent.shared.writes,0);
 }
});
test("cancelled folder picker and denied permissions never write a file",async()=>{
 const fixture=makeZip();
 let parent=new FakeDirectory("Synthetic Parent");
 await assert.rejects(load(parent,async()=>{throw Error("Synthetic picker cancelled");}).install(installOptions(fixture)),/Synthetic picker cancelled/);
 assert.equal(parent.entriesMap.size,0);
 parent=new FakeDirectory("Synthetic Parent",{writes:0,permission:"denied"});
 await assert.rejects(load(parent).install(installOptions(fixture)),/Write access was not granted/);
 assert.equal(parent.entriesMap.size,0);
});
test("interrupted first install is marked incomplete, not reported as successful or silently removed",async()=>{
 const fixture=makeZip(),parent=new FakeDirectory("Synthetic Parent",{writes:0,failWrite:"index.html",permission:"granted"});
 const api=load(parent);
 await assert.rejects(api.install(installOptions(fixture)),error=>
   error.partial===true && /partial NEW folder may remain/.test(error.message));
 const destination=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 assert.equal(destination.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true);
 assert.equal(destination.entriesMap.has("INSTALLATION-MANIFEST.json"),false,
   "no complete installation claim on a partially written folder");
 await assert.rejects(api.install(installOptions(fixture)),/already exists/);
});
test("fresh installation refuses late tampering, manifest changes or unlisted files",async()=>{
 const fixture=makeZip();
 for(const mode of ["tampered-entry","tampered-manifest","unlisted-file"]){
  const shared={writes:0,permission:"granted"};
  shared.afterRemove=async(name,root)=>{
   if(name!=="MOONDOG-INSTALL-INCOMPLETE.txt")return;
   if(mode==="tampered-entry"){
    const app=await root.getDirectoryHandle("System Files");
    (await app.getFileHandle("index.html")).bytes=b("modified after verification");
   }else if(mode==="tampered-manifest"){
    (await root.getFileHandle("INSTALLATION-MANIFEST.json")).bytes=b("{}");
   }else{
    await root.getFileHandle("unexpected-foreign-file.txt",{create:true});
   }
  };
  const parent=new FakeDirectory("Synthetic Parent",shared),api=load(parent);
  await assert.rejects(api.install(installOptions(fixture)),error=>
   error.partial===true && /partial NEW folder may remain/.test(error.message),
   mode+" must never report a completed installation");
  const installed=await parent.getDirectoryHandle("MoonDog Synthetic Store");
  assert.equal(installed.entriesMap.has("INSTALLATION-MANIFEST.json"),true,
   "manifest committed before simulated sync change");
  assert.equal(installed.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true,
   "restore the visible incomplete marker after post-commit validation fails");
  assert.equal(parent.entriesMap.size,1,"preserve partial copy without touching another installation");
 }
});

test("new install restores missing application and compatibility entries from approved software",async()=>{
 const fixture=makeZip({}, "", true),shared={writes:0,permission:"granted"};
 shared.afterRemove=async(name,destination)=>{
  if(name==="MOONDOG-INSTALL-INCOMPLETE.txt"){
   const app=await destination.getDirectoryHandle("System Files");
   app.entriesMap.delete("index.html"); // Simulated late OneDrive removal.
   destination.entriesMap.delete("index.html");
  }
 };
 const parent=new FakeDirectory("Synthetic Parent",shared),api=load(parent);
 const result=await api.install(installOptions(fixture));
 assert.equal(result.status,"installed");
 const folder=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 const app=await folder.getDirectoryHandle("System Files");
 assert.deepEqual(Buffer.from((await app.getFileHandle("index.html")).bytes),zipData["System Files/index.html"],
   "approved application entry restored from immutable ZIP, not an untrusted copy");
 assert.deepEqual(Buffer.from((await folder.getFileHandle("index.html")).bytes),b(compatibilityHtml));
 assert.equal(folder.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),false);
 assert.ok(await folder.getFileHandle("INSTALLATION-MANIFEST.json"));
 assert.equal((await app.getDirectoryHandle("Workspace")).entriesMap.has("data"),true,
   "a restored program file must leave the private Workspace alone");
});

test("a denied late entry restoration leaves an incomplete-install hold, never a success",async()=>{
 const fixture=makeZip({}, "", true),shared={writes:0,permission:"granted"};
 shared.afterRemove=async(name,destination)=>{
  if(name==="MOONDOG-INSTALL-INCOMPLETE.txt"){
   const app=await destination.getDirectoryHandle("System Files");
   app.entriesMap.delete("index.html");
   shared.failWrite="index.html";
  }
 };
 const parent=new FakeDirectory("Synthetic Parent",shared),api=load(parent);
 await assert.rejects(api.install(installOptions(fixture)),e=>
  e.partial===true&&/partial NEW folder may remain/.test(e.message));
 const folder=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 assert.equal(folder.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true);
 assert.equal(parent.entriesMap.size,1,"no existing store is removed or replaced");
});
test("an incomplete marker that returns during final inventory blocks installation",async()=>{
 const marker="MOONDOG-INSTALL-INCOMPLETE.txt";
 let committedFolder;
 const shared={writes:0,permission:"granted",
  afterRemove(name,folder){if(name===marker)committedFolder=folder;},
  async beforeValues(folder){
   if(folder===committedFolder){
    const returned=await folder.getFileHandle(marker,{create:true});
    returned.bytes=b("Synthetic marker restored by sync");
   }
  }};
 const parent=new FakeDirectory("Synthetic Parent",shared);
 await assert.rejects(load(parent).install(installOptions(makeZip())),/incomplete-install marker/);
 const returned=await committedFolder.getFileHandle(marker);
 assert.deepEqual(Buffer.from(returned.bytes),b("Synthetic marker restored by sync"));
});
test("directory name rejects traversal and Windows reserved names",()=>{
 const api=load(new FakeDirectory("Synthetic Parent"));
 for(const name of ["../Existing","CON","LPT1","AUX.txt","my/folder","my\\folder","trail."]) {
   assert.throws(()=>api.installationName(name));
 }
 assert.equal(api.installationName("MoonDog - Store 2"),"MoonDog - Store 2");
});
test("website keeps verification, manual fallback and the in-app Guided Setup boundary",()=>{
 assert.match(html,/src="\.\/fresh-install-writer\.js"/);
 assert.match(html,/id="autoInstall"[^>]*disabled/);
 assert.match(html,/id="installedNext"[^>]*hidden/);
 assert.match(html,/showDirectoryPicker/);
 assert.match(html,/Extract All/);
 assert.match(html,/Complete <strong>Guided Setup<\/strong>/);
 assert.match(html,/Settings → System Updates/);
 assert.match(html,/Do not select Desktop itself/);
 assert.match(html,/Choose an existing folder that Edge allows/);
 assert.match(html,/open the new MoonDog folder inside it/);
 assert.match(html,/After Guided Setup, before normal use/);
 assert.match(html,/Optional: check the installation if MoonDog won't open/);
 assert.doesNotMatch(html,/class="button" href="\.\/check-installation\.html"/);
 assert.match(html,/validated SAPR report from that same store/);
 assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b/);
 assert.doesNotMatch(source,/getFileHandle\("settings\.json".*\{create:true/);
 assert.doesNotThrow(()=>new vm.Script(source));
});


// Exercise the actual website event handlers and ZIP writer together. This is an
// in-memory DOM integration regression, not a claim of physical Edge field proof.
function websiteHarness(fixture,options={}) {
 const parent=options.parent||new FakeDirectory("Synthetic Installation Parent");
 const nodes=new Map(),events=new Map();
 const ids=[
  "freshConfirm","download","downloadHint","zipFile","verify","verifyResult",
  "finish","versionStatus","autoInstall","installFolderName","installResult",
  "installedNext","deviceNotice"
 ];
 for(const id of ids){
  nodes.set(id,{
   id,checked:false,disabled:false,hidden:id==="finish"||id==="installedNext",
   className:"",textContent:"",value:"",files:[],
   classList:{toggle:()=>{}},
   addEventListener:(event,callback)=>events.set(id+":"+event,callback)
  });
 }
 nodes.get("installFolderName").value="MoonDog Synthetic Store";
 const directoryPicker=options.directoryPicker|| (async()=>parent);
 const context={
  crypto:crypto.webcrypto,TextDecoder,TextEncoder,Blob,DecompressionStream,
  window:{showDirectoryPicker:directoryPicker},
  showDirectoryPicker:directoryPicker,confirm:()=>{throw Error("Unexpected second confirmation");},
  navigator:{userAgent:"Windows NT 10.0; Microsoft Edge"},
  document:{getElementById:id=>{
    const element=nodes.get(id);
    if(!element)throw Error("Unrecognized page element: "+id);
    return element;
  }},
  fetch:async()=>({
   ok:options.metadataValid!==false,
   json:async()=>({
    version:"0.10.17",sha256:fixture.hash,
    asset:"https://github.com/JHFMoon/MoonDog-Service-OS/releases/latest/download/Service-Operations-Dashboard.zip"
   })
  })
 };
 vm.runInNewContext(source,context,{filename:"fresh-install-writer.js"});
 const inline=html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i);
 assert.ok(inline,"the actual website handler should be present");
 vm.runInNewContext(inline[1],context,{filename:"fresh-install.html:inline"});
 return {
  parent,el:id=>nodes.get(id),
  fire:async(id,event)=>{const callback=events.get(id+":"+event);assert.ok(callback,id+" "+event);return callback();},
  flush:async()=>new Promise(resolve=>setImmediate(resolve))
 };
}
function selectedZip(fixture) {
 return {name:"Service-Operations-Dashboard.zip",size:fixture.bytes.length,
  arrayBuffer:async()=>Uint8Array.from(fixture.bytes).buffer};
}

test("website consent, automatic official hash, and install click create a verified new store; never overwrite on retry",async()=>{
 const fixture=makeZip(),ui=websiteHarness(fixture);
 await ui.flush();
 assert.equal(ui.el("zipFile").disabled,true,"a new store must explicitly consent first");
 assert.equal(ui.el("autoInstall").disabled,true);
 assert.equal(ui.parent.shared.writes,0);
 ui.el("freshConfirm").checked=true;
 await ui.fire("freshConfirm","change");
 assert.equal(ui.el("zipFile").disabled,false);
 assert.equal(ui.el("autoInstall").disabled,true,"choosing a store is not sufficient before verification");
 ui.el("zipFile").files=[selectedZip(fixture)];
 await ui.fire("zipFile","change");
 assert.equal(ui.el("verify").disabled,false);
 
 assert.equal(ui.el("finish").hidden,false);
 assert.equal(ui.el("autoInstall").disabled,false);
 assert.match(ui.el("verifyResult").textContent,/VERIFIED/);
 assert.equal(ui.parent.shared.writes,0,"verification must never create files");
 await ui.fire("autoInstall","click");
 assert.equal(ui.el("installedNext").hidden,false);
 assert.match(ui.el("installResult").textContent,/INSTALLED AND VERIFIED/);
 const installed=await ui.parent.getDirectoryHandle("MoonDog Synthetic Store");
 assert.ok(await installed.getFileHandle("INSTALLATION-MANIFEST.json"));
 assert.ok(await installed.getFileHandle("00 - OPEN DASHBOARD.html"));
 assert.equal(ui.parent.entriesMap.size,1);
 const writeCount=ui.parent.shared.writes;
 await ui.fire("autoInstall","click");
 assert.equal(ui.parent.shared.writes,writeCount,"repeat installs must never overwrite the first store");
 assert.equal(ui.parent.entriesMap.size,1);
 assert.match(ui.el("installResult").textContent,/already exists/);
 assert.equal(ui.el("installedNext").hidden,true);
 ui.el("installFolderName").value="MoonDog Second Synthetic Store";
 await ui.fire("autoInstall","click");
 assert.equal(ui.parent.entriesMap.size,2,"a separate store gets a distinct new folder");
 assert.equal(ui.el("installedNext").hidden,false);
 assert.ok(await ui.parent.getDirectoryHandle("MoonDog Second Synthetic Store"));
});

test("website rejects a changed ZIP and a denied parent without presenting setup as complete",async()=>{
 const fixture=makeZip(),parent=new FakeDirectory("Synthetic Parent",{writes:0,permission:"denied"});
 const ui=websiteHarness(fixture,{parent});await ui.flush();
 ui.el("freshConfirm").checked=true;await ui.fire("freshConfirm","change");
 const alternate=makeZip({"System Files/unlisted.txt":b("synthetic unauthorized")});
 ui.el("zipFile").files=[selectedZip(alternate)];await ui.fire("zipFile","change");
 
 assert.equal(ui.el("autoInstall").disabled,true);
 assert.equal(ui.el("finish").hidden,true);
 assert.equal(parent.shared.writes,0);
 ui.el("zipFile").files=[selectedZip(fixture)];await ui.fire("zipFile","change");
 
 assert.equal(ui.el("autoInstall").disabled,false);
 await ui.fire("autoInstall","click");
 assert.match(ui.el("installResult").textContent,/Write access was not granted/);
 assert.equal(ui.el("installedNext").hidden,true);
 assert.equal(parent.entriesMap.size,0);
 assert.equal(parent.shared.writes,0);
 parent.shared.permission="granted";
 await ui.fire("autoInstall","click");
 assert.match(ui.el("installResult").textContent,/INSTALLED AND VERIFIED/);
 assert.equal(parent.entriesMap.size,1);
});

test("blocked Desktop choice leaves verified ZIP usable and does not write",async()=>{
 const fixture=makeZip(),parent=new FakeDirectory("Synthetic Parent");
 const error=new Error("The user aborted a request");error.name="AbortError";
 const ui=websiteHarness(fixture,{parent,directoryPicker:async()=>{throw error;}});
 await ui.flush();
 ui.el("freshConfirm").checked=true;await ui.fire("freshConfirm","change");
 ui.el("zipFile").files=[selectedZip(fixture)];await ui.fire("zipFile","change");
 assert.equal(ui.el("autoInstall").disabled,false);
 await ui.fire("autoInstall","click");
 assert.match(ui.el("installResult").textContent,/try another existing folder that Edge allows/);
 assert.equal(ui.el("autoInstall").disabled,false,"same verified ZIP can retry with a permitted folder");
 assert.equal(ui.el("installedNext").hidden,true);
 assert.equal(parent.entriesMap.size,0);
 assert.equal(parent.shared.writes,0);
});

test("rapid ZIP reselection cannot accept an earlier completed hash",async()=>{
 const fixture=makeZip(),ui=websiteHarness(fixture);
 await ui.flush();
 ui.el("freshConfirm").checked=true;await ui.fire("freshConfirm","change");
 let resolveFirst;
 const slow={...selectedZip(fixture),arrayBuffer:()=>new Promise(resolve=>{resolveFirst=resolve;})};
 ui.el("zipFile").files=[slow];
 const oldCheck=ui.fire("zipFile","change");
 assert.equal(ui.el("autoInstall").disabled,true);
 const altered=makeZip({"System Files/unapproved.txt":b("synthetic mismatched ZIP")});
 ui.el("zipFile").files=[selectedZip(altered)];
 await ui.fire("zipFile","change");
 assert.equal(ui.el("autoInstall").disabled,true);
 assert.equal(ui.el("finish").hidden,true);
 resolveFirst(Uint8Array.from(fixture.bytes).buffer);
 await oldCheck;
 assert.equal(ui.el("autoInstall").disabled,true,"a stale matching hash must not unlock installation");
 assert.equal(ui.el("finish").hidden,true);
 assert.equal(ui.parent.entriesMap.size,0);
});

test("website cannot offer an unverified release when official metadata fails",async()=>{
 const fixture=makeZip(),ui=websiteHarness(fixture,{metadataValid:false});
 await ui.flush();
 ui.el("freshConfirm").checked=true;await ui.fire("freshConfirm","change");
 ui.el("zipFile").files=[selectedZip(fixture)];await ui.fire("zipFile","change");
 assert.equal(ui.el("zipFile").disabled,true);
 assert.equal(ui.el("verify").disabled,true);
 assert.equal(ui.el("autoInstall").disabled,true);
 assert.equal(ui.parent.entriesMap.size,0);
 assert.match(ui.el("versionStatus").textContent,/could not safely verify/);
});


test("production-built full software ZIP installs into two isolated synthetic stores with original file bytes",async t=>{
 const {spawnSync}=require("node:child_process"),os=require("node:os");
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"moondog-full-site-install-"));
 try{
  const vendor=path.join(tmp,"vendor");fs.mkdirSync(vendor);
  for(const [name,min,signature] of [
   ["jszip.min.js",50000,"JSZip"],["pdf.min.js",100000,"pdfjsLib"],
   ["pdf.worker.min.js",100000,"pdfjsWorker"],["xlsx.full.min.js",250000,"XLSX"]
  ]){
   const stub=Buffer.alloc(min+100,120);
   stub.write(signature,0,"utf8");
   fs.writeFileSync(path.join(vendor,name),stub);
  }
  const archive=path.join(tmp,"Service-Operations-Dashboard.zip");
  const build=spawnSync("python3",[
   "scripts/build_distribution.py","--vendor-dir",vendor,"--output",archive
  ],{cwd:path.join(__dirname,".."),encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024});
  if(build.error?.code==="ENOENT"){t.skip("Python 3 builder is not installed");return;}
  assert.equal(build.status,0,(build.stderr||"")+"\n"+(build.stdout||""));
  const fullZip=fs.readFileSync(archive);
  const release=JSON.parse(fs.readFileSync(path.join(tmp,"Service-Operations-Dashboard.manifest.json"),"utf8"));
  const expectedHash=sha(fullZip);
  assert.equal(expectedHash,release.sha256);
  assert.equal(release.version,"0.10.17");
  assert.ok(release.runtimeFileCount>20,"exercise real production runtime inventory, not a tiny ZIP fixture");
  const parent=new FakeDirectory("Two Independent Synthetic Stores");
  const installer=load(parent);
  for(const name of ["Synthetic Dealer A","Synthetic Dealer B"]){
   const result=await installer.install({
    file:localFile(fullZip),sha256:expectedHash,version:release.version,folderName:name
   });
   assert.equal(result.status,"installed");
   assert.equal(result.files,release.runtimeFileCount+5,
    "the production builder's runtime files, launcher, companion files and manifest all persisted");
   const root=await parent.getDirectoryHandle(name);
   const system=await root.getDirectoryHandle("System Files");
   const workspace=await system.getDirectoryHandle("Workspace");
   assert.equal(root.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),false);
   assert.equal(workspace.entriesMap.has("settings.json"),false);
   assert.equal((await workspace.getDirectoryHandle("data")).entriesMap.has("settings.json"),false);
   assert.deepEqual(Buffer.from((await system.getFileHandle("index.html")).bytes),
    fs.readFileSync(path.join(__dirname,"..","index.html")),
    "the installed app entry must match the production source byte-for-byte");
   assert.deepEqual(Buffer.from((await root.getFileHandle("INSTALLATION-MANIFEST.json")).bytes).length>100,true);
  }
  assert.equal(parent.entriesMap.size,2,"the two installed stores have distinct roots");
  const a=await parent.getDirectoryHandle("Synthetic Dealer A");
  const b=await parent.getDirectoryHandle("Synthetic Dealer B");
  const aLauncher=await a.getFileHandle("00 - OPEN DASHBOARD.html");
  const bLauncher=await b.getFileHandle("00 - OPEN DASHBOARD.html");
  const otherBytes=Buffer.from(bLauncher.bytes);
  aLauncher.bytes=new Uint8Array([1,2,3]);
  assert.deepEqual(Buffer.from(bLauncher.bytes),otherBytes,"store A cannot mutate store B");
  const existingWrites=parent.shared.writes;
  await assert.rejects(installer.install({
   file:localFile(fullZip),sha256:expectedHash,version:release.version,folderName:"Synthetic Dealer A"
  }),/already exists/);
  assert.equal(parent.shared.writes,existingWrites,"a repeat install never writes over a store");
 }finally{
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});

test("new installation refuses a foreign file added after the initial empty-folder check",async()=>{
 const foreign=b("SYNTHETIC FOREIGN FILE: PRESERVE ORIGINAL BYTES"),fixture=makeZip();
 const parent=new FakeDirectory("Synthetic Parent",{writes:0,permission:"granted",afterClose:async(name,dir)=>{
   if(name==="MOONDOG-INSTALL-INCOMPLETE.txt"){
     const pending=await dir.getFileHandle("index.html",{create:true});
     pending.bytes=new Uint8Array(foreign);
   }
 }});
 await assert.rejects(load(parent).install(installOptions(fixture)),/unexpected|appeared|already exists/i,
  "a different writer adding an approved-name file must stop before overwrite");
 const installed=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 const original=await installed.getFileHandle("index.html");
 assert.deepEqual(Buffer.from(original.bytes),foreign,"never replace another writer's file");
 assert.equal(installed.entriesMap.has("INSTALLATION-MANIFEST.json"),false);
 assert.equal(installed.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true);
});

test("new installation detects an unlisted synthetic entry inserted during package writing",async()=>{
 const foreign=b("SYNTHETIC EXTERNAL FILE: DO NOT DELETE"),fixture=makeZip();
 const parent=new FakeDirectory("Synthetic Parent",{writes:0,permission:"granted",afterClose:async(name,dir)=>{
   if(name==="00 - OPEN DASHBOARD.html"){
     const unexpected=await dir.getFileHandle("SYNTHETIC-EXTERNAL.txt",{create:true});
     unexpected.bytes=new Uint8Array(foreign);
   }
 }});
 await assert.rejects(load(parent).install(installOptions(fixture)),/unexpected|appeared|unapproved/i,
  "an extra file in an otherwise fresh root must prevent a verified-complete claim");
 const installed=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 assert.deepEqual(Buffer.from((await installed.getFileHandle("SYNTHETIC-EXTERNAL.txt")).bytes),foreign);
 assert.equal(installed.entriesMap.has("INSTALLATION-MANIFEST.json"),false);
 assert.equal(installed.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true);
});

test("original immutable Stable installs the compatibility page required for the first update",async()=>{
 const fixture=makeZip({},"",true);
 assert.equal(fixture.manifest.files.some(file=>file.path==="index.html"),false);
 const parent=new FakeDirectory("Synthetic Parent"),api=load(parent);
 const archive=await api.inspectVerifiedZip(await localFile(fixture.bytes).arrayBuffer(),fixture.hash,"0.10.17");
 assert.equal(archive.files.some(file=>file.path==="index.html"),false);
 const result=await api.install(installOptions(fixture,{folderName:"Legacy Stable New Store"}));
 assert.equal(result.status,"installed");
 const root=await parent.getDirectoryHandle("Legacy Stable New Store");
 assert.deepEqual(Buffer.from((await root.getFileHandle("index.html")).bytes),b(compatibilityHtml));
 assert.deepEqual(Buffer.from((await root.getFileHandle("INSTALLATION-MANIFEST.json")).bytes),
  Buffer.from(archive.files.find(file=>file.path==="INSTALLATION-MANIFEST.json").bytes));
 assert.equal(root.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),false);
 assert.ok(await root.getFileHandle("00 - OPEN DASHBOARD.html"));
 const system=await root.getDirectoryHandle("System Files");
 assert.ok(await system.getFileHandle("index.html"));
 assert.ok(await root.getFileHandle("INSTALLATION-MANIFEST.json"));
 const workspace=await system.getDirectoryHandle("Workspace");
 assert.equal(workspace.entriesMap.has("settings.json"),false);
});

test("final integrity check rejects a previously written approved file changed before commit",async()=>{
 const foreign=b("SYNTHETIC CONCURRENT REWRITE OF VERIFIED LAUNCHER"),fixture=makeZip();
 const parent=new FakeDirectory("Synthetic Parent",{writes:0,permission:"granted",afterClose:async(name,dir)=>{
   if(name==="index.html" && dir.name==="MoonDog Synthetic Store"){
     const launcher=await dir.getFileHandle("00 - OPEN DASHBOARD.html",{create:false});
     launcher.bytes=new Uint8Array(foreign); // Not written by installer.
   }
 }});
 await assert.rejects(load(parent).install(installOptions(fixture)),/changed before completion|missing/i);
 const installed=await parent.getDirectoryHandle("MoonDog Synthetic Store");
 assert.deepEqual(Buffer.from((await installed.getFileHandle("00 - OPEN DASHBOARD.html")).bytes),foreign,
  "report conflict but never silently replace or remove unrelated concurrent bytes");
 assert.equal(installed.entriesMap.has("INSTALLATION-MANIFEST.json"),false);
 assert.equal(installed.entriesMap.has("MOONDOG-INSTALL-INCOMPLETE.txt"),true);
});


test("hosted installer requests the destination before downloading and writes only verified bytes",async()=>{
 const fixture=makeZip();
 const parent=new FakeDirectory("Synthetic Parent");
 let picked=false,downloads=0;
 const api=load(parent,async()=>{
  picked=true;
  assert.equal(parent.shared.writes,0);
  return parent;
 });
 const result=await api.install(installOptions(fixture,{
  file:undefined,
  loadArchive:async()=>{
   assert.equal(picked,true,"picker must precede network request");
   assert.equal(parent.shared.writes,0,"no bytes written before verified download");
   downloads++;
   return Uint8Array.from(fixture.bytes);
  }
 }));
 assert.equal(result.status,"installed");
 assert.equal(downloads,1);
 assert.ok(await(await parent.getDirectoryHandle("MoonDog Synthetic Store"))
  .getFileHandle("00 - OPEN DASHBOARD.html"));
});

test("hosted installer refuses a corrupted archive before creating a folder",async()=>{
 const fixture=makeZip(),altered=makeZip({"System Files/extra.txt":b("unapproved")});
 const parent=new FakeDirectory("Synthetic Parent"),api=load(parent);
 await assert.rejects(api.install(installOptions(fixture,{
  file:undefined,
  loadArchive:async()=>Uint8Array.from(altered.bytes)
 })),/SHA-256|hash|fingerprint|matches|verif|differs from the approved Stable release/i);
 assert.equal(parent.shared.writes,0);
 assert.equal(parent.entriesMap.size,0);
});

test("canceling hosted installer never downloads the archive or creates files",async()=>{
 const fixture=makeZip(),parent=new FakeDirectory("Synthetic Parent");
 const error=new Error("The user canceled selection");error.name="AbortError";
 const api=load(parent,async()=>{throw error;});
 let downloaded=false;
 await assert.rejects(api.install(installOptions(fixture,{
  file:undefined,loadArchive:async()=>{downloaded=true;return fixture.bytes;}
 })),/canceled selection/);
 assert.equal(downloaded,false);
 assert.equal(parent.shared.writes,0);
});

test("primary installer uses a chosen Windows folder, with no synthetic mode or ZIP picker",()=>{
 const local=fs.readFileSync(path.join(__dirname,"..","distribution","site","local-install.html"),"utf8");
 const landing=fs.readFileSync(path.join(__dirname,"..","distribution","site","index.html"),"utf8");
 assert.match(landing,/href="\.\/local-install\.html"/);
 assert.doesNotMatch(landing,/href="\.\/web-preview\/\?v=20"/);
 assert.match(local,/id="installNow"/);
 assert.match(local,/MoonDogFreshInstall\.install/);
 assert.match(local,/fetchVerifiedSitePackage/);
 assert.match(local,/newInstallConsent/);
 assert.doesNotMatch(local,/<select\b/i);
 assert.doesNotMatch(local,/<input[^>]+type="file"/i);
 assert.doesNotMatch(local,/workspaceMode|syntheticWarning|id="zipFile"/);
 assert.match(local,/file:\/\//);
 assert.match(local,/00 - OPEN DASHBOARD\.html/);
 assert.match(local,/Alt while dragging each original file or folder/);
 assert.match(local,/System Files \/ Workspace \/ 01 - DROP REPORTS HERE/);
 assert.match(local,/Files to Learn/);
 assert.match(local,/without moving anything in the installation folder/);
});

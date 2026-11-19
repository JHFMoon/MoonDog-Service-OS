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
const zipData={
 "00 - OPEN DASHBOARD.html":b("<html>Open synthetic MoonDog</html>"),
 "index.html":b("<html>Root origin synthetic MoonDog</html>"),
 "System Files/index.html":b("<html>System Files synthetic MoonDog</html>"),
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
function makeZip(extraFiles={},omitDirectory="") {
 const inventory=Object.entries(zipData).map(([name,data])=>({
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
   ...Object.entries({...zipData,...extraFiles}).map(([name,bytes])=>({name:PREFIX+name,bytes})),
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
 async *values(){for(const entry of this.entriesMap.values())yield entry;}
 async removeEntry(name){if(!this.entriesMap.delete(name))throw missing();}
}
function load(parent,confirm=()=>true){
 const context={
   crypto:crypto.webcrypto,TextDecoder,TextEncoder,Blob,DecompressionStream,
   confirm,showDirectoryPicker:async()=>parent
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
test("existing installation folder is never overwritten, even when empty or name is reused",async()=>{
 const parent=new FakeDirectory("Synthetic Parent"),api=load(parent),fixture=makeZip();
 const original=await parent.getDirectoryHandle("MoonDog Synthetic Store",{create:true});
 await assert.rejects(api.install(installOptions(fixture)),/already exists/);
 assert.equal(original.entriesMap.size,0);
 assert.equal(parent.shared.writes,0);
});
test("private Workspace or existing app root cannot be selected as installation parent",async()=>{
 const fixture=makeZip();
 for(const mode of ["workspace","app","partial-app","partial-workspace"]){
   const parent=new FakeDirectory("Synthetic "+mode);
   if(mode==="workspace" || mode==="partial-workspace"){
     await parent.getDirectoryHandle("data",{create:true});
     await parent.getDirectoryHandle(mode==="workspace"?"backups":"imports",{create:true});
   }else if(mode==="partial-app"){
     const system=await parent.getDirectoryHandle("System Files",{create:true});
     await system.getDirectoryHandle("Workspace",{create:true});
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
   makeZip({},"System Files/Workspace/backups/")
 ];
 for(const data of badCases){
   const parent=new FakeDirectory("Synthetic Parent"),api=load(parent);
   await assert.rejects(api.install(installOptions(data)));
   assert.equal(parent.entriesMap.size,0,"reject invalid archive before directory creation");
   assert.equal(parent.shared.writes,0);
 }
});
test("declined installation and denied permissions never write a file",async()=>{
 const fixture=makeZip();
 let parent=new FakeDirectory("Synthetic Parent");
 let out=await load(parent,()=>false).install(installOptions(fixture));
 assert.equal(out.status,"cancelled");assert.equal(parent.entriesMap.size,0);
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
 assert.match(html,/validated SAPR report from that same store/);
 assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b/);
 assert.doesNotMatch(source,/getFileHandle\("settings\.json".*\{create:true/);
 assert.doesNotThrow(()=>new vm.Script(source));
});

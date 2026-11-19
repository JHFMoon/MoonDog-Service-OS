'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const src = path.join(__dirname, '..', 'distribution', 'site', 'web-lab');
const imported = import('../distribution/site/web-lab/workspace.mjs');
function missing(){ const e=new Error('Missing');e.name='NotFoundError';return e; }
class File {
  constructor(name){this.name=name;this.kind='file';this.bytes=new Uint8Array(0);}
  async getFile(){return {arrayBuffer:async()=>this.bytes.slice().buffer};}
  async createWritable(){let pieces=[];return {write:async(bytes)=>{pieces.push(Uint8Array.from(bytes));},close:async()=>{const length=pieces.reduce((a,b)=>a+b.length,0);this.bytes=new Uint8Array(length);let p=0;for(const b of pieces){this.bytes.set(b,p);p+=b.length;}},abort:async()=>{}};}
}
class Dir {
  constructor(name){this.kind='directory';this.name=name;this.nodes=new Map();}
  async getDirectoryHandle(name,{create=false}={}){let x=this.nodes.get(name);if(!x&&create){x=new Dir(name);this.nodes.set(name,x);}if(!x)throw missing();if(x.kind!=='directory')throw Error('Not directory');return x;}
  async getFileHandle(name,{create=false}={}){let x=this.nodes.get(name);if(!x&&create){x=new File(name);this.nodes.set(name,x);}if(!x)throw missing();if(x.kind!=='file')throw Error('Not file');return x;}
  async *entries(){yield* this.nodes.entries();}
}
const storage=()=>({root:new Dir('opfs'),getDirectory(){return Promise.resolve(this.root);},persisted:async()=>false,estimate:async()=>({usage:123,quota:1024})});
const lab=async s=>(await imported).openSyntheticLab({storage:s,subtle:webcrypto.subtle,uuid:()=>webcrypto.randomUUID()});
test('browser-only lab writes two independent synthetic stores and reopens them',async()=>{
  const s=storage(),first=await lab(s);
  const a=await first.createStore(),b=await first.createStore();
  assert.notEqual(a.id,b.id);await first.proveDurableReadback(a.id);
  await assert.rejects(first.readProof(b.id),/Missing/);
  await first.proveDurableReadback(b.id);
  const reopened=await lab(s);assert.deepEqual(await reopened.listStoreIds(),[a.id,b.id].sort());
  assert.equal((await reopened.readProof(a.id)).id,a.id);
  assert.equal((await reopened.readProof(b.id)).id,b.id);
});
test('lab refuses non-synthetic data and rejects a foreign store identifier',async()=>{
  const s=storage(),client=await lab(s),a=await client.createStore();
  await assert.rejects(client.proveDurableReadback(a.id,'real store report'),/refuses non-synthetic/);
  await assert.rejects(client.inspectStore('../../desktop'),/Invalid synthetic store/);
  const first=await s.root.getDirectoryHandle('moondog-pwa-synthetic-proof-v1');
  const stores=await first.getDirectoryHandle('stores');
  const dir=await stores.getDirectoryHandle(a.id);
  const marker=await dir.getFileHandle('manifest.json');marker.bytes=new TextEncoder().encode('{"format":"foreign"}');
  await assert.rejects(client.inspectStore(a.id),/identity does not match/);
});
test('browser storage quota and nonpersistent status are not represented as durable backup',async()=>{
  const s=storage(),client=await lab(s),retention=await client.browserRetention();
  assert.deepEqual(retention,{persisted:false,quota:1024});
});
test('service worker permits only the exact public lab asset URLs',()=>{
  const sw=fs.readFileSync(path.join(src,'sw.js'),'utf8');
  assert.match(sw,/event\.request\.method !== 'GET'/);
  assert.match(sw,/!ALLOWED\.has\(event\.request\.url\)/);
  assert.match(sw,/cache\.match\(event\.request/);
  assert.doesNotMatch(sw,/cache\.put\(event\.request/);
  assert.doesNotMatch(sw,/\bPOST\b|\bPUT\b|\bDELETE\b/);
});
test('lab is visibly synthetic and never appears as the working MoonDog dashboard',()=>{
  const html=fs.readFileSync(path.join(src,'index.html'),'utf8');
  const readme=fs.readFileSync(path.join(src,'README.md'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(src,'app.webmanifest'),'utf8'));
  assert.match(html,/SYNTHETIC TEST ONLY/);
  assert.match(html,/This is not the MoonDog dashboard/);
  assert.match(readme,/does not run the dashboard/);
  assert.match(manifest.name,/Synthetic Only/);
  assert.ok(manifest.scope==='./');
  assert.match(html,/Content-Security-Policy/);
});
test('duplicate UUID never adopts an existing synthetic directory',async()=>{
  const s=storage();const id=webcrypto.randomUUID();
  const module=await imported;
  const lab=await module.openSyntheticLab({storage:s,subtle:webcrypto.subtle,uuid:()=>id});
  await lab.createStore();
  await assert.rejects(lab.createStore(),/already exists/);
  assert.equal((await lab.listStoreIds()).length,1);
});
test('incomplete synthetic store record cannot be mistaken for success',async()=>{
  const s=storage();const client=await lab(s);const {id}=await client.createStore();
  const ns=await s.root.getDirectoryHandle('moondog-pwa-synthetic-proof-v1');
  const dir=await (await ns.getDirectoryHandle('stores')).getDirectoryHandle(id);
  const file=await dir.getFileHandle('manifest.json');file.bytes=new TextEncoder().encode('{ "format":');
  await assert.rejects(client.inspectStore(id));
  assert.deepEqual(await client.listStoreIds(),[id], 'directory exists but requires verification before use');
});
test('service worker caches only exact public files and refuses unrelated/private requests',async()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(src,'sw.js'),'utf8');
  const root='https://synthetic.example.invalid/web-lab/';
  const listeners=new Map(),writes=[],cache=new Map(),requests=[];
  const self={registration:{scope:root},addEventListener:(type,fn)=>listeners.set(type,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  const caches={keys:async()=>['moondog-other-app','moondog-synthetic-pwa-lab-v1'],
    delete:async()=>{},open:async()=>({put:async(url,data)=>{cache.set(url,data);writes.push(url);},match:async request=>cache.get(request.url)||null})};
  const fetch=async(request)=>{requests.push(request.url||request);return {ok:true,type:'basic',text:async()=> 'synthetic app'};};
  vm.runInNewContext(source,{self,URL,Set,caches,fetch,Error});
  const waiting=[];listeners.get('install')({waitUntil:p=>waiting.push(p)});
  await Promise.all(waiting);
  assert.equal(writes.length,6);
  assert.ok(writes.every(x=>x.startsWith(root)));
  let intercepted=false;
  listeners.get('fetch')({request:{method:'GET',url:root+'../private-data.json'},respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false,'private files are never serviced/cached');
  listeners.get('fetch')({request:{method:'POST',url:root+'index.html'},respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false,'writes never reach this read-only service worker');
  let response;
  listeners.get('fetch')({request:{method:'GET',url:root+'index.html'},respondWith:p=>{response=p;}});
  assert.ok(response,'allowlisted public page intercepted');
  assert.equal((await response).ok,true);
  assert.equal(requests.length,6,'offline page resolved from cache without another network fetch');
});

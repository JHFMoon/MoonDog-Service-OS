// Standalone recovery controller, real Web Crypto and isolated synthetic disk only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createHash,webcrypto}=require('node:crypto');
const repo=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(repo,'repair-moondog.html'),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const scripts=[...html.matchAll(/<script([^>]*)>\n([\s\S]*?)<\/script>/g)];
const catalog=JSON.parse(scripts.at(-1)[2].match(/const CATALOG=Object\.freeze\((\[[^;]+\])\);/)[1]);
const missing=()=>Object.assign(new Error('synthetic missing'),{name:'NotFoundError'});

test('downloaded recovery page contains exact reviewed modules and application catalog',()=>{
  assert.equal(scripts.length,5);
  for(const match of scripts.slice(0,-1)){
    const source=match[1].match(/data-moondog-source="([^"]+)"/)[1];
    assert.equal(match[2].replaceAll('<\\/script','</script'),fs.readFileSync(path.join(repo,source),'utf8'));
  }
  const app=fs.readFileSync(path.join(repo,'assets/app.js'),'utf8');
  assert.deepEqual(catalog,JSON.parse(app.match(/const HANDOFF_RUNTIME_PATHS=(\[[^;]+\]);/s)[1]));
  assert.match(html,/default-src 'none'/);assert.match(html,/Workspace is preserved/);
  assert.doesNotMatch(html,/<script[^>]+src=/i);
});

function harness(t,options={}){
  const rootPath=fs.mkdtempSync(path.join(os.tmpdir(),'moondog-recovery-synthetic-'));
  t.after(()=>fs.rmSync(rootPath,{recursive:true,force:true}));
  fs.mkdirSync(path.join(rootPath,'System Files','Workspace','data'),{recursive:true});
  const privatePath=path.join(rootPath,'System Files','Workspace','data','current-state.json');
  fs.writeFileSync(privatePath,'{"synthetic":true,"manualOverride":"preserve","ro":"same-id"}\n');
  const privateBefore=fs.readFileSync(privatePath),reads=[],writes=[],requests=[];
  const fields=new Map(),handlers=new Map();
  const field=id=>{if(!fields.has(id))fields.set(id,{textContent:'',disabled:false,addEventListener:(type,fn)=>handlers.set(id+':'+type,fn)});return fields.get(id);};
  function handle(folder){return {
    kind:'directory',name:path.basename(folder),_path:folder,
    isSameEntry:async other=>!options.wrongRoot&&other?._path===folder,
    queryPermission:async()=>options.denied?'denied':'granted',requestPermission:async()=>options.denied?'denied':'granted',
    getDirectoryHandle:async(name,opts={})=>{
      assert.equal(path.basename(name),name);assert.notEqual(name,'..');const child=path.join(folder,name);
      if(!fs.existsSync(child)){if(!opts.create)throw missing();fs.mkdirSync(child);}
      if(!fs.statSync(child).isDirectory())throw new Error('synthetic directory mismatch');return handle(child);
    },
    getFileHandle:async(name,opts={})=>{
      assert.equal(path.basename(name),name);assert.notEqual(name,'..');const target=path.join(folder,name);
      if(!fs.existsSync(target)&&!opts.create)throw missing();
      return {getFile:async()=>{
        reads.push(path.relative(rootPath,target));if(!fs.existsSync(target))throw missing();const bytes=fs.readFileSync(target);
        return {size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
      },createWritable:async()=>{let bytes;return {
        write:async value=>bytes=Buffer.from(value),close:async()=>{writes.push(path.relative(rootPath,target));fs.writeFileSync(target,bytes);},abort:async()=>{}
      };}};
    },
    entries:async function*(){for(const entry of fs.readdirSync(folder,{withFileTypes:true}))yield [entry.name,entry.isDirectory()?handle(path.join(folder,entry.name)):{kind:'file'}];},
    removeEntry:async name=>{const target=path.join(folder,name);if(!fs.existsSync(target))throw missing();writes.push(path.relative(rootPath,target));fs.unlinkSync(target);}
  };}
  const root=handle(rootPath);
  const manifest={format:'service-operations-dashboard-clean-install',formatVersion:1,version:'0.10.17',
    applicationRoot:'System Files',workspaceRoot:'System Files/Workspace',launcher:'00 - OPEN DASHBOARD.html',
    workspaceProtectedFromUpdates:true,files:[{path:'System Files/index.html',sha256:'a'.repeat(64)}]};
  fs.writeFileSync(path.join(rootPath,'INSTALLATION-MANIFEST.json'),JSON.stringify(options.invalidIdentity?{}:manifest));
  if(options.missingWorkspace)fs.rmSync(path.join(rootPath,'System Files','Workspace'),{recursive:true});
  if(options.unknownLauncher)fs.writeFileSync(path.join(rootPath,'00 - OPEN DASHBOARD.html'),'unknown synthetic custom launcher');
  // A complete synthetic software catalog exercises the actual controller and
  // installer. Production packages/pinned dependencies are proven separately
  // by the extracted-package Chromium smoke, not replaced by fake digests.
  const files=catalog.map(name=>{
    const content=Buffer.from(name==='index.html'?'<!doctype html><html lang="en"><head><title>Synthetic application</title></head><body></body></html>':'synthetic approved software');
    return {path:name,action:'put',sha256:hash(content),contentBase64:content.toString('base64')};
  });
  const packageBytes=Buffer.from(JSON.stringify({formatVersion:1,version:'0.10.18-beta.900',approvedFiles:catalog,files}));
  const packageUrl='https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-0.10.18-beta.900.json';
  const release={version:'0.10.18-beta.900',minimumCompatibleVersion:options.incompatible?'1.0.0':'0.10.9',migrationRequired:false,packageUrl,sha256:hash(packageBytes)};
  const fetcher=async(url,opts)=>{
    requests.push({url,opts});assert.equal(opts.credentials,'omit');assert.equal(opts.referrerPolicy,'no-referrer');
    assert.equal(opts.body,undefined);assert.ok(!opts.method||opts.method==='GET');
    if(url.startsWith('https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json'))return {ok:true,json:async()=>({beta:release})};
    assert.equal(url,packageUrl);let sent=false;const bytes=options.tampered?Buffer.from('synthetic tampered package'):packageBytes;
    return {ok:true,headers:{get:()=>String(bytes.length)},body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes}),cancel:async()=>{}})}};
  };
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,URL,atob,crypto:webcrypto,fetch:fetcher,
    document:{getElementById:field},showDirectoryPicker:async()=>root,confirm:()=>!options.cancel});
  for(const script of scripts)vm.runInContext(script[2],context);
  return {rootPath,privatePath,privateBefore,reads,writes,requests,field,
    choose:()=>handlers.get('choose:click')(),repair:()=>handlers.get('repair:click')()};
}

test('standalone page repairs an unstartable synthetic installation and preserves private disk bytes',async t=>{
  const h=harness(t);await h.choose();assert.equal(h.field('repair').disabled,false);
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.requests,[],'folder diagnosis never uploads or downloads private data');
  await h.repair();assert.match(h.field('status').textContent,/^Ready\. Beta/);
  assert.deepEqual(fs.readFileSync(h.privatePath),h.privateBefore);
  assert.deepEqual(fs.readFileSync(path.join(h.rootPath,'00 - OPEN DASHBOARD.html')),fs.readFileSync(path.join(repo,'00 - OPEN DASHBOARD.html')));
  assert.ok(fs.existsSync(path.join(h.rootPath,'System Files','assets','app.js')));
  assert.ok(h.reads.every(name=>!name.startsWith('System Files/Workspace/data/')),'repair never reads operational records');
  assert.ok(h.writes.every(name=>!name.startsWith('System Files/Workspace/data/')));
  assert.equal(h.requests.length,2);
});

for(const [name,options]of [
  ['unrecognized installation',{invalidIdentity:true}],['missing private Workspace',{missingWorkspace:true}],
  ['denied write permission',{denied:true}],['wrong selected root',{wrongRoot:true}],
  ['unknown named launcher',{unknownLauncher:true}],['tampered package',{tampered:true}],
  ['incompatible installed version',{incompatible:true}],['declined authorization',{cancel:true}]
])test('standalone page refuses '+name+' without changing application or operational bytes',async t=>{
  const h=harness(t,options);await h.choose();await h.repair();
  assert.doesNotMatch(h.field('status').textContent,/^Ready\. Beta/);
  assert.deepEqual(h.writes,[]);
  if(!options.missingWorkspace)assert.deepEqual(fs.readFileSync(h.privatePath),h.privateBefore);
});

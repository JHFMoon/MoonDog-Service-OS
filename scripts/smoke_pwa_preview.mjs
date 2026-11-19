#!/usr/bin/env node
/* CI-only Chromium test of actual Stable runtime served by web-only OPFS path.
 * NO store data. Uses fresh synthetic Edge/Chromium browser profile and the
 * authenticated Stable ZIP already built by Clean Install Proof.
 */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=path.resolve('distribution/site');
const zipPath=path.resolve('dist/Service-Operations-Dashboard.zip');
const manifestPath=path.resolve('dist/Service-Operations-Dashboard.manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const prefix='/MoonDog-Service-OS/';
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json',
 '.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith(prefix)) {res.writeHead(404);res.end();return;}
  const relative=decodeURIComponent(url.pathname.slice(prefix.length));
  if(relative==='latest.json'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   res.end(JSON.stringify({version:manifest.version,sha256:manifest.sha256,
    asset:'https://github.com/JHFMoon/MoonDog-Service-OS/releases/latest/download/Service-Operations-Dashboard.zip'}));
   return;
  }
  const parts=relative.split('/');
  if(!relative||parts.some(v=>!v||v==='.'||v==='..'||v.includes('\\'))){res.writeHead(404);res.end();return;}
  const file=path.join(root,...parts);
  if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile()){res.writeHead(404);res.end();return;}
  const raw=await readFile(file);
  res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
  res.end(raw);
 }catch(_){res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({serviceWorkers:'allow'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));
 const rootUrl=`http://127.0.0.1:${port}${prefix}web-preview/`;
 await page.goto(rootUrl+'index.html',{waitUntil:'load',timeout:30000});
 await page.waitForFunction(()=>document.getElementById('install').disabled===false,null,{timeout:10000});
 await page.setInputFiles('#zip',zipPath);
 await page.locator('#consent').check();
 await page.locator('#install').click();
 await page.locator('#openApp').waitFor({state:'visible',timeout:45000});
 const launch=await page.locator('#openApp').getAttribute('href');
 if(!/\/store\/[0-9a-f-]{36}\/[a-f0-9]{64}\/\d+\.\d+\.\d+\/index\.html$/.test(launch||''))
  throw Error('Web-only browser install did not publish a verified app route.');
 // Registering SW from the shell creates the service-worker-backed browser URL.
 await page.goto(new URL(launch,rootUrl).href,{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>(typeof globalThis.MoonDogInstalledVersion==='string'&&typeof globalThis.XLSX?.read==='function'&&typeof globalThis.JSZip==='function'),null,{timeout:25000});
 const result=await page.evaluate(()=>({version:globalThis.MoonDogInstalledVersion,
    title:document.title,buttonPresent:!!document.getElementById('connectButton'),
    bridge:typeof window.showDirectoryPicker==='function'}));
 if(!result.buttonPresent||!result.bridge||result.version!==manifest.version)
   throw Error('The real verified MoonDog dashboard did not start through the browser-only bridge.');
 const initialErrors=errors.filter(x=>/SyntaxError|ReferenceError|TypeError/i.test(x));
 if(initialErrors.length)throw Error('Browser app errors: '+initialErrors.slice(0,4).join(' | '));
 await page.waitForFunction(()=>document.getElementById('connectButton')?.disabled===false,null,{timeout:15000});
 page.on('dialog',async dialog=>dialog.accept());
 await page.locator('#connectButton').click();
 await page.waitForFunction(()=>globalThis.__moondogDaily?.model?.root &&
    globalThis.__moondogDaily.model.connectionState==='CONNECTED',null,{timeout:25000});
 const connection=await page.evaluate(()=>({connected:globalThis.__moondogDaily?.model?.connectionState,
    store:globalThis.__moondogDaily?.model?.root?.name,root:!!globalThis.__moondogDaily?.model?.applicationRoot}));
 if(connection.connected!=='CONNECTED')throw Error('Real MoonDog Workspace did not connect to verified browser-private store.');
 await context.setOffline(true);
 await page.reload({waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>typeof globalThis.MoonDogInstalledVersion==='string'&&
    typeof globalThis.JSZip==='function',null,{timeout:20000});
 console.log('Synthetic PWA smoke: official app version, OPFS connection and offline reload verified.',JSON.stringify({version:result.version,connected:connection.connected,offlineReload:true}));
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
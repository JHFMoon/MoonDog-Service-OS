'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const load=()=>import('../src/pwa/verified_beta_transport.mjs');
const bytes=x=>new TextEncoder().encode(x),sha=async x=>Buffer.from(await webcrypto.subtle.digest('SHA-256',x)).toString('hex');
const ROOT='https://jhfmoon.github.io/MoonDog-Service-OS/',COMMIT='a'.repeat(40),VERSION='0.10.18-beta.456';
async function fake({wrongHash=false,redirect=false,unsafe=false,stable='0.10.17',wrongFile=false,migrationRequired=false,minimumCompatibleVersion='0.10.9'}={}){
 const names=['index.html','assets/app.js','assets/styles.css','assets/freshness.js','vendor/xlsx.full.min.js'];
 if(unsafe)names[4]='Workspace/data/private.json';
 const files=[];for(const path of names){const raw=bytes('synthetic only '+path);files.push({path,action:'put',sha256:await sha(raw),contentBase64:Buffer.from(raw).toString('base64')});}
 if(wrongFile)files[1].contentBase64=Buffer.from('tampered').toString('base64');
 const pkg=bytes(JSON.stringify({formatVersion:1,version:VERSION,approvedFiles:names,files}));
 const manifest=bytes(JSON.stringify({stable:{version:stable},beta:{version:VERSION,sha256:wrongHash?'0'.repeat(64):await sha(pkg),migrationRequired,minimumCompatibleVersion,packageUrl:'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-'+VERSION+'.json'}}));
 const url='https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/'+COMMIT+'/';
 const expected=new Map([[ROOT+'site-version.json',bytes(JSON.stringify({mainSha:COMMIT}))],[url+'updates/manifest.json',manifest],[url+'updates/packages/moondog-'+VERSION+'.json',pkg]]);
 const calls=[];
 const fetchImpl=async(link,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
  calls.push(link);const raw=expected.get(link);if(!raw)throw Error('unexpected fetch '+link);
  return {ok:true,type:'cors',redirected:redirect&&calls.length===3,url:link,headers:{get:()=>String(raw.length)},
   body:{getReader(){let done=false;return {read:async()=>done?{done:true}:{done:(done=true,false),value:raw},cancel:async()=>{}};}}};
 };
 return {fetchImpl,calls};
}
test('pinned published main verifies Beta JSON manifest and each runtime file without any Workspace access',async()=>{
 const f=await fake(),out=await(await load()).fetchVerifiedPinnedBeta({fetchImpl:f.fetchImpl,crypto:webcrypto});
 assert.equal(out.version,VERSION);assert.equal(out.mainSha,COMMIT);assert.equal(out.verified,true);
 assert.equal(out.installed,false);assert.equal(out.productionReady,false);assert.equal(out.files.length,5);
 assert.deepEqual(out.files.map(x=>x.path),['index.html','assets/app.js','assets/styles.css','assets/freshness.js','vendor/xlsx.full.min.js']);
 assert.equal(f.calls.length,3);assert.equal(f.calls.every(x=>x.startsWith(ROOT)||x.includes('/'+COMMIT+'/')),true);
});
test('wrong package SHA, redirected content and per-file tampering refuse all Beta bytes',async()=>{
 for(const opts of [{wrongHash:true},{redirect:true},{wrongFile:true}]){
  const f=await fake(opts);await assert.rejects((await load()).fetchVerifiedPinnedBeta({fetchImpl:f.fetchImpl,crypto:webcrypto}),/mismatch|redirect/);
 }
});
test('private path and unexpected Stable manifest authority never authenticate a Beta candidate',async()=>{
 for(const opts of [{unsafe:true},{stable:'0.10.18'}]){
  const f=await fake(opts);await assert.rejects((await load()).fetchVerifiedPinnedBeta({fetchImpl:f.fetchImpl,crypto:webcrypto}),/unapproved runtime paths|approved Stable channel/);
 }
});
test('wrong Pages origin and unavailable cryptography reject before network activity',async()=>{
 const f=await fake(),api=await load();
 await assert.rejects(api.fetchVerifiedPinnedBeta({siteUrl:'https://untrusted.example/',fetchImpl:f.fetchImpl,crypto:webcrypto}),/Trusted MoonDog Pages/);
 await assert.rejects(api.fetchVerifiedPinnedBeta({fetchImpl:f.fetchImpl,crypto:null}),/Trusted MoonDog Pages/);
 assert.equal(f.calls.length,0);
});

test('Beta requiring Workspace migration or missing compatibility authority is refused',async()=>{
 for(const params of [{migrationRequired:true},{minimumCompatibleVersion:'invalid'}]){
  const mock=await fake(params);
  await assert.rejects((await load()).fetchVerifiedPinnedBeta({fetchImpl:mock.fetchImpl,crypto:webcrypto}),/migration|compatibility/);
 }
});

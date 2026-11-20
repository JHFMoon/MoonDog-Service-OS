'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');

const api = () => import('../src/pwa/verified_site_package.mjs');
const SITE = 'https://jhfmoon.github.io/MoonDog-Service-OS/web-preview/';
const VERSION = '0.10.17';
const payload = new TextEncoder().encode('SYNTHETIC public software ZIP fixture. NO DEALERSHIP DATA.');
const sha = async value => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',value)),
  item=>item.toString(16).padStart(2,'0')).join('');
const siteResponse = (bytes=payload, {status=200,url,redirected=false,length=bytes.length,method='GET'}={}) => {
  const response = new Response(method==='HEAD'?null:bytes,{status,headers:{'content-length':String(length)}});
  Object.defineProperty(response,'url',{value:url||SITE+'packages/moondog-'+VERSION+'.zip'});
  Object.defineProperty(response,'redirected',{value:redirected});
  return response;
};
test('version-pinned package URL requires HTTPS and trusted web-preview path',async()=>{
 const {verifiedSitePackageUrl} = await api();const hash=await sha(payload);
 assert.equal(verifiedSitePackageUrl({siteUrl:SITE,version:VERSION,sha256:hash}),
  SITE+'packages/moondog-'+VERSION+'.zip');
 for(const value of [
  {siteUrl:'http://jhfmoon.github.io/MoonDog-Service-OS/web-preview/',version:VERSION,sha256:hash},
  {siteUrl:'https://evil.example/web-preview/',version:'../other',sha256:hash},
  {siteUrl:SITE+'?next=evil',version:VERSION,sha256:hash},
  {siteUrl:SITE,version:'0.10.17-beta.456',sha256:hash},
  {siteUrl:SITE,version:VERSION,sha256:'f'},
  {siteUrl:'https://jhfmoon.github.io/other/',version:VERSION,sha256:hash}
 ])assert.throws(()=>verifiedSitePackageUrl(value),/trusted website|Stable package fingerprint/);
});
test('same-origin published ZIP is downloaded with no file picker and verified before use',async()=>{
 const {fetchVerifiedSitePackage,probeSitePackage}=await api();const hash=await sha(payload);
 const calls=[];const fetchImpl=async(url,opts)=>{
   calls.push({url,opts});return siteResponse(payload,{method:opts.method});
 };
 assert.equal(await probeSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,fetchImpl,crypto:webcrypto}),true);
 const read=await fetchVerifiedSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,fetchImpl,crypto:webcrypto});
 assert.deepEqual(Buffer.from(read),Buffer.from(payload));
 assert.equal(calls.length,2);
 assert.equal(calls[0].opts.method,'HEAD');
 assert.equal(calls[1].opts.method,'GET');
 for(const call of calls){
  assert.equal(call.url,SITE+'packages/moondog-'+VERSION+'.zip');
  assert.equal(call.opts.credentials,'omit');
  assert.equal(call.opts.redirect,'error');
  assert.equal(call.opts.mode,'same-origin');
  assert.equal(call.opts.cache,'no-store');
 }
});
test('unpublished website package never starts browser store creation',async()=>{
 const {fetchVerifiedSitePackage,probeSitePackage}=await api();const hash=await sha(payload);
 const fetchImpl=async()=>siteResponse(payload,{status:404});
 assert.equal(await probeSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,fetchImpl,crypto:webcrypto}),false);
 await assert.rejects(fetchVerifiedSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,fetchImpl,crypto:webcrypto}),
  /unavailable or redirected/);
});
test('wrong hash, redirected response, and wrong source are rejected',async()=>{
 const {fetchVerifiedSitePackage,probeSitePackage}=await api();const hash=await sha(payload);
 const cases=[
  {response:siteResponse(new TextEncoder().encode('TAMPERED')),message:/SHA-256/},
  {response:siteResponse(payload,{redirected:true}),message:/redirected/},
  {response:siteResponse(payload,{url:'https://other.example/download.zip'}),message:/redirected/},
  {response:siteResponse(payload,{length:64*1024*1024+1}),message:/length/},
  {response:siteResponse(payload,{length:'bad'}),message:/length/},
  {response:siteResponse(new Uint8Array()),message:/empty|length/}
 ];
 for(const item of cases){
  await assert.rejects(fetchVerifiedSitePackage({
   siteUrl:SITE,version:VERSION,sha256:hash,fetchImpl:async()=>item.response,crypto:webcrypto
  }),item.message);
 }
 assert.equal(await probeSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,
  fetchImpl:async()=>siteResponse(payload,{redirected:true}),crypto:webcrypto}),false);
});
test('stream length limit is checked independently of the Content-Length header',async()=>{
 const {fetchVerifiedSitePackage}=await api();const hash=await sha(payload);
 let cancelled=false;
 const response={ok:true,type:'basic',redirected:false,url:SITE+'packages/moondog-'+VERSION+'.zip',
  headers:{get:()=>null},body:{getReader:()=>({
    read:async()=>({done:false,value:new Uint8Array(64*1024*1024+1)}),
    cancel:async()=>{cancelled=true;}
   })}};
 await assert.rejects(fetchVerifiedSitePackage({siteUrl:SITE,version:VERSION,sha256:hash,
  fetchImpl:async()=>response,crypto:webcrypto}),/exceeds the allowed size/);
 assert.equal(cancelled,true);
});

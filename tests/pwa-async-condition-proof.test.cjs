"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../scripts/smoke_pwa_restart.mjs'),'utf8');
const start=source.indexOf('async function waitForAsyncCondition('),end=source.indexOf('async function shellProof(',start);
assert.ok(start>=0&&end>start);
function fixture(){
 let clock=0,evaluations=0;const delays=[];
 const wait=vm.runInNewContext(source.slice(start,end)+';waitForAsyncCondition',{Date:{now:()=>clock}});
 const page={evaluate:async(fn,arg)=>{evaluations++;return await fn(arg);},waitForTimeout:async ms=>{delays.push(ms);clock+=ms;}};
 return{wait:(fn,arg,options)=>wait(page,fn,arg,options),evaluations:()=>evaluations,delays};
}
test('asynchronous false results keep polling until actual browser readiness',async()=>{
 const f=fixture();let readyChecks=0;
 await f.wait(async expected=>++readyChecks===expected,3,{timeout:100,polling:10});
 assert.equal(f.evaluations(),3);assert.deepEqual(f.delays,[10,10]);
});
test('a resolved false Promise never certifies browser readiness',async()=>{
 const f=fixture();
 await assert.rejects(f.wait(async()=>false,null,{timeout:20,polling:10}),/Async browser condition timed out/);
 assert.equal(f.evaluations(),3);assert.deepEqual(f.delays,[10,10]);
});
test('browser predicate failures are not silently retried',async()=>{
 const f=fixture();
 await assert.rejects(f.wait(async()=>{throw Error('real browser read failed');},null,{timeout:20,polling:10}),/real browser read failed/);
 assert.equal(f.evaluations(),1);assert.deepEqual(f.delays,[]);
});

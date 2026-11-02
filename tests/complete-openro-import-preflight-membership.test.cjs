"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  async function verifyCompleteRoImport(");
const end=app.indexOf("  async function importCdkRepairOrdersDocxUnlocked(",start);
assert.ok(start>=0&&end>start,"actual production complete-roster verification exists");
const code=app.slice(start,end);
assert.match(code,/incomingRoKeys\.has\(text\(row\.ro\)\.trim\(\)\)/,
  "production coverage must use the source-validation identity Set");
const synthetic=number=>({ro:String(700000+number)});
function harness({incoming,existing,priorDigest="",sourceDigest="synthetic-digest",
    currentDigest="synthetic-digest",accept=true,modified=Date.now()-60000}={}){
  let prompt="",reads=0,hashes=0;
  const bytes=new Uint8Array([3,8,5]).buffer;
  const model={state:{records:existing||[],source:{sha256:priorDigest}}};
  const ctx=vm.createContext({model,Date,Set,Number,
    text:value=>String(value??""),
    sha256:async()=>{hashes++;return hashes===1?sourceDigest:currentDigest;},
    sourceFileHandle:async()=>({getFile:async()=>{reads++;return{arrayBuffer:async()=>bytes};}}),
    window:{confirm:message=>{prompt=message;return accept;}}
  });
  vm.runInContext(code+"\nthis.verify=verifyCompleteRoImport;",ctx);
  return{model,bytes,modified,verify:()=>ctx.verify("synthetic-open-ro.xlsx",{lastModified:modified},bytes,incoming||[],false),
    prompt:()=>prompt,reads:()=>reads};
}

test("synthetic complete-roster source counts missing ROs exactly once without changing data",async()=>{
  const existing=Array.from({length:2400},(_,i)=>synthetic(i));
  const incoming=Array.from({length:2400},(_,i)=>synthetic(i+1200));
  const before=JSON.stringify(existing),h=harness({incoming,existing});
  const result=await h.verify();
  assert.match(h.prompt(),/2400 incoming ROs; 1200 existing ROs absent/);
  assert.equal(result.sha256,"synthetic-digest");
  assert.equal(result.verification,"explicit-local-source-review; unsigned");
  assert.equal(h.reads(),1);
  assert.equal(JSON.stringify(existing),before);
});

test("duplicate and blank incoming identities fail closed before any file verification",async()=>{
  for(const incoming of [[synthetic(1),synthetic(1)],[synthetic(2),{ro:" "}]]) {
    const h=harness({incoming,existing:[synthetic(1)]});
    await assert.rejects(h.verify(),/Needs Review: (duplicate RO identities|incomplete RO identity)/);
    assert.equal(h.reads(),0);
  }
});

test("source digest replay and mid-review byte change must not authorize replacement",async()=>{
  const old=harness({incoming:[synthetic(1)],existing:[],priorDigest:"synthetic-digest"});
  await assert.rejects(old.verify(),/already imported/);
  assert.equal(old.reads(),0);
  const changed=harness({incoming:[synthetic(1)],existing:[],currentDigest:"different-digest"});
  await assert.rejects(changed.verify(),/changed during review/);
  const refused=harness({incoming:[synthetic(1)],existing:[],accept:false});
  await assert.rejects(refused.verify(),/was not approved/);
});

test("old linear lookup and actual revised Set lookup agree on synthetic completeness",()=>{
  const incoming=Array.from({length:2400},(_,i)=>synthetic(i+1200));
  const existing=Array.from({length:2400},(_,i)=>synthetic(i));
  const keys=incoming.map(row=>row.ro);
  const keySet=new Set(keys);
  const countLinear=()=>existing.filter(row=>!keys.includes(row.ro)).length;
  const countIndexed=()=>existing.filter(row=>!keySet.has(row.ro)).length;
  assert.equal(countLinear(),1200);
  assert.equal(countIndexed(),countLinear());
  const measure=fn=>{
    const samples=[];
    for(let i=0;i<9;i++){const t=performance.now();assert.equal(fn(),1200);samples.push(performance.now()-t);}
    samples.sort((a,b)=>a-b);
    return{count:9,p50Ms:samples[4],p95Ms:samples[8]};
  };
  // These are Node membership-only timings, not browser render, source parse,
  // durable file read/write, real installed app, or a complete import task.
  const before=measure(countLinear),after=measure(countIndexed);
  console.log("58-05 synthetic complete-roster membership baseline "+
    JSON.stringify({scope:"2400 incoming and 2400 prior synthetic ROs, membership-only",before,after,
      p50ReductionPercent:Math.round((1-after.p50Ms/before.p50Ms)*1000)/10,
      p95ReductionPercent:Math.round((1-after.p95Ms/before.p95Ms)*1000)/10}));
  assert.ok(before.p50Ms>=0&&after.p50Ms>=0);
});

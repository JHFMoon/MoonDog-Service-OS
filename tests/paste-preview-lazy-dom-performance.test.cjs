"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {performance}=require("node:perf_hooks");
const sourceFile=fs.readFileSync(path.join(__dirname,"..","assets","daily-ops.js"),"utf8");
const start=sourceFile.indexOf("    function renderResult(outcome){");
const end=sourceFile.indexOf("    function renderTeachingForm(){",start);
assert.ok(start>0&&end>start,"production clipboard preview renderer is available");
const shipped=sourceFile.slice(start,end);
const marker="        // The details list is collapsed by default.";
const first=shipped.indexOf(marker),last=shipped.indexOf("        result.append(details);",first);
assert.ok(first>0&&last>first,"actual production deferred-detail block exists");
const eagerBlock=[
 "        const ul=document.createElement('ul');",
 "        for(const item of outcome.changes){",
 "          const entry=line(ul,'RO '+item.ro+': '+item.kind,'li');",
 "          if(item.fields?.length){",
 "            const fields=document.createElement('ul');",
 "            for(const change of item.fields)line(fields,change.field+': '+String(change.before||'(blank)')+' → '+String(change.after||'(blank)'),'li');",
 "            entry.append(fields);",
 "          }",
 "        }",
 "        details.append(ul);result.append(details);"
].join("\n");
const baseline=shipped.slice(0,first)+eagerBlock+shipped.slice(last+"        result.append(details);".length);
function fakeHarness(src){
  const count={created:0,expanded:0,committed:0};
  class FakeElement{
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.open=false;this.hidden=false;this.textContent="";count.created++;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[...items];}
    addEventListener(name,handler){(this.handlers[name]||=[]).push(handler);}
    dispatchEvent(type){for(const handler of this.handlers[type]||[])handler({type,target:this});}
    get fullText(){return this.textContent+this.children.map(child=>child.fullText||"").join("");}
  }
  const document={createElement:tag=>new FakeElement(tag)};
  const result=document.createElement("section"),status=document.createElement("span");
  const line=(parent,txt,tag="p",cls="")=>{
    const el=document.createElement(tag);el.textContent=String(txt);el.className=cls;parent.append(el);return el;
  };
  const button=(label,handler,cls="")=>{
    const el=document.createElement("button");el.textContent=label;el.className=cls;el.click=handler;return el;
  };
  const ctx={result,status,line,document,button,activeNonce:"reviewed",confirm:()=>true,
    bridge:{commit:async()=>{count.committed++;return{status:"unchanged",added:0,updated:0};}},
    renderTeachingForm:()=>{throw Error("unexpected teaching path");}};
  vm.runInNewContext(src+"\nthis.render=renderResult;",ctx);
  return{render:outcome=>ctx.render(outcome),result,status,count};
}
function outcome(){
  const changes=Array.from({length:100},(_,i)=>({
    ro:String(930000+i),kind:"new",fields:Array.from({length:10},(_,j)=>({
      field:"synthetic-field-"+j,before:"",after:"synthetic-after-"+j
    }))
  }));
  return{kind:{sourceId:"cdk-repair-orders",name:"CDK Repair Orders",status:"recognized"},
    detected:300,valid:300,scope:"Synthetic partial/unknown",counts:{new:100,updated:0,unchanged:200,invalid:0},
    changes,issues:[],warnings:[],canCommit:true};
}
const percent=(s,p)=>{
  const values=[...s].sort((a,b)=>a-b);
  return +values[Math.min(values.length-1,Math.max(0,Math.ceil(p*values.length)-1))].toFixed(3);
};
test("collapsed proposed changes avoids building nested DOM and remains keyboard-expandable",async()=>{
  const h=fakeHarness(shipped),data=outcome();
  const snapshot=JSON.stringify(data);
  h.render(data);
  const details=h.result.children.find(node=>node.tagName==="details");
  assert.ok(details,"native details semantics remain intact");
  assert.equal(details.children.length,1,"only summary initially, no hidden list");
  assert.match(details.children[0].textContent,/100 shown/);
  assert.ok(h.count.created<30,"closed preview must not allocate 1000 hidden list nodes");
  const button=h.result.children.find(node=>node.tagName==="button");
  assert.equal(button.textContent,"Import Verified Data","verified import stays available");
  details.open=true;details.dispatchEvent("toggle");
  assert.equal(details.children.length,2);
  const list=details.children[1];
  assert.equal(list.tagName,"ul");assert.equal(list.children.length,100);
  assert.equal(list.children[0].children[0].children.length,10);
  assert.match(list.fullText,/RO 930000: new/);
  details.open=false;details.dispatchEvent("toggle");
  details.open=true;details.dispatchEvent("toggle");
  assert.equal(details.children.length,2,"repeated open must not duplicate content");
  assert.equal(JSON.stringify(data),snapshot,"UI must not mutate source preview evidence");
  await button.click();
  assert.equal(h.count.committed,1);
  assert.match(h.result.fullText,/Already current/);
});
test("empty changes leave preview read-only and preserve existing labels",()=>{
  const h=fakeHarness(shipped);
  h.render({kind:{name:"Source",sourceId:"known"},detected:0,valid:0,canCommit:false,
    scope:"Review only",warnings:["Synthetic warning"],issues:["Synthetic exception"],changes:[]});
  assert.equal(h.result.children.filter(node=>node.tagName==="details").length,1,"exception details preserved");
  assert.match(h.result.fullText,/Review 1 exceptions/);
  assert.equal(h.result.children.filter(node=>node.tagName==="button").length,0,"review-only cannot import");
});
test("24 paired synthetic production renderer samples preserve data and cut initial DOM allocation",()=>{
  const prev=fakeHarness(baseline),next=fakeHarness(shipped),data=outcome();
  for(let i=0;i<4;i++){prev.render(data);next.render(data);}
  const oldTimes=[],newTimes=[];
  let oldNodes=0,newNodes=0;
  for(let i=0;i<24;i++){
    for(const [label,h] of i%2===0?[["legacy",prev],["shipped",next]]:[["shipped",next],["legacy",prev]]){
      h.count.created=0;
      const startMs=performance.now();h.render(data);
      const ms=performance.now()-startMs;
      if(label==="legacy"){oldTimes.push(ms);oldNodes=h.count.created;}
      else{newTimes.push(ms);newNodes=h.count.created;}
    }
  }
  assert.equal(oldTimes.length,24);assert.equal(newTimes.length,24);
  assert.ok(oldNodes>=1000&&newNodes<30,"all 1000+ hidden field details must be deferred");
  console.log("58-05 paired clipboard preview DOM benchmark",JSON.stringify({
    samples:24,syntheticChanges:100,fieldsPerChange:10,
    legacy:{p50:percent(oldTimes,.5),p95:percent(oldTimes,.95),nodes:oldNodes},
    optimized:{p50:percent(newTimes,.5),p95:percent(newTimes,.95),nodes:newNodes},
    scope:"actual production renderResult; synthetic Node fake DOM; collapsed details; not browser frame timing or OneDrive"}));
});

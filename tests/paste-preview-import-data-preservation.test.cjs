"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

// Exercise the shipped implementation, not a separately invented renderer.
// This test guards source values and import authorization before/after a lazy preview.
const productionPath="assets/daily-ops.js";
const source=fs.readFileSync(path.join(__dirname,"..",...productionPath.split("/")),"utf8");
const start=source.indexOf("    function renderResult(outcome){");
const end=source.indexOf("    function renderTeachingForm(){",start);
assert.ok(start>=0&&end>start,"real clipboard renderResult must be present");
const implementation=source.slice(start,end);

function harness(activeNonce=""){
  const calls={writes:0};
  class Element{
    constructor(tag){this.tagName=tag;this.textContent="";this.children=[];this.listeners={};this.open=false;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[...items];}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    fire(type){for(const fn of this.listeners[type]??[])fn();}
  }
  const document={createElement:tag=>new Element(tag)};
  const result=new Element("section"),status=new Element("p");
  function line(target,text,tag="p"){const element=new Element(tag);element.textContent=String(text);target.append(element);return element;}
  function button(label,handler){const element=new Element("button");element.textContent=label;element.click=handler;return element;}
  const context={document,result,status,line,button,activeNonce,confirm:()=>true,
    bridge:{commit:async()=>{calls.writes++;return{status:"unchanged",added:0,updated:0};}},
    renderTeachingForm:()=>{throw Error("unexpected teaching form");}};
  vm.runInNewContext(implementation+"\nthis.renderResultForTest=renderResult;",context);
  return {render:context.renderResultForTest,result,status,calls};
}
function sourcePreview(canCommit){
  return {kind:{name:"Synthetic CDK",sourceId:"synthetic-only",status:"recognized"},detected:1,valid:1,
    scope:"Synthetic partial import",counts:{new:0,updated:1,unchanged:0,invalid:0},
    changes:[{ro:"SYNTHETIC-0001",kind:"updated",fields:[
      {field:"advisor",before:"synthetic before",after:"synthetic after"},
      {field:"notes",before:"unchanged owner note",after:"unchanged owner note"}
    ]}],warnings:[],issues:[],canCommit};
}
test("lazy source details preserve before and after values without any write",()=>{
  const fixture=sourcePreview(false),snapshot=JSON.stringify(fixture);
  const h=harness("");
  h.render(fixture);
  const details=h.result.children.find(el=>el.tagName==="details");
  assert.ok(details);
  assert.equal(details.children.length,1,"expanded import details are not prebuilt");
  assert.equal(h.calls.writes,0,"preview must not write operational records");
  details.open=true;details.fire("toggle");
  assert.equal(details.children.length,2);
  assert.equal(details.children[1].children.length,1);
  assert.equal(details.children[1].children[0].children[0].children.length,2);
  assert.equal(details.children[1].children[0].children[0].children[0].textContent,
    "advisor: synthetic before → synthetic after");
  details.open=false;details.fire("toggle");details.open=true;details.fire("toggle");
  assert.equal(details.children.length,2,"toggle does not duplicate or rewrite evidence");
  assert.equal(JSON.stringify(fixture),snapshot,"source preview values remain intact");
  assert.equal(h.calls.writes,0);
  assert.equal(h.result.children.filter(el=>el.tagName==="button").length,0,
    "unapproved source cannot be imported");
});
test("verified import remains an explicit action after lazy expansion",async()=>{
  const fixture=sourcePreview(true),snapshot=JSON.stringify(fixture);
  const h=harness("synthetic-confirmation-nonce");
  h.render(fixture);
  const details=h.result.children.find(el=>el.tagName==="details");
  details.open=true;details.fire("toggle");
  assert.equal(h.calls.writes,0,"expansion is read-only");
  const action=h.result.children.find(el=>el.tagName==="button");
  assert.ok(action);
  assert.equal(action.textContent,"Import Verified Data");
  await action.click();
  assert.equal(h.calls.writes,1,"only the explicit authorized action invokes import");
  assert.equal(JSON.stringify(fixture),snapshot,"source evidence is unchanged after action");
});

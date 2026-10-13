"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const moduleSource=fs.readFileSync(path.join(__dirname,"..","assets","paste-learn.js"),"utf8");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
function engine(){const cx={};vm.runInNewContext(moduleSource,cx);return cx.MoonDogPasteLearn;}
function cdkHarness(){
 const start=app.indexOf("  function cdkRepairOrdersLayout("),end=app.indexOf("  function defaultManagementFor(",start);
 assert.ok(start>=0&&end>start);
 const cdks=app.slice(start,end);
 const ctx={norm:s=>String(s||"").trim().toLowerCase(),stableId:r=>"ro-"+r.ro+"-"+r.vin.slice(-8),
 reconcileRecordSourceIdentity:r=>r,performance:{now:()=>0},setTimeout,Promise,DOMException,
 cdkDateTimeFromLines:(lines,index)=>{
   const match=String(lines[index]||"").match(/^(\d{1,2}\/\d{1,2}\/20\d{2})$/);
   if(!match||!/^(\d{1,2}):(\d{2})\s*(am|pm)$/i.test(lines[index+1]||""))return null;
   return{iso:"2026-10-12",display:match[1]+" "+lines[index+1],consumed:2};
 }};
 vm.runInNewContext(cdks+"\nthis.strict=parseCdkRepairOrdersDocx;this.partial=parseCdkRepairOrdersPaste",ctx);
 return ctx;
}
function rows(count,headCount=count){
 const lines=["CDK","Repair Orders","RO #","All: "+headCount+" Open: "+headCount+" Working: 0 On Hold: 0 Closed: 0"];
 for(let i=0;i<count;i++)lines.push(String(900000+i),"Open","Synthetic Customer","1HGBH41JXMN109186",
   "2022 Jeep Synthetic","TAG"+i,"110","225","10/12/2026","08:30 AM","10/13/2026","09:00 AM","[C] Synthetic Operation");
 return lines.join("\n");
}
test("Plain-text capture normalizes input and rejects oversize text",()=>{
 const e=engine();
 assert.equal(e.capture("A\r\nB",""),"A\nB");
 assert.throws(()=>e.normalize("a".repeat(e.MAX_TEXT+1)),/too large/);
});
test("Recognizes CDK via verified header and does not guess unrelated source",()=>{
 const e=engine();
 assert.equal(e.detectFormat(rows(1)).sourceId,"cdk-repair-orders");
 assert.equal(e.detectFormat("Employee note about an RO").status,"unknown");
});
test("Teaches table headers and field mappings as a versioned non-writing rule",()=>{
 const e=engine(),headers=["RO Number","Next Status","Technician"];
 const first=e.safeRule({name:"Fleet Status",headers,fields:{ro:"RO Number",status:"Next Status"}});
 assert.equal(first.writeEnabled,false);assert.equal(first.version,1);
 const sample="RO Number\tNext Status\tTechnician\n123456\tPending\tSynthetic";
 assert.equal(e.detectFormat(sample,[first]).sourceId,first.id);
 const preview=e.tablePreview(sample,first);
 assert.equal(preview.rows[0].ro,"123456");
 const next=e.safeRule({...first,fields:{...first.fields,technician:"Technician"}},[first]);
 assert.equal(next.version,2);assert.equal(next.previous.version,1);
 assert.throws(()=>e.safeRule({...first,id:"cdk-repair-orders"},[first]),/cannot be replaced/);
});
test("Rejects unknown table mapping fields rather than allowing executable content",()=>{
 const e=engine();
 assert.throws(()=>e.safeRule({name:"One",headers:["A","B"],fields:{ro:"Unknown"}}),/Map at least one/);
 const rule=e.safeRule({name:"Safe table",headers:["A","B"],fields:{ro:"A",__proto__:"B"}});
 assert.deepEqual(Object.keys(rule.fields),["ro"]);
});
test("Strict DOCX parser still reconciles all rows; partial clipboard copy remains non-authoritative",async()=>{
 const h=cdkHarness(),full=h.strict(rows(10),"synthetic.docx");
 assert.equal(full.records.length,10);assert.equal(full.validation.scope,"verified-full");
 const partial=await h.partial(rows(1,300));
 assert.equal(partial.records.length,1);assert.equal(partial.validation.scope,"unverified");
 assert.match(partial.warnings.join(" "),/300/);
 assert.equal(partial.issues.length,0);
 assert.throws(()=>h.strict(rows(1,300),"synthetic.docx"),/reconciliation failed/);
});
test("Malformed pasted RO is flagged, not silently dropped and declared importable",async()=>{
 const h=cdkHarness(),text=rows(2).replace("1HGBH41JXMN109186","NOT-A-VIN");
 const parsed=await h.partial(text);
 assert.equal(parsed.records.length,1);assert.equal(parsed.issues.length,1);
});
test("300 records are processed in bounded reporting steps and cancellable",async()=>{
 const h=cdkHarness(),progress=[];
 const now=Date.now(),parsed=await h.partial(rows(300),p=>progress.push(p),{aborted:false});
 assert.equal(parsed.records.length,300);
 assert.ok(progress.length>=15);
 assert.equal(progress.at(-1).completed,300);
 assert.ok(Date.now()-now<10000,"synthetic parsing unexpectedly slow");
 await assert.rejects(()=>h.partial(rows(300),null,{aborted:true}),/canceled/);
});
test("Partial clipboard path cannot invoke full source reconciliation or advance verified snapshot",()=>{
 const from=app.indexOf("  async function commitPasteLearning("),to=app.indexOf("  async function savePasteLearningRule(",from);
 const commit=app.slice(from,to);
 assert.ok(from>0&&to>from);
 assert.doesNotMatch(commit,/mergeCompleteOpenRoRecords\(/);
 assert.doesNotMatch(commit,/saveOpenRoWorkload\(/);
 assert.doesNotMatch(commit,/retainDailyReport\(/);
 assert.match(commit,/management:prior\?\.management\|\|defaultManagementFor/);
 assert.match(commit,/missingClosed:0/);
 assert.match(commit,/writeJson\(STATE_PATH,next\)/);
});

test("reviewed secondary source adapter can be registered without operational write authority",()=>{
 const e=engine();
 e.registerAdapter({id:"synthetic-checklist",name:"Synthetic Checklist",version:"1",
   detect:text=>text.includes("SYNTHETIC CHECKLIST"),evidence:["SYNTHETIC CHECKLIST"]});
 const match=e.detectFormat("SYNTHETIC CHECKLIST\nA\tB");
 assert.equal(match.sourceId,"synthetic-checklist");
 assert.equal(match.writeEnabled,false);
 assert.throws(()=>e.registerAdapter({id:"synthetic-checklist",name:"Another",detect:()=>true}),/duplicate/);
});

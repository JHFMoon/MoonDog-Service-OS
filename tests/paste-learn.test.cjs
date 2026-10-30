"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const SYNTHETIC_VIN=(()=>{
 const values={};"0123456789".split("").forEach((char,index)=>values[char]=index);
 "ABCDEFGH".split("").forEach((char,index)=>values[char]=index+1);
 ["JKLMNPR","STUVWXYZ"].forEach((letters,set)=>letters.split("").forEach((char,index)=>
   values[char]=(set?[2,3,4,5,6,7,8,9]:[1,2,3,4,5,7,9])[index]));
 const chars=Array.from({length:17},(_,index)=>"0123456789ABCDEFGHJKLMNPRSTUVWXYZ"[(index*11+7)%33]);
 chars[8]="0";
 const weights=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
 const total=chars.reduce((sum,char,index)=>sum+values[char]*weights[index],0);
 chars[8]=total%11===10?"X":String(total%11);
 return chars.join("");
})();

const moduleBegin=app.indexOf("/* MoonDog Paste & Learn — inert");
const moduleEnd=app.indexOf("})(globalThis);",moduleBegin);
assert.ok(moduleBegin>=0&&moduleEnd>moduleBegin,"embedded engine must remain in rollback-safe app.js");
const moduleSource=app.slice(moduleBegin,moduleEnd+"})(globalThis);".length);
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
 for(let i=0;i<count;i++)lines.push(String(900000+i),"Open","Synthetic Customer",SYNTHETIC_VIN,
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
test("Private report layouts fingerprint sanitized mappings and preserve same-sheet variants",()=>{
 const e=engine(),columns={
   account:"Dealer Account",advisorCode:"Advisor #",advisor:"Advisor Name",ros:"Repair Order Count",
   presented:"Presentation Rate",sold:"Menu Sold",penetration:"Penetration Rate",menu:"Menu Revenue",
   total:"Total Revenue",perMenu:"Revenue Per Menu",hours:"Hours Per Menu"
 };
 const first=e.safeReportLayout({family:"menu-sales",sheetName:"Menu Results",headerRow:2,columns});
 assert.equal(first.grouping,"account-summary-advisor-rows");
 assert.equal(first.writeEnabled,false);assert.equal(first.approved,true);assert.equal(first.version,1);
 assert.equal(first.layoutSchemaVersion,2);assert.match(first.layoutFingerprint,/^layout-v2-[a-f0-9]{16}$/);
 assert.equal(first.minimumConfidence,1);
 assert.equal(first.reportDateSemantics,"Parameters-sheet-report-date-range");
 assert.equal(first.validationProfile,"menu-sales-account-and-advisor-reconciliation-v1");
 assert.deepEqual(JSON.parse(JSON.stringify(first.sectionRules)),{
   summary:"numeric-ros-without-advisor-code",advisor:"valid-advisor-code-and-identity",
   total:"ignore-normalized-account-total"
 });
 assert.equal(JSON.stringify(first).includes("Synthetic Customer"),false);
 assert.throws(()=>e.safeReportLayout({family:"menu-sales",sheetName:"Menu Results",headerRow:2,columns:{...columns,hours:"Total Revenue"}}),/different source column/);
 assert.throws(()=>e.safeReportLayout({family:"menu-sales",sheetName:"Menu Results",headerRow:2,columns:{...columns,hours:""}}),/Map every required/);
 assert.throws(()=>e.safeReportLayout({family:"unsupported",sheetName:"Menu Results",headerRow:2,columns}),/supported report family/);

 const caseEquivalent=e.safeReportLayout({...first,columns:{...columns,advisor:"ADVISOR NAME"}},[first]);
 assert.equal(caseEquivalent.id,first.id,"case-only header changes must reuse the existing mapping identity");
 assert.equal(caseEquivalent.layoutFingerprint,first.layoutFingerprint,"fingerprints follow case-insensitive runtime header matching");
 assert.equal(caseEquivalent.version,2);
 const uppercaseColumns=Object.fromEntries(Object.entries(columns).map(([field,label])=>[field,label.toUpperCase()]));
 const allHeadersCaseVariant=e.safeReportLayout({...first,columns:uppercaseColumns},[first,caseEquivalent]);
 assert.equal(allHeadersCaseVariant.id,first.id,"all case-equivalent source headers reuse one mapping identity");
 assert.equal(allHeadersCaseVariant.layoutFingerprint,first.layoutFingerprint);
 const revalidated=e.safeReportLayout({...first},[first]);
 assert.equal(revalidated.id,first.id);assert.equal(revalidated.version,2);
 assert.equal(revalidated.previous.layoutFingerprint,first.layoutFingerprint);
 const variant=e.safeReportLayout({family:"menu-sales",sheetName:"Menu Results",headerRow:2,
   columns:{...columns,advisor:"Advisor Display"}},[revalidated]);
 assert.notEqual(variant.id,revalidated.id);
 assert.notEqual(variant.layoutFingerprint,revalidated.layoutFingerprint);
 assert.equal(variant.version,1);
 assert.equal(revalidated.columns.advisor,"Advisor Name");
 assert.equal(variant.columns.advisor,"Advisor Display");
 assert.equal(variant.writeEnabled,false);
 assert.throws(()=>e.safeReportLayout({...first,columns:{...columns,advisor:"Tampered Header"}},[first]),/fingerprint/);
 assert.throws(()=>e.safeReportLayout({...first,validationProfile:"untrusted"},[first]),/fingerprint|profile/);
});

test("Legacy report layout identifiers remain readable and migrate without losing their mapped variant",()=>{
 const e=engine(),columns={
   account:"Dealer Account",advisorCode:"Advisor #",advisor:"Advisor Name",ros:"Repair Order Count",
   presented:"Presentation Rate",sold:"Menu Sold",penetration:"Penetration Rate",menu:"Menu Revenue",
   total:"Total Revenue",perMenu:"Revenue Per Menu",hours:"Hours Per Menu"
 };
 const sheetName="Menu Results",legacyId="report-layout-menu-sales-"+Array.from(sheetName)
   .map(char=>char.codePointAt(0).toString(16)).join("-");
 const legacy={id:legacyId,family:"menu-sales",sheetName,headerRow:2,columns,
   version:1,approved:true,enabled:true,writeEnabled:false,grouping:"account-summary-advisor-rows"};
 const compatible=e.safeReportLayout(legacy,[]);
 assert.equal(compatible.id,legacyId);assert.match(compatible.layoutFingerprint,/^layout-v2-[a-f0-9]{16}$/);
 const reparsed=e.safeReportLayout(compatible,[]);
 assert.equal(reparsed.id,legacyId);
 const updated=e.safeReportLayout({family:"menu-sales",sheetName,headerRow:2,columns},[legacy]);
 assert.equal(updated.id,legacyId);assert.equal(updated.version,2);
 assert.equal(updated.previous.layoutSchemaVersion,1);
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
 const h=cdkHarness(),text=rows(2).replace(SYNTHETIC_VIN,"NOT-A-VIN");
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

test("partial clipboard commit keeps missing active ROs and every manual management field",async()=>{
 const begin=app.indexOf("  async function commitPasteLearning("),end=app.indexOf("  async function savePasteLearningRule(",begin);
 const commit=app.slice(begin,end);
 const root={name:"Synthetic Workspace"},management={status:"Waiting Parts",owner:"Advisor",nextAction:"Order sensor",reviewDate:"2026-10-14",note:"Important management note"};
 const prior={id:"synthetic-one",ro:"123456",vin:SYNTHETIC_VIN,customer:"Synthetic",
   sourceStatus:"Pending",advisorCode:"110",management};
 const missing={id:"synthetic-two",ro:"123457",vin:SYNTHETIC_VIN,
   management:{status:"Waiting Approval",nextAction:"Follow up"}};
 const incoming={...prior,sourceStatus:"Working",customer:"Synthetic",management:undefined};
 const model={root,state:{updatedAt:"before",records:[prior,missing],closedRecords:[],source:{fileName:"Verified Complete Snapshot",importedAt:"verified"}}};
 let writes=0,backups=0,history=0,workloadWrites=0,rendered=0;
 const preview={nonce:"reviewed",root,updatedAt:"before",priorIds:model.state.records.map(x=>x.id).join("|"),
   parsed:{records:[incoming]},diff:{errors:[],counts:{new:0,updated:1,unchanged:0}}};
 const cx={model,pastePreview:preview,pasteCommitBusy:false,folderWatch:{busy:false},
   dailyImportBusy:false,appointmentImportBusy:false,workspaceConnectionBusy:false,postConnectionScanBusy:false,
   withSupervisorWorkbookLock:async operation=>operation(),writeAuthority:{requireWrite:()=>{}},
   pasteDiff:()=>({errors:[]}),now:()=>new Date().toISOString(),backupState:async()=>backups++,
   writeJson:async()=>writes++,addHistory:async()=>history++,markSupervisorWorkbookStale:async()=>{},
   renderAll:()=>rendered++,defaultManagementFor:()=>({}),operationalStatusFromImport:()=>null,
   recordDiagnostic:()=>{},STATE_PATH:["data","current-state.json"]};
 vm.runInNewContext(commit+"\nthis.commit=commitPasteLearning",cx);
 const outcome=await cx.commit("reviewed");
 assert.equal(outcome.missingClosed,0);assert.equal(backups,1);assert.equal(writes,1);
 assert.equal(model.state.records.length,2);
 assert.equal(model.state.records.find(x=>x.ro==="123457").management.nextAction,"Follow up");
 assert.equal(model.state.records.find(x=>x.ro==="123456").management,management);
 assert.equal(model.state.source.fileName,"Verified Complete Snapshot","partial import must not advance verified source");
 assert.equal(history,1);assert.equal(rendered,1);assert.equal(workloadWrites,0);
});
test("stale preview and failed durable writes cannot report success",async()=>{
 const begin=app.indexOf("  async function commitPasteLearning("),end=app.indexOf("  async function savePasteLearningRule(",begin);
 const source=app.slice(begin,end),root={name:"Synthetic"},model={root,state:{updatedAt:"old",records:[],closedRecords:[]}};
 const cx={model,pastePreview:{nonce:"nonce",root,updatedAt:"old",priorIds:"",parsed:{records:[{ro:"123456",id:"x"}]},diff:{errors:[]}},
 pasteCommitBusy:false,folderWatch:{busy:false},dailyImportBusy:false,appointmentImportBusy:false,
 postConnectionScanBusy:false,workspaceConnectionBusy:false,pasteDiff:()=>({errors:[]}),now:()=>new Date().toISOString(),
 withSupervisorWorkbookLock:async operation=>operation(),writeAuthority:{requireWrite:()=>{}},backupState:async()=>{},
 writeJson:async()=>{throw Error("Read-back failed");},defaultManagementFor:()=>({status:"",nextAction:""}),
 operationalStatusFromImport:()=>null,STATE_PATH:["data","current-state.json"]};
 vm.runInNewContext(source+"\nthis.commit=commitPasteLearning",cx);
 model.state.updatedAt="new";
 await assert.rejects(()=>cx.commit("nonce"),/changed/);
 model.state.updatedAt="old";
 await assert.rejects(()=>cx.commit("nonce"),/Read-back failed/);
 assert.equal(model.state.updatedAt,"old");
 assert.equal(model.state.records.length,0);
});

test("can teach field mappings from key/value text without enabling operational imports",()=>{
 const e=engine(),sample="Part Number: SYNTHETIC-001\nPart Status: Waiting\nOwner: Synthetic Advisor";
 const structure=e.suggestedStructure(sample);
 assert.equal(structure.kind,"key-value");
 const rule=e.safeRule({name:"Parts Note",kind:structure.kind,headers:structure.headers,
   fields:{description:"Part Number",status:"Part Status",owner:"Owner"}});
 assert.equal(e.detectFormat(sample,[rule]).sourceId,rule.id);
 const preview=e.tablePreview(sample,rule);
 assert.equal(preview.rows.length,1);
 assert.equal(preview.rows[0].status,"Waiting");
 assert.equal(rule.writeEnabled,false);
});

test("CDK compact summary and secondary Waiting stay separate from customer",async()=>{
 const h=cdkHarness();
 const sample=rows(1).replace("All: 1 Open: 1 Working: 0 On Hold: 0 Closed: 0","All: 1Open: 1Working: 0On Hold: 0Closed: 0").replace(`Synthetic Customer\n${SYNTHETIC_VIN}`,`Waiting\nSynthetic Customer\n${SYNTHETIC_VIN}`);
 const parsed=await h.partial(sample);
 assert.equal(parsed.summary?.all,1);
 assert.equal(parsed.records.length,1);
 assert.equal(parsed.records[0].customer,"Synthetic Customer");
 assert.equal(parsed.records[0].secondaryStatus,"Waiting");
});
test("Five invalid VIN blocks are quarantined while one verified record stays eligible",async()=>{
 const h=cdkHarness();
 const source=rows(6).replace("All: 6 Open: 6 Working: 0 On Hold: 0 Closed: 0","All: 6Open: 6Working: 0On Hold: 0Closed: 0");
 const parts=source.split(SYNTHETIC_VIN);
 const mixed=parts.map((part,i)=>part+(i<5?SYNTHETIC_VIN.slice(0,14):i===5?SYNTHETIC_VIN:"")).join("");
 const parsed=await h.partial(mixed);
 assert.equal(parsed.validation.recordStarts,6);
 assert.equal(parsed.records.length,1);
 assert.equal(parsed.issues.length,5);
 assert.equal(parsed.summary?.all,6);
});

test("Clipboard commit classifies unchanged rows using the same verified diff as preview",()=>{
 const a=app.indexOf("  function pasteDiff("),b=app.indexOf("  async function analyzePasteLearning(",a);
 const diff=app.slice(a,b);
 const c=app.slice(app.indexOf("  async function commitPasteLearning("),app.indexOf("  async function savePasteLearningRule("));
 assert.match(diff,/kind:!prior\?"new":fieldChanges\.length\?"updated":"unchanged"/);
 assert.match(c,/const approvedChanges=new Map\(\(rechecked\.changes\|\|\[\]\)\.map/);
 assert.match(c,/if\(prior&&approved\.kind==="unchanged"\)/);
 assert.match(c,/unchanged\.push\(raw\.ro\)/);
 assert.match(c,/else changed\.push\(previous\)/);
 assert.doesNotMatch(c,/JSON\.stringify\(\{\.\.\.prior,cdkOperational/);
});

test("Invalid source records are not mislabeled as missing clipboard coverage",async()=>{
 const h=cdkHarness();
 const source=rows(2).replace(SYNTHETIC_VIN,"INVALID-VIN");
 const parsed=await h.partial(source);
 assert.equal(parsed.validation.recordStarts,2);
 assert.equal(parsed.records.length,1);
 assert.equal(parsed.issues.length,1);
 assert.match(parsed.warnings.join(" "),/1 identified RO records could not be validated/);
 assert.doesNotMatch(parsed.warnings.join(" "),/clipboard coverage may be filtered or incomplete/);
});
test("Incomplete source boundaries remain explicitly distinct from invalid rows",async()=>{
 const h=cdkHarness();
 const parsed=await h.partial(rows(1,300));
 assert.match(parsed.warnings.join(" "),/Detected 1 of 300 RO boundaries/);
 assert.equal(parsed.issues.length,0);
});


test("clipboard import excludes concurrent operational work and shares the busy flag through verified persistence",async()=>{
 const start=app.indexOf("  async function commitPasteLearning("),end=app.indexOf("  async function savePasteLearningRule(",start);
 assert.ok(start>0&&end>start);
 const root={name:"Synthetic Workspace"},record={id:"synthetic-one",ro:"123456",sourceStatus:"Working"};
 const model={root,state:{updatedAt:"before",records:[],closedRecords:[]}};
 const preview={nonce:"approved",root,updatedAt:"before",priorIds:"",
   parsed:{records:[record]},diff:{errors:[],counts:{new:1,updated:0,unchanged:0}}};
 let writes=0,backups=0,releaseWrite,releaseLock,lockEntries=0;
 const blockedWrite=new Promise(resolve=>{releaseWrite=resolve;});
 const pendingSupervisorLock=new Promise(resolve=>{releaseLock=resolve;});
 const cx={model,pastePreview:preview,pasteCommitBusy:false,folderWatch:{busy:false},
   dailyImportBusy:false,appointmentImportBusy:false,workspaceConnectionBusy:false,postConnectionScanBusy:false,
   withSupervisorWorkbookLock:async operation=>{lockEntries++;await pendingSupervisorLock;return operation();},
   writeAuthority:{requireWrite:()=>{}},pasteDiff:()=>({errors:[],changes:[{ro:"123456",kind:"new"}]}),
   backupState:async()=>{backups++;},writeJson:async()=>{writes++;await blockedWrite;},
   addHistory:async()=>{},markSupervisorWorkbookStale:async()=>{},renderAll:()=>{},
   defaultManagementFor:()=>({owner:"Synthetic"}),operationalStatusFromImport:()=>null,
   now:()=>"2026-10-30T12:00:00.000Z",recordDiagnostic:()=>{},
   STATE_PATH:["data","current-state.json"]};
 vm.runInNewContext(app.slice(start,end)+"\nthis.commit=commitPasteLearning",cx);
 for(const flag of ["folderWatch","dailyImportBusy","appointmentImportBusy","workspaceConnectionBusy","postConnectionScanBusy"]){
   if(flag==="folderWatch")cx.folderWatch.busy=true;
   else cx[flag]=true;
   await assert.rejects(()=>cx.commit("approved"),/another workspace operation/i,flag+" must exclude commit");
   if(flag==="folderWatch")cx.folderWatch.busy=false;
   else cx[flag]=false;
   assert.equal(writes,0,"blocked operation cannot write state");
 }
 const committing=cx.commit("approved");
 assert.equal(cx.dailyImportBusy,true,"shared import flag must be held before the first await");
 assert.equal(cx.pasteCommitBusy,true);
 await assert.rejects(()=>cx.commit("approved"),/already being committed/);
 assert.equal(lockEntries,1,"clipboard import must acquire the same Supervisor Workbook lock as Open RO saves");
 assert.equal(writes,0,"state writes must wait for the shared browser lock");
 releaseLock();
 await Promise.resolve();await Promise.resolve();
 assert.equal(cx.dailyImportBusy,true,"shared flag remains held while durable write is pending");
 releaseWrite();
 const outcome=await committing;
 assert.equal(outcome.status,"saved");
 assert.equal(writes,1);assert.equal(backups,1);
 assert.equal(cx.dailyImportBusy,false,"shared flag released after success");
 assert.equal(cx.pasteCommitBusy,false);
 assert.equal(model.state.records.length,1);
});

test("clipboard import releases shared lock after durable write/read-back failure",async()=>{
 const start=app.indexOf("  async function commitPasteLearning("),end=app.indexOf("  async function savePasteLearningRule(",start);
 const root={name:"Synthetic"},model={root,state:{updatedAt:"before",records:[],closedRecords:[]}};
 const cx={model,pastePreview:{nonce:"approved",root,updatedAt:"before",priorIds:"",
     parsed:{records:[{id:"synthetic-one",ro:"123456"}]},diff:{errors:[]}},
   pasteCommitBusy:false,folderWatch:{busy:false},dailyImportBusy:false,
   appointmentImportBusy:false,workspaceConnectionBusy:false,postConnectionScanBusy:false,
   withSupervisorWorkbookLock:async operation=>operation(),writeAuthority:{requireWrite:()=>{}},pasteDiff:()=>({errors:[],changes:[{ro:"123456",kind:"new"}]}),
   backupState:async()=>{},writeJson:async()=>{throw Error("Synthetic durable mismatch");},
   defaultManagementFor:()=>({}),operationalStatusFromImport:()=>null,
   now:()=>"2026-10-30T12:00:00.000Z",STATE_PATH:["data","current-state.json"]};
 vm.runInNewContext(app.slice(start,end)+"\nthis.commit=commitPasteLearning",cx);
 await assert.rejects(()=>cx.commit("approved"),/Synthetic durable mismatch/);
 assert.equal(cx.pasteCommitBusy,false);
 assert.equal(cx.dailyImportBusy,false);
 assert.equal(model.state.updatedAt,"before","failed durable write must preserve previous authoritative state");
 assert.equal(model.state.records.length,0);
});

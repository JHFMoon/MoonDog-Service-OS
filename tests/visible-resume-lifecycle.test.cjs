"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf('  window.addEventListener("focus",()=>folderWatchScan("focus"));document.addEventListener("visibilitychange"');
const end=app.indexOf("\n  syncArrivalDate();",start);
assert.ok(start>=0&&end>start,"production focus and visibility resume hooks exist");
const lifecycle=app.slice(start,end);

function harness(){
  const listeners=new Map(),scans=[];
  const document={visibilityState:"hidden",addEventListener:(name,handler)=>listeners.set("document:"+name,handler)};
  const window={addEventListener:(name,handler)=>listeners.set("window:"+name,handler)};
  const context=vm.createContext({document,window,folderWatchScan:reason=>{scans.push(reason);}});
  vm.runInContext(lifecycle,context);
  return {document,listeners,scans};
}

test("visible resume rechecks the synthetic Report Inbox after hidden idle periods",()=>{
  const {document,listeners,scans}=harness();
  const onVisibility=listeners.get("document:visibilitychange");
  assert.equal(typeof onVisibility,"function");
  for(let i=0;i<100;i++){
    document.visibilityState="hidden";
    onVisibility();
    document.visibilityState="visible";
    onVisibility();
  }
  assert.equal(scans.length,100,"hidden periods do no work and each visible resume starts one recheck");
  assert.ok(scans.every(reason=>reason==="visible"));
});

test("window focus rechecks the synthetic Report Inbox through the production hook",()=>{
  const {listeners,scans}=harness();
  const onFocus=listeners.get("window:focus");
  assert.equal(typeof onFocus,"function");
  onFocus();
  assert.deepEqual(scans,["focus"]);
});


test("repeated visible resumes remain bounded while production workbook and PDF readers process synthetic reports",async()=>{
  const workerStart=app.indexOf("  // Large XLSX sources are parsed in a self-contained worker");
  const workerEnd=app.indexOf("  // Privacy-safe performance evidence:",workerStart);
  const pdfTextStart=app.indexOf("  function pdfTextLines(");
  const pdfTextEnd=app.indexOf("\n  function isoDateFromUs(",pdfTextStart);
  const pdfReadStart=app.indexOf("  async function withLocalPdf(");
  const pdfReadEnd=app.indexOf("\n  function isAppointmentPdf(",pdfReadStart);
  const pdfSignatureStart=app.indexOf("  async function pdfSignatureText(");
  const pdfSignatureEnd=app.indexOf("\n  async function isMoonDogGreeterOutput(",pdfSignatureStart);
  assert.ok(workerStart>=0&&workerEnd>workerStart,"production workbook worker helper exists");
  assert.ok(pdfTextStart>=0&&pdfTextEnd>pdfTextStart,"production PDF text extraction exists");
  assert.ok(pdfReadStart>=0&&pdfReadEnd>pdfReadStart&&pdfSignatureStart>=0&&pdfSignatureEnd>pdfSignatureStart,
    "production PDF reader and signature path exist");

  const workerCalls=[],pdfTasks=[],revokedUrls=[];
  class FakeBlob{constructor(parts){this.parts=parts;}}
  class FakeWorker{
    postMessage(message){
      workerCalls.push(message);
      queueMicrotask(()=>this.onmessage({data:{id:message.id,ok:true,book:{marker:"synthetic-worker",options:message.options}}}));
    }
    terminate(){this.terminated=true;}
  }
  class TestURL extends URL{
    static createObjectURL(){return "blob:synthetic-xlsx-worker";}
    static revokeObjectURL(url){revokedUrls.push(url);}
  }
  const listeners=new Map(),scans=[];
  const document={
    baseURI:"file:///synthetic/moondog/index.html",
    visibilityState:"hidden",
    addEventListener:(name,handler)=>listeners.set("document:"+name,handler)
  };
  const window={addEventListener:(name,handler)=>listeners.set("window:"+name,handler)};
  const pdfjsLib={
    GlobalWorkerOptions:{workerSrc:""},
    getDocument(options){
      const task={
        promise:Promise.resolve({
          numPages:1,
          getPage:async()=>({getTextContent:async()=>({items:[
            {str:"PRE-WORKORDER",transform:[1,0,0,1,0,10]},
            {str:"SERVICE ADVISOR:",transform:[1,0,0,1,80,10]}
          ]})})
        }),
        destroy:async()=>{pdfTasks.push({destroyed:true});}
      };
      pdfTasks.push({options,task});
      return task;
    }
  };
  const XLSX={version:"synthetic",read:(_bytes,options)=>({marker:"sync",options})};
  const context=vm.createContext({
    document,window,pdfjsLib,XLSX,Worker:FakeWorker,Blob:FakeBlob,URL:TestURL,
    TextDecoder,TextEncoder,ArrayBuffer,Uint8Array,WeakMap,Map,TypeError,Error,DOMException,
    clearTimeout,setTimeout,queueMicrotask,console,
    runtimeFileBytes:async()=>new TextEncoder().encode("synthetic local XLSX parser"),
    boundedPdfRead:async(operation)=>operation(),
    recordDiagnostic:()=>{},
    folderWatchScan:reason=>scans.push(reason)
  });
  vm.runInContext(app.slice(workerStart,workerEnd)+"\n"+
    app.slice(pdfTextStart,pdfTextEnd)+"\n"+
    app.slice(pdfReadStart,pdfReadEnd)+"\n"+
    app.slice(pdfSignatureStart,pdfSignatureEnd)+"\n"+
    lifecycle+"\n"+
    "this.prepareXlsxWorkbook=prepareXlsxWorkbook;this.stopXlsxWorker=stopXlsxWorker;this.pdfSignatureText=pdfSignatureText;",
    context);

  const pdfBytes=new TextEncoder().encode("%PDF synthetic report");
  const originalPdf=pdfBytes.slice();
  for(let cycle=0;cycle<100;cycle++){
    document.visibilityState="hidden";
    listeners.get("document:visibilitychange")();
    document.visibilityState="visible";
    listeners.get("document:visibilitychange")();
    if(cycle%10===0){
      const workbookBytes=new Uint8Array(640*1024);
      workbookBytes[0]=cycle+1;
      const originalWorkbook=workbookBytes.slice();
      const book=await context.prepareXlsxWorkbook(workbookBytes,{type:"array",raw:true});
      assert.equal(book.marker,"synthetic-worker");
      assert.deepEqual(workbookBytes,originalWorkbook,"transferring a workbook never changes its source bytes");
      const signature=await context.pdfSignatureText(pdfBytes);
      assert.match(signature,/PRE-WORKORDER SERVICE ADVISOR:/);
    }
  }
  assert.equal(scans.length,100,"each visible resume schedules one Report Inbox recheck");
  assert.equal(listeners.size,2,"repeated resume cycles do not register extra lifecycle listeners");
  assert.equal(workerCalls.length,10,"each synthetic large workbook uses the production worker helper");
  assert.equal(pdfTasks.filter(entry=>entry.destroyed).length,10,"each PDF task is cleaned up after extraction");
  assert.equal(pdfjsLib.GlobalWorkerOptions.workerSrc,"file:///synthetic/moondog/vendor/pdf.worker.min.js");
  assert.deepEqual(pdfBytes,originalPdf,"PDF extraction leaves the input source bytes intact");
  await context.stopXlsxWorker(new Error("synthetic lifecycle cleanup"));
  assert.deepEqual(revokedUrls,["blob:synthetic-xlsx-worker"],"the reusable workbook worker releases its Blob URL on cleanup");
});

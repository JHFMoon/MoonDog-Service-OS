"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const compareStart=app.indexOf("  function comparableManagerSnapshot(");
const compareEnd=app.indexOf("  function managerConflictObservationDate(",compareStart);
const importStart=app.indexOf("  async function importManagerSource(",compareEnd);
const importEnd=app.indexOf("  async function classifyImportFile(",importStart);
assert.ok(compareStart>=0&&compareEnd>compareStart&&importStart>compareEnd&&importEnd>importStart,
  "production Media ASR comparison and importer boundaries must exist");
const production=app.slice(compareStart,compareEnd)+app.slice(importStart,importEnd);

const period="2026-10-01/2026-10-07";
function advisorSnapshot(){
  return {
    period,periodStart:"2026-10-01",periodEnd:"2026-10-07",
    advisors:{
      "SYN-A":{code:"SYN-A",name:"Synthetic Advisor A",observations:3,completed:2},
      "SYN-B":{code:"SYN-B",name:"Synthetic Advisor B",observations:4,completed:3}
    },
    sourceFile:"synthetic-media-asr.xlsx",
    importedAt:"2026-10-20T08:00:00.000Z",
    sourceModifiedAt:"2026-10-20T07:00:00.000Z",
    coverageDate:"2026-10-07",
    updatedAt:"synthetic-prior-update"
  };
}
function technicianSnapshot(){
  return {
    period,periodStart:"2026-10-01",periodEnd:"2026-10-07",
    technicians:[
      {id:"SYN-102",number:"SYN-102",name:"Synthetic Technician B",observations:4,completed:3},
      {id:"SYN-101",number:"SYN-101",name:"Synthetic Technician A",observations:3,completed:2}
    ],
    sourceFile:"synthetic-media-asr-tech.xlsx",
    importedAt:"2026-10-20T08:00:00.000Z",
    sourceModifiedAt:"2026-10-20T07:00:00.000Z",
    coverageDate:"2026-10-07",
    updatedAt:"synthetic-prior-update"
  };
}
function fixture(kind,prior,candidate){
  const family=kind==="media-asr"?"mediaAsr":"mediaAsrTech";
  const model={operationalMetrics:{[family]:{snapshots:{[period]:structuredClone(prior)}}}};
  let durable=structuredClone(model.operationalMetrics);
  const events=[],removed=[];
  const parsers={
    sor:()=>{throw Error("Unexpected SOR parse");},
    "appointment-activity":()=>{throw Error("Unexpected appointment parse");},
    efficiency:()=>{throw Error("Unexpected Efficiency parse");},
    "media-asr":()=>structuredClone(candidate),
    "media-asr-tech":()=>structuredClone(candidate),
    "open-ro-summary":()=>{throw Error("Unexpected Open RO parse");}
  };
  const context=vm.createContext({
    model,structuredClone,OPERATIONAL_METRICS_PATH:["data","operational-metrics.json"],
    now:()=>"2026-10-24T12:00:00.000Z",
    localDateKey:()=>"2026-10-24",
    sourceFileHandle:async()=>({getFile:async()=>({lastModified:Date.UTC(2026,9,24)})}),
    parseSorWorkbook:parsers.sor,
    parseAppointmentActivityWorkbook:parsers["appointment-activity"],
    parseEfficiencyWorkbook:parsers.efficiency,
    parseMediaAsrAdvisorWorkbook:parsers["media-asr"],
    parseMediaAsrTechWorkbook:parsers["media-asr-tech"],
    parseOpenRoSummaryWorkbook:parsers["open-ro-summary"],
    workbookGrid:()=>({rows:[]}),
    dailyEvidenceDate:()=> "2026-10-07",
    internalObservationDate:()=> "",
    learnTechnicians:()=>{},
    pruneDatedSnapshots:value=>value,
    writeJson:async(_path,value)=>{events.push("write");durable=structuredClone(value);},
    readJson:async()=>{events.push("readback");return structuredClone(durable);},
    addHistory:async()=>{events.push("history");},
    removeSourceEntry:async name=>{events.push("delete");removed.push(name);}
  });
  vm.runInContext(production+"\nthis.import=importManagerSource;",context);
  return{
    model,events,removed,durable:()=>durable,
    run:deleteAfterSuccess=>context.import("synthetic-reimport.xlsx",kind,[],deleteAfterSuccess)
  };
}

for(const [kind,makeSnapshot] of [["media-asr",advisorSnapshot],["media-asr-tech",technicianSnapshot]]){
  test(kind+" rejects changed same-period measurements before mutation or source deletion",async()=>{
    const prior=makeSnapshot();
    const changed=structuredClone(prior);
    if(kind==="media-asr")changed.advisors["SYN-A"].completed+=1;
    else changed.technicians.find(row=>row.id==="SYN-101").completed+=1;
    const f=fixture(kind,prior,changed);
    const before=JSON.stringify(f.model.operationalMetrics);
    await assert.rejects(
      f.run(true),
      new RegExp("Conflicting "+kind+" report for period "+period.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+" is already saved")
    );
    assert.equal(JSON.stringify(f.model.operationalMetrics),before,"conflicting source must not change in-memory state");
    assert.equal(JSON.stringify(f.durable()),before,"conflicting source must not change durable state");
    assert.deepEqual(f.events,[],"conflicts fail before write, read-back, or success history");
    assert.deepEqual(f.removed,[],"conflicting source remains available for review");
  });

  test(kind+" accepts equivalent reimport after derived provenance changes",async()=>{
    const prior=makeSnapshot();
    const equivalent=structuredClone(prior);
    equivalent.sourceFile="synthetic-media-asr-reimport.xlsx";
    equivalent.importedAt="2026-10-24T11:00:00.000Z";
    equivalent.sourceModifiedAt="2026-10-24T10:00:00.000Z";
    equivalent.coverageDate="2026-10-06";
    equivalent.updatedAt="synthetic-refreshed-update";
    if(kind==="media-asr"){
      equivalent.advisors={
        "SYN-B":{...equivalent.advisors["SYN-B"],name:"Current Synthetic Label B"},
        "SYN-A":{...equivalent.advisors["SYN-A"],name:"Current Synthetic Label A"}
      };
    }else{
      equivalent.technicians.reverse();
    }
    const f=fixture(kind,prior,equivalent);
    await f.run(true);
    const saved=f.durable()[kind==="media-asr"?"mediaAsr":"mediaAsrTech"].snapshots[period];
    assert.equal(saved.sourceFile,"synthetic-reimport.xlsx","accepted import records its current source name");
    assert.equal(saved.coverageDate,"2026-10-07","coverage metadata is normalized from source evidence");
    assert.deepEqual(f.events,["write","readback","history","delete"],
      "source deletion follows durable write, verified read-back, and history");
    assert.deepEqual(f.removed,["synthetic-reimport.xlsx"]);
    assert.equal(JSON.stringify(f.model.operationalMetrics),JSON.stringify(f.durable()),
      "verified in-memory and durable snapshots remain equal");
  });
}

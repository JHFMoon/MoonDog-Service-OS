"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function defaultManagementFor(");
const end=app.indexOf("  async function importCdkRepairOrdersDocx(",start);
assert.ok(start>=0&&end>start,"production complete-source Open RO merge exists");

function productionMerge(state){
  const context={
    model:{state},
    CLOSED_RO_RETENTION_DAYS:730,
    canonicalCdkStatus:value=>value==="Review"?"Ready for Review":value==="Working"?"Being Repaired":""
  };
  const helpers=vm.runInNewContext(app.slice(start,end)+"\n({mergeCompleteOpenRoRecords})",context);
  return helpers.mergeCompleteOpenRoRecords;
}
const copy=value=>JSON.parse(JSON.stringify(value));

test("verified manager edit survives durable reload and complete-source reimport without taking over source fields",()=>{
  const manualState={
    schemaVersion:1,
    updatedAt:"2026-10-26T10:00:00.000Z",
    records:[{
      id:"synthetic-ro-201",
      ro:"SYN-201",
      sourceStatus:"Working",
      advisor:"Synthetic Advisor A",
      technician:"Synthetic Technician A",
      sourceFields:{
        "RO Number":"SYN-201",
        "Source Status":"Working",
        "Advisor":"Synthetic Advisor A",
        "Technician":"Synthetic Technician A"
      },
      management:{
        status:"Waiting Parts",
        owner:"Synthetic Manager Owner",
        nextAction:"Recheck synthetic part ETA",
        reviewDate:"2026-10-27",
        communication:"Updated",
        note:"Synthetic follow-up after verified save",
        manualAnnotation:"Synthetic manager annotation",
        updatedAt:"2026-10-26T10:00:00.000Z"
      }
    }],
    closedRecords:[],
    source:{fileName:"synthetic-open-ro.xlsx",importedAt:"2026-10-26T09:55:00.000Z"}
  };
  // This is the JSON snapshot produced by the verified save/read-back path
  // covered in open-ro-edit-save-roundtrip.test.cjs.
  const durable=JSON.stringify(manualState);
  const afterReload=JSON.parse(durable);
  const merge=productionMerge(afterReload);

  const incoming={
    id:"synthetic-ro-201",
    ro:"SYN-201",
    sourceStatus:"Review",
    advisor:"Synthetic Advisor B",
    technician:"Synthetic Technician B",
    sourceFields:{
      "RO Number":"SYN-201",
      "Source Status":"Review",
      "Advisor":"Synthetic Advisor B",
      "Technician":"Synthetic Technician B",
      "Reported Hours":"2.5"
    },
    management:{
      status:"DO NOT IMPORT",
      owner:"DO NOT IMPORT",
      nextAction:"DO NOT IMPORT",
      reviewDate:"2030-01-01",
      note:"DO NOT IMPORT"
    }
  };
  const merged=merge([incoming],"2026-10-26T11:00:00.000Z","open-ro-xlsx");
  const result=copy(merged.records[0]);

  assert.equal(merged.records.length,1);
  assert.deepEqual(result.management,manualState.records[0].management,
    "reimport retains every saved manager-authoritative field after JSON reload");
  assert.deepEqual(result.sourceFields,incoming.sourceFields,
    "the newer validated report refreshes source-owned fields independently");
  assert.equal(result.sourceStatus,"Review");
  assert.equal(result.advisor,"Synthetic Advisor B");
  assert.equal(result.technician,"Synthetic Technician B");
  assert.equal(result.cdkOperational.status,"Ready for Review",
    "current CDK status follows the new report while manager workflow status remains authoritative");
  assert.equal(result.management.status,"Waiting Parts");
  assert.equal(result.management.owner,"Synthetic Manager Owner");
  assert.equal(result.management.reviewDate,"2026-10-27");

  const reloadedAgain=JSON.parse(JSON.stringify({records:merged.records,closedRecords:merged.closedRecords}));
  const repeatedMerge=productionMerge(reloadedAgain);
  const next=copy(repeatedMerge([{...incoming,advisor:"Synthetic Advisor C"}],
    "2026-10-26T12:00:00.000Z","open-ro-xlsx").records[0]);
  assert.deepEqual(next.management,manualState.records[0].management,
    "a second durable reload and reimport cannot replace the manager's saved plan");
  assert.equal(next.sourceFields.Advisor,"Synthetic Advisor C",
    "source provenance continues to follow the latest accepted report");
});

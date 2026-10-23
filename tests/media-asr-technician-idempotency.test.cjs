"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function comparableManagerSnapshot(");
const end=app.indexOf("  function managerConflictObservationDate(",start);
assert.ok(start>=0&&end>start,"Missing production manager snapshot comparator");
const comparator=app.slice(start,end);
const context=vm.createContext({structuredClone});
vm.runInContext(comparator+"\nthis.compare=comparableManagerSnapshot;",context);

test("equivalent Media ASR technician summaries compare by source identity, not workbook row order",()=>{
  const first={
    periodStart:"2026-10-01",
    periodEnd:"2026-10-07",
    technicians:[
      {id:"102",number:"102",name:"Synthetic Tech Two",roCount:4,mediaCreated:2},
      {id:"101",number:"101",name:"Synthetic Tech One",roCount:3,mediaCreated:1}
    ]
  };
  const reordered={
    periodStart:"2026-10-01",
    periodEnd:"2026-10-07",
    technicians:[
      {id:"101",number:"101",name:"Synthetic Tech One",roCount:3,mediaCreated:1},
      {id:"102",number:"102",name:"Synthetic Tech Two",roCount:4,mediaCreated:2}
    ]
  };
  assert.equal(
    context.compare(first,"mediaAsrTech"),
    context.compare(reordered,"mediaAsrTech"),
    "Reordering the same identity-keyed source rows must remain idempotent"
  );
});

test("Media ASR technician comparisons still reject changed identity or measurements",()=>{
  const original={
    periodStart:"2026-10-01",
    periodEnd:"2026-10-07",
    technicians:[
      {id:"101",number:"101",name:"Synthetic Tech One",roCount:3,mediaCreated:1},
      {id:"102",number:"102",name:"Synthetic Tech Two",roCount:4,mediaCreated:2}
    ]
  };
  const changedMeasure=structuredClone(original);
  changedMeasure.technicians[1].mediaCreated=3;
  const changedIdentity=structuredClone(original);
  changedIdentity.technicians[1].id="103";
  assert.notEqual(context.compare(original,"mediaAsrTech"),context.compare(changedMeasure,"mediaAsrTech"));
  assert.notEqual(context.compare(original,"mediaAsrTech"),context.compare(changedIdentity,"mediaAsrTech"));
});

"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=app.indexOf("  function sourceStatusLabel(evidence)");
const end=app.indexOf("  function advisorNextWin(",start);
assert.ok(start>=0&&end>start,"production source lineage renderer exists");
const ctx=vm.createContext({freshness:require("../assets/freshness.js"),Date,Intl});
vm.runInContext(app.slice(start,end)+"\nthis.label=sourceStatusLabel;this.lineage=sourceLineageLabel;",ctx);
test("a cross-store report always displays an actionable dealership mismatch before a plausible current KPI",()=>{
  const report={key:"sapr",status:"invalid",loaded:true,
    sourceStoreConfidence:"store-conflict",
    reason:"Saved report source dealership conflicts with Guided Setup.",
    importedAt:"2026-11-04T13:00:00Z",importTimestamp:"2026-11-04T13:00:00Z",
    periodStart:"2026-11-01",periodEnd:"2026-11-04",reportPeriodVerified:false};
  assert.equal(ctx.label(report),"Dealership mismatch · Review required");
  const label=ctx.lineage(report);
  assert.match(label,/Dealership mismatch · Review required/);
  assert.match(label,/Report period: Not verified/);
  assert.doesNotMatch(label,/Current · Report period/);
});
test("a matching code without complete source-store markers cannot masquerade as verified dealership origin",()=>{
  const uncertain={key:"menu",status:"current",loaded:true,
    sourceStoreConfidence:"configured-destination-only",
    periodStart:"2026-11-01",periodEnd:"2026-11-04",reportPeriodVerified:true};
  assert.equal(ctx.label(uncertain),"Source dealership unverified · Review required");
  assert.match(ctx.lineage(uncertain),/Source dealership unverified/);
});
test("fully validated local source and legacy date-only labels keep their existing status wording",()=>{
  const accepted={key:"csi",status:"current",loaded:true,
    sourceStoreConfidence:"verified-source-store",
    periodStart:"2026-11-01",periodEnd:"2026-11-04",reportPeriodVerified:true};
  assert.equal(ctx.label(accepted),"Current");
  assert.equal(ctx.label({...accepted,sourceStoreConfidence:undefined}),"Current");
});

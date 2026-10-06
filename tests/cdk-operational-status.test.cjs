const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extractBetween(startToken, endToken) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start + 1);
  assert.ok(start >= 0 && end > start, "could not extract " + startToken);
  return app.slice(start, end);
}
const constants = extractBetween("  const FRESH_MANAGEMENT_STATUSES", "  const LEGACY_MANAGEMENT_STATUSES");
const statusFns = extractBetween("  function canonicalReviewStatus", "  function normalizeCommunication");
const mergeFns = extractBetween("  function defaultManagementFor", "  async function importCdkRepairOrdersDocx");
const source = [
  "const norm=(v)=>String(v??'').trim().toLowerCase().replace(/\\s+/g,' ');",
  constants,
  "const statusById=()=>null;",
  statusFns,
  "const model={state:{records:[],closedRecords:[]}};globalThis.model=model;",
  mergeFns,
  "globalThis.api={canonicalCdkStatus,canonicalReviewStatus,statusDetailsFor,operationalStatusFromImport,mergeCompleteOpenRoRecords,pruneClosedRecords};"
].join("\n");
const context={Date,Number,String,Set,Map,Object,Array};vm.createContext(context);vm.runInContext(source,context);
const api=context.api;

const expected={
  Open:"Awaiting Assignment",
  Inspection:"Work in Progress",
  "Parts Estimate":"Parts Estimate",
  Pending:"Pending Authorization",
  Waiting:"Awaiting Technician Attention",
  Working:"Being Repaired",
  Review:"Ready for Review",
  Closed:"Closed"
};
for(const [raw,canonical] of Object.entries(expected))assert.equal(api.canonicalCdkStatus(raw),canonical,raw);

assert.deepEqual(Array.from(api.statusDetailsFor("Pending Authorization")),["Customer","Warranty","Insurance","Internal/Management","Other"]);
assert.deepEqual(Array.from(api.statusDetailsFor("Awaiting Technician Attention")),["Approved — Waiting Parts","Approved — Waiting for Technician to Begin","Deferred — Waiting for Reassembly/Ready for Delivery","Deferred — Waiting for Technician Story/Documentation","Other"]);
assert.deepEqual(Array.from(api.statusDetailsFor("Ready for Review")),["Advisor","Warranty Admin","Service Manager","Other"]);
assert.equal(api.statusDetailsFor("Being Repaired").length,0);

const confirmed=api.operationalStatusFromImport({sourceStatus:"Pending"},null,"2026-10-06T18:00:00.000Z");
assert.equal(confirmed.status,"Pending Authorization");
assert.equal(confirmed.stale,false);

const prior={cdkOperational:{status:"Being Repaired",rawStatus:"Working",confirmedAt:"2026-10-06T17:00:00.000Z",stale:false}};
const stale=api.operationalStatusFromImport({sourceStatus:"PREASSIGNED"},prior,"2026-10-06T18:00:00.000Z");
assert.equal(stale.status,"Being Repaired");
assert.equal(stale.stale,true);

const at=Date.parse("2026-10-10T12:00:00.000Z");
const kept=api.pruneClosedRecords([
  {id:"keep",closedAt:"2026-10-04T12:00:00.000Z"},
  {id:"drop",closedAt:"2026-10-02T11:59:59.000Z"}
],at);
assert.deepEqual(Array.from(kept,x=>x.id),["keep"]);

context.model.state.records=[
  {id:"ro-a",ro:"10001",sourceStatus:"Working",management:{status:"Being Repaired",nextAction:"Continue repair",reviewDate:"2026-10-08",updatedAt:"2026-10-06T16:00:00.000Z"},cdkOperational:{status:"Being Repaired",rawStatus:"Working",confirmedAt:"2026-10-06T16:00:00.000Z",stale:false}},
  {id:"ro-b",ro:"10002",sourceStatus:"Open",management:{status:"Awaiting Assignment",nextAction:"Dispatch",reviewDate:"2026-10-08",updatedAt:"2026-10-06T16:00:00.000Z"}}
];
context.model.state.closedRecords=[];
const merged=api.mergeCompleteOpenRoRecords([{id:"ro-a",ro:"10001",sourceStatus:"Review",advisor:"Advisor A"}],"2026-10-06T18:00:00.000Z","synthetic");
assert.equal(merged.records.length,1);
assert.equal(merged.records[0].management.nextAction,"Continue repair");
assert.equal(merged.records[0].cdkOperational.status,"Ready for Review");
assert.equal(merged.closedRecords.length,1);
assert.equal(merged.closedRecords[0].id,"ro-b");

context.model.state.records=[];
context.model.state.closedRecords=[{...merged.closedRecords[0],management:{status:"Awaiting Assignment",nextAction:"Dispatch",reviewDate:"2026-10-08",updatedAt:"2026-10-06T16:00:00.000Z"}}];
const reopened=api.mergeCompleteOpenRoRecords([{id:"ro-b",ro:"10002",sourceStatus:"Open",advisor:"Advisor B"}],"2026-10-07T18:00:00.000Z","synthetic");
assert.equal(reopened.records[0].management.nextAction,"Dispatch");
assert.equal(reopened.reopenedCount,1);

console.log("PASS canonical CDK status, subtype, stale, close retention, and reopen rules");

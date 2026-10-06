const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(name, next) {
  const start = app.indexOf("  function " + name);
  const end = app.indexOf("  function " + next, start + 1);
  assert.ok(start >= 0 && end > start, "could not extract " + name);
  return app.slice(start, end);
}
const source = [
  "const norm=(v)=>String(v||'').trim().toLowerCase();",
  "const usDateToIso=(v)=>{const m=String(v).match(/(\\d{1,2})\\/(\\d{1,2})\\/(20\\d{2})/);return m?m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'):''};",
  "const workloadDate=(v)=>v;",
  "const reconcileRecordSourceIdentity=()=>{};",
  "const stableId=(r)=>r.ro;",
  extract("cdkDateTime(value)", "cdkDateTimeFromLines"),
  extract("cdkDateTimeFromLines(lines,index)", "parseCdkRepairOrdersDocx"),
  extract("parseCdkRepairOrdersDocx(source,fileName)", "importCdkRepairOrdersDocx"),
  "globalThis.parse=parseCdkRepairOrdersDocx;"
].join("\n");
const context={};vm.createContext(context);vm.runInContext(source,context);

const sample = [
  "CDK","Repair Orders","RO#:","All: 3","Open: 2","Working: 0","On Hold: 0","Closed: 1",
  "50001","Open","CUSTOMER ONE","1C4ABCDEFGHIJ1234","2025 JEEP TEST","T100","101",
  "10/06/2026","9:23 am","10/06/2026","3:30 pm","[A] [B]",
  "50002","Review","CUSTOMER TWO","3C6ABCDEFGHIJ5678","2024 RAM TEST","T101","102","9001",
  "10/05/2026","4:15 pm","10/08/2026","3:30 pm","[A]",
  "50003","Closed","CUSTOMER THREE","2C4ABCDEFGHIJ9012","2023 CHRYSLER TEST","T102","103","9002",
  "10/04/2026","8:00 am","10/04/2026","3:30 pm","10/05/2026","10:00 am","[A]"
].join("\n");
const parsed=context.parse(sample,"synthetic.docx");
assert.equal(parsed.summary.all,3);
assert.equal(parsed.summary.open,2);
assert.equal(parsed.summary.closed,1);
assert.equal(parsed.records.length,2);
assert.equal(parsed.records[0].vin,"1C4ABCDEFGHIJ1234");
assert.equal(parsed.records[0].vehicle,"2025 JEEP TEST");
assert.equal(parsed.records[0].opened,"10/06/2026 9:23 AM");
assert.equal(parsed.records[1].technicianCode,"9001");
assert.equal(parsed.validation.parser,"cdk-repair-orders-docx-v2-split-fields");
console.log("PASS CDK DOCX split VIN/vehicle and date/time export");

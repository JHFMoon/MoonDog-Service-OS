"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  function latestCsiRefreshDate() {");
const end = app.indexOf("  function latestOperationalSnapshot(", start);
assert.ok(start >= 0 && end > start, "actual production CSI freshness presentation function exists");
const production = app.slice(start, end);

function latest(csi, today = "2026-10-20") {
  const model = {operationalMetrics: {csi}};
  const ctx = vm.createContext({
    model, freshness, Date,
    localDateKey: (value) => value instanceof Date ? value.toISOString().slice(0, 10) : today
  });
  vm.runInContext(production + "\nthis.latest=latestCsiRefreshDate;", ctx);
  const original = JSON.stringify(model);
  const result = ctx.latest();
  assert.equal(JSON.stringify(model), original, "read-only freshness display must not mutate imported source history");
  return result;
}

test("verified real current CSI refresh date remains visible without import fallback", () => {
  assert.equal(latest({lastSuccessfulRefreshDate:"2026-10-20",
    imports:[{refreshDate:"2026-10-19"}]}), "2026-10-20");
});

test("impossible and future persisted CSI dates never certify a source refresh", () => {
  for (const invalid of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01",
    "2026-00-10", "2026-10-00", "2026-11-01", "2026-1-20", "not-a-date"]) {
    assert.equal(latest({lastSuccessfulRefreshDate:invalid,
      imports:[{refreshDate:"2026-10-19"}]}), "2026-10-19", invalid);
  }
});

test("invalid or future explicit import refresh date cannot borrow its import timestamp", () => {
  for (const invalid of ["2026-02-30", "2026-10-21", "2026-13-01"]) {
    assert.equal(latest({imports:[{refreshDate:invalid,
      importedAt:"2026-10-20T14:00:00.000Z"}]}), "", invalid);
  }
});

test("valid timestamp-only legacy import retains observation fallback; invalid timestamps fail closed", () => {
  assert.equal(latest({imports:[{importedAt:"2026-10-19T14:00:00.000Z"}]}), "2026-10-19");
  assert.equal(latest({imports:[{importedAt:"2026-10-21T14:00:00.000Z"}]}), "",
    "future imported timestamp is not an observed source refresh");
  for (const invalid of ["2026-02-30T14:00:00.000Z", "2026-10-19T25:00:00.000Z",
    "not-a-date", "", null, undefined]) {
    assert.equal(latest({imports:[{importedAt:invalid}]}), "", String(invalid));
  }
});

test("latest valid dated source wins while absent sources remain unknown rather than today's date", () => {
  assert.equal(latest({imports:[
    {refreshDate:"2026-10-17"}, {refreshDate:"2026-10-19"},
    {refreshDate:"2026-10-21"}, {refreshDate:"2026-02-30"}
  ]}), "2026-10-19");
  assert.equal(latest({imports:[{}, {refreshDate:""}, {importedAt:null}]}), "");
  assert.equal(latest({}), "");
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets/app.js"), "utf8");
const start = app.indexOf("  // Presentation-only advisor scopes.");
const end = app.indexOf("  function configuredAdvisors(", start);
assert.ok(start >= 0 && end > start, "Production visibility selector exists");
const model = {
  settings: {
    advisors: {
      "101": { number: "101", name: "Synthetic A", active: true, removed: false, participation: { openRo: false, advisorPerformance: true } },
      "102": { number: "102", name: "Synthetic B", active: true, removed: false, participation: { assignNext: true } },
      "103": { number: "103", name: "Synthetic C", active: false, removed: true, participation: { openRo: true, advisorPerformance: true } }
    }
  },
  state: {
    records: [
      { id: "synthetic-1", advisorCode: "101", advisor: "Synthetic A" },
      { id: "synthetic-2", advisorCode: "102", advisor: "Synthetic B" },
      { id: "synthetic-3", advisorCode: "103", advisor: "Synthetic C" },
      { id: "synthetic-4", advisorCode: "999", advisor: "Unconfigured source" },
      { id: "synthetic-5", advisor: "Synthetic A" }
    ]
  }
};
const norm = value => String(value ?? "").toLowerCase().trim();
const visibility = vm.runInNewContext(app.slice(start, end) +
  "\n({advisorShownInSection, openRoRecordVisible, openRoVisibleRecords})", { model, norm });

test("Open RO scope hides one advisor without removing authoritative records", () => {
  const before = JSON.stringify(model.state);
  const visible = visibility.openRoVisibleRecords();
  assert.deepEqual([...visible.map(record => record.id)], ["synthetic-2", "synthetic-4"]);
  assert.equal(JSON.stringify(model.state), before, "source state must be unchanged");
  assert.equal(visibility.advisorShownInSection("101", "advisorPerformance"), true, "performance numbers remain visible");
  assert.equal(visibility.advisorShownInSection("101", "assignNext"), false, "other scope remains independent");
});

test("older settings default to showing Open RO and Performance, including inactive source identities", () => {
  assert.equal(visibility.advisorShownInSection("102", "openRo"), true);
  assert.equal(visibility.advisorShownInSection("102", "advisorPerformance"), true);
  assert.equal(visibility.advisorShownInSection("999", "openRo"), true, "unknown source may not disappear");
  assert.equal(visibility.advisorShownInSection("103", "openRo"), false, "legacy global-hidden is honored");
});

test("records with missing advisor codes are hidden only after unique name resolution", () => {
  assert.equal(visibility.openRoRecordVisible({advisor:"Synthetic A"}), false);
  assert.equal(visibility.openRoRecordVisible({advisor:"Unknown"}), true);
  model.settings.advisors["104"] = {number:"104",name:"Synthetic A",removed:false,participation:{openRo:true}};
  assert.equal(visibility.openRoRecordVisible({advisor:"Synthetic A"}), true, "ambiguous identity must remain accessible");
  delete model.settings.advisors["104"];
});

test("UI surfaces have independent non-destructive visibility gates", () => {
  const scopes = ["openRo","assignNext","dailyWalk","advisorPerformance","advisorMeeting","supervisorWorkbook"];
  const settings = app.slice(app.indexOf("  function renderAdvisorSettings()"),app.indexOf("  function renderSettings()"));
  for (const key of scopes) assert.ok(settings.includes('["'+key+'",'), key + " toggle");
  assert.ok(!settings.includes("Remove from Service Operations Dashboard"), "no misleading global remove control");
  assert.match(app, /function renderFilters\(\) \{ renderAdvisorHandoff\(\); const records=openRoVisibleRecords\(\)/);
  assert.match(app, /const rows=openRoVisibleRecords\(\)\.filter\(validManagerReviewDate\)/);
  assert.match(app, /all = openRoVisibleRecords\(\), exactRos=/);
  assert.match(app, /Object\.values\(latest\.advisors\)\.filter\(advisor => advisorShownInSection\(advisor\.code, "advisorPerformance"\)\)/);
  assert.match(app, /advisorShownInSection\(a\.number,'advisorPerformance'\)/);
  assert.match(app, /await writeJson\(SETTINGS_PATH,model\.settings\)/, "settings still saved to durable Workspace");
  assert.match(app, /const records = model\.state\.records \|\| \[\]; const today = localDateKey\(\), active = records\.filter/, "global Home totals retain all source records");
  new vm.Script(app);
});

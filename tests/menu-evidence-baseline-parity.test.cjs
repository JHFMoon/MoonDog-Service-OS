"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function production(start, end, label) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Real production " + label + " must exist");
  return app.slice(from, to);
}
const rawMenu = production("  function menuMeetingEvidence(metric)", "  function csiMetricEvidence(", "Menu display evidence");
const activeWrapper = production("  const rawVirMeetingEvidence=virMeetingEvidence,rawMenuMeetingEvidence=menuMeetingEvidence;", "  function meetingGrossWindowTotal(", "active evidence confidence wrapper");
const baseline = production("  function meetingCurrentMetrics()", "  // Distinct triggers (connection, timer, Settings)", "Meeting-cycle stored comparison selector");

function fixture(presentation, penetration=37) {
  const snapshot = {
    releaseWeek: "2026-11-02", periodStart: "2026-11-02", periodEnd: "2026-11-08",
    store: {presentation,penetration}, importedAt: "synthetic-import"
  };
  const sourceHealth = {status:"current",safeForCurrent:true,reportPeriodVerified:true};
  const model = {settings:{csiPeriodStart:"2026-11-01"}};
  const ctx = vm.createContext({
    model,
    sourceExpectation: () => "required",
    latestOperationalSnapshot: key => key==="menu" ? snapshot : null,
    latestVerifiedMeetingSnapshot: () => null,
    expectedMenuWeek: () => "2026-11-02",
    text: v => String(v ?? ""),
    localDateKey: () => "2026-11-02",
    currentCsiSurveys: () => ({}),
    npsSummary: () => ({responses:0,nps:null}),
    verifiedMeetingCsiNps: () => null,
    virMeetingEvidence: () => ({verified:false,status:"missing-source"}),
    virObservationDate: () => "",
    controllableTeamStatus: () => ({className:"unknown",progress:0}),
    sourceFreshness: key => key==="menu" ? sourceHealth :
      {safeForCurrent:false,reportPeriodVerified:false},
    metricEvidence: fields => ({
      ...fields, verified: ["verified","known-zero"].includes(fields.status)
    }),
    metricDependencyEvidence: (dependencies, fields) =>
      ({...fields, verified: fields.verified &&
        dependencies.every(source => source.safeForCurrent === true &&
          source.reportPeriodVerified === true)})
  });
  vm.runInContext(rawMenu + "\n" + activeWrapper + "\n" + baseline +
    "\nthis.api={menuEvidence:menuMeetingEvidence,cycle:meetingCurrentMetrics};", ctx);
  return {snapshot,sourceHealth,evidence: metric=>ctx.api.menuEvidence(metric), cycle:()=>ctx.api.cycle()};
}

test("missing, null and blank Menu numbers are unknown in BOTH visible evidence and stored baseline", () => {
  for(const raw of [undefined,null,""," ","0",false,Number.NaN,Number.POSITIVE_INFINITY]) {
    const f=fixture(raw);
    const before=JSON.stringify(f.snapshot);
    const evidence=f.evidence("presentation"),current=f.cycle();
    assert.equal(evidence.status,"parser-error",
      "display must not manufacture zero from " + String(raw));
    assert.equal(evidence.verified,false);
    assert.equal(current.menuPresentation.value,null,
      "stored comparison uses the same unknown authority as visible tile");
    assert.equal(current.menuPenetration.value,37,
      "an independently valid Menu metric is not discarded");
    assert.equal(JSON.stringify(f.snapshot),before,"render and baseline must not mutate source");
  }
});

test("a real finite Menu zero stays a verified known zero in both views", () => {
  const f=fixture(0,0), evidence=f.evidence("presentation"), saved=f.cycle();
  assert.equal(evidence.status,"known-zero");
  assert.equal(evidence.verified,true);
  assert.equal(evidence.value,0);
  assert.equal(saved.menuPresentation.value,0);
  assert.equal(saved.menuPenetration.value,0);
  assert.equal(f.evidence("penetration").status,"known-zero");
});

test("a valid Menu nonzero retains period and matches baseline without coercion", () => {
  const f=fixture(84,31);
  assert.equal(f.evidence("presentation").value,84);
  assert.equal(f.evidence("presentation").verified,true);
  assert.equal(f.cycle().menuPresentation.value,84);
  assert.equal(f.cycle().menuPresentation.period,"menu:2026-11-02");
  assert.equal(f.evidence("penetration").value,31);
  assert.equal(f.cycle().menuPenetration.value,31);
});

test("a period-unverified Menu snapshot cannot supply current display evidence or stored comparisons", () => {
  const f=fixture(0);
  f.sourceHealth.reportPeriodVerified=false;
  assert.equal(f.evidence("presentation").verified,false);
  assert.equal(f.cycle().menuPresentation.value,null);
  f.sourceHealth.reportPeriodVerified=true;
  f.sourceHealth.safeForCurrent=false;
  assert.equal(f.evidence("presentation").verified,false);
  assert.equal(f.cycle().menuPresentation.value,null);
});

test("missing Menu store is not an implicit zero",()=>{
  const f=fixture(0);
  delete f.snapshot.store;
  assert.equal(f.evidence("presentation").status,"parser-error");
  assert.equal(f.cycle().menuPresentation.value,null);
  assert.equal(f.cycle().menuPenetration.value,null);
});

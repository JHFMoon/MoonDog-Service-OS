"use strict";

// #59-01: real CSI source-authority selector + Performance trend functions.
// All records are synthetic and cannot identify a real customer.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");
const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function part(first, last) {
  const start = app.indexOf(first), end = app.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, "expected shipped production source: " + first);
  return app.slice(start, end);
}
const source = part("  function sourceFreshness(", "  function metricDependencyEvidence(");
const dates = part("  function validCoverageDate(", "  function coverageTimestamp(");
const csiPeriod = part("  function csiReportedPeriod(", "  function verifiedVirSourceObservationDate(");
const trendPoints = part("  function trendPoints(", "  function availableTrendMeasures(");
const trendSummary = part("  function trendSummary(", "  function trendScale(");
const today = "2026-10-30";
const start = "2026-10-01";
const through = "2026-10-26";
const item = {id:"SYN-CSI-01",advisorCode:"SYN",surveyDate:through,score:10};
const measure = {family:"csi",key:"responses",unit:"count",roles:["store","advisor"],volume:true};

function harness(imports, surveys={"SYN-CSI-01":item}) {
  const model = {operationalMetrics:{csi:{
    surveys:JSON.parse(JSON.stringify(surveys)),
    imports:JSON.parse(JSON.stringify(imports))
  }}};
  const ctx = vm.createContext({
    model,freshness,Date,Intl,
    sourceExpectation: () => "recommended",
    businessTimeZone: () => "America/Los_Angeles",
    localDateKey: () => today,
    advisorDisplayName: id => "Synthetic Advisor "+id,
    TREND_SOURCES: {csi:"Dealer Dashboard CSI"},
    npsSummary: entries => ({
      nps: Object.values(entries).length ? 100 : null,
      responses: Object.values(entries).length
    })
  });
  vm.runInContext(dates + "\n" + csiPeriod + "\n" + source + "\n" +
    trendPoints + "\n" + trendSummary +
    "\nthis.points=trendPoints;this.summary=trendSummary;",ctx);
  return {
    model, points: (role="store",id="SYN") => JSON.parse(JSON.stringify(ctx.points(measure,role,id,today))),
    summary: points => JSON.parse(JSON.stringify(ctx.summary(measure,points)))
  };
}

test("a survey date or a recent import cannot invent verified month-to-date CSI coverage", () => {
  const f = harness([{
    coverageStart:through,coverageEnd:through,
    sourceFile:"synthetic-received.csv",importedAt:"2026-10-30T16:00:00Z",
    reportObservationVerified:true,reportObservationDate:through
  }]);
  const prior=JSON.stringify(f.model.operationalMetrics);
  const points=f.points();
  assert.equal(points.length,1);
  assert.equal(points[0].value,1);
  assert.equal(points[0].periodVerified,false);
  assert.equal(points[0].periodStart,"");
  assert.equal(points[0].periodEnd,through);
  assert.equal(f.summary(points).label,"Latest observation · reporting period unverified");
  assert.equal(JSON.stringify(f.model.operationalMetrics),prior,
    "display cannot mutate retained source evidence");
});

test("an end-only CSI scope is not a verified whole-month interval in Performance", () => {
  const f=harness([{scopeVerified:true,scopeEnd:through,
    importedAt:"2026-10-30T16:00:00Z",sourceFile:"synthetic-end-only.csv"}]);
  const points=f.points();
  assert.equal(points[0].periodVerified,false);
  assert.equal(points[0].periodStart,"");
  assert.equal(f.summary(points).label,"Latest observation · reporting period unverified");
});

test("a fully verified cumulative export certifies CSI MTD while retaining advisor/store symmetry", () => {
  const f=harness([{scopeVerified:true,scopeStart:start,scopeEnd:through,
    sourceFile:"synthetic-full-scope.csv",importedAt:"2026-10-30T16:00:00Z"}]);
  const store=f.points("store"),advisor=f.points("advisor");
  assert.equal(store[0].periodStart,start);
  assert.equal(store[0].periodVerified,true);
  assert.equal(store[0].sourceFile,"synthetic-full-scope.csv");
  assert.equal(f.summary(store).label,"Current MTD");
  assert.equal(advisor[0].periodVerified,true);
  assert.equal(advisor[0].value,store[0].value);
  assert.equal(advisor[0].sourceFile,store[0].sourceFile);
});

test("invalid, future, reversed, incomplete and conflicting scope cannot authorize MTD", () => {
  const cases=[
    {scopeVerified:true,scopeStart:"2026-02-30",scopeEnd:through},
    {scopeVerified:true,scopeStart:"2026-10-27",scopeEnd:through},
    {scopeVerified:true,scopeStart:"2026-10-02",scopeEnd:through},
    {scopeVerified:true,scopeStart:start,scopeEnd:"2026-10-25"},
    {scopeVerified:true,scopeStart:start,scopeEnd:"2026-11-01"},
    {scopeVerified:true,scopeStart:start,scopeEnd:through,
      reportObservationVerified:true,reportObservationDate:"2026-02-30"}
  ];
  for(const [i,entry] of cases.entries()){
    const f=harness([{...entry,sourceFile:"synthetic-"+i+".csv"}]);
    const point=f.points()[0];
    assert.equal(point.periodVerified,false,"invalid CSI scope case "+i);
    assert.equal(f.summary([point]).label,"Latest observation · reporting period unverified");
  }
});

test("a month-to-date interval is never claimed for survey dates after the verified report scope", () => {
  const beyond={id:"SYN-CSI-02",advisorCode:"SYN",surveyDate:"2026-10-29",score:9};
  const f=harness([{scopeVerified:true,scopeStart:start,scopeEnd:through,
    sourceFile:"synthetic-month-partial.csv"}],{"SYN-CSI-01":item,"SYN-CSI-02":beyond});
  const points=f.points();
  assert.equal(points.length,2);
  assert.equal(points[0].periodVerified,true);
  assert.equal(points[0].periodStart,start);
  assert.equal(points[1].periodVerified,false);
  assert.equal(points[1].periodStart,"");
  assert.equal(points[1].value,2);
  assert.equal(f.summary(points).label,"Latest observation · reporting period unverified");
});

test("missing survey history must remain absent, never a zero-response verified MTD point",()=>{
  const f=harness([{scopeVerified:true,scopeStart:start,scopeEnd:through}],{});
  assert.deepEqual(f.points(),[]);
  assert.equal(f.summary([]).label,"No verified current-month observations");
});

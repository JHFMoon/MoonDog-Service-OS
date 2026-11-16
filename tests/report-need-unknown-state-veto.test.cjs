"use strict";

// #59-01 synthetic report-readiness authority: an unknown/partial status
// must not be converted into CURRENT by an unrelated current workload.
const test = require("node:test");
const assert = require("node:assert/strict");
const freshness = require("../assets/freshness.js");
const today = "2026-11-02";
const families = ["openRo", "appointments", "sapr", "nextAppointments", "csi", "vir", "menu"];
function check(key, evidence, currentSnapshot = true) {
  const original = JSON.stringify(evidence);
  const need = freshness.evaluateReportNeed({
    key, evidence, today, currentSnapshot,
    activeFeature: true, arrivalPlanning: true
  });
  assert.equal(JSON.stringify(evidence), original, "readiness is a read-only selector");
  return need;
}

test("contradictory safeForCurrent flags cannot certify missing, stale or unloaded sources", () => {
  const blocked = [
    {status:"missing",loaded:false,safeForCurrent:true},
    {status:"missing",loaded:true,safeForCurrent:true},
    {status:"stale",loaded:true,safeForCurrent:true},
    {status:"stale",loaded:false,safeForCurrent:true},
    {status:"current",loaded:false,safeForCurrent:true},
    {status:"current",loaded:true,safeForCurrent:false},
    {status:"current",loaded:true,safeForCurrent:"true"},
    {status:"historical-valid",loaded:false,safeForCurrent:true},
    {status:"historical-valid",loaded:true,safeForCurrent:true}
  ];
  for(const key of families.filter(family=>family!=="openRo")){
    for(const evidence of blocked){
      const original=Object.freeze({key,...evidence,safeForPurpose:true});
      assert.notEqual(check(key,original,false).state,"CURRENT",
        key+" "+evidence.status+" must not borrow an inconsistent readiness flag");
    }
  }
  assert.equal(check("sapr",Object.freeze({status:"current",loaded:true,safeForCurrent:true,safeForPurpose:true}),false).state,"CURRENT");
  assert.equal(check("openRo",Object.freeze({status:"missing",loaded:false,safeForCurrent:false}),true).state,"CURRENT",
    "independently verified current Open RO workload remains an allowed fallback");
});

test("Open RO independent workload never certifies contradictory current or historical-valid source authority", () => {
  const bad = [
    {status:"current",loaded:false,safeForCurrent:true,safeForPurpose:true},
    {status:"current",loaded:true,safeForCurrent:false,safeForPurpose:false},
    {status:"current",loaded:true,safeForCurrent:true,safeForPurpose:false},
    {status:"historical-valid",loaded:true,safeForCurrent:false,safeForPurpose:false},
    {status:"historical-valid",loaded:false,safeForCurrent:false,safeForPurpose:true}
  ];
  for (const evidence of bad) {
    const original=Object.freeze({key:"openRo",...evidence});
    assert.equal(check("openRo",original,true).state,"NEED NOW",
      "independent workload cannot forgive contradictory source integrity");
  }
  for (const [status,loaded] of [["missing",false],["stale",true]]) {
    const evidence=Object.freeze({key:"openRo",status,loaded,safeForCurrent:false,safeForPurpose:false});
    assert.equal(check("openRo",evidence,true).state,"CURRENT",
      "genuinely missing/stale report retains independent workload coverage");
    assert.equal(check("openRo",evidence,false).state,"NEED NOW");
  }
  const good=freshness.evaluateSource({key:"openRo",today,exists:true,sourceDate:today});
  assert.equal(check("openRo",good,true).state,"CURRENT");
});
test("recent historical source needs explicit coherent purpose authority", () => {
  for(const key of ["sapr","csi","vir","nextAppointments","menu"]){
    for(const evidence of [
      {status:"historical-valid",loaded:true,safeForPurpose:false,safeForCurrent:false},
      {status:"historical-valid",loaded:true,safeForPurpose:true,safeForCurrent:true},
      {status:"historical-valid",loaded:false,safeForPurpose:true,safeForCurrent:false}
    ]){
      const input=Object.freeze({key,...evidence});
      const result=freshness.evaluateReportNeed({key,evidence:input,today,observationDate:today,
        activeFeature:true,arrivalPlanning:true,currentSnapshot:false});
      assert.notEqual(result.state,"CURRENT",key+" unsafe historical observation must not be current");
    }
    const valid=Object.freeze({key,status:"historical-valid",loaded:true,
      safeForPurpose:true,safeForCurrent:false});
    const need=freshness.evaluateReportNeed({key,evidence:valid,today,observationDate:today,
      activeFeature:true,arrivalPlanning:true,currentSnapshot:false});
    assert.equal(need.state,"CURRENT",key+" verified dated historical source remains current");
  }
});

test("independent Open RO workload rejects contradictory missing or stale source flags", () => {
  const blocked=[
    {status:"missing",loaded:true,safeForCurrent:false,safeForPurpose:false},
    {status:"missing",loaded:false,safeForCurrent:true,safeForPurpose:false},
    {status:"missing",loaded:false,safeForCurrent:false,safeForPurpose:true},
    {status:"stale",loaded:false,safeForCurrent:false,safeForPurpose:false},
    {status:"stale",loaded:true,safeForCurrent:true,safeForPurpose:false},
    {status:"stale",loaded:true,safeForCurrent:false,safeForPurpose:true}
  ];
  for(const evidence of blocked)assert.equal(check("openRo",Object.freeze(evidence),true).state,
    "NEED NOW", "independent workload cannot waive contradictory source-integrity flags");
  assert.equal(check("openRo",Object.freeze({
    status:"missing",loaded:false,safeForCurrent:false,safeForPurpose:false}),true).state,"CURRENT");
  assert.equal(check("openRo",Object.freeze({
    status:"stale",loaded:true,safeForCurrent:false,safeForPurpose:false}),true).state,"CURRENT");
});

test("unknown, blank, pending and bogus confidence cannot claim report readiness in any operational family", () => {
  for (const key of families) {
    for (const status of [undefined, null, "", "unknown", "pending", "loading", "verified"]) {
      const evidence = Object.freeze({
        key, status, loaded: true, safeForCurrent: true, safeForPurpose: true,
        label: "Synthetic " + key, reason: "No canonical source authority proved"
      });
      const result = check(key, evidence);
      assert.equal(result.state, "NEED NOW", key + " " + String(status));
      assert.equal(result.actionable, true, key + " " + String(status));
      assert.equal(result.actions.length, 1, key + " " + String(status));
    }
    const absent = check(key, {});
    assert.equal(absent.state, "NEED NOW", key + " entirely absent evidence");
  }
});

test("recognized invalid, conflicting, unsupported and unverified states remain blocked", () => {
  for (const key of families) for (const status of ["invalid", "conflicting", "unsupported", "unverified"]) {
    const evidence = Object.freeze({key, status, loaded: true, safeForCurrent: false, safeForPurpose: false});
    assert.equal(check(key, evidence).state, "NEED NOW", key + " " + status);
  }
});

test("canonical current, missing and stale Open RO evidence preserve authorized independent workload behavior", () => {
  const current = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: today});
  const missing = freshness.evaluateSource({key: "openRo", today, exists: false});
  const stale = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: "2026-10-31"});
  assert.equal(current.status, "current");
  assert.equal(missing.status, "missing");
  assert.equal(stale.status, "stale");
  assert.equal(check("openRo", current).state, "CURRENT");
  assert.equal(check("openRo", missing).state, "CURRENT");
  assert.equal(check("openRo", stale).state, "CURRENT");
  assert.equal(check("openRo", missing, false).state, "NEED NOW");
  assert.equal(check("openRo", stale, false).state, "NEED NOW");
});

test("not-used and unavailable policy remain non-actionable, not verified as current", () => {
  for (const [key, expectation] of [["sapr", "not-used"], ["csi", "temporarily-unavailable"]]) {
    const state = freshness.evaluateSource({key, today, exists: false, expectation});
    const need = check(key, state);
    assert.equal(need.state, "OPTIONAL", expectation);
    assert.equal(need.actionable, false, expectation);
    assert.equal(freshness.evaluateMetric([state]).verified, false);
  }
});

test("valid current source can still satisfy need without independent workload fallback", () => {
  const current = freshness.evaluateSource({key: "openRo", today, exists: true, sourceDate: today});
  assert.equal(check("openRo", current, false).state, "CURRENT");
});

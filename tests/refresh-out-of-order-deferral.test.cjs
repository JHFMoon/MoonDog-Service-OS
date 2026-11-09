"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

for(const target of ["src/refresh-intelligence.js","assets/freshness.js"]){
  const R = require(path.resolve(__dirname,"..",target));
  test(target+": late deferral does not shorten a newer snooze or trigger repeated report prompts",()=>{
    const first="2026-11-08T10:00:00Z";
    const latest="2026-11-08T14:00:00Z";
    const late="2026-11-08T10:15:00Z";
    let history=R.learn(R.empty(),"csi","not-now",{at:first});
    history=R.learn(history,"csi","not-now",{at:latest});
    const expected=history.sources.csi.notNowUntil;
    assert.equal(expected,"2026-11-08T15:00:00.000Z");
    const original=JSON.stringify(history);
    const deliveredLate=R.learn(history,"csi","not-now",{at:late});
    assert.equal(JSON.stringify(history),original,"late event must not mutate original history");
    assert.equal(deliveredLate.sources.csi.notNowUntil,expected,
      "late event must preserve the most recent explicit user deferral");
    assert.deepEqual(R.plan([{source:"csi",rank:1}],deliveredLate,{
      at:"2026-11-08T14:30:00Z",today:"2026-11-08"}),[],
      "the refresh list should not nag the user during their existing deferral");
  });
  test(target+": future event timestamps cannot inflate older deferral frequency",()=>{
    const history={schemaVersion:1,sources:{performance:{
      observations:[],deferrals:[
        {at:"2026-11-08T15:00:00Z",hour:15},
        {at:"2026-11-08T16:00:00Z",hour:16}
      ],notNowUntil:""
    }}};
    const next=R.learn(history,"performance","not-now",{
      at:"2026-11-08T10:00:00Z"});
    assert.equal(next.sources.performance.notNowUntil,"2026-11-08T10:30:00.000Z",
      "future history must not count as prior user deferrals");
    assert.equal(history.sources.performance.deferrals.length,2);
  });
  test(target+": chronological user deferrals still increase snooze normally",()=>{
    let history=R.empty();
    const expected=[
      ["2026-11-08T10:00:00Z","2026-11-08T10:30:00.000Z"],
      ["2026-11-08T10:10:00Z","2026-11-08T11:10:00.000Z"],
      ["2026-11-08T10:20:00Z","2026-11-08T12:20:00.000Z"]
    ];
    for(const [at,until] of expected){
      history=R.learn(history,"performance","not-now",{at});
      assert.equal(history.sources.performance.notNowUntil,until);
    }
    history=R.learn(history,"performance","imported",{
      at:"2026-11-08T13:00:00Z",periodEnd:"2026-11-08"});
    assert.equal(history.sources.performance.notNowUntil,"",
      "a verified newer import should continue clearing a snooze");
  });
}

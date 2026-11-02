"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const freshness = require("../assets/freshness.js");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function fragment(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "actual production review-date/DOM function missing");
  return app.slice(from, to);
}
const validate = fragment("  function validManagerReviewDate(", "  function ensureOpenRoRetrievalUi(");
const render = fragment("  function renderRecentlyReviewed(){", "\n  // Sorting is presentation-only");

function node(tag) {
  return {tag, children: [], textContent: "", dataset: {}, append(...rows) {this.children.push(...rows);},
    replaceChildren(...rows) {this.children=[...rows];}};
}
function fixture(rows) {
  const list=node("div");
  const ctx=vm.createContext({
    freshness, Date, String, text: value=>String(value??""),
    storeDateKey: date=>date.toISOString().slice(0,10),
    ui:{recentlyReviewedPanel:list},
    document:{createElement:node},
    openRoVisibleRecords:()=>rows
  });
  vm.runInContext(validate+"\n"+render+"\nthis.valid=validManagerReviewDate;this.render=renderRecentlyReviewed;this.trusted=trustedManagerReviewTime;",ctx);
  return {ctx,list};
}

test("Open RO manager-reviewed date rejects impossible civil dates, not JS date rollovers",()=>{
  const rows=[
    {id:"valid",ro:"SYN-001",management:{managerReviewedOn:"2024-02-29",updatedAt:"2024-02-29T20:00:00Z"}},
    ...["2026-02-29","2026-02-30","2026-04-31","2026-13-01","2026-00-10","2026-10-00","2026-10-32","2026-1-10","not-a-date"].map((date,i)=>
      ({id:"invalid-"+i,ro:"SYN-"+String(i+2).padStart(3,"0"),
        management:{managerReviewedOn:date,updatedAt:"2026-03-02T19:00:00Z"}}))
  ];
  const h=fixture(rows);
  assert.equal(h.ctx.valid(rows[0]),true,"valid leap-day manager review remains visible");
  for(const record of rows.slice(1)) {
    assert.equal(h.ctx.valid(record),false,record.management.managerReviewedOn);
    assert.equal(h.ctx.trusted(record),"","invalid review dates must not yield trusted review timestamp");
  }
  h.ctx.render();
  assert.equal(h.list.children.length,1,"invalid review dates never appear in Recently Reviewed");
  assert.equal(h.list.children[0].dataset.recentlyReviewedId,"valid");
  assert.equal(h.list.children[0].children[0].textContent,"RO SYN-001");
});

test("no verified manager-review date produces explicit empty state without modifying source rows",()=>{
  const rows=[{id:"unreviewed",ro:"SYN-002",management:{managerReviewedOn:"2026-02-30"}}];
  const original=JSON.stringify(rows),h=fixture(rows);
  h.ctx.render();
  assert.equal(h.list.children.length,1);
  assert.equal(h.list.children[0].textContent,"No reviewed current ROs.");
  assert.equal(JSON.stringify(rows),original);
});

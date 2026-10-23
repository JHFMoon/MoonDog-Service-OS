"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const text=(name)=>fs.readFileSync(path.join(root,name),"utf8");

test("Open RO narrow layout preserves all seven labeled columns, including source",()=>{
  const css=text("assets/worklist.css");
  assert.doesNotMatch(css,/ro-worklist th:nth-child\(4\),\.ro-worklist td:nth-child\(4\)\{display:none\}/);
  for(const [n,label] of [[1,"RO"],[2,"Advisor"],[3,"Customer / vehicle"],[4,"Source"],[5,"Management"],[6,"Next action / commitment"],[7,"Action"]]){
    assert.ok(css.includes('td:nth-child('+n+')::before{content:"'+label+'"}'),label+" lost");
  }
  assert.match(css,/\.focus-ro-detail strong,\.focus-ro-detail small\{\s*white-space:normal/);
});
test("advisor comparison keeps every labeled metric in the narrow reflow",()=>{
  const css=text("assets/performance.css"),html=text("index.html");
  assert.match(html,/<table class="performance-table">/);
  for(const label of ["Advisor","Total gross","Closed ROs","Gross / RO","CP hrs / RO","CP ELR","Labor margin","Parts margin","SAPR open / aged","Current tracker open"]){
    assert.ok(css.includes('::before{content:"'+label+'"}'),"missing metric label: "+label);
  }
  assert.match(css,/max-width:560px/);
  assert.match(css,/performance-table tbody tr\{grid-template-columns:minmax\(0,1fr\)/);
});
test("arrival cards preserve all six original fields at narrow widths",()=>{
  const css=text("assets/arrivals.css"),app=text("assets/app.js");
  for(const label of ["Time","Customer","Advisor","Vehicle","Concern"]){
    assert.ok(css.includes('::before{content:"'+label+'"}'),"missing arrival label: "+label);
  }
  assert.match(css,/arrival-row select\.arrival-state\{width:100%;max-width:100%\}/);
  assert.match(app,/row\.append\(time, person, advisor, vehicle, request, select\)/);
});
test("responsive design contract does not conceal overflowing page content",()=>{
  const css=text("assets/styles.css"),doc=text("docs/UX-STANDARD.md");
  assert.match(css,/min-width:0;max-width:100%/);
  assert.doesNotMatch(css.slice(css.lastIndexOf("Layout foundations:")),/overflow-x:hidden/);
  assert.match(doc,/find.*understand.*act/i);
  assert.match(doc,/320×568/);
  assert.match(doc,/1920×1080/);
});

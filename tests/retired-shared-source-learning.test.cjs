"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const app=fs.readFileSync(path.join(root,"assets/app.js"),"utf8");
const tools=fs.readFileSync(path.join(root,"assets/daily-ops.js"),"utf8");
const documentation=fs.readFileSync(path.join(root,"docs/SHARED_REPORT_SOURCE_LEARNING.md"),"utf8");

test("retired cross-store source-learning checkbox cannot reappear in Tools",()=>{
  const begin=tools.indexOf("  function renderTools(category='')");
  const end=tools.indexOf("  function ",begin+25);
  assert.ok(begin>=0&&end>begin,"Tools renderer found in installed runtime");
  const block=tools.slice(begin,end);
  assert.doesNotMatch(block,/Shared report-source learning|secure serverless endpoint|cross.store submission|participate when secure sharing/i);
  assert.doesNotMatch(tools,/api\.sharedSourceLearning|api\.setSharedSourceLearning/);
  assert.doesNotMatch(app,/sharedSourceLearning|setSharedSourceLearning/);
});

test("private Get it from instructions remain functional and confined to Workspace",()=>{
  assert.match(tools,/Get it from: /);
  assert.match(tools,/api\.saveSourceLocation\(key,location\)/);
  assert.match(app,/sourceLocations: \(\) => model\.settings\.future\?\.sourceLocations \|\| \{\}/);
  assert.match(app,/saveSourceLocation: async \(source,location\) =>/);
  assert.match(app,/future\.sourceLocations=\{\.\.\.\(future\.sourceLocations\|\|\{\}\),\[source\]:cleaned\}/);
});

test("retired design does not authorize a sharing endpoint or correction-learning database",()=>{
  assert.match(documentation,/explicitly retired/);
  assert.match(documentation,/No cross-store upload, submission, network endpoint/);
  assert.match(documentation,/Files To Learn remains a separate, local ingestion/);
  assert.match(documentation,/not a correction-learning database/);
  assert.doesNotMatch(documentation,/consent does \*\*not\*\* activate network requests|Before enabling outbound submission/);
});

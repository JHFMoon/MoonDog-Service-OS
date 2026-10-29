"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.resolve(__dirname,"..","assets","app.js"),"utf8");
const start = app.indexOf("  async function auditInstalledRuntimeLayout(root, catalog = HANDOFF_RUNTIME_PATHS) {");
const end = app.indexOf("  async function runVerifiedUpdateFollowup() {",start);
assert.ok(start >= 0 && end > start, "update-only layout audit is defined");
const audit = vm.runInNewContext("("+app.slice(start,end).trim()+")", {});
const missing = () => Object.assign(new Error("Not found"),{name:"NotFoundError"});
function fakeDir(files=[],dirs={}) {
  const exists=new Set(files), operations={reads:[],dirs:[],list:0,deleted:0};
  const folder={
    operations,
    async getFileHandle(name) {
      operations.reads.push(name);
      if (!exists.has(name)) throw missing();
      return {kind:"file",name};
    },
    async getDirectoryHandle(name) {
      operations.dirs.push(name);
      if (!Object.prototype.hasOwnProperty.call(dirs,name)) throw missing();
      return dirs[name];
    },
    async *entries() {
      operations.list++;
      for(const name of exists) yield [name,{kind:"file",name}];
      for(const name of Object.keys(dirs)) yield [name,{kind:"directory",name}];
    },
    async removeEntry() {operations.deleted++;throw new Error("Audit must never delete files");}
  };
  return folder;
}
function fixture(overrides={}) {
  const workspace=fakeDir(["private.json"]);
  workspace.entries=async function*(){throw new Error("Protected Workspace must never be enumerated");};
  const assets=fakeDir(overrides.assetFiles??["app.js"]);
  const vendor=fakeDir(overrides.vendorFiles??["pdf.min.js"]);
  const system=fakeDir(overrides.systemFiles??["index.html"],{assets,vendor,Workspace:workspace});
  const root=fakeDir(overrides.rootFiles??["00 - OPEN DASHBOARD.html","index.html"],{"System Files":system});
  return {root,system,assets,vendor,workspace};
}
const CATALOG=["index.html","assets/app.js","vendor/pdf.min.js"];

test("verified clean layout includes all catalog files and retains root compatibility index",async()=>{
  const {root,workspace}=fixture();
  const result=await audit(root,CATALOG);
  assert.equal(result.missing,0);
  assert.equal(result.scanned,3);
  assert.equal(result.compatibilityIndexPresent,true);
  assert.equal(result.needsReview,false);
  assert.equal(workspace.operations.list,0);
});

test("fresh clean install does not need a migrated root index",async()=>{
  const {root}=fixture({rootFiles:["00 - OPEN DASHBOARD.html"]});
  const result=await audit(root,CATALOG);
  assert.equal(result.needsReview,false);
  assert.equal(result.compatibilityIndexPresent,false);
});

test("unexpected runtime files and misplaced operational exports are review-only",async()=>{
  const {root,system,assets,vendor,workspace}=fixture({
    rootFiles:["00 - OPEN DASHBOARD.html","index.html","accidental.csv"],
    systemFiles:["index.html","outside.xlsx"],
    vendorFiles:["pdf.min.js","obsolete.js"]
  });
  const result=await audit(root,CATALOG);
  assert.equal(result.missing,0);
  assert.equal(result.misplacedReports,2);
  assert.equal(result.unexpectedRuntime,1);
  assert.equal(result.needsReview,true);
  for(const dir of [root,system,assets,vendor,workspace]) assert.equal(dir.operations.deleted,0);
  assert.equal(workspace.operations.list,0);
});

test("missing required runtime files and launcher block verified follow-up without deletion",async()=>{
  const {root,assets}=fixture({assetFiles:[],rootFiles:["index.html"]});
  const result=await audit(root,CATALOG);
  assert.ok(result.missing>=2);
  assert.equal(result.needsReview,true);
  assert.equal(assets.operations.deleted,0);
});

test("permission denial is not treated as harmless missing file",async()=>{
  const {root,assets}=fixture();
  assets.getFileHandle=async()=>{
    throw Object.assign(new Error("OneDrive permission not granted"),{name:"NotAllowedError"});
  };
  await assert.rejects(audit(root,CATALOG),/permission not granted/);
});

test("runtime inventory rejects traversal or Workspace inspection targets",async()=>{
  const {root}=fixture();
  await assert.rejects(audit(root,["assets/../Workspace/private.json"]),/invalid path/);
  await assert.rejects(audit(root,["Workspace/private.json"]),/invalid path/);
});

test("heavy audit is tied to a verified installed-version receipt, not every startup",()=>{
  const followup=app.slice(app.indexOf("  async function runVerifiedUpdateFollowup() {"),app.indexOf("\n  const folderWatch=",app.indexOf("  async function runVerifiedUpdateFollowup() {")));
  assert.match(followup,/receipt\?\.version!==VERSION/);
  assert.match(followup,/if\(layout\.needsReview\)/);
  assert.match(followup,/localStorage\.removeItem\(key\)/);
  assert.match(followup,/parserRevisionChanged=previousParser\?previousParser!==LEARNED_PARSER_REVISION:legacyImportState/);
  assert.match(followup,/reconcileLearnedFiles\(LEARNED_PARSER_REVISION\)/);
  assert.match(app,/return \{failures,attempts,recovered,unsupported,skipped\}/);
});

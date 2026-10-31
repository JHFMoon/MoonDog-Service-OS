"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");
const packageWorkflow=read(".github/workflows/prepare-beta-package.yml");
const mergeWorkflow=read(".github/workflows/guarded-pr-merge.yml");

test("trusted Beta packaging never requests an external Codex review",()=>{
  assert.doesNotMatch(packageWorkflow, /@codex\s+review/i);
  assert.match(packageWorkflow,/Push package commit to the same reviewed PR/);
  assert.match(packageWorkflow,/APP_TOKEN/);
  assert.match(packageWorkflow,/HEAD_BRANCH/);
  assert.match(packageWorkflow,/exact-head owner review and both CI gates are still required/);
});

test("protected merger never requests an external Codex review",()=>{
  assert.doesNotMatch(mergeWorkflow, /@codex\s+review/i);
  assert.doesNotMatch(mergeWorkflow,/REVIEW_REQUESTED=/);
  assert.match(mergeWorkflow,/merge-review-state/);
  assert.match(mergeWorkflow,/\[ "\$REVIEW_STATE" = "findings" \]/);
  assert.match(mergeWorkflow,/\[ "\$REVIEW_STATE" = "clean" \]/);
  assert.match(mergeWorkflow,/Final guarded merge refused: exact-head review is missing, stale, or has findings/);
});

test("normal guarded release still enforces exact-head checks and protected GitHub merge",()=>{
  assert.match(mergeWorkflow,/Latest exact-head Publication Check or Clean Install Proof failed/);
  assert.match(mergeWorkflow,/Verify Beta package matches the exact PR runtime/);
  assert.match(mergeWorkflow,/Refuse Stable manifest changes/);
  assert.match(mergeWorkflow,/scripts\/pipeline_guard.py check-paths/);
  assert.match(mergeWorkflow,/merge_method=squash/);
});

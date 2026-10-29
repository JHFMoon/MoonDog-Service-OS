"use strict";

const assert=require("node:assert/strict");
const {test}=require("node:test");

test("synthetic UX retry is bounded to one retry and never retries success",async()=>{
  const {MAX_UX_SAMPLE_ATTEMPTS,shouldRetryUxSample}=await import("../scripts/bounded-ux-retry.mjs");
  assert.equal(MAX_UX_SAMPLE_ATTEMPTS,2);
  assert.equal(shouldRetryUxSample(true,1),true);
  assert.equal(shouldRetryUxSample(true,2),false);
  assert.equal(shouldRetryUxSample(false,1),false);
  assert.equal(shouldRetryUxSample(true,0),false);
  assert.equal(shouldRetryUxSample(true,1.5),false);
});

test("UX retry diagnostics redact paths and credential-shaped values",async()=>{
  const {sanitizeUxFailureReason}=await import("../scripts/bounded-ux-retry.mjs");
  const reason=sanitizeUxFailureReason(new Error("failed at /home/runner/private.xlsx token=synthetic-secret"));
  assert.equal(reason.includes("/home/runner/private.xlsx"),false);
  assert.equal(reason.includes("synthetic-secret"),false);
  assert.match(reason,/\[path\]/);
  assert.match(reason,/token=\[redacted\]/i);
  assert.ok(reason.length<=240);
});

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

test("UX retry diagnostics redact paths, auth schemes, JSON secrets, and quoted values",async()=>{
  const {sanitizeUxFailureReason}=await import("../scripts/bounded-ux-retry.mjs");
  const reason=sanitizeUxFailureReason(new Error(
    'failed at /home/runner/private.xlsx Authorization: Bearer bearer-secret {"token":"json-secret","password":"two word secret"}'));
  for(const secret of ["/home/runner/private.xlsx","bearer-secret","json-secret","two word secret"])
    assert.equal(reason.includes(secret),false);
  assert.match(reason,/\[redacted-path\]/);
  assert.match(reason,/authorization=\[redacted\]/i);
  assert.match(reason,/"token"=\[redacted\]/);
  assert.match(reason,/"password"=\[redacted\]/);
  assert.ok(reason.length<=240);
  for(const sample of [
    'error: "/home/runner/Private Customer/report.xlsx"',
    "failed to read /srv/private/customer.xlsx",
    'opened "file:///C:/Synthetic Workspace/Report.xlsx"'
  ]){
    const sanitized=sanitizeUxFailureReason(sample);
    assert.equal(sanitized.includes("Private Customer"),false);
    assert.equal(sanitized.includes("/srv/private"),false);
    assert.equal(sanitized.includes("Synthetic Workspace"),false);
    assert.equal(/file:\/\//i.test(sanitized),false);
  }
});

"use strict";
// Regression gate for the classifier used by Files To Learn.
// A change to its recognition rules must also update LEARNED_PARSER_REVISION
// and the reviewed baseline below. Do not change only the signature to silence
// a failure; doing so can strand unsupported source files in the old memo.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const beginning = app.indexOf("  async function classifyImportFile(");
const ending = app.indexOf("  async function moveToLearn(", beginning);
assert.ok(beginning >= 0 && ending > beginning, "Trusted source recognition boundaries changed; review epoch gate");
const classifier = app.slice(beginning, ending).replace(/\r\n/g, "\n");
const revision = app.match(/const LEARNED_PARSER_REVISION = "([^"]+)";/)?.[1] || "";

function fingerprint(source) {
  // FNV-1a source fingerprint is a drift detector, not a cryptographic trust check.
  let value = 2166136261;
  for (let i = 0; i < source.length; i++) {
    value ^= source.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

const reviewed = Object.freeze({
  revision: "strict-report-recognition-2026-10-12",
  classifierFingerprint: "1e601352"
});

test("classification edits require reviewed epoch + fingerprint updates together", () => {
  const currentFingerprint = fingerprint(classifier);
  const classifierChanged = currentFingerprint !== reviewed.classifierFingerprint;
  const revisionChanged = revision !== reviewed.revision;
  assert.equal(classifierChanged, revisionChanged,
    "Files To Learn classifier changed without LEARNED_PARSER_REVISION update (or revision advanced with unchanged classifier). Review the source-recognition changes, update the revision and this baseline together, then verify durable file retry tests.");
  assert.ok(revision.length > 8);
});

test("source drift fingerprint notices changed recognition ordering", () => {
  assert.notEqual(fingerprint(classifier + " // synthetic classification rule change"), fingerprint(classifier));
});

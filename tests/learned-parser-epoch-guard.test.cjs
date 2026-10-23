"use strict";
// The Files To Learn memo caches unsupported signatures by parser epoch.
// The PR-to-base check below covers delegated production recognizers, not just
// classifyImportFile's dispatch code, so parser rule changes require a bump.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const beginning = app.indexOf("  async function classifyImportFile(");
const ending = app.indexOf("  async function moveToLearn(", beginning);
assert.ok(beginning >= 0 && ending > beginning, "Trusted classifier boundaries changed; review epoch gate");
const classifier = app.slice(beginning, ending).replace(/\r\n/g, "\n");
const revisionOf = source => source.match(/const LEARNED_PARSER_REVISION = "([^"]+)";/)?.[1] || "";
const revision = revisionOf(app);

function fingerprint(source) {
  // FNV-1a is a drift detector, not a cryptographic trust check.
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

// These are the production parsers/detectors called by the trusted classifier.
// Include the actual recognition code: its dispatch text can remain unchanged
// while a previously unsupported file becomes newly recognizable.
const watched = Object.freeze([
  "classifyImportFile",
  "parseNextAppointmentsCsv",
  "parseAppointmentsCreatedSummaryCsv",
  "parseVirCsv",
  "parseCsiRows",
  "parseCsiCsv",
  "parseCsiWorkbook",
  "parseCdkRepairOrdersDocx",
  "cdkRepairOrdersLayout",
  "parseSorWorkbook",
  "parsePerformanceWorkbook",
  "parseMenuSalesWorkbook",
  "parseOpenRoSummaryWorkbook",
  "parseMediaAsrWorkbook",
  "parseSupplementalWorkbook",
  "parseEfficiencyWorkbook",
  "parseAppointmentActivityWorkbook",
  "parseSupplementalDocxReport",
  "legacyReport",
  "findTable",
  "parseCsv",
  "workbookGrid",
  "pdfSignatureText",
  "docxText",
  "isMoonDogGreeterOutput",
  "isAppointmentPdf",
  "supplementalPdfFamily",
  "referenceOnlyDocumentType",
  "workbookIsHandoff",
  "workbookHasReturnIdentity",
  "workbookHasReturnSchema"
]);

function recognitionSection(source, name) {
  if (name === "classifyImportFile") {
    const start = source.indexOf("  async function classifyImportFile(");
    const end = source.indexOf("  async function moveToLearn(", start);
    return start >= 0 && end > start ? source.slice(start, end).replace(/\r\n/g, "\n") : "";
  }
  const normal = "\n  function " + name + "(";
  const asynchronous = "\n  async function " + name + "(";
  const marker = source.includes(normal) ? normal : asynchronous;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const remainder = source.slice(start + marker.length);
  const next = /\n  (?:async )?function [A-Za-z_$][\w$]*\(/.exec(remainder);
  return source.slice(start, next ? start + marker.length + next.index : source.length).replace(/\r\n/g, "\n");
}

function changedRecognizers(previous, current) {
  return watched.filter(name => recognitionSection(previous, name) !== recognitionSection(current, name));
}

test("top-level classifier source drift cannot silently reuse its parser epoch", () => {
  const classifierChanged = fingerprint(classifier) !== reviewed.classifierFingerprint;
  if (classifierChanged)
    assert.notEqual(revision, reviewed.revision,
      "Files To Learn classifier changed without a parser epoch bump; review and update the baseline.");
  assert.ok(revision.length > 8);
});

test("all watched delegated recognizers exist in the actual shipped source", () => {
  for (const name of watched)
    assert.ok(recognitionSection(app, name).length >= 20, "Missing or relocated recognizer " + name + "; review the epoch gate");
});

test("source drift detection recognizes synthetic dispatcher and delegated parser changes", () => {
  assert.notEqual(fingerprint(classifier + " // synthetic classification change"), fingerprint(classifier));
  const marker = "  function parseVirCsv(source, fileName) {";
  assert.ok(app.includes(marker));
  const changed = app.replace(marker, marker + " /* synthetic recognition rule update */");
  assert.ok(changedRecognizers(app, changed).includes("parseVirCsv"));
  assert.deepEqual(changedRecognizers(app, app), []);
});

// Protected Publication Check supplies the immutable pull-request base SHA.
// Comparing production code to Git history means changing this test's pinned
// baseline alone cannot hide a parser edit made without an epoch bump.
test("PR-to-base delegated recognition edits require LEARNED_PARSER_REVISION bump", () => {
  const base = (process.env.LEARNED_PARSER_BASE_SHA || "").trim();
  if (!base) {
    assert.notEqual(process.env.GITHUB_EVENT_NAME, "pull_request",
      "Missing immutable pull-request base SHA; delegated parser epoch verification must fail closed");
    return; // Local or push builds retain baseline and synthetic tests.
  }
  assert.match(base, /^[a-f0-9]{40}$/i, "Only a reviewed commit SHA may be used as base");
  const previous = execFileSync("git", ["show", base + ":assets/app.js"],
    { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const changed = changedRecognizers(previous, app);
  if (changed.length)
    assert.notEqual(revision, revisionOf(previous),
      "Production Files To Learn recognition changed without a parser epoch bump: " + changed.join(", "));
});

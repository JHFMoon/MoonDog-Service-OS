"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const start = app.indexOf("  // Large XLSX sources are parsed in a self-contained worker");
const end = app.indexOf("  // Privacy-safe performance evidence:", start);
assert.ok(start >= 0 && end > start, "Production XLSX worker helper block must exist");
const helper = app.slice(start, end);

function harness({ failWorker = false } = {}) {
  const workerCalls = [];
  const nativeCalls = [];
  class FakeBlob { constructor(parts) { this.parts = parts; } }
  class FakeWorker {
    postMessage(message, transfer) {
      workerCalls.push({ message, transfer });
      queueMicrotask(() => this.onmessage({
        data: failWorker
          ? { id: message.id, ok: false, error: "synthetic worker failure" }
          : { id: message.id, ok: true, book: { profile: message.options, marker: "worker" } }
      }));
    }
    terminate() { this.terminated = true; }
  }
  const XLSX = {
    version: "0.20.3",
    read(bytes, options) {
      nativeCalls.push({ bytes, options });
      return { marker: "native", profile: options };
    }
  };
  const context = vm.createContext({
    XLSX, Worker: FakeWorker, Blob: FakeBlob, TextDecoder, TextEncoder,
    URL: { createObjectURL() { return "blob:synthetic"; }, revokeObjectURL() {} },
    runtimeFileBytes: async () => { const source = new Uint8Array(300000); source.set(new TextEncoder().encode("XLSX.version")); return source; },
    clearTimeout, setTimeout, ArrayBuffer, Uint8Array, WeakMap, Map, TypeError, Error, console
  });
  // Expose the production wrapper so extracted importer harnesses keep the existing XLSX.read interface.
  vm.runInContext(helper + "\nthis.prepareXlsxWorkbook=prepareXlsxWorkbook; this.xlsxRead=XLSX.read;", context);
  return { context, workerCalls, nativeCalls };
}

test("production worker preserves parser option profiles and reuses only equivalent profiles", async () => {
  const h = harness();
  const bytes = new Uint8Array(512 * 1024);
  bytes[0] = 7; bytes[bytes.length - 1] = 9;
  const original = bytes.slice();
  const menuOptions = { type: "array", raw: true, cellDates: true };
  const csiOptions = { type: "array", cellDates: true };

  const menuBook = await h.context.prepareXlsxWorkbook(bytes, menuOptions);
  assert.deepEqual(menuBook.profile, menuOptions);
  assert.equal(menuBook.marker, "worker");
  assert.equal(h.workerCalls.length, 1);
  assert.deepEqual(h.workerCalls[0].message.options, menuOptions);
  assert.equal(h.workerCalls[0].message.bytes.byteLength, bytes.byteLength);
  assert.notEqual(h.workerCalls[0].message.bytes, bytes.buffer, "The source ArrayBuffer is copied before transfer.");
  assert.deepEqual(bytes, original, "The source workbook bytes remain unchanged.");
  assert.equal(h.context.xlsxRead(bytes, menuOptions), menuBook, "The exact parser profile reuses its worker result.");
  const reordered = { cellDates: true, raw: true, type: "array" };
  assert.equal(h.context.xlsxRead(bytes, reordered), menuBook, "Equivalent options are keyed independent of property order.");

  const csiBook = await h.context.prepareXlsxWorkbook(bytes, csiOptions);
  assert.deepEqual(csiBook.profile, csiOptions);
  assert.equal(h.workerCalls.length, 2, "A different parser profile must receive its own parse.");
  assert.equal(h.nativeCalls.length, 0);
});

test("production worker failure falls back synchronously and caches only the fallback profile", async () => {
  const h = harness({ failWorker: true });
  const bytes = new Uint8Array(512 * 1024);
  bytes[1] = 4;
  const options = { type: "array", raw: true };
  const book = await h.context.prepareXlsxWorkbook(bytes, options);

  assert.equal(book.marker, "native");
  assert.deepEqual(h.nativeCalls[0].options, options);
  assert.equal(h.nativeCalls.length, 1);
  assert.equal(h.context.xlsxRead(bytes, options), book);
  assert.equal(h.nativeCalls.length, 1);
  assert.equal(bytes[1], 4, "Worker failure must not detach or mutate the original input.");
});

test("classification prepares each parser profile before invoking its synchronous parser", () => {
  const section = app.slice(app.indexOf("async function classifyImportFile"), app.indexOf("async function moveToLearn"));
  for (const profile of [
    'type: "array", cellDates: true',
    'type: "array", raw: true, cellDates: true',
    'type: "array", raw: true',
    'type: "array", raw: true, cellDates: true, cellNF: true'
  ]) assert.ok(section.includes(profile), "Classification retains parser profile: " + profile);
  assert.ok(app.includes('typeof prepareXlsxWorkbook === "function"'), "Large workbooks are prepared when the worker helper is available.");
  assert.ok(app.includes('workbookGrid(bytes).rows'), "Classification still inspects the workbook grid.");
});

test("classification and import retain one byte snapshot through workbook parsing", () => {
  assert.ok(app.includes('book = typeof prepareXlsxWorkbook === "function" ? await prepareXlsxWorkbook(bytes, { type: "array", cellDates: true, cellFormula: true }) : XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: true })'));
  for (const importer of ["importPerformanceFile", "importMenuSalesFile", "importCsiFile", "importAppointmentFile", "importSource"])
    assert.ok(app.includes(importer + "(candidate.name, deleteAfterSuccess, bytes)"));
  assert.ok(app.includes("changed while it was being checked and was left in place"));
  assert.ok(app.includes('const expectedXlsx = xlsxSourceDeleteGuards.get(name)'));
  assert.ok(app.includes('if (guardXlsxDelete) xlsxSourceDeleteGuards.set(candidate.name, bytes)'));
});


test("source deletion rechecks exact bytes and retains a changed XLSX", async () => {
  const sameStart = app.indexOf("  function sameByteContent(left, right)");
  const sameEnd = app.indexOf("  function stopXlsxWorker", sameStart);
  const removeStart = app.indexOf("  async function removeSourceEntry(name) {");
  const removeEnd = app.indexOf("  async function finishReadOnlyConnection", removeStart);
  assert.ok(sameStart >= 0 && sameEnd > sameStart && removeStart >= 0 && removeEnd > removeStart);
  const sameBytes = app.slice(sameStart, sameEnd);
  const removeSource = app.slice(removeStart, removeEnd);

  async function run(current) {
    const removed = [];
    const expected = new Uint8Array([11, 22, 33]);
    const context = vm.createContext({
      dailyPickedSources: new Set(),
      xlsxSourceDeleteGuards: new Map([["synthetic.xlsx", expected]]),
      sourceLocations: new Map([["synthetic.xlsx", "root"]]),
      sourceFileHandle: async () => ({ getFile: async () => ({ arrayBuffer: async () => current.buffer.slice(0) }) }),
      model: { root: { removeEntry: async name => { removed.push(name); } } },
      sameByteContent: null, ArrayBuffer, Uint8Array, Error
    });
    vm.runInContext(sameBytes + "\n" + removeSource + "\nthis.removeSourceEntry=removeSourceEntry;", context);
    return { context, removed };
  }

  const changed = await run(new Uint8Array([11, 22, 34]));
  await assert.rejects(changed.context.removeSourceEntry("synthetic.xlsx"), /changed while it was being checked/);
  assert.deepEqual(changed.removed, [], "Changed source bytes must never be deleted.");

  const unchanged = await run(new Uint8Array([11, 22, 33]));
  await unchanged.context.removeSourceEntry("synthetic.xlsx");
  assert.deepEqual(unchanged.removed, ["synthetic.xlsx"], "An unchanged source still follows the existing delete-after-success path.");
});

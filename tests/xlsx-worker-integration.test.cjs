"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "assets", "app.js"), "utf8");
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
  vm.runInContext(helper + "\nthis.prepareXlsxWorkbook=prepareXlsxWorkbook; this.readWorkbook=readWorkbook;", context);
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
  assert.equal(h.context.readWorkbook(bytes, menuOptions), menuBook, "The exact parser profile reuses its worker result.");
  const reordered = { cellDates: true, raw: true, type: "array" };
  assert.equal(h.context.readWorkbook(bytes, reordered), menuBook, "Equivalent options are keyed independent of property order.");

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
  assert.equal(h.context.readWorkbook(bytes, options), book);
  assert.equal(h.nativeCalls.length, 1);
  assert.equal(bytes[1], 4, "Worker failure must not detach or mutate the original input.");
});

test("classification prepares each parser profile before invoking its synchronous parser", () => {
  const expected = [
    /await prepareXlsxWorkbook\(bytes, \{ type: "array", cellDates: true \}\); parseCsiWorkbook/,
    /await prepareXlsxWorkbook\(bytes, \{ type: "array", raw: true, cellDates: true \}\); parseMenuSalesWorkbook/,
    /await prepareXlsxWorkbook\(bytes, \{ type: "array", raw: true \}\); parsePerformanceWorkbook/,
    /await prepareXlsxWorkbook\(bytes, \{ type: "array", raw: true, cellDates: true, cellNF: true \}\); parseEfficiencyWorkbook/,
    /await prepareXlsxWorkbook\(bytes, \{ type: "array", raw: true, cellDates: true, cellNF: true \}\); return parseMediaAsrWorkbook/
  ];
  for (const pattern of expected) assert.match(app, pattern);
  assert.match(app, /if \(!isPdf\) await prepareXlsxWorkbook\(bytes,\{type:"array",raw:true,cellDates:true\}\); const date=.*workbookGrid\(bytes\)\.rows/);
});

test("classification and import retain one byte snapshot through workbook parsing", () => {
  assert.match(app, /book = await prepareXlsxWorkbook\(bytes, \{ type: "array", cellDates: true, cellFormula: true \}\)/);
  assert.match(app, /importPerformanceFile\(candidate\.name, deleteAfterSuccess, bytes\)/);
  assert.match(app, /importMenuSalesFile\(candidate\.name, deleteAfterSuccess, bytes\)/);
  assert.match(app, /importCsiFile\(candidate\.name, deleteAfterSuccess, bytes\)/);
  assert.match(app, /importAppointmentFile\(candidate\.name, deleteAfterSuccess, bytes\)/);
  assert.match(app, /importSource\(candidate\.name, deleteAfterSuccess, bytes\)/);
  assert.match(app, /changed after classification and was left in place/);
});



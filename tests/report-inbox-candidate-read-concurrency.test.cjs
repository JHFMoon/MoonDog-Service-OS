"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
function extract(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `production source contains ${startMarker}`);
  return app.slice(start, end);
}
const productionHelpers = [
  extract("function watchedInboxFile(name)", "function returnedWorkbookCandidate(name)"),
  extract("function returnedWorkbookCandidate(name)", "async function folderWatchScan("),
  extract("async function watchCandidates(){", "function candidateNeedsImport(candidate)")
].join("\n");

function entries(items) {
  return { async *entries() { for (const item of items) yield item; } };
}
function handle(file, options = {}) {
  return {
    kind: "file",
    async getFile() {
      options.onStart?.();
      try {
        await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 5));
        if (options.error) throw options.error;
        return file;
      } finally {
        options.onFinish?.();
      }
    }
  };
}
function runWatch(inboxItems, rootItems, metrics) {
  const context = vm.createContext({
    REPORT_INBOX: "01 - DROP REPORTS HERE",
    model: { root: entries(rootItems) },
    reportInbox: async () => entries(inboxItems)
  });
  vm.runInContext(`${productionHelpers}\nthis.runWatch = watchCandidates;`, context);
  return context.runWatch().then(result => ({ result, metrics }));
}

test("production inbox scan overlaps only two metadata reads and retains deterministic order", async () => {
  const metrics = { active: 0, maxActive: 0 };
  const start = () => { metrics.active++; metrics.maxActive = Math.max(metrics.maxActive, metrics.active); };
  const finish = () => { metrics.active--; };
  const file = (name, size, lastModified) => ({ name, size, lastModified });
  const inbox = [
    ["a.xlsx", handle(file("a", 10, 1), { onStart: start, onFinish: finish })],
    ["b.txt", handle(file("b", 20, 2), { onStart: start, onFinish: finish })],
    ["c.xlsx", handle(file("c", 30, 3), { onStart: start, onFinish: finish })]
  ];
  const root = [
    ["a.xlsx", handle(file("duplicate", 1, 1), { onStart: start, onFinish: finish })],
    ["MoonDog advisor.xlsx", handle(file("d", 40, 4), { onStart: start, onFinish: finish })],
    ["~$MoonDog temp.xlsx", handle(file("temp", 2, 2), { onStart: start, onFinish: finish })],
    ["unrelated.txt", handle(file("ignored", 3, 3), { onStart: start, onFinish: finish })]
  ];

  const { result } = await runWatch(inbox, root, metrics);
  assert.equal(metrics.maxActive, 2, "the OneDrive read window stays bounded and removes serial-only waiting");
  assert.equal(metrics.active, 0);
  assert.deepEqual(result.map(item => item.name), ["a.xlsx", "b.txt", "c.xlsx", "MoonDog advisor.xlsx"]);
  assert.deepEqual(result.map(item => item.location), ["inbox", "inbox", "inbox", "root"]);
  assert.deepEqual(result.map(item => item.signature), [
    "01 - DROP REPORTS HERE/a.xlsx|10|1",
    "01 - DROP REPORTS HERE/b.txt|20|2",
    "01 - DROP REPORTS HERE/c.xlsx|30|3",
    "MoonDog advisor.xlsx|40|4"
  ]);
});

test("production inbox scan retains failed reads for diagnostics without dropping other candidates", async () => {
  const failure = Object.assign(new Error("OneDrive transient read"), { name: "NotReadableError" });
  const metrics = { active: 0, maxActive: 0 };
  const { result } = await runWatch([
    ["good.xlsx", handle({ size: 7, lastModified: 8 })],
    ["retry.xlsx", handle(null, { error: failure })]
  ], [], metrics);

  assert.equal(result.length, 2);
  assert.equal(result[0].signature, "01 - DROP REPORTS HERE/good.xlsx|7|8");
  assert.equal(result[1].name, "retry.xlsx");
  assert.equal(result[1].readError, failure);
  assert.equal("signature" in result[1], false);
});

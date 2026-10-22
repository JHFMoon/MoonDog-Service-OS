"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const path=require("node:path");

test("full-history cache retains a stable heap across repeated warm searches",()=>{
  const helper=path.join(__dirname,"history-cache-retained-heap-probe.cjs");
  const output=execFileSync(process.execPath,["--expose-gc",helper],{encoding:"utf8",timeout:30000});
  const result=JSON.parse(output.trim());
  assert.equal(result.syntheticFiles,2104);
  assert.equal(result.warmSearches,500);
  assert.equal(result.fileReads,2104,"warm searches must not reread cached history payloads");
  assert.equal(result.cacheSize,2104);
  assert.equal(result.snapshotReused,true,"warm searches must retain the same materialized full-history snapshot");
  assert.ok(result.heapSamples.every(Number.isSafeInteger));
  assert.ok(result.retainedHeapDeltaBytes<1024*1024,
    `repeated warm searches retained ${result.retainedHeapDeltaBytes} bytes after full GC; expected less than 1 MiB of per-session growth`);
  assert.ok(result.maxRetainedGrowthBytes<1024*1024,
    `intermediate full-GC samples grew by ${result.maxRetainedGrowthBytes} bytes; expected less than 1 MiB`);
  console.log("# retained-history-heap "+JSON.stringify(result));
});


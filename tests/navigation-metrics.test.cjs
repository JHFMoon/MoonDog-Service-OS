"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

test("synthetic navigation percentiles use deterministic nearest ranks",async()=>{
  const {summarizeNavigationMs}=await import("../scripts/navigation-metrics.mjs");
  const samples=Array.from({length:20},(_,i)=>20-i);
  assert.deepEqual({...summarizeNavigationMs(samples)},{count:20,p50:10,p95:19,max:20});
  assert.deepEqual({...summarizeNavigationMs([4])},{count:1,p50:4,p95:4,max:4});
  assert.equal(summarizeNavigationMs(samples).count,20);
  assert.deepEqual(samples,[...Array.from({length:20},(_,i)=>20-i)],"input must not be mutated");
});

test("synthetic navigation metrics reject invalid values instead of inventing zeroes",async()=>{
  const {summarizeNavigationMs}=await import("../scripts/navigation-metrics.mjs");
  for(const sample of [[],[NaN],[Infinity],[-1],"4",null])
    assert.throws(()=>summarizeNavigationMs(sample),TypeError);
});

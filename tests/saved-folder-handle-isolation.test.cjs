"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const start=source.indexOf("  const DB_NAME =");
const stop=source.indexOf("  const STATE_PATH =",start);
assert.ok(start>=0&&stop>start,"saved handle identity must be present in production app");

function savedKey(pathname,search="",protocol="file:"){
  const sandbox={location:{protocol,pathname,search},URLSearchParams};
  vm.runInNewContext(source.slice(start,stop)+"\nglobalThis.testKey=HANDLE_KEY;",sandbox);
  return sandbox.testKey;
}
test("separate file launchers sharing a browser profile never use the same saved-folder handle key",()=>{
  const a=savedKey("/C:/MoonDog/Synthetic-A/Service%20Operations%20Dashboard/System%20Files/index.html");
  const b=savedKey("/C:/MoonDog/Synthetic-B/Service%20Operations%20Dashboard/System%20Files/index.html");
  assert.notEqual(a,b);
  assert.match(a,/^working-folder:/);
  assert.match(b,/^working-folder:/);
  assert.notEqual(a,"working-folder");
  assert.notEqual(b,"working-folder");
});
test("query flags cannot silently switch which saved folder belongs to a launcher",()=>{
  const pathname="/C:/MoonDog/Synthetic-A/Service%20Operations%20Dashboard/System%20Files/index.html";
  assert.equal(savedKey(pathname),savedKey(pathname,"?moondog-new-store=1"));
});
test("non-file harness retains its legacy key until separately supported",()=>{
  assert.equal(savedKey("/dashboard","", "https:"),"working-folder");
});

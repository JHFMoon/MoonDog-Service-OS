const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

for(const relative of ["assets/app.js","assets/daily-ops.js"]){
  const source=fs.readFileSync(path.join(__dirname,"..",relative),"utf8");
  assert.doesNotThrow(()=>new Function(source),relative+" must parse as JavaScript");
}
console.log("PASS browser JavaScript syntax");

const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs');const source=fs.readFileSync('src/work-order-interpreter.js','utf8');const c={};vm.runInNewContext(source,c);const parse=c.MoonDogStoryInterpreter.analyze;
const a=parse('RO 123456 Tech found worn brakes. Waiting for authorization.');assert.equal(a.status.value,'Pending Authorization');assert.equal(a.roNumbers[0],'123456');
const b=parse('RO 123456 Waiting for parts. Parts arrived. Tech completed repair.');assert.equal(b.blocker,null);
const d=parse('RO 123456 RO 654321 Tech inspected vehicle.');assert.equal(d.roNumbers.length,2);
const r=fs.readFileSync('assets/daily-ops.js','utf8');assert.ok(r.includes('function renderPasteWorkOrder'));assert.ok(r.includes('api.openEdit(record.id)'));
console.log('PASS local story interpreter safety basics');
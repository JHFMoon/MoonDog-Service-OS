"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");

test("canonical source preserves already-vetted Beta manager pulse and accessible styles",()=>{
  const daily=read("assets/daily-ops.css"),styles=read("assets/styles.css");
  assert.match(daily,/\.manager-control-pulse-grid/);
  assert.match(daily,/\.manager-pulse-card\.urgent/);
  assert.match(daily,/\[data-theme="dark"\]/);
  assert.match(styles,/:focus-visible/);
  assert.match(styles,/prefers-reduced-motion/);
});

test("canonical source carries Beta follow-up filters while retaining manager-only schedule",()=>{
  const html=read("index.html");
  for(const option of ["long-2","long-5","needs-update","comeback"]){
    assert.match(html,new RegExp('<option value="'+option+'">'));
  }
  assert.match(html,/Configured ROs per advisor/);
  assert.match(html,/id="managerWorkScheduleSettings"/);
  assert.match(html,/id="managerWorkStart"/);
  assert.match(html,/id="managerWorkEnd"/);
});

test("application updates still require explicit folder permission and verified rollback, not operational editing designation",()=>{
  const src=read("assets/moondog-update-install.js");
  assert.match(src,/await permission\(app\)/);
  assert.match(src,/verified package hashes/);
  assert.match(src,/rollback backup/);
  assert.match(src,/read-back verification/);
  assert.doesNotMatch(src,/Editing authority is required before installing an update/);
  assert.doesNotMatch(src,/Editing authority is required before recovering an update/);
  assert.match(src,/status: "confirmation-required"/);
  assert.match(src,/status: "recovery-required"/);
});


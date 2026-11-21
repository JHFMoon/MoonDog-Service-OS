'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../src/pwa/browser_workspace_enrollment.mjs');
const profile=()=>({name:'SYNTHETIC Operational Motors',code:'test-0001',brand:'',timeZone:'America/Los_Angeles'});
const at='2026-11-21T12:00:00.000Z';
async function enrolled(){const {createOperationalEnrollment}=await api;return createOperationalEnrollment({store:profile(),confirmed:true,confirmedAt:at});}
test('operational enrollment requires explicit confirmation and preserves canonical local configuration',async()=>{
 const {createOperationalEnrollment,inspectBrowserWorkspaceEnrollment}=await api;
 assert.throws(()=>createOperationalEnrollment({store:profile()}),/Explicit dealership/);
 const input=profile(),value=createOperationalEnrollment({store:input,confirmed:true,confirmedAt:at});
 assert.equal(value.store.code,'TEST-0001');assert.equal(input.code,'test-0001');assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.store));
 const checked=inspectBrowserWorkspaceEnrollment({label:input.name,enrollment:value});
 assert.equal(checked.mode,'operational');assert.equal(checked.store.code,'TEST-0001');assert.equal(checked.confirmedAt,at);
});
test('ordinary labels and a forged mode field cannot silently adopt an operational store',async()=>{
 const {inspectBrowserWorkspaceEnrollment}=await api;
 assert.throws(()=>inspectBrowserWorkspaceEnrollment({label:'Unenrolled store',mode:'operational'}),/explicit dealership enrollment/);
 assert.equal(inspectBrowserWorkspaceEnrollment({label:'SYNTHETIC Legacy Motors'}).mode,'synthetic');
 assert.throws(()=>inspectBrowserWorkspaceEnrollment({label:'SYNTHETIC Legacy Motors',enrollment:null}),/invalid or unsupported/);
});
test('enrollment validation refuses ambiguous identities, unknown formats and extra authority fields',async()=>{
 const {inspectBrowserWorkspaceEnrollment}=await api;const value=await enrolled();
 for(const edit of [v=>{v.mode='synthetic';},v=>{v.formatVersion=2;},v=>{v.admin=true;},v=>{v.store.code='test-0001';},v=>{v.store.approved=true;},v=>{v.confirmedAt='2026-02-30T12:00:00.000Z';}]){
  const changed=structuredClone(value);edit(changed);
  assert.throws(()=>inspectBrowserWorkspaceEnrollment({label:value.store.name,enrollment:changed}));
 }
 assert.throws(()=>inspectBrowserWorkspaceEnrollment({label:'SYNTHETIC Different Motors',enrollment:value}),/does not match/);
});
test('enrollment rejects missing, unsafe or invalid configuration without supplying invented dealership values',async()=>{
 const {createOperationalEnrollment}=await api;
 for(const change of [{name:''},{name:'<script>synthetic</script>'},{code:'../other'},{code:9001},{timeZone:'Unknown/Zone'},{timeZone:''}])
  assert.throws(()=>createOperationalEnrollment({store:{...profile(),...change},confirmed:true,confirmedAt:at}));
 const value=createOperationalEnrollment({store:{...profile(),code:'0001'},confirmed:true,confirmedAt:at});
 assert.equal(value.store.code,'0001');assert.equal(value.store.brand,'');
});

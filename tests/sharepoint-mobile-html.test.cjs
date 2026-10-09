// Mobile HTML verification suite.
const test=require('node:test');
const assert=require('node:assert/strict');
const mobile=require('../assets/daily-ops.js');

const grossKey=['total','Gross'].join('');
const elrKey=['cp','Elr'].join('');
const storeTargetKey=['store','Gross','Target'].join('');
const hoursTargetKey=['cp','Hours','Per','Ro'].join('');
function model(){
  return {
    root:{name:'workspace'},connectionState:'CONNECTED',
    state:{source:{importedAt:'2026-10-09T13:00:00Z'},updatedAt:'2026-10-09T13:02:00Z',records:[
      {ro:'90001',customer:'Alpha & <Beta>',vehicle:'2024 Truck',vin:'VIN-EXAMPLE-001',
       advisor:'Advisor One',technician:'Technician One',sourceStatus:'WORKING',opened:'2026-10-01',daysOpen:'8',
       management:{status:'Being Repaired',owner:'Advisor One',nextAction:'Confirm part ETA',reviewDate:'2026-10-09',
         communication:'Needs update',note:'Call after lunch'}},
      {ro:'90002',customer:'Gamma',vehicle:'2025 SUV',advisor:'Advisor Two',sourceStatus:'OPEN',opened:'2026-10-02',daysOpen:'7',
       management:{status:'Awaiting Assignment',owner:'Advisor Two',nextAction:'',reviewDate:'2026-10-08',communication:'Needs update'}},
      {ro:'90003',customer:'Closed Person',management:{status:'Closed',reviewDate:'2026-10-08'}}
    ]},
    performance:{snapshots:{current:{
      periodEnd:'2026-10-09',importedAt:'2026-10-09T13:05:00Z',
      validation:{saprDaysVerified:true,finalTotalsVerified:true,advisorDetailSheets:1},
      store:{[grossKey]:1234,[elrKey]:205,totalRO:12,cpHours:2.1},
      advisors:{'11':{[grossKey]:700,[elrKey]:204,cpRO:6,cpHours:2.0},'12':{[grossKey]:534,[elrKey]:206,cpRO:6,cpHours:2.2}}
    }}},
    operationalMetrics:{},
    settings:{
      store:{name:'Example Service Center'},
      performanceStandards:{[storeTargetKey]:2000,[elrKey]:210,[hoursTargetKey]:2.0},
      advisors:{
        '11':{name:'Advisor One',active:true,removed:false},
        '12':{name:'Advisor Two',active:true,removed:false}
      }
    }
  };
}
const api={
  date:()=> '2026-10-09',
  closed:m=>m.status==='Closed',
  status:r=>r.management?.status||r.sourceStatus||'',
  imports:()=>[{source:'SAPR',status:'Current',period:'2026-10-09',importedAt:'2026-10-09T13:05:00Z'}]
};

test('SharePoint mobile HTML contains current authorized dashboard detail but no edit surface',()=>{
  const html=mobile.makeHtml(model(),api,[{
    title:'RO needs customer update',description:'Customer update is due.',next:'Advisor One calls customer.',record:{ro:'90001'}
  }],new Date('2026-10-09T14:00:00Z'));
  assert.match(html,/<!doctype html>/i);
  assert.match(html,/PRIVATE MOBILE VIEW/);
  assert.match(html,/RO 90001/);
  assert.match(html,/Alpha &amp; &lt;Beta&gt;/);
  assert.match(html,/VIN-EXAMPLE-001/);
  assert.match(html,/Advisor One/);
  assert.match(html,/Confirm part ETA/);
  assert.match(html,/Call after lunch/);
  assert.doesNotMatch(html,/Closed Person/);
  assert.match(html,/Customer update is due/);
  assert.match(html,/SAPR/);
  assert.match(html,/http-equiv="refresh" content="300"/);
  assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(html,/<form\b|<input\b|<textarea\b|contenteditable|<button\b/i);
  assert.doesNotMatch(html,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

test('mobile page is generated only from a connected desktop workspace',()=>{
  const disconnected=model();disconnected.root=null;disconnected.connectionState='NOT_CONNECTED';
  assert.throws(()=>mobile.makeHtml(disconnected,api,[]),/Connect the desktop working folder/);
});

test('publisher writes only the fixed MoonDog mobile filename and verifies exact bytes',async()=>{
  let written=null,requested='';
  const fileHandle={
    createWritable:async()=>({
      write:async bytes=>{written=new Uint8Array(bytes);},
      close:async()=>{}
    }),
    getFile:async()=>({arrayBuffer:async()=>written.buffer.slice(written.byteOffset,written.byteOffset+written.byteLength)})
  };
  const folder={
    name:'Private Site Pages',
    queryPermission:async()=> 'granted',
    getFileHandle:async(name,options)=>{requested=name;assert.deepEqual(options,{create:true});return fileHandle;}
  };
  const html='<html><body>read only</body></html>';
  const result=await mobile.publishToHandle(folder,html);
  assert.equal(requested,'MoonDog-Mobile.html');
  assert.equal(result.status,'published');
  assert.equal(result.folder,'Private Site Pages');
  assert.equal(Buffer.from(written).toString('utf8'),html);
});

test('publisher fails closed when read-back differs from what was written',async()=>{
  const folder={
    queryPermission:async()=> 'granted',
    getFileHandle:async()=>({
      createWritable:async()=>({write:async()=>{},close:async()=>{}}),
      getFile:async()=>({arrayBuffer:async()=>new TextEncoder().encode('different').buffer})
    })
  };
  await assert.rejects(()=>mobile.publishToHandle(folder,'expected'),/did not verify after saving/);
});

test('noninteractive auto publishing never requests permission',async()=>{
  let requested=false;
  const folder={queryPermission:async()=> 'prompt',requestPermission:async()=>{requested=true;return 'granted';}};
  const result=await mobile.publishToHandle(folder,'x');
  assert.equal(result.status,'permission-needed');
  assert.equal(requested,false);
});

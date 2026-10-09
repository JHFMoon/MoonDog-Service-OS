const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mobile = require('../assets/mobile-snapshot.js');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const amountKey = ['total','Gross'].join('');
const rateKey = ['cp','Elr'].join('');
function sample(verified = true) {
  return {
    root:{name:'workspace'},connectionState:'CONNECTED',
    state:{
      source:{fileName:'report.xlsx',importedAt:'2026-10-09T12:00:00Z'},
      records:[
        {ro:'SECRET-RO-ALPHA',vin:'SECRET-VIN',customer:'SECRET-CUSTOMER',
         management:{status:'In Progress',reviewDate:'2026-10-08',communication:'Needs update',nextAction:''}},
        {ro:'SECRET-RO-BETA',management:{status:'In Progress',reviewDate:'2026-10-09',nextAction:'Follow up'}},
        {ro:'SECRET-RO-CLOSED',management:{status:'Closed',reviewDate:'2026-10-08'}}
      ]
    },
    performance:{snapshots:{'2026-10-09':{
      periodEnd:'2026-10-09',importedAt:'2026-10-09T15:00:00Z',
      validation:{saprDaysVerified:verified,finalTotalsVerified:true,advisorDetailSheets:1},
      store:{[amountKey]:12345,[rateKey]:210,totalRO:50,cpHours:1.95},
      advisors:{'11':{name:'SECRET-ADVISOR', [amountKey]:3456,[rateKey]:199,cpRO:8}}
    }}},
    settings:{advisors:{'11':{name:'SECRET-ADVISOR',active:true,participation:{advisorMeeting:true}}}}
  };
}
const helpers={date:()=> '2026-10-09',closed:m=>m.status==='Closed'};

test('optional mobile PDF runtime is included in product installation and loaded after app', () => {
  const app=read('assets/app.js'),html=read('index.html'),ui=read('assets/daily-ops.js');
  assert.match(app,/"assets\/mobile-snapshot\.js"/);
  assert.match(html,/<script src="assets\/mobile-snapshot\.js"><\/script>/);
  assert.ok(html.indexOf('assets/mobile-snapshot.js') < html.indexOf('assets/daily-ops.js'));
  assert.match(ui,/Save phone PDF/);
  assert.match(ui,/category==='more'/);
});

test('connected snapshot contains only intentional aggregate data with source dates', () => {
  const summary=mobile.summarize(sample(),helpers,new Date('2026-10-09T17:00:00Z'));
  assert.equal(summary.open,2);
  assert.equal(summary.due,1);
  assert.equal(summary.overdue,1);
  assert.equal(summary.needsUpdate,1);
  assert.equal(summary.noPlan,1);
  assert.equal(summary.gross,12345);
  assert.equal(summary.advisors.length,1);
  assert.equal(summary.saprDate,'2026-10-09');
  assert.equal(summary.openSource,'2026-10-09');
  const pdf=Buffer.from(mobile.makePdf(summary)).toString('latin1');
  assert.match(pdf,/^%PDF-1\.4/);
  assert.match(pdf,/Service drive at a glance/);
  assert.match(pdf,/Rank 1/);
  assert.match(pdf,/Not live/);
  for(const forbidden of ['SECRET-RO-ALPHA','SECRET-RO-BETA','SECRET-VIN','SECRET-CUSTOMER',
    'SECRET-ADVISOR','report.xlsx','workspace'])assert.ok(!pdf.includes(forbidden),forbidden+' leaked into PDF');
  const offset=Number(pdf.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(pdf.slice(offset,offset+5),'xref\n');
});

test('unverified SAPR never appears as verified; absent sources show unavailable',()=>{
  const m=sample(false);m.state.source=null;
  assert.equal(mobile.summarize(m,helpers).saprDate,'Not verified');
  const summary=mobile.summarize(m,helpers);
  assert.equal(summary.open,null);
  assert.equal(summary.openSource,'Not imported');
  assert.equal(summary.gross,null);
  assert.equal(summary.advisors.length,0);
});

test('a disconnected phone copy cannot export, and no writes or network calls are made',async()=>{
  assert.throws(()=>mobile.summarize({root:null,connectionState:'NOT_CONNECTED'},helpers),/Connect the desktop/);
  let wrote=false,bytes=0;
  const environment={showSaveFilePicker:async args=>{
    assert.ok(args.suggestedName.endsWith('.pdf'));
    return {createWritable:async()=>({write:async blob=>{wrote=true;bytes=blob.size;},close:async()=>{}})};
  }};
  const result=await mobile.save(sample(),helpers,environment);
  assert.equal(result.status,'saved');
  assert.equal(result.mode,'picked');
  assert.ok(wrote);
  assert.ok(bytes>1500);
});

test('cancel is safe and does not use download fallback',async()=>{
  const env={showSaveFilePicker:async()=>{
    const error=new Error('user cancelled');error.name='AbortError';throw error;
  },URL:{createObjectURL:()=>{throw Error('bad fallback');}}};
  assert.equal((await mobile.save(sample(),helpers,env)).status,'cancelled');
});

test('mobile snapshot has no export automation or external endpoints',()=>{
  const source=read('assets/mobile-snapshot.js');
  assert.doesNotMatch(source,/\bfetch\s*\(/);
  assert.doesNotMatch(source,/XMLHttpRequest|sendBeacon|localStorage|indexedDB/);
  assert.doesNotMatch(source,/writeJson|writeFile|removeEntry|Workspace\/data/);
});

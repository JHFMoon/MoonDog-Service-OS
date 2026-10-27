const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const ops = read('assets/daily-ops.js');

function productionFunction(startMarker, endMarker) {
  const start = ops.indexOf(startMarker);
  const end = ops.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'production function boundary exists: ' + startMarker);
  return ops.slice(start, end);
}

test('report input clears its selection immediately so a failed import can retry the exact same file', async () => {
  const state = {busy:false,error:''};
  const events = [], imports = [], rendered = [];
  let shouldFail = true, pending;
  const file = {name:'synthetic-sapr.xlsx'};
  const task = {source:'performance',id:'synthetic-required-report'};
  const dailyTask = {querySelectorAll:()=>[],setAttribute(){},removeAttribute(){}};
  const mkElement = tag => ({
    tag,files:[],value:'',listeners:{},hidden:false,
    addEventListener(name,listener){this.listeners[name]=listener;},
    click(){},setAttribute(){},append(){},
  });
  const context = vm.createContext({
    Date,
    state,
    $: id => id === 'dailyTask' ? dailyTask : null,
    say: message => {state.error=message;},
    document:{createElement:mkElement},
    names:{performance:'SAPR'},
    button:(label,handler,kind)=>({label,handler,kind}),
    now:()=>Date.parse('2026-10-26T15:00:00Z'),
    active:()=> 'tools',
    renderTools:category=>rendered.push(category),
    selectNext:async()=>{events.push('next');},
    log:async(kind,submitted)=>{events.push(kind+':'+submitted.id);},
    api:{importFile:async selected=>{
      imports.push(selected);
      if(shouldFail)throw Error('Synthetic report read failed; retry the original file.');
      return 'performance';
    }}
  });
  vm.runInContext(
    productionFunction('  async function action(fn){','  function compactField(') +
    productionFunction('  function importer(host,task=null){','  function renderRefreshStrip(') +
    '\nthis.makeImporter=importer;this.productionAction=action;', context);
  // Capture the Promise initiated by the production change handler without
  // replacing the actual production action/error-handling implementation.
  const run=context.productionAction;
  context.action=fn=>(pending=run(fn));
  const host={children:[],append(...nodes){this.children.push(...nodes);}};
  context.makeImporter(host,task);
  const input=host.children.find(node=>node.tag==='input');
  assert.ok(input?.listeners.change,'the actual importer registered a change handler');

  input.files=[file];
  input.value='synthetic-sapr.xlsx';
  input.listeners.change();
  assert.equal(input.value,'','the selected value is released before the failing asynchronous import');
  await pending;
  assert.deepEqual(imports,[file]);
  assert.match(state.error,/Synthetic report read failed/);
  assert.deepEqual(events,[],'a rejected import cannot claim completion or change the current task');
  assert.deepEqual(rendered,[]);
  assert.equal(state.busy,false,'the action guard releases after failure');

  shouldFail=false;
  input.files=[file];
  input.value='synthetic-sapr.xlsx';
  input.listeners.change();
  assert.equal(input.value,'','the same report is selectable after retry');
  await pending;
  assert.deepEqual(imports,[file,file]);
  assert.equal(state.error,'','the old failure message clears on the verified follow-up');
  assert.deepEqual(events,['completed:synthetic-required-report','next']);
  assert.deepEqual(rendered,['imports']);
  assert.equal(state.busy,false);
});

test('the quick report-refresh picker also clears the source selection before awaiting import',()=>{
  const section=productionFunction('  function renderRefreshStrip(host) {','  async function actionWrap(fn)');
  assert.match(section,/const file=input\.files\?\.\[0\];if\(!file\)return;input\.value='';/);
  assert.match(section,/await api\.importFile\(file\);await selectNext\(\)/);
});

test('the production import API notifies only after its classified candidate has completed',()=>{
  const app=read('assets/app.js');
  const start=app.indexOf('    importFile: async function(file) {');
  const end=app.indexOf('\n    }\n  });',start);
  assert.ok(start>=0&&end>start,'production importer is present');
  const entry=app.slice(start,end);
  const candidate=entry.indexOf('await processClassifiedCandidate(');
  const notify=entry.indexOf("dailyNotify('moondog-imported'");
  const result=entry.indexOf('return kind;',notify);
  assert.ok(candidate>=0&&notify>candidate&&result>notify,
    'the UI import completion event follows the production classified candidate');
  assert.match(entry,/catch\(error\).*throw error;/s,'import failures remain errors, not success');
});

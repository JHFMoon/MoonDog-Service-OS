(function () {
  'use strict';
  const api=globalThis.__moondogDaily,engine=globalThis.MoonDogDailyEngine;
  if(!api||!engine)return;
  const $=id=>document.getElementById(id), model=api.model;
  const state={current:null,events:[],loadedRoot:null,loading:false,busy:false,editing:false,searchToken:0,searchResults:[],history:[],error:'',pending:false,selectedPhase:''};
  const names={performance:'SAPR','open-ro':'Open RO',appointments:'Appointments / pre-RO','next-appointments':'Next Appointments',vir:'VIR','menu-sales':'Menu Sales',csi:'CSI',sor:'SOR','appointment-activity':'Appointment Activity',efficiency:'Efficiency','media-asr':'Media ASR — Advisor','media-asr-tech':'Media ASR — Technician','open-ro-summary':'Aggregate WIP','ro-update':'Returned supervisor workbook'};
  const toolNames={home:'Home','assign-next':'Assign Next','open-ro':'Open RO Control',performance:'Advisor Performance',meeting:'Advisor Meeting',tools:'Tools',overview:'Store overview',arrivals:"Today's Arrivals",imports:'Supervisor workbook and detailed imports',settings:'Change how Service Operations Hub works',setup:'Reports and setup'};
  const settingsFeatures=Object.freeze([
    {key:'advisors',label:'Advisors',targets:['advisorSettingsList']},
    {key:'meeting',label:'Meeting',targets:['meetingDay','meetingVoiceSurvey','csiPeriodStart']},
    {key:'targets',label:'Performance targets',targets:['virTarget']},
    {key:'workflow',label:'Open RO workflow and workbook',targets:['managementStatusSettings','worksheetOrderSettings']},
    {key:'routine',label:'Daily routine',targets:['dailyWalkCount']},
    {key:'store',label:'Store',targets:['storeName']},
    {key:'reports',label:'Reports / Data',view:'setup'},
    {key:'updates',label:'System Updates',targets:['settings-update']},
    {key:'advanced',label:'Advanced',targets:['advancedDiagnosticsSection','newStoreSection']},
    {key:'recovery',label:'Recovery',targets:['backupRecoverySection']}
  ]);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(text,fn,cls='secondary')=>{const el=document.createElement('button');el.type='button';el.className=cls;el.textContent=text;el.addEventListener('click',fn);return el;};
  function installThemeToggle(){
    const storageKey='service-operations-hub-theme-v1';
    const systemTheme=globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    let savedTheme='';
    try { const saved=globalThis.localStorage.getItem(storageKey); if(saved==='dark'||saved==='light') savedTheme=saved; } catch(_) {}
    let theme=savedTheme||(systemTheme?.matches?'dark':'light');
    const control=document.createElement('button');
    control.type='button';control.className='theme-toggle';
    function paint(){
      document.documentElement.dataset.theme=theme;
      document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',theme);
      control.textContent=theme==='dark'?'☀ Light mode':'☾ Dark mode';
      control.setAttribute('aria-pressed',String(theme==='dark'));
      control.setAttribute('aria-label',theme==='dark'?'Switch to light mode':'Switch to dark mode');
    }
    control.addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';savedTheme=theme;try{globalThis.localStorage.setItem(storageKey,theme);}catch(_){}paint();});
    systemTheme?.addEventListener?.('change',event=>{if(savedTheme)return;theme=event.matches?'dark':'light';paint();});
    document.querySelector('.top-actions')?.append(control);
    paint();
  }
  const active=()=>document.querySelector('.view.active')?.id.replace('view-','');
  const today=()=>api.date();
  const now=()=>Date.now();
  const businessHour=()=>globalThis.MoonDogFreshness?.timeParts(new Date(),globalThis.__moondogFreshness?.timeZone?.()||'America/Los_Angeles')?.hour??new Date().getHours();
  function say(message){state.error=message;let target=active()==='home'?$('dailyError'):$('dailyToolError');if(!target&&message&&active()!=='home'){target=document.createElement('p');target.id='dailyToolError';target.setAttribute('role','alert');document.querySelector('.view.active')?.prepend(target);}if(target){target.hidden=!message;target.textContent=message;}}
  function go(view,anchor=''){api.navigate(view,anchor);}
  function wrap(el,label){if(!el||el.closest('.daily-disclosure'))return;const detail=document.createElement('details');detail.className='daily-disclosure';const summary=document.createElement('summary');summary.textContent=label;el.before(detail);detail.append(summary,el);}

  function installShell(){
    document.body.classList.add('daily-operating');
    const storeName=$('hubStoreName');if(storeName)storeName.textContent=model.settings.store?.code&&model.settings.store?.name?.trim()?model.settings.store.name.trim():'Offline operations';
    const nav=document.querySelector('nav[aria-label="Main navigation"]');
    for(const [key,label] of Object.entries(toolNames)){const el=nav.querySelector(`[data-view="${key}"]`);if(el&&key!=='home')el.textContent=label;}
    const primary=['home','assign-next','open-ro','performance','meeting','tools'];
    primary.forEach(key=>{const el=nav.querySelector(`[data-view="${key}"]`);if(el)nav.append(el);});
    nav.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('secondary-destination',!primary.includes(el.dataset.view)));
    const search=document.createElement('div');search.className='daily-search';search.innerHTML='<label for="findAnything">Find Anything</label><input id="findAnything" type="search" placeholder="RO, customer, task, report, or setting" autocomplete="off"><div id="findResults" class="find-results" hidden></div>';
    document.querySelector('.topbar').insertBefore(search,document.querySelector('.top-actions'));
    let timer; $('findAnything').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(searchAll,220);});
    $('findAnything').addEventListener('keydown',e=>{if(e.key==='Escape')$('findResults').hidden=true;});
    document.addEventListener('click',e=>{if(!e.target.closest('.daily-search'))$('findResults').hidden=true;});
    const detail=document.createElement('dialog');detail.id='dailyReadOnly';detail.innerHTML='<div class="dialog-head"><h2 id="dailyReadTitle">Details</h2><button type="button" aria-label="Close">×</button></div><div id="dailyReadBody"></div>';detail.querySelector('button').onclick=()=>detail.close();document.body.append(detail);
    const assign=$('view-assign-next');assign.querySelector('h2').textContent='Who should get the next RO?';assign.querySelector('.assign-hero p:not(.eyebrow)').textContent='';wrap($('assignAdvisorGrid').parentElement,'Workload and advisor availability');wrap(assign.querySelector('.assign-source'),'Report details');
    wrap($('view-open-ro').querySelector('.daily-focus'),'Manager’s Daily Walk');wrap($('view-open-ro').querySelector('.filter-bar'),'More filters');wrap($('view-open-ro').querySelector('.queue-keyboard'),'Keyboard shortcuts');
    wrap($('view-arrivals').querySelector('.arrival-import'),'Import appointments');wrap($('view-arrivals').querySelector('.arrival-metrics'),'Arrival summary');wrap($('view-arrivals').querySelector('.advisor-load'),'Appointments by advisor');
    const performance=$('view-performance');
    [...performance.children].forEach(el=>{if(el.matches('.performance-import,.performance-controls'))return;if(/trend|comparison|controllable|source|kpi|detail/i.test(el.className)&&!el.matches('.performance-executive'))wrap(el,el.querySelector('h2,h3')?.textContent||'Performance detail');});
    const note=$('editNote').closest('label');wrap(note,'Add note');
    wrap(performance.querySelector('.performance-import'),'Import SAPR');
    wrap($('performanceAdvisorTable')?.closest('section'),'Advisor comparison');
    wrap($('performanceChanges')?.closest('.performance-grid'),'Trends and daily changes');
    $('view-overview').querySelector('.manager-attention')?.classList.add('secondary-attention');
    renderTools();
  }
  function sourceTasks(){
    const day=today(),tasks=api.reportRefreshRequests(day).map(r=>({...r,id:`import:${r.source}:${day}`,type:`import:${r.source}`,title:`${names[r.source]} update needed`,once:false}));
    if(Object.values(model.settings.advisors||{}).some(a=>a.setupRequired&&!a.removed))tasks.push({id:'settings:advisors',type:'settings',title:'Review new advisors',description:'Choose how each new advisor participates.',view:'settings',anchor:'settings-advisors',rank:6,fingerprint:JSON.stringify(model.settings.advisors)});
    return tasks;
  }
  function candidates(){
    if(!model.root)return[];
    const day=today(),at=now(),hour=businessHour(),items=(model.state.records||[]).map(r=>engine.roTask(r,api,day,at)).filter(Boolean);
    items.push(...sourceTasks());
    if(model.state.reviewQueue?.length)items.push({id:'unmatched:questions',type:'questions',title:'Resolve the returned workbook questions',description:'Review unmatched advisor updates before applying them to an RO.',view:'open-ro',rank:3,fingerprint:String(model.state.reviewQueue.length)});
    if(model.assignNext.currentOpenRo)items.push({id:'availability:'+day+':'+hour,type:'availability',title:'Check advisor availability',description:'Confirm who is available before assigning the next RO.',view:'assign-next',rank:12,once:true,fingerprint:day+':'+hour});
    const open=model.state.records.filter(r=>!api.closed(r.management||{})),parts=open.filter(r=>/waiting on parts|parts delay/i.test(api.status(r))&&!engine.hasFuturePlan(r,day));
    if(parts.length>=3)items.push({id:`parts:${day}`,type:'parts',title:'Review the parts delays',description:`${parts.length} current ROs are waiting on parts. Confirm the next action and customer update with Parts.`,view:'open-ro',rank:8,once:true,fingerprint:day});
    const unresolved=open.filter(r=>r.management?.reviewDate===day||r.management?.communication==='Needs update'||Boolean(engine.stuckWork(r,day)));
    if(hour>=15&&unresolved.length)items.push({id:`tomorrow:${day}`,type:'tomorrow',title:'Make tomorrow ready',description:`Review ${unresolved.length} unresolved follow-up${unresolved.length===1?'':'s'}, customer update${unresolved.length===1?'':'s'}, or finish plan${unresolved.length===1?'':'s'} before closing.`,view:'open-ro',rank:5.5,once:true,fingerprint:JSON.stringify([day,unresolved.map(r=>[r.id,r.management?.updatedAt,r.management?.reviewDate])])});
    const coaching=engine.coachingTurn(engine.coachingTasks(api.latestSapr(),api.advisors(),model.settings.performanceStandards,globalThis.__moondogFreshness.sourceFreshness('sapr',{today:day}).safeForCurrent,day),state.events,at);
    if(coaching)items.push(coaching);
    return items;
  }
  async function loadHistory(){
    const entries=await api.readEntries('data/history'),events=[];
    for(const {name,handle} of entries)if(name.endsWith('.json')){try{events.push(JSON.parse(await(await handle.getFile()).text()));}catch(error){if(error.name!=='SyntaxError')throw error;}}
    events.sort((a,b)=>String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));
    state.history=events;state.events=events.filter(e=>e.type==='daily-task');
  }
  async function log(action,task,extra={}){
    const event=await api.event({action,taskId:task.id,taskType:task.type,advisor:task.advisor||'',recordId:task.recordId||'',day:today(),hour:businessHour(),rank:task.rank,fingerprint:task.fingerprint,...extra});
    state.history.push(event);state.events.push(event);
    return event;
  }
  // Fingerprints in history are compact source/revision evidence, never customer text.
  function compactTask(task){if(task?.type==='ro')task.fingerprint=JSON.stringify([task.record.id,task.record.management?.updatedAt,task.record.sourceStatus,task.record.management?.reviewDate,task.record.management?.reviewTime,task.record.management?.nextAction?true:false,task.rank,model.state.source?.importedAt]);if(task?.type==='settings')task.fingerprint=Object.values(model.settings.advisors||{}).filter(a=>a.setupRequired).map(a=>a.number).sort().join(',');return task;}
  function allTasks(){return candidates().map(compactTask);}
  async function selectNext(){
    state.operatingDate=today();
    state.selectedPhase=engine.phase(now());
    const task=engine.choose(allTasks(),state.events,now());state.current=task;state.editing=false;state.pending=false;state.error='';renderHome();
    if(task&&active()==='home'&&!(model.settings.setup?.newStorePrepared&&!model.settings.setup?.completedAt))try{await log('surfaced',task);}catch(error){say('This task is available, but its activity could not be recorded. Check folder access before continuing.');}
  }
  async function ready(){
    if(!model.root||model.connectionState!=='CONNECTED'){if(!state.current)renderHome();return;}
    if(state.loadedRoot===model.root){await checkOperatingDate();refreshCurrent();return;}
    if(state.loading)return;state.loading=true;
    try{await loadHistory();state.loadedRoot=model.root;await selectNext();}catch(error){say('Service Operations Hub could not read its task history. Check folder access and reconnect.');}finally{state.loading=false;}
  }
  async function checkOperatingDate(){
    if(!model.root||model.connectionState!=='CONNECTED'||state.loading||state.busy)return;
    const day=today(),currentPhase=engine.phase(now());if(state.operatingDate===day&&state.selectedPhase===currentPhase)return;
    if(state.operatingDate===day&&state.editing)return;
    state.operatingDate=day;
    if(state.editing){state.pending=true;const target=$('dailyChanged');if(target)target.hidden=false;return;}
    await action(selectNext);
  }
  function refreshCurrent(){
    if(state.busy||state.loading)return;
    if(!state.current){renderHome();return;}
    const fresh=allTasks().find(t=>t.id===state.current.id);
    if(!fresh||fresh.fingerprint!==state.current.fingerprint){state.pending=true;const target=$('dailyChanged');if(target)target.hidden=false;}
  }
  async function action(fn){if(state.busy)return;state.busy=true;say('');$('dailyTask')?.setAttribute('aria-busy','true');try{await fn();}catch(error){say(error.message||'This could not be saved. Check folder access and try again.');}finally{state.busy=false;$('dailyTask')?.removeAttribute('aria-busy');}}
  function compactField(form,label,key,value,control,needs){
    const item=document.createElement('div');item.className='daily-field';
    const heading=document.createElement('label');heading.textContent=label;control.name=key;control.id=`daily-${key}`;heading.htmlFor=control.id;
    control.value=value||'';
    const context=document.createElement('div');context.className='daily-field-context';const text=document.createElement('span');text.textContent=value||'Not recorded';
    const change=button('Change',()=>{context.hidden=true;control.hidden=false;control.focus();state.editing=true;},'link-button');context.append(text,change);
    control.hidden=!needs;context.hidden=needs;item.append(heading,context,control);form.append(item);
  }
  function roForm(task,host){
    const r=model.state.records.find(x=>x.id===task.recordId);if(!r)return;
    const original=JSON.stringify(r),m=r.management||{};
    host.insertAdjacentHTML('beforeend',`<div class="daily-ro-context"><strong>RO ${esc(r.ro)}</strong><span>${esc(r.customer)}</span><span>${esc(r.vehicle||r.tagNumber)}</span><small>${esc(r.advisor)}${r.advisorCode?' · '+esc(r.advisorCode):''} · ${esc(r.sourceStatus||'Status not provided')}</small></div>`);
    const form=document.createElement('form');form.id='dailyRoForm';form.className='daily-ro-form';
    const status=document.createElement('select');api.statuses(r).forEach(v=>status.add(new Option(v,v)));
    compactField(form,'Current condition','status',api.status(r),status,Boolean(api.clarification(r))||!m.status);
    const next=document.createElement('textarea');next.rows=2;next.required=true;compactField(form,'Next action','nextAction',m.nextAction,next,!m.nextAction||task.hard);
    const date=document.createElement('input');date.type='date';date.required=true;compactField(form,'Follow-up date','reviewDate',m.reviewDate,date,!m.reviewDate||m.reviewDate<=today());
    const time=document.createElement('input');time.type='time';compactField(form,'Follow-up time (optional)','reviewTime',m.reviewTime,time,false);
    const comm=document.createElement('select');api.communication.forEach(v=>comm.add(new Option(v||'Not recorded',v)));compactField(form,'Customer communication','communication',m.communication,comm,!m.communication||m.communication==='Needs update');
    const tech=document.createElement('input');tech.maxLength=120;compactField(form,'Current technician','currentTechnician',m.currentTechnician||r.technician||'',tech,false);
    const owner=document.createElement('input');compactField(form,'Owner','owner',m.owner,owner,false);
    const note=document.createElement('details');note.className='daily-note';note.innerHTML='<summary>Add note</summary><label for="daily-note">Update note</label><textarea id="daily-note" name="note" rows="2"></textarea>';note.querySelector('textarea').value=m.note||'';form.append(note);
    const save=document.createElement('button');save.type='submit';save.className='primary daily-primary';save.textContent='Save and continue';form.append(save);
    form.addEventListener('input',()=>state.editing=true);form.addEventListener('change',()=>state.editing=true);
    form.addEventListener('submit',e=>{e.preventDefault();action(async()=>{const values=Object.fromEntries(new FormData(form));try{await api.saveHome(r.id,original,values);}catch(error){if(JSON.stringify(model.state.records.find(x=>x.id===r.id))!==original){state.pending=true;$("dailyChanged").hidden=false;}throw error;}const updated=compactTask(engine.roTask(model.state.records.find(x=>x.id===r.id),api,today(),now()));const savedTask=updated||task;await log('completed',savedTask,{fingerprint:savedTask.fingerprint,until:new Date(now()+(task.hard?30:120)*60000).toISOString()});await selectNext();});});
    host.append(form);
  }
  function importer(host,task=null){
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.csv,.pdf';input.hidden=true;
    const choose=button(task?`Import ${names[task.source]}`:'Choose a report',()=>input.click(),'primary daily-primary');
    input.addEventListener('change',()=>{const file=input.files[0];if(!file)return;action(async()=>{const imported=await api.importFile(file);if(task&&imported===task.source)await log('completed',task,{until:new Date(now()+60000).toISOString()});await selectNext();if(active()==='tools')renderTools('imports');});});
    host.append(input,choose);
    const hint=document.createElement('p');hint.className='daily-hint';hint.textContent='Or place reports in “01 - DROP REPORTS HERE”. Service Operations Hub checks them automatically.';host.append(hint);
  }
  function renderHome(){
    const host=$('dailyTask');host.replaceChildren();
    if(!model.root){host.innerHTML='<p class="eyebrow">Your daily workspace</p><h2>Connect Service Operations Hub to begin</h2><p>Your saved work stays in the connected working folder.</p>';host.append(button('Connect working folder',()=>api.connect(),'primary'));return;}
    if(!state.loadedRoot&&!state.current){host.innerHTML='<h2>Loading your saved work…</h2>';return;}
    const task=state.current;
    if(!task){host.innerHTML='<p class="eyebrow">Home</p><h2>No other task is ready right now</h2><p>Deferred work is still saved. You can check the drive or find any item above.</p>';host.append(button('Check priorities',()=>action(selectNext),'primary'),button('Open RO Control',()=>go('open-ro')));return;}
    host.innerHTML=`<p class="eyebrow">${task.type==='coaching'?'Coaching opportunity':'Do this next'}</p><h2>${esc(task.title)}</h2><p id="dailyError" role="alert" hidden></p><div id="dailyChanged" hidden>New information is available. Your draft is still here. <button type="button">Refresh this task</button></div>`;
    $('dailyChanged').querySelector('button').onclick=()=>action(selectNext);
    if(task.type==='ro')roForm(task,host);
    else{
      if(task.description){const p=document.createElement('p');p.className='daily-description';p.textContent=task.description.replace(/TREND DATA NEEDED · SAPR · /,'').replace(/historical snapshot/g,'historical report');host.append(p);}
      if(task.type==='coaching'){const p=document.createElement('p');p.className='daily-description';p.textContent=`NEXT · ${task.next}`;host.append(p);}
      if(task.source)importer(host,task);
      else{
        if(task.type==='questions')host.append(button('View saved questions',()=>showReadOnly('Returned workbook questions',{questions:model.state.reviewQueue})));
        if(task.type!=='coaching')host.append(button('Open '+(task.type==='settings'?'advisor settings':task.view==='open-ro'?'Open RO Control':task.view==='imports'?'workbook tools':task.view==='assign-next'?'Assign Next':'Advisor Performance'),()=>go(task.view,task.anchor),'primary'));
        host.append(button('Completed',()=>action(async()=>{await log('completed',task,{until:new Date(now()+120*60000).toISOString()});await selectNext();})));
      }
    }
    const footer=document.createElement('div');footer.className='daily-task-footer';footer.append(button('Not Now',()=>action(async()=>{await log('deferred',task,{until:engine.deferUntil(task,state.events,now()),fingerprint:task.fingerprint});await selectNext();})));host.append(footer);
    say(state.error);
  }

  function settingsCategory(category){
    const feature=settingsFeatures.find(item=>item.key===category);
    if(!feature)return;
    if(feature.view){go(feature.view);return;}
    const host=$('view-settings');
    const targets=feature.targets.map(id=>$(id)).filter(el=>el&&host.contains(el));
    if(!targets.length){goTools('settings');say(`${feature.label} is unavailable in this application copy.`);return;}
    go('settings');
    host.querySelectorAll('.daily-settings-back').forEach(e=>e.remove());
    const back=button('‹ Change how Service Operations Hub works',()=>goTools('settings'));back.classList.add('daily-settings-back');host.prepend(back);
    const selected=new Set(targets.map(el=>el.closest('.card')).filter(Boolean));
    const cards=host.querySelectorAll('.card');cards.forEach(card=>card.classList.toggle('daily-settings-hidden',!selected.has(card)));
    if(category==='advanced')cards.forEach(card=>{if(/diagnostic|new.store|handoff/i.test(card.id+' '+card.className))card.classList.remove('daily-settings-hidden');});
    if(category==='recovery')$('backupRecoverySection')?.classList.remove('daily-settings-hidden');
    if(category==='updates')targets[0].scrollIntoView({block:'start'});
  }
  function goTools(category){go('tools');renderTools(category);}
  function renderTools(category=''){
    const host=$('dailyTools');host.dataset.category=category;host.replaceChildren();
    const title=document.createElement('h2');title.textContent=category?({imports:'Import or refresh data',settings:'Change how Service Operations Hub works',recovery:'Back up or recover Service Operations Hub',more:'More tools'})[category]:'What are you trying to do?';host.append(title);
    if(category)host.append(button('‹ Tools',()=>renderTools()));
    const options=document.createElement('div');options.className='daily-tool-choices';host.append(options);
    if(!category){[['Import or refresh data','imports'],['Change how Service Operations Hub works','settings'],['Back up or recover Service Operations Hub','recovery']].forEach(([label,key])=>options.append(button(label,()=>renderTools(key))));host.append(button('More',()=>renderTools('more'),'link-button'));}
    if(category==='imports'){
      importer(options);
      const rows=api.imports(),groups=[['WHAT YOU NEED NOW',row=>row.need.state==='NEED NOW'],['USEFUL SOON / OPTIONAL',row=>!['NEED NOW','REFERENCE','ON DEMAND'].includes(row.need.state)],['REFERENCE / ON DEMAND',row=>['REFERENCE','ON DEMAND'].includes(row.need.state)]];
      const date=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value||'')?new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'}):value||'None';
      const trendLine=row=>globalThis.MoonDogFreshness.trendMaintenanceSummary(row.key,row.trend,date);
      for(const [label,includes] of groups){
        const group=document.createElement('section');group.className='daily-report-needs';group.dataset.needGroup=label;const title=document.createElement('h3');title.textContent=label;group.append(title);options.append(group);
        const selected=rows.filter(includes);
        if(label==='WHAT YOU NEED NOW'&&!selected.length){const p=document.createElement('p');p.className='empty';p.textContent='You’re current. No reports need to be pulled right now.';group.append(p);}
        for(const row of selected){const entry=document.createElement('div');entry.className='daily-source-row';entry.dataset.source=row.key;
          entry.innerHTML=`<strong>${esc(row.source)}</strong><span>${esc(row.need.state==='ON DEMAND'?'On demand':row.need.state==='REFERENCE'?'Reference data':row.need.state)}</span><small>${esc(row.need.reason)}</small>`;
          const trend=document.createElement('div');trend.className='daily-trend-compact';trend.innerHTML='<strong>SOURCE EVIDENCE</strong>';
          const quick=document.createElement('span');quick.textContent=`${row.trend.cadence}${row.trend.cadence?' · ':''}${trendLine(row)}`;trend.append(quick);entry.append(trend);
          if(['NEED NOW','NEED SOON'].includes(row.need.state)){const action=document.createElement('p');action.textContent=row.need.actions.length>1?'Recover the missing SAPR snapshots listed in Coverage details.':row.need.actions[0]||'';entry.append(action);}
          const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Trend details / Why?';details.append(summary);
          const coverage=document.createElement('div');coverage.className='daily-source-coverage';
          const t=row.trend,lines=[`Purpose: ${row.need.purpose}`,`Operational need: ${row.need.state} · ${row.need.reason}`,`Trend status: ${t.status}`,`Cadence: ${t.cadence||'None'}`];
          if(['openRo','appointments'].includes(row.key))lines.push(`Current verified import: ${t.importDate?date(t.importDate):'not available'}`,`Source snapshot date: ${t.snapshotDate?date(t.snapshotDate):'not provided'}`);
          else if(t.kind==='recoverable')lines.push(`Response events present: ${t.responses||'not established'}`,`Last report observation: ${t.lastReportObservation?date(t.lastReportObservation):'not established'}`,`Verified export scope: ${t.last||'not established'}`,t.last?'':'Response dates show when surveys occurred; they do not prove the export covered every day in that range.',t.missing.length?`Next useful export: ${t.next} cumulative CSI`:'A day without a response is not a missing report.');
          else if(row.key==='sor')lines.push(`Current observation: ${date(t.last)}`,`Financial month: ${/^\d{4}-\d{2}$/.test(t.financialMonth||'')?new Date(`${t.financialMonth}-01T12:00:00Z`).toLocaleDateString(undefined,{timeZone:'UTC',month:'long'}):'not established'}`,`Next optional observation: ${date(t.next)}`);
          else if(t.kind!=='none')lines.push(`Last valid trend point: ${date(t.last)}`,...(row.key==='sapr'?[]:[`Next ${t.kind==='required'?'required':'optional'} ${row.key==='menu'?'release':'point'}: ${date(t.next)}`]));
          if(row.need.state==='ON DEMAND')lines.push(`Last generated: ${t.lastActivityDate?date(t.lastActivityDate):'not recorded'}`,`Source timestamp: ${row.lastSuccessfulImport}`,`Generate when needed.`);
          if(row.need.state==='REFERENCE')lines.push(`Last received: ${t.lastActivityDate?date(t.lastActivityDate):'not recorded'}`,`Source timestamp: ${row.lastSuccessfulImport}`,`Reference data; no recurring refresh required.`);
          if(t.kind==='required')lines.push(`REQUIRED TREND DATES: ${t.missing.map(date).join(', ')||'None'}`);
          if(t.kind==='optional')lines.push(`OPTIONAL TREND DATES: ${t.missing.map(date).join(', ')||'None'}`);
          lines.push(t.recovery,t.note);
          if(!['REFERENCE','ON DEMAND'].includes(row.need.state))lines.push(`Freshness: ${row.status} · Last successful update: ${row.lastSuccessfulImport}`);
          if(!['openRo','appointments','csi','sor'].includes(row.key))lines.push(`Represented period: ${row.period}`);
          const historical=['REQUIRED TREND','CUMULATIVE / RECOVERABLE','WEEKLY'].includes(row.need.purpose)||row.need.purpose.startsWith('OPTIONAL TREND');
          if(historical)lines.push(row.coverage.summary,...row.coverage.details);
          for(const line of lines.filter(Boolean)){const p=document.createElement('p');p.textContent=line;coverage.append(p);}
          const actions=['REQUIRED TREND','CUMULATIVE / RECOVERABLE','WEEKLY'].includes(row.need.purpose)?row.coverage.actions:row.need.actions;
          if(actions.length){const list=document.createElement('ul');for(const line of actions){const item=document.createElement('li');item.textContent=line;list.append(item);}coverage.append(list);}
          details.append(coverage);entry.append(details,button(row.need.state==='ON DEMAND'?'Generate / workbook tools':'Import',()=>row.need.state==='ON DEMAND'?go('imports'):options.querySelector('input[type="file"]').click()));group.append(entry);
        }
        if(label==='WHAT YOU NEED NOW'){
          const plan=document.createElement('section');plan.className='daily-trend-plan daily-report-needs';plan.innerHTML='<h3>TREND MAINTENANCE</h3>';
          const actions=globalThis.MoonDogFreshness.trendMaintenanceActions(rows,date);
          if(!actions.length){const p=document.createElement('p');p.textContent='All required trend data is current. No report action needed.';plan.append(p);}
          for(const action of actions){const p=document.createElement('p');p.textContent=`${action.label}: ${action.summary}${action.instruction?` · ${action.instruction}`:''}`;plan.append(p);}
          group.after(plan);
        }
      }
      host.append(button('Supervisor workbook and detailed imports',()=>go('imports')),button("Today's Arrivals",()=>go('arrivals')),button('Report availability and setup',()=>go('setup')));
    }
    if(category==='settings')for(const feature of settingsFeatures.filter(item=>item.key!=='recovery'))options.append(button(feature.label,()=>settingsCategory(feature.key)));
    if(category==='recovery'){options.append(button('Create backup / Restore from backup',()=>settingsCategory('recovery')),button('Create support / recovery copy',()=>settingsCategory('recovery')),button('Show recovery status',()=>settingsCategory('recovery')),button('Advanced recovery and new-store preparation',()=>settingsCategory('advanced')));}
    if(category==='more')for(const key of ['arrivals','overview','imports','setup'])options.append(button(toolNames[key],()=>go(key)));
  }
  function showReadOnly(title,data){$('dailyReadTitle').textContent=title;const host=$('dailyReadBody');host.replaceChildren();const list=document.createElement('dl');
    function fields(object,prefix=''){for(const [key,value] of Object.entries(object||{})){if(value===null||value===undefined||value==='')continue;if(typeof value==='object'){fields(value,prefix+key+' / ');continue;}const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=(prefix+key).replace(/([a-z])([A-Z])/g,'$1 $2');dd.textContent=String(value);list.append(dt,dd);}}
    fields(data);host.append(list);$('dailyReadOnly').showModal();
  }
  const matches=(value,q)=>{const content=JSON.stringify(value).toLowerCase();return q.split(/\s+/).every(word=>content.includes(word));};
  async function searchAll(){
    const token=++state.searchToken,q=$('findAnything').value.trim().toLowerCase(),host=$('findResults');host.replaceChildren();host.hidden=!q;if(!q)return;
    const results=[],seen=new Set();
    const add=(key,label,detail,open)=>{if(seen.has(key))return;seen.add(key);results.push({key,label,detail,open});};
    const addRo=(r,historical=false,path='')=>{if(!matches(r,q))return;add(`${historical?'past':'ro'}:${r.id}:${historical?path:''}`,`${historical?'Historical ':''}RO ${r.ro} · ${r.customer||''}`,`${r.advisor||''} · ${r.vehicle||''} · ${r.management?.nextAction||''}`,()=>historical?showReadOnly(`Historical RO ${r.ro}`,r):api.openEdit(r.id));};
    model.state.records.forEach(r=>addRo(r));
    for(const [day,value] of Object.entries(model.appointments.days||{}))for(const a of value.appointments||[])if(matches(a,q))add(`arrival:${day}:${a.id}`,`${a.guest||a.customer||'Arrival'} · ${day}`,`${a.time||''} · ${a.vehicle||''}`,()=>showReadOnly('Appointment',a));
    for(const [view,label] of Object.entries(toolNames))if(matches([view,label],q))add(`page:${view}`,label,'Open this area',()=>go(view));
    for(const [key,label,terms] of [["imports","Import or refresh data","reports import upload"],["settings","Change how Service Operations Hub works","settings configuration"],["recovery","Back up or recover Service Operations Hub","backup restore recovery support"],["updates","System Updates","stable beta update release"]])if(matches([label,terms],q))add(`tool:${key}`,label,"Tools",()=>key==="updates"?settingsCategory("updates"):goTools(key));
    for(const a of Object.values(model.settings.advisors||{}))if(matches(a,q))add(`advisor:${a.number}`,`${a.name} · Advisor ${a.number}`,'Advisor settings',()=>settingsCategory('advisors'));
    for(const [key,value] of Object.entries(model.settings))if(matches({[key]:value},q))add(`setting:${key}`,`Setting: ${key.replace(/([a-z])([A-Z])/g,'$1 $2')}`,'Saved configuration',()=>showReadOnly('Saved setting',{[key]:value}));
    for(const row of api.imports())if(matches(row,q))add(`source:${row.source}`,`${row.source} report`,row.status,()=>goTools('imports'));
    for(const task of allTasks()){const event=engine.lastEvent(state.events,task.id);if(matches([task.title,task.description,event?.details?.action,task.recordId],q))add(`task:${task.id}`,`${task.title}${event?' · '+event.details.action:''}`,task.description||'Current task',()=>task.recordId?api.openEdit(task.recordId):showReadOnly(task.title,{status:event?.details?.action||'available',description:task.description||'',until:event?.details?.until||''}));}
    for(const event of state.history)if(matches(event,q))add(`history:${event.id}`,`${event.summary||event.type} · ${String(event.at).slice(0,10)}`,'Saved activity',()=>showReadOnly('Saved activity',event));
    for(const [family,value] of Object.entries({...model.operationalMetrics,advisorPerformance:model.performance,assignNext:model.assignNext,unmatchedQuestions:model.state.reviewQueue}))if(value&&typeof value==='object'&&matches({[family]:value},q))add(`metrics:${family}`,family.replace(/([a-z])([A-Z])/g,'$1 $2'),'Saved report information',()=>showReadOnly('Report information',{[family]:value}));
    function paint(loading=false){if(token!==state.searchToken)return;host.replaceChildren();const count=document.createElement('p');count.textContent=`${results.length} result${results.length===1?'':'s'}${loading?' · Searching saved history…':''}`;host.append(count);for(const item of results){const row=button(item.label,()=>{host.hidden=true;item.open();},'find-result');const detail=document.createElement('small');detail.textContent=item.detail;row.append(detail);host.append(row);}state.searchResults=results;}
    paint(Boolean(model.root));if(!model.root)return;
    try{
      await loadHistory();for(const event of state.history)if(matches(event,q))add(`history:${event.id}`,`${event.summary||event.type} · ${String(event.at).slice(0,10)}`,'Saved activity',()=>showReadOnly('Saved activity',event));
      for(const {name,handle} of await api.readEntries('backups')){if(token!==state.searchToken)return;if(!name.endsWith('.json'))continue;let value;try{value=JSON.parse(await(await handle.getFile()).text());}catch(_){continue;}for(const r of value.records||[])addRo(r,true,name);}
      paint();
    }catch(error){paint();const p=document.createElement('p');p.textContent='Some saved files could not be searched. Check folder access and try again.';host.append(p);}
  }
  document.addEventListener('moondog-recovered',async()=>{state.current=null;state.editing=false;state.loadedRoot=null;await ready();});
  document.addEventListener('moondog-data',ready);
  document.addEventListener('moondog-data',()=>{const name=$('hubStoreName');if(name)name.textContent=model.settings.store?.code&&model.settings.store?.name?.trim()?model.settings.store.name.trim():'Offline operations';});
  function refreshImportCoverage(){if(active()==='tools'&&$('dailyTools').dataset.category==='imports')renderTools('imports');}
  document.addEventListener('moondog-data',refreshImportCoverage);
  document.addEventListener('moondog-imported',refreshImportCoverage);
  document.addEventListener('moondog-navigation',e=>{if(e.detail.view==='tools')renderTools();if(e.detail.view==='settings')$('view-settings').querySelectorAll('.daily-settings-hidden').forEach(el=>el.classList.remove('daily-settings-hidden'));if(e.detail.view==='home'&&!state.editing){refreshCurrent();renderHome();}if(e.detail.anchor){const el=$(e.detail.anchor);for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;}});
  document.addEventListener('moondog-imported',()=>{if(!state.busy&&!state.editing)action(async()=>{await loadHistory();await selectNext();});else state.pending=true;});
  document.addEventListener('moondog-saved',e=>{if(e.detail.origin!=='home'&&!state.busy){state.pending=true;if(!state.editing)action(selectNext);}});
  // Automatic intake completion is an allowed boundary, but never replaces a draft.
  const observer=new MutationObserver(()=>{if($('status').classList.contains('success'))refreshCurrent();});observer.observe($('status'),{childList:true,attributes:true});
  setInterval(checkOperatingDate,30000);
  window.addEventListener('focus',checkOperatingDate);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkOperatingDate();});
  installThemeToggle();installShell();renderHome();ready();
  globalThis.__moondogDailyUI=Object.freeze({state,candidates:allTasks,selectNext,renderHome,renderTools,searchAll,settingsCategory,ready});
})();
/* Service Operations Hub theme Beta 0.10.7-beta.2. */

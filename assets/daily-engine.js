/* Pure selection rules. All record/source facts are supplied by authoritative app helpers. */
(function(root) {
  'use strict';
  const minutes=60000;
  const freshness=root.MoonDogFreshness;
  const businessTimeZone=()=>root.__moondogSettingsModel?.settings?.store?.timeZone||freshness?.DEFAULT_TIME_ZONE||Intl.DateTimeFormat().resolvedOptions().timeZone;
  const businessHour=at=>freshness?.timeParts(new Date(at),businessTimeZone())?.hour??new Date(at).getHours();
  const businessMinute=at=>{const parts=freshness?.timeParts(new Date(at),businessTimeZone());return parts?parts.hour*60+parts.minute:new Date(at).getHours()*60+new Date(at).getMinutes();};
  const businessDate=at=>freshness?.dateKey(new Date(at),businessTimeZone())||new Date(at).toLocaleDateString('en-CA');
  const phase=at=>{const hour=businessHour(at);return hour<11?'morning':hour<15?'midday':'late';};
  const lastEvent=(events,id,action)=>events.filter(e=>e.details?.taskId===id&&(!action||e.details.action===action)).at(-1);
  function preference(events,type) {
    const times=events.filter(e=>e.details?.action==='completed'&&e.details.taskType===type).slice(-30).map(e=>Number(e.details.hour)).filter(Number.isFinite);
    return times.length>=3?times.sort((a,b)=>a-b)[Math.floor(times.length/2)]:null;
  }
  function deferUntil(task,events,at) {
    const count=events.filter(e=>e.details?.taskId===task.id&&e.details.action==='deferred').length;
    let delay=task.hard?Math.max(2,10-count*2):Math.max(10,60-count*10);
    const learned=preference(events,task.type),hour=businessHour(at);
    if(!task.hard&&learned!==null&&learned>hour)delay=Math.min(180,(learned-hour)*60);
    if(task.deadline){const remaining=(Date.parse(task.deadline)-at)/minutes;if(remaining>0)delay=Math.min(delay,Math.max(1,remaining/2));}
    return new Date(at+delay*minutes).toISOString();
  }
  function followUpAt(at,days=3,scheduledDays) {
    const working = Array.isArray(scheduledDays) && scheduledDays.length ? scheduledDays : [2,3,4,5,6];
    const date=new Date(at); if (!Number.isFinite(date.valueOf())) return at;
    date.setHours(12,0,0,0);
    let count=0;
    while(count<days){date.setDate(date.getDate()+1);if(working.includes(date.getDay()))count++;}
    return date.getTime();
  }
  function eligible(task,events,at) {
    const event=events.filter(e=>e.details?.taskId===task.id&&['completed','deferred','not-an-issue'].includes(e.details.action)).at(-1);
    if(!event)return true;
    const d=event.details;
    if(task.type==='coaching' && ['completed','not-an-issue'].includes(d.action)) {
      const decline=Number.isFinite(task.actual)&&Number.isFinite(d.actual)&&task.actual<d.actual-(task.key==='cpElr'?5:3);
      if(decline)return true; // Substantial deterioration overrides a prior acknowledgment.
      if(d.action==='not-an-issue'&&d.fingerprint===task.fingerprint)return false;
      const configured=root.__moondogSettingsModel?.settings?.future?.managementSchedule?.days;
      const next=followUpAt(Date.parse(event.at||''),d.action==='not-an-issue'?7:3,configured);
      if(at<next)return false;
      return d.fingerprint!==task.fingerprint; // Requires new evidence before resurfacing.
    }
    // A saved RO action plan is authoritative until its next review date.
    // Reimporting Open ROs or refreshing source timestamps must not cause
    // the same planned work to reappear merely because it is aged.
    if(task.type==='ro' && d.action==='completed'){
      const record=task.record||{};
      const management=record.management||{};
      const reviewDate=String(management.reviewDate||'');
      const currentDay=new Date(at).toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'});
      const planned=reviewDate && /^20\\d{2}-\\d{2}-\\d{2}$/.test(reviewDate);
      const reviewed=String(management.managerReviewedOn||'');
      const newEscalation=Number(d.rank)>Number(task.rank) ||
        (management.communication==='Needs update' && !String(d.fingerprint||'').includes('Needs update'));
      if(planned && reviewDate>currentDay && !newEscalation)return false;
      if(reviewed===currentDay && !newEscalation && Date.parse(d.until)>at)return false;
    }
    // A changed source or commitment is new work; a deferral never hides escalation.
    if(d.fingerprint!==task.fingerprint||Number(d.rank)>task.rank)return true;
    if(d.action==='deferred'&&Date.parse(d.until)>at)return false;
    if(d.action==='completed'&&task.source)return true; // Current source freshness owns refresh status.
    if(d.action==='completed'&&task.once)return false;
    if(d.action==='completed'&&Date.parse(d.until)>at)return false;
    return true;
  }
  // SAPR is the only evidence here: a verified current snapshot and its own
  // report benchmarks, or a saved store standard. No advisor comparison.
  function coachingTasks(snapshot,advisors,standards,current,day) {
    if(!current||!snapshot?.validation?.saprDaysVerified||!snapshot.validation.finalTotalsVerified||!snapshot.validation.advisorDetailSheets)return [];
    const definitions=[
      ['tires','tire recommendations','review tire recommendations supported by inspection findings'],
      ['alignments','alignment recommendations','review alignment recommendations supported by inspection findings'],
      ['batteries','battery recommendations','review battery recommendations supported by test results'],
      ['chemicals','chemical recommendations','review chemical recommendations supported by service needs'],
      ['wipers','wiper recommendations','review wiper recommendations supported by inspection findings'],
      ['filters','filter recommendations','review filter recommendations supported by inspection findings'],
      ['brakes','brake recommendations','review brake recommendations supported by inspection findings']
    ];
    return advisors.flatMap(advisor=>{
      const code=String(advisor.number),row=snapshot.advisors?.[code];
      if(!row||!Number.isFinite(row.cpRO)||row.cpRO<8)return []; // Avoid tiny daily samples.
      const metrics=snapshot.validation.controllables===7&&snapshot.validation.controllableVinDenominator==='cp-ro'?snapshot.controllables?.advisors?.[code]:null;
      let opportunity;
      const elrTarget=standards?.cpElr;
      if(Number.isFinite(row.cpElr)&&Number.isFinite(elrTarget)&&elrTarget>0&&row.cpElr<elrTarget-8)
        opportunity={key:'cpElr',label:'CP ELR',action:'review labor discounts, labor pricing, hours sold and repair mix; inspect two or three verified low-ELR ROs in the source system',benchmark:'configured CP ELR target',actual:row.cpElr,target:elrTarget};
      for(const [key,label,action] of definitions){
        if(opportunity)break;
        const metric=metrics?.[key];
        if(metric&&Number.isFinite(metric.actual)&&Number.isFinite(metric.brandAverage)&&metric.actual>=0&&metric.brandAverage>0&&metric.brandAverage<=100&&metric.actual<metric.brandAverage&&metric.eligibleVins===row.cpRO){opportunity={key,label,action,benchmark:'SAPR Brand Average',actual:metric.actual,target:metric.brandAverage};break;}
      }
      const standard=standards?.mediaViewed;
      if(!opportunity&&Number.isFinite(row.mediaViewed)&&row.mediaViewed>=0&&row.mediaViewed<=100&&Number.isFinite(standard)&&standard>0&&standard<=100&&row.mediaViewed<standard)opportunity={key:'mediaViewed',label:'Media Viewed',action:'review media sharing and reinforce asking customers to view what was sent',benchmark:'current store standard',actual:row.mediaViewed,target:standard};
      if(!opportunity)return [];
      return [{id:`coaching:${code}:${opportunity.key}`,type:'coaching',title:`${advisor.name} · ${opportunity.label} needs attention`,description:`${opportunity.label}: ${opportunity.actual.toFixed(opportunity.key==='cpElr'?2:1)} vs ${opportunity.target.toFixed(opportunity.key==='cpElr'?2:1)} (${opportunity.benchmark}).`,next:`With ${advisor.name}, ${opportunity.action}.`,view:'performance',rank:6,once:false,advisor:code,key:opportunity.key,actual:opportunity.actual,target:opportunity.target,fingerprint:JSON.stringify([snapshot.periodEnd,snapshot.importedAt,opportunity.key,opportunity.actual,opportunity.target])}];
    });
  }
  function coachingTurn(tasks,events,at) {
    const available=tasks.filter(task=>eligible(task,events,at));
    if(!available.length)return null;
    const day=businessDate(at),counts=new Map();
    for(const event of events){const d=event.details;if(d?.taskType==='coaching'&&d.day===day&&['completed','deferred'].includes(d.action))counts.set(String(d.advisor),(counts.get(String(d.advisor))||0)+1);}
    return available.sort((a,b)=>(counts.get(a.advisor)||0)-(counts.get(b.advisor)||0)||String(a.advisor).localeCompare(String(b.advisor),undefined,{numeric:true}))[0];
  }
  const compare=(a,b)=>a.rank-b.rank||String(a.deadline||'9999').localeCompare(String(b.deadline||'9999'))||(b.age||0)-(a.age||0)||a.id.localeCompare(b.id);
  function phaseWeight(task,at) {
    if(task.hard||task.rank<=3)return 0;
    const current=phase(at);
    if(current==='morning'&&task.type==='arrival')return 1.5;
    if(current==='late'&&task.type==='tomorrow')return 1.5;
    if(task.type!=='ro'||!task.record||hasFuturePlan(task.record,businessDate(at)))return 0;
    const status=String(task.record.management?.status||'').toLowerCase();
    const blocker=/waiting on (parts|customer|approval|authorization|dispatch|diagnosis)|in diagnostic/.test(status);
    if(current==='morning'&&/waiter|comeback|parts|approv|authoriz|diagnos/.test(status))return 0.75;
    if(current==='midday'&&/parts|approv|authoriz|dispatch|diagnos|waiting on customer/.test(status))return 1;
    if(current==='late'&&blocker)return 0.75;
    return 0;
  }
  function selectionCompare(a,b,events,at){
    if(a.hard||b.hard)return compare(a,b);
    const hour=businessHour(at),pa=preference(events,a.type),pb=preference(events,b.type);
    const ar=a.rank+(pa!==null&&hour<pa?1:0)-phaseWeight(a,at),br=b.rank+(pb!==null&&hour<pb?1:0)-phaseWeight(b,at);
    return ar-br||compare(a,b);
  }
  function choose(tasks,events,at) {
    const available=tasks.filter(t=>eligible(t,events,at));
    const ros=available.filter(t=>t.type==='ro'), others=available.filter(t=>t.type!=='ro');
    if(ros.length){
      const codes=new Set(ros.map(t=>t.advisor));
      const day=businessDate(at);
      let visited=new Set();
      for(const e of events){const d=e.details;if(d?.taskType!=='ro'||!['completed','deferred'].includes(d.action)||d.day!==day)continue;
        if([...codes].every(c=>visited.has(c)))visited.clear();
        if(codes.has(d.advisor))visited.add(d.advisor);
      }
      let unvisited=ros.filter(t=>!visited.has(t.advisor));if(!unvisited.length)unvisited=ros;
      // Preserve turns for routine work; a verified hard risk can go first.
      const rotated=unvisited.sort((a,b)=>selectionCompare(a,b,events,at))[0],urgent=ros.filter(t=>t.hard&&t.rank<=3).sort(compare)[0];
      others.push(rotated.rank>=4&&urgent&&urgent.rank<rotated.rank?urgent:rotated);
    }
    return others.sort((a,b)=>selectionCompare(a,b,events,at))[0]||null;
  }
  const validDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  function hasFuturePlan(record,day){const m=record.management||{},action=String(m.nextAction||'').trim();return Boolean(action&&!/^(?:tbd|to be determined|unknown|n\/a|none|pending)$/i.test(action)&&validDate(m.reviewDate)&&m.reviewDate>day);}
  function stuckWork(record,day) {
    const m=record.management||{},date=m.reviewDate,action=String(m.nextAction||'').trim(),usableAction=Boolean(action&&!/^(?:tbd|to be determined|unknown|n\/a|none|pending)$/i.test(action));
    if(hasFuturePlan(record,day))return null;
    const age=Number(record.daysOpen),aged=Number.isFinite(age)&&age>=2;
    const noPlan=!usableAction||!validDate(date);
    if(aged&&age>=5&&noPlan)return {kind:'missing-plan',rank:3,title:'Build a plan to finish this RO'};
    const blocked=/waiting on (parts|customer|approval|authorization|dispatch|diagnosis)|in diagnostic/i.test(String(m.status||''));
    const updated=String(m.updatedAt||''),stamp=Date.parse(updated),verified=Number.isFinite(stamp)&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(updated);
    const lastManagementDay=verified?businessDate(stamp):'',daysSinceUpdate=lastManagementDay?Math.floor((Date.parse(day+'T12:00:00Z')-Date.parse(lastManagementDay+'T12:00:00Z'))/86400000):0;
    if(blocked&&aged&&daysSinceUpdate>=2&&noPlan)return {kind:'blocked',rank:3,title:'Unblock this RO'};
    return null;
  }
  function roTask(record,api,day,at) {
    const m=record.management||{};
    if(api.closed(m))return null;
    const core=api.priority(record,day), text=[api.status(record),record.sourceStatus,m.nextAction].join(' ').toLowerCase();
    const [reviewHour,reviewMinute]=String(m.reviewTime||'').split(':').map(Number),overdueTime=m.reviewDate===day&&Number.isFinite(reviewHour)&&Number.isFinite(reviewMinute)&&reviewHour*60+reviewMinute<=businessMinute(at);
    const needsCustomerUpdate=m.communication==='Needs update',comeback=/comeback/.test(text),waiter=/waiter/.test(text),promisedToday=/promised today/.test(text);
    const risk=needsCustomerUpdate||comeback||waiter||promisedToday;
    const stuck=stuckWork(record,day),meaningful=core<4||risk||Number(record.daysOpen)>=2||/parts|authoriz|approv|dispatch|diagnos|waiting/.test(text);
    if(!meaningful&&m.managerReviewedOn===day)return null;
    let title='Review this RO';
    if(core===0)title='Resolve this RO question';else if(core===1||overdueTime)title='Follow up on this commitment';else if(core===2)title='Keep this commitment today';else if(m.communication==='Needs update')title='Update this customer';else if(/waiter/.test(text))title='Check this waiter';else if(/comeback/.test(text))title='Review this comeback';else if(stuck)title=stuck.title;else if(/parts/.test(text))title='Follow up on parts';else if(/authoriz|approv/.test(text))title='Follow up on approval';else if(/dispatch/.test(text))title='Check dispatch';else if(/diagnos/.test(text))title='Follow up on diagnosis';
    const rank=core===0?0:core===1||overdueTime?1:core===2?2:needsCustomerUpdate?2.25:comeback?2.5:(waiter||promisedToday)?3:stuck?.rank??(core===3?4:5);
    return {id:`ro:${record.id}`,type:'ro',title,recordId:record.id,advisor:String(record.advisorCode||record.advisor||'unassigned'),rank,hard:rank<=3,age:Number(record.daysOpen)||0,deadline:m.reviewDate?`${m.reviewDate}T${m.reviewTime||'23:59'}:00`:null,fingerprint:JSON.stringify(record),record};
  }
  const api=Object.freeze({choose,eligible,preference,deferUntil,roTask,stuckWork,hasFuturePlan,phase,phaseWeight,compare,lastEvent,coachingTasks,coachingTurn});
  root.MoonDogDailyEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);

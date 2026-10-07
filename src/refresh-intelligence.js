/* Offline, source-aware refresh planning. Never substitutes unverified values. */
(function (root) {
  "use strict";

  const catalog = Object.freeze({
    "performance": { label:"SAPR", location:"DealerCentral → SAPR", facts:["gross","ELR","RO counts","advisor production","working days"] },
    "open-ro": { label:"Open RO", location:"CDK → current Open RO report", facts:["open ROs","advisor workload","repair status"] },
    "csi": { label:"CSI", location:"Dealer Dashboard → CSI Store / Responses", facts:["Dealer NPS","customer responses"] },
    "vir": { label:"VIR", location:"VIR Use Utilization report", facts:["VIR utilization"] },
    "menu-sales": { label:"Menu Sales", location:"Menu Sales workbook", facts:["menu presentation","menu penetration"] },
    "appointments": { label:"Appointments", location:"Appointment / pre-RO report", facts:["today's arrivals"] },
    "next-appointments": { label:"Next Appointments", location:"Next Appointments report or approved substitute", facts:["upcoming appointments"] },
    "media-asr": { label:"Media ASR", location:"Media ASR advisor export", facts:["advisor media activity"] },
    "media-asr-tech": { label:"Technician Media ASR", location:"Media ASR technician export", facts:["technician media activity"] },
    "efficiency": { label:"Efficiency", location:"Efficiency tracking report", facts:["technician efficiency"] },
    "sor": { label:"SOR", location:"SOR report", facts:["financial reference"] }
  });
  const empty = () => ({ schemaVersion:1, sources:{} });
  const dateValid = s => /^20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(String(s||"")) &&
    !Number.isNaN(Date.parse(s+"T12:00:00Z")) && new Date(s+"T12:00:00Z").toISOString().slice(0,10)===s;
  const day = s => typeof s==="string" ? s.slice(0,10) : "";
  const finite = n => typeof n==="number" && Number.isFinite(n) && n>=0;
  const timeStamp = v => { const n=Date.parse(v||"");return Number.isFinite(n)?n:0; };
  const timeHour = v => new Date(v).getHours();
  function sourceRecord(history,source) {
    const item=history?.sources?.[source]||{};
    return { observations:Array.isArray(item.observations)?item.observations.slice(-24):[],
      deferrals:Array.isArray(item.deferrals)?item.deferrals.slice(-24):[],
      notNowUntil:typeof item.notNowUntil==="string"?item.notNowUntil:"" };
  }
  function learn(history,source,kind,options={}) {
    if(!catalog[source]) return history||empty();
    if(!["imported","not-now","requested"].includes(kind)) return history||empty();
    const at=options.at||new Date().toISOString(), timestamp=timeStamp(at);
    if(!timestamp) return history||empty();
    const original=history&&typeof history==="object"?history:empty();
    const sources={...(original.sources||{})},entry=sourceRecord(original,source);
    if(kind==="imported") {
      const date=day(options.periodEnd||options.observedDate||at);
      const observation={at,day:dateValid(date)?date:day(at),hour:Number.isInteger(options.hour)?options.hour:timeHour(at)};
      const existing=entry.observations.findIndex(item=>item.day===observation.day);
      if(existing>=0) entry.observations.splice(existing,1);
      entry.observations.push(observation);
      entry.observations=entry.observations.slice(-24);
      entry.notNowUntil="";
    }
    if(kind==="not-now") {
      entry.deferrals.push({at,hour:Number.isInteger(options.hour)?options.hour:timeHour(at)});
      entry.deferrals=entry.deferrals.slice(-24);
      const prior=entry.deferrals.filter(item=>timestamp-timeStamp(item.at)<7*86400000).length;
      const minutes=Math.min(180,prior>=3?120:prior===2?60:30);
      entry.notNowUntil=new Date(timestamp+minutes*60000).toISOString();
    }
    if(kind==="requested") entry.lastRequested=at;
    sources[source]=entry;
    return {schemaVersion:1,sources};
  }
  function typicalHour(record) {
    const samples=record.observations.slice(-12).map(item=>item.hour).filter(hour=>Number.isInteger(hour)&&hour>=0&&hour<=23).sort((a,b)=>a-b);
    return samples.length>=4?samples[Math.floor(samples.length/2)]:null;
  }
  function plan(requests,history,{at=new Date().toISOString(),today="",limit=4}={}) {
    const current=timeStamp(at)||Date.now(),seen=new Set(),result=[];
    const sourceRequests=Array.isArray(requests)?requests:[];
    for(const request of [...sourceRequests].sort((a,b)=>(a.rank??7)-(b.rank??7))) {
      const source=String(request?.source||""),def=catalog[source];
      if(!def||seen.has(source)) continue;
      seen.add(source);
      const entry=sourceRecord(history,source),snoozeUntil=timeStamp(entry.notNowUntil);
      const safetyCritical=source==="open-ro";
      if(!safetyCritical&&snoozeUntil>current) continue;
      const median=typicalHour(entry);
      if(!safetyCritical&&median!==null && dateValid(today) &&
          day(at)===today && new Date(at).getHours()<Math.max(7,median-1) &&
          (request.rank??7)>4) continue;
      result.push({
        source,label:def.label,location:def.location,facts:[...def.facts],
        range:request.period||request.expectedPeriod||"",
        instruction:String(request.description||"").trim(),
        rank:request.rank??7,
        learnedHour:median
      });
      if(result.length>=Math.max(1,Math.min(8,limit))) break;
    }
    return result;
  }
  const civil = s => new Date(s+"T12:00:00Z");
  function operatingDayAt(year,month,nth) {
    if(!Number.isInteger(nth)||nth<1||nth>31||!Number.isInteger(year)||year<2000||year>2100) return "";
    const dates=[];
    for(let d=1;d<=31;d++) {
      const value=`${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      if(!dateValid(value)||value.slice(5,7)!==String(month).padStart(2,"0")) break;
      if(civil(value).getUTCDay()!==0) dates.push(value);
    }
    return dates[nth-1]||dates.at(-1)||"";
  }
  function workingProgress(snapshot,{today="",hour=19,closeHour=18}={}) {
    const days=snapshot?.saprDaysCompleted,total=snapshot?.saprTotalDays,end=snapshot?.periodEnd;
    if(!finite(days)||!finite(total)||total<=0||days>total||!dateValid(end)) return null;
    const open=Boolean(end===today&&civil(today).getUTCDay()!==0&&hour<closeHour&&hour>=0);
    const complete=open?Math.max(0,days-0.5):days;
    return {daysWorked:complete,workingDays:total,inProgress:open,reportedDays:days,
      progress:complete/total,asOf:end};
  }
  function matchPriorYear(current,history,options={}) {
    const active=workingProgress(current,options);
    if(!active) return {status:"unavailable",reason:"SAPR working-day counts are not verified."};
    const month=current.periodEnd.slice(5,7),year=Number(current.periodEnd.slice(0,4))-1;
    const candidates=(Array.isArray(history)?history:Object.values(history||{}))
      .filter(item=>item&&typeof item==="object"&&dateValid(item.periodEnd)&&
        item.periodEnd.startsWith(`${year}-${month}-`)&&finite(item.saprDaysCompleted)&&
        finite(item.saprTotalDays)&&item.saprDaysCompleted<=item.saprTotalDays);
    const sorted=candidates.map(snapshot=>({snapshot,gap:Math.abs(snapshot.saprDaysCompleted-active.daysWorked)}))
      .sort((a,b)=>a.gap-b.gap||String(b.snapshot.periodEnd).localeCompare(String(a.snapshot.periodEnd)));
    if(sorted.length&&sorted[0].gap<=1) return {
      status:"comparable",current:active,prior:sorted[0].snapshot,workingDayGap:sorted[0].gap,
      note:sorted[0].gap===0?"Same working-day count":"Closest verified SAPR working-day count"
    };
    const target=operatingDayAt(year,Number(month),Math.ceil(active.daysWorked));
    return {status:"needs-history",current:active,estimatedEnd:target,
      periodStart:`${year}-${month}-01`,
      reason:"No prior-year SAPR with a close working-day match. The suggested date is approximate; verify days worked on the report."};
  }
  function topFive(tasks,events,engine,at=Date.now()) {
    const ranked=(Array.isArray(tasks)?tasks:[])
      .filter(item=>item&&item.type!=="import"&&!String(item.type||"").startsWith("import:")&&
        (!engine?.eligible||engine.eligible(item,events||[],at)))
      .map(item=>({item,weight:(Number(item.rank)||7)-
        (item.type==="ro"&&Number(item.age)>0?Math.min(0.75,Number(item.age)/14):0)}))
      .sort((a,b)=>a.weight-b.weight||String(a.item.deadline||"9999").localeCompare(String(b.item.deadline||"9999"))||String(a.item.id).localeCompare(String(b.item.id)));
    const keys=new Set(),picked=[];
    for(const {item} of ranked) {
      const key=item.recordId?`ro:${item.recordId}`:item.type==="parts"?"parts":item.type==="tomorrow"?"tomorrow":item.type+":"+String(item.advisor||item.id);
      if(keys.has(key))continue;
      keys.add(key);picked.push(item);
      if(picked.length===5)break;
    }
    return picked;
  }
  const api=Object.freeze({catalog,empty,learn,plan,typicalHour,sourceRecord,workingProgress,matchPriorYear,operatingDayAt,topFive});
  root.ServiceRefreshIntelligence=api;
  if(typeof module!=="undefined")module.exports=api;
})(globalThis);

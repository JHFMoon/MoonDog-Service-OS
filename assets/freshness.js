/* Canonical MoonDog business-date, source-freshness, and metric-dependency rules. */
(function (root) {
  "use strict";

  const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const SOURCE_DEFINITIONS = Object.freeze({
    openRo: Object.freeze({ label: "Open RO", cadence: "same-business-day" }),
    sapr: Object.freeze({ label: "SAPR", cadence: "prior-operating-day" }),
    csi: Object.freeze({ label: "CSI", cadence: "cumulative-observation" }),
    nextAppointments: Object.freeze({ label: "Next Appointments", cadence: "prior-operating-day" }),
    vir: Object.freeze({ label: "VIR", cadence: "prior-operating-day" }),
    menu: Object.freeze({ label: "Menu Sales", cadence: "weekly-monday" }),
    appointments: Object.freeze({ label: "Today's Arrivals", cadence: "same-business-day-period" }),
    sor: Object.freeze({ label: "SOR", cadence: "period-bound" }),
    appointmentActivity: Object.freeze({ label: "Appointment Activity", cadence: "period-bound" }),
    efficiency: Object.freeze({ label: "Efficiency", cadence: "period-bound" }),
    mediaAsr: Object.freeze({ label: "Media ASR — Advisor", cadence: "period-bound" }),
    mediaAsrTech: Object.freeze({ label: "Media ASR — Technician", cadence: "period-bound" }),
    openRoSummary: Object.freeze({ label: "Aggregate WIP", cadence: "period-bound" }),
    supervisorWorkbook: Object.freeze({ label: "Supervisor Workbook", cadence: "state-current" })
  });

  function validDateKey(value) { return DATE_KEY.test(String(value || "")); }
  function dateKey(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return "";
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (_) {
      return dateKey(date, DEFAULT_TIME_ZONE);
    }
  }
  function timeParts(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return null;
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map((part) => [part.type, part.value]));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: parts.weekday };
    } catch (_) { return timeParts(date, DEFAULT_TIME_ZONE); }
  }
  function civilDate(date) { const [year, month, day] = String(date).split("-").map(Number); return validDateKey(date) ? new Date(Date.UTC(year, month - 1, day, 12)) : null; }
  function fromCivilDate(date) { return Number.isNaN(date?.valueOf()) ? "" : date.toISOString().slice(0, 10); }
  function addDays(date, amount) { const value = civilDate(date); if (!value) return ""; value.setUTCDate(value.getUTCDate() + Number(amount || 0)); return fromCivilDate(value); }
  function dayOfWeek(date) { return civilDate(date)?.getUTCDay(); }
  function isSunday(date) { return dayOfWeek(date) === 0; }
  function previousOperatingDay(date) { let value = addDays(date, -1); while (isSunday(value)) value = addDays(value, -1); return value; }
  function operatingDays(start, end) { const output = []; if (!validDateKey(start) || !validDateKey(end) || end < start) return output; for (let value = start; value <= end; value = addDays(value, 1)) if (!isSunday(value)) output.push(value); return output; }
  function trendMaintenance(input) {
    const {key,today,coverage={}}=input, unavailable=['not-used','temporarily-unavailable'].includes(coverage.state),
      validPoint=date=>validDateKey(date)&&date<=today,
      last=validPoint(coverage.lastPoint)?coverage.lastPoint:(coverage.presentDates||[]).filter(validPoint).at(-1)||'',missing=coverage.missingDates||[],
      required=key==='sapr'||key==='menu',optional=['nextAppointments','vir','mediaAsr','mediaAsrTech','efficiency','sor'].includes(key),
      format=input.formatDate||((date)=>date),operatingFrom=date=>{while(isSunday(date))date=addDays(date,1);return date;},
      result={kind:required?'required':optional?'optional':key==='csi'?'recoverable':'none',cadence:'',last:'',next:'',missing:[],status:'',recovery:'',note:''};
    if(key==='supervisorWorkbook')return{...result,cadence:'On demand',status:'NOT APPLICABLE',lastActivityDate:validPoint(input.lastActivityDate)?input.lastActivityDate:'',note:'Generate when needed.'};
    if(['openRo','appointments','appointmentActivity','openRoSummary'].includes(key))return{...result,cadence:key==='openRo'||key==='appointments'?'Current operational snapshot':'Reference only',status:'NONE REQUIRED',importDate:validPoint(input.currentImportDate)?input.currentImportDate:'',snapshotDate:validPoint(input.sourceSnapshotDate)?input.sourceSnapshotDate:'',lastActivityDate:validPoint(input.lastActivityDate)?input.lastActivityDate:'',note:key==='openRo'||key==='appointments'?'Historical daily trend: Not required.':'No historical trend maintenance required.'};
    if(unavailable)return{...result,status:coverage.state==='not-used'?'NOT USED':'UNAVAILABLE',note:coverage.state==='not-used'?'No report action for this store.':'Trend evidence remains pending until the source is available.'};
    if(key==='menu'){
      const latest=validPoint(coverage.lastPoint)?coverage.lastPoint:(coverage.presentReleases||[]).filter(validPoint).at(-1)||'',currentMonday=mondayFor(today),nextRelease=addDays(currentMonday,7),gaps=coverage.missingReleases||[];
      return{...result,cadence:'Weekly — Monday release',last:latest,next:gaps.includes(currentMonday)?currentMonday:nextRelease,missing:gaps,status:gaps.length?'Missing required releases':latest?`Current through ${format(latest)}`:'No verified release yet',recovery:'Each missing release needs its actual retained Menu Sales report; a current release does not rebuild prior weeks.'};
    }
    if(key==='csi'){
      const start=input.cumulativeStart&&input.cumulativeStart<input.monthStart?input.cumulativeStart:input.monthStart,
        scope=input.verifiedScope,next=`${format(start)}–${format(today)}`,
        responses=input.responsesRange?.start&&input.responsesRange?.end?`${format(input.responsesRange.start)}–${format(input.responsesRange.end)}`:'';
      return{...result,cadence:'Cumulative export',last:scope?`${format(scope.start)}–${format(scope.end)}`:'',responses,next,missing,lastReportObservation:input.lastReportObservation||'',recovery:missing.length?`One verified Dealer Dashboard CSI export covering ${next} can recover missing response history; no daily files needed.`:'Response event dates and report observation dates are distinct; a day without a response is not a missing report.',status:missing.length?'Recoverable':scope?`Verified export scope through ${format(scope.end)}`:'Verified export scope not established'};
    }
    let next=operatingFrom(today);if(last>=next)next=operatingFrom(addDays(last,1));
    result.cadence=key==='sapr'?'Daily — operating days':key==='sor'?'Optional dated financial observation':'Optional daily — operating days';
    result.last=last;result.next=next;result.missing=missing;result.financialMonth=key==='sor'?input.financialMonth||'':'';
    result.status=required?(missing.length?'Missing required dates':last&&last>coverage.expectedEnd?`Current through ${format(last)}`:coverage.expectedEnd?`Current through ${format(coverage.expectedEnd)}`:last?`Current through ${format(last)}`:'No completed operating day yet'):(last?`Current through ${format(last)}`:'No verified trend point');
    result.recovery=key==='sapr'?'Each missing day needs a separate month-to-date SAPR ending on that date; a current cumulative SAPR cannot rebuild prior points.':key==='nextAppointments'?'Each dated report supplies one point. A verified substitute can fill only its matching period; cumulative totals do not rebuild prior daily points.':key==='sor'?'The report month is a financial label, not an observation date. Only a verified source or file observation date in that month supplies a point.':'Each missing date needs an actual dated report; a current report cannot reconstruct past observations.';
    return result;
  }
  function trendMaintenanceSummary(key,plan,format=(value)=>value) {
    const date=value=>value?format(value):'None',missing=plan.missing||[];
    if(plan.status==='NOT USED'||plan.status==='UNAVAILABLE')return `${plan.status} · ${plan.note}`;
    if(plan.kind==='none'){
      if(key==='supervisorWorkbook')return `On demand · Last generated: ${plan.lastActivityDate?date(plan.lastActivityDate):'not recorded'} · Generate when needed`;
      if(key==='appointmentActivity'||key==='openRoSummary')return `Reference data · Last received: ${plan.lastActivityDate?date(plan.lastActivityDate):'not recorded'}`;
      return key==='openRo'||key==='appointments'?`${plan.importDate?`Current verified import: ${date(plan.importDate)}`:'Current verified import: not available'} · Source snapshot date: ${plan.snapshotDate?date(plan.snapshotDate):'not provided'} · Historical daily trend: not required`:plan.note;
    }
    if(plan.kind==='recoverable')return `${plan.status} · Responses present: ${plan.responses||'not established'} · Last report observation: ${date(plan.lastReportObservation)} · Verified export scope: ${plan.last||'not established'}${missing.length?` · Next useful export: ${plan.next} cumulative`:''}`;
    if(plan.kind==='required'){
      if(key==='sapr')return missing.length?`Missing required ${missing.length===1?'date':'dates'}: ${missing.map(date).join(', ')}`:plan.status;
      return `${plan.status} · Next required release: ${date(plan.next)}${missing.length?` · Missing required releases: ${missing.map(date).join(', ')}`:''}`;
    }
    if(key==='sor'){
      const month=/^\d{4}-\d{2}$/.test(plan.financialMonth||'')?new Date(`${plan.financialMonth}-01T12:00:00Z`).toLocaleDateString(undefined,{timeZone:'UTC',month:'long'}):'not established';
      return `Current observation: ${date(plan.last)} · Financial month: ${month} · Next optional observation: ${date(plan.next)}`;
    }
    return `${plan.status} · Next optional: ${date(plan.next)}`;
  }
  function csiTrendEvidence({imports=[],surveys={},today}={}) {
    const reportDates=[...new Set(imports.map(item=>item.refreshDate||dateKey(item.importedAt)).filter(date=>validDateKey(date)&&(!today||date<=today)))].sort();
    const responseDates=[...new Set(Object.values(surveys).map(item=>item.surveyDate).filter(date=>validDateKey(date)&&(!today||date<=today)))].sort();
    const advisorResponseDates=[...new Set(Object.values(surveys).filter(item=>item.advisorCode).map(item=>item.surveyDate).filter(date=>validDateKey(date)&&(!today||date<=today)))].sort();
    const unmappedAdvisorResponses=Object.values(surveys).filter(item=>validDateKey(item.surveyDate)&&(!today||item.surveyDate<=today)&&!item.advisorCode).length;
    const scopes=imports.filter(item=>item.scopeVerified&&validDateKey(item.scopeStart)&&validDateKey(item.scopeEnd)&&item.scopeStart<=item.scopeEnd&&(!today||item.scopeEnd<=today)).sort((a,b)=>a.scopeEnd.localeCompare(b.scopeEnd));
    return {reportDates,responseDates,advisorResponseDates,unmappedAdvisorResponses,lastReportObservation:reportDates.at(-1)||'',lastResponseEvent:responseDates.at(-1)||'',verifiedScope:scopes.at(-1)||null,missingDates:[]};
  }
  function trendMaintenanceAction(row,format=(value)=>value) {
    const {key,trend={},need={}}=row,missing=trend.missing||[],date=value=>value?format(value):'not established';
    if(['REFERENCE','ON DEMAND'].includes(need.state)||['NOT USED','UNAVAILABLE'].includes(trend.status))return null;
    if(key==='sapr'){
      if(missing.length)return {label:'SAPR',summary:`Missing report${missing.length===1?'':'s'}: ${missing.map(date).join(', ')}`,instruction:missing.map(value=>`Import SAPR ending ${date(value)}`).join('; ')};
      if(need.state!=='NEED NOW'&&need.state!=='NEED SOON')return null;
      return {label:'SAPR',summary:'Need current report',instruction:need.actions?.[0]||''};
    }
    if(key==='menu'){
      if(missing.length)return {label:'Menu Sales',summary:`Missing release${missing.length===1?'':'s'}: ${missing.map(date).join(', ')}`,instruction:'Import the actual missing Monday release report.'};
      if(need.state!=='NEED NOW'&&need.state!=='NEED SOON')return null;
      return {label:'Menu Sales',summary:'Need current Monday release',instruction:need.actions?.[0]||''};
    }
    if(key==='csi'){
      if(need.state!=='NEED NOW'&&need.state!=='NEED SOON')return null;
      return {label:'CSI — Store / Responses',summary:`Need current report · Last verified report: ${date(trend.lastReportObservation)}`,instruction:need.actions?.[0]||''};
    }
    if(need.state!=='NEED NOW'&&need.state!=='NEED SOON')return null;
    if(trend.kind==='optional')return {label:row.source||need.label||key,summary:need.reason||'A newer verified observation is needed for the active trend.',instruction:need.actions?.[0]||''};
    if(key==='openRo'||key==='appointments')return {label:row.source||need.label||key,summary:need.reason||'Current operational evidence is needed.',instruction:need.actions?.[0]||''};
    return null;
  }
  function trendMaintenanceActions(rows,format=(value)=>value) { return rows.map(row=>trendMaintenanceAction(row,format)).filter(Boolean); }
  function mondayFor(date) { const weekday = dayOfWeek(date); return weekday === undefined ? "" : addDays(date, -((weekday + 6) % 7)); }
  function lastDayOfMonth(month) { const match = String(month || "").match(/^(\d{4})-(\d{2})$/); if (!match) return ""; return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0, 12)).toISOString().slice(0, 10); }
  function previousMonth(date) { const match = String(date || "").match(/^(\d{4})-(\d{2})/); if (!match) return ""; return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1, 12)).toISOString().slice(0, 7); }
  function finalOperatingDay(month) { let value = lastDayOfMonth(month); while (isSunday(value)) value = addDays(value, -1); return value; }
  function adjacentWindows(end, length = 7) { const currentStart = addDays(end, -(length - 1)), priorEnd = addDays(currentStart, -1), priorStart = addDays(priorEnd, -(length - 1)); return { current: { start: currentStart, end }, previous: { start: priorStart, end: priorEnd } }; }

  function result(input, status, details = {}) {
    const definition = SOURCE_DEFINITIONS[input.key] || { label: input.key, cadence: input.cadence || "period-bound" };
    const loaded = Boolean(input.exists);
    const safeForCurrent = status === "current";
    const safeForPurpose = safeForCurrent || status === "historical-valid";
    return Object.freeze({ key: input.key, label: definition.label, cadence: input.cadence || definition.cadence, loaded, status, safeForCurrent, safeForPurpose, sourceTimestamp: input.sourceTimestamp || "", periodStart: input.periodStart || "", periodEnd: input.periodEnd || "", expectedPeriod: details.expectedPeriod || "", reason: details.reason || "", requiredAction: details.requiredAction || "", ...details });
  }
  function evaluateSource(input) {
    const definition = SOURCE_DEFINITIONS[input.key] || { label: input.key, cadence: input.cadence || "period-bound" }, cadence = input.cadence || definition.cadence, today = input.today || dateKey(input.at, input.timeZone || DEFAULT_TIME_ZONE), expectation = input.expectation || "recommended";
    if (expectation === "not-used") return result(input, "not-used", { reason: "This source is configured as not used." });
    if (expectation === "temporarily-unavailable" && !input.exists) return result(input, "temporarily-unavailable", { reason: "This source is configured as temporarily unavailable." });
    if (!input.exists) return result(input, "missing", { reason: "No validated source is loaded.", requiredAction: `Load ${definition.label}.` });
    if (input.invalid) return result(input, "invalid", { reason: input.invalid, requiredAction: input.requiredAction || `Load a corrected ${definition.label} source.` });
    if (input.purpose === "historical") {
      const targetStart = input.targetStart || input.targetEnd, targetEnd = input.targetEnd || input.targetStart;
      const periodValid = validDateKey(targetEnd) && validDateKey(input.periodEnd) && input.periodEnd >= targetEnd && (!validDateKey(targetStart) || !validDateKey(input.periodStart) || input.periodStart <= targetStart);
      return periodValid ? result(input, "historical-valid", { expectedPeriod: [targetStart, targetEnd].filter(Boolean).join(" through "), reason: "The source covers its requested historical period." }) : result(input, "stale", { expectedPeriod: [targetStart, targetEnd].filter(Boolean).join(" through "), reason: "The loaded source does not cover the requested historical period.", requiredAction: `Load ${definition.label} covering the requested historical period.` });
    }
    let current = false, expectedPeriod = "", reason = "", requiredAction = "";
    if (cadence === "same-business-day") {
      const sourceDate = input.sourceDate || dateKey(input.sourceTimestamp, input.timeZone || DEFAULT_TIME_ZONE);
      expectedPeriod = today; current = sourceDate === today;
      reason = current ? "Imported during the current store business date." : `Last source date is ${sourceDate || "unknown"}; expected ${today}.`;
    } else if (cadence === "cumulative-observation") {
      // CSI can legitimately contain no new surveys. Freshness is about a validated
      // report observation or verified report scope, never its response count.
      const expected = previousOperatingDay(today);
      const scopeVerified = input.scopeVerified === true;
      const observed = input.observationVerified === true
        ? (input.sourceDate || (input.sourceTimestamp ? dateKey(input.sourceTimestamp, input.timeZone || DEFAULT_TIME_ZONE) : ""))
        : "";
      const covered = scopeVerified ? (input.scopeEnd || input.periodEnd || "") : "";
      expectedPeriod = expected;
      // A verified cumulative scope is authoritative. Re-importing an old report today
      // must never make that old scope current. Without verified scope, only a report-
      // supplied/validated observation date may establish currentness.
      current = scopeVerified
        ? (validDateKey(covered) && covered >= expected && covered <= today)
        : (validDateKey(observed) && observed >= expected && observed <= today);
      reason = current
        ? "A recent validated CSI report is available; zero new responses is valid."
        : `Last verified CSI observation ${observed || "unknown"}; expected a report observed since ${expected}. Survey event dates do not determine freshness.`;
    } else if (cadence === "same-business-day-period") {
      expectedPeriod = today; current = input.periodStart === today || input.periodEnd === today;
      reason = current ? "The source represents the current store business date." : `Loaded period does not represent ${today}.`;
    } else if (cadence === "prior-operating-day") {
      const expected = previousOperatingDay(today); expectedPeriod = expected; current = validDateKey(input.periodEnd) && input.periodEnd >= expected && input.periodEnd <= today;
      reason = current ? `Reporting period covers the prior completed operating day (${expected}).` : `Report ends ${input.periodEnd || "on an unknown date"}; expected coverage through ${expected}.`;
    } else if (cadence === "weekly-monday") {
      const expected = mondayFor(today), represented = input.releaseWeek || input.periodEnd; expectedPeriod = expected; current = validDateKey(represented) && represented >= expected && represented <= today;
      reason = current ? `Current Monday release (${expected}) is loaded.` : `Loaded release is ${represented || "unknown"}; expected Monday ${expected}.`;
    } else if (cadence === "state-current") {
      expectedPeriod = today; current = input.stale !== true;
      reason = current ? "The durable artifact matches current state." : "The durable artifact predates current state changes.";
    } else {
      return result(input, "historical-valid", { expectedPeriod: input.periodStart && input.periodEnd ? `${input.periodStart} through ${input.periodEnd}` : input.periodEnd || input.periodStart || "source-defined period", reason: "No current-day cadence is established; this source is valid only for its stated reporting period." });
    }
    if (!current) requiredAction = input.requiredAction || `Load ${definition.label} for ${expectedPeriod}.`;
    return result(input, current ? "current" : "stale", { expectedPeriod, reason, requiredAction });
  }
  // Report completeness is evidence, not an automatic obligation to pull files.
  const REPORT_PURPOSES = Object.freeze({
    openRo: 'CURRENT OPERATIONAL', appointments: 'CURRENT OPERATIONAL',
    sapr: 'REQUIRED TREND', csi: 'CUMULATIVE / RECOVERABLE', menu: 'WEEKLY',
    nextAppointments: 'OPTIONAL TREND', vir: 'OPTIONAL TREND',
    mediaAsr: 'OPTIONAL TREND', mediaAsrTech: 'OPTIONAL TREND',
    efficiency: 'OPTIONAL TREND', sor: 'OPTIONAL TREND / FINANCIAL REFERENCE',
    appointmentActivity: 'REFERENCE / ARCHIVAL', openRoSummary: 'REFERENCE / ARCHIVAL',
    supervisorWorkbook: 'GENERATED ON DEMAND'
  });
  function evaluateReportNeed(input) {
    const {key, evidence = {}} = input, today = input.today || dateKey(),
      purpose = REPORT_PURPOSES[key], label = SOURCE_DEFINITIONS[key]?.label || key;
    const finish = (state, reason, actions = []) => Object.freeze({key, label, purpose,
      state, reason, actions: Object.freeze(actions), actionable: state === 'NEED NOW'});
    if (purpose === 'GENERATED ON DEMAND') return finish('ON DEMAND', 'Generate from current Open RO only when requested.');
    if (purpose === 'REFERENCE / ARCHIVAL') return finish('REFERENCE', 'Retain if supplied. No recurring report or historical backfill required.');
    if (input.expectation === 'not-used' || evidence.status === 'not-used') return finish('OPTIONAL', 'Not used at this store. No action needed.');
    if (input.expectation === 'temporarily-unavailable' || evidence.status === 'temporarily-unavailable') return finish('OPTIONAL', 'Temporarily unavailable. Evidence remains unknown; no pull request until available.');
    const trustedDate = value => validDateKey(value) && fromCivilDate(civilDate(value)) === value;
    const optional = purpose?.startsWith('OPTIONAL'), prior = previousOperatingDay(today),
      observation = input.observationDate || '',
      datedCurrent = trustedDate(observation) && observation >= prior && observation <= today,
      current = input.currentSnapshot === true || (!input.legacyUnsafe && (evidence.safeForCurrent || (evidence.loaded && evidence.status === 'historical-valid' && datedCurrent))),
      missing = (input.missingDates || []).filter(date => trustedDate(date) && date.slice(0,7) === today.slice(0,7) && date < today && !isSunday(date)),
      active = Boolean(input.activeFeature), soon = Boolean(input.soonFeature);
    if (optional && !active && !soon) return finish(current ? 'CURRENT' : 'OPTIONAL', current ? 'Current trend is usable; additional dated observations are optional.' : 'Optional trend depth. No historical backfill required.');
    if (key === 'appointments' && !input.arrivalPlanning) return finish(current ? 'CURRENT' : 'OPTIONAL', 'Today’s arrival planning does not currently require a report. Historical arrivals are not requested.');
    if (isSunday(today)) return finish(current ? 'CURRENT' : 'OPTIONAL', 'Sunday: no report pull required. Retained evidence and unknowns remain unchanged.');
    let action = evidence.requiredAction || `Import one current valid ${label} report.`;
    if (key === 'csi') action = 'Import the latest available validated Dealer Dashboard CSI Store / Responses report (zero responses is valid).';
    if (key === 'openRo') action = `Pull a fresh Open RO report for ${today}.`;
    if (key === 'appointments') action = `Load today's appointments or pre-RO packet for ${today}.`;
    if (key === 'nextAppointments') action = 'Import one current valid Next Appointments report or the approved service-only substitute; either satisfies the same NSA authority.';
    if (!current) {
      const reason = optional ? `${input.legacyUnsafe ? 'Legacy percentage evidence needs verification. ' : ''}${input.activeFeature || input.soonFeature} needs a current verified ${label} report.` : key === 'menu' ? `The Monday release ${mondayFor(today)} is due.` : `Current ${label} evidence is missing, invalid or stale for its operational purpose.`;
      return finish(optional && soon && !active ? 'NEED SOON' : 'NEED NOW', reason, [action]);
    }
    if (key === 'sapr' && missing.length) return finish('NEED SOON', 'Current SAPR is usable; missing completed operating-day snapshots limit the required month trend.', missing.map(date => `Run SAPR ${today.slice(0,7)}-01 through ${date}.`));
    // CSI has no required daily response events. Empty survey days are not gaps.
    return finish('CURRENT', key === 'menu' ? 'Weekly report current. Historical release gaps are evidence details, not daily tasks.' : 'Evidence is sufficient for the current purpose.');
  }
  function evaluateMetric(dependencies = []) {
    const blocking = dependencies.filter((item) => !item?.safeForPurpose && !["not-used", "temporarily-unavailable"].includes(item?.status));
    return Object.freeze({ verified: blocking.length === 0, status: blocking[0]?.status || "verified", blocking, dependencies });
  }

  root.MoonDogFreshness = Object.freeze({ DEFAULT_TIME_ZONE, SOURCE_DEFINITIONS, REPORT_PURPOSES, evaluateReportNeed, trendMaintenance, trendMaintenanceSummary, trendMaintenanceAction, trendMaintenanceActions, csiTrendEvidence, validDateKey, dateKey, timeParts, addDays, dayOfWeek, isSunday, previousOperatingDay, operatingDays, mondayFor, lastDayOfMonth, previousMonth, finalOperatingDay, adjacentWindows, evaluateSource, evaluateMetric });
  if (typeof module !== "undefined") module.exports = root.MoonDogFreshness;
})(globalThis);
// BEGIN GENERATED REFRESH INTELLIGENCE (see src/refresh-intelligence.js)
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
})(globalThis);
// END GENERATED REFRESH INTELLIGENCE

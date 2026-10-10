/* Optional, export-only mobile snapshot. Never edits Workspace, sends data, or embeds identifiers. */
(function (root) {
  "use strict";

  function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
  function whole(value) { return finite(value) === null ? "--" : Math.round(value).toLocaleString("en-US"); }
  function money(value) { return finite(value) === null ? "--" : "$" + Math.round(value).toLocaleString("en-US"); }
  function fixed(value, places) { return finite(value) === null ? "--" : value.toFixed(places); }
  function civilDate(value) {
    return typeof value === "string" && /^20\d\d-\d\d-\d\d$/.test(value.slice(0,10)) ? value.slice(0,10) : "Not verified";
  }
  function validSnapshot(item) {
    return Boolean(item && item.validation?.saprDaysVerified === true &&
      item.validation?.finalTotalsVerified === true &&
      Number(item.validation?.advisorDetailSheets) > 0 && civilDate(item.periodEnd) !== "Not verified");
  }

  // Deliberate allowlist: never clone, serialize, or interpolate private source objects.
  function summarize(model, api, at = new Date()) {
    if (!model?.root || model.connectionState !== "CONNECTED") {
      throw new Error("Connect the desktop working folder before saving a mobile report.");
    }
    const today = typeof api?.date === "function" ? api.date() : at.toISOString().slice(0, 10);
    const knownOpenSource = Boolean(model.state?.source?.importedAt || model.state?.source?.fileName ||
      model.state?.source?.file || model.state?.source?.sourceFile || model.state?.source?.name);
    const records = Array.isArray(model.state?.records) ? model.state.records : [];
    const isClosed = record => typeof api?.closed === "function" ? api.closed(record.management || {}) :
      String(record.management?.status || "").toLowerCase() === "closed";
    const open = knownOpenSource ? records.filter(record => !isClosed(record)) : null;
    const snapshots = Object.values(model.performance?.snapshots || {}).filter(validSnapshot)
      .sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)) ||
        String(a.importedAt || "").localeCompare(String(b.importedAt || "")));
    const sapr = snapshots.at(-1) || null;
    const advisors = sapr ? Object.entries(sapr.advisors || {}).filter(([code]) => {
      const configured = model.settings?.advisors?.[code];
      return configured && !configured.removed && configured.active !== false &&
        configured.participation?.advisorMeeting === true;
    }).map(([, row]) => ({
      gross: finite(row.totalGross), hours: finite(row.cpHours),
      elr: finite(row.cpElr), cpRO: finite(row.cpRO)
    })).sort((a,b) => (b.gross ?? -Infinity) - (a.gross ?? -Infinity)).slice(0,8) : [];

    return {
      generated: at.toISOString(), operatingDate: civilDate(today),
      openSource: knownOpenSource ? civilDate(model.state?.source?.importedAt || model.state?.source?.date ||
        model.state?.source?.snapshotDate || model.state?.updatedAt) : "Not imported",
      saprDate: sapr ? civilDate(sapr.periodEnd) : "Not verified",
      open: open && open.length, due: open && open.filter(r => r.management?.reviewDate === today).length,
      overdue: open && open.filter(r => r.management?.reviewDate && r.management.reviewDate < today).length,
      needsUpdate: open && open.filter(r => r.management?.communication === "Needs update").length,
      noPlan: open && open.filter(r => !String(r.management?.nextAction || "").trim() ||
        !String(r.management?.reviewDate || "").trim()).length,
      gross: finite(sapr?.store?.totalGross), elr: finite(sapr?.store?.cpElr),
      cpHours: finite(sapr?.store?.cpHours), closedROs: finite(sapr?.store?.totalRO),
      advisors
    };
  }

  function ascii(value) {
    return String(value).normalize("NFKD").replace(/[^\x20-\x7e]/g, "?")
      .replace(/[\\()]/g, "\\$&").slice(0, 100);
  }
  function makePdf(summary) {
    const cmds = [];
    const rect = (x,y,w,h,r,g,b) => cmds.push(
      [r,g,b].map(n=>n.toFixed(3)).join(" ") + " rg " + [x,y,w,h].join(" ") + " re f");
    const line = (x1,y1,x2,y2,r=.85,g=.88,b=.91) => {
      cmds.push([r,g,b].map(n=>n.toFixed(3)).join(" ") + " RG 1 w " +
        x1+" "+y1+" m "+x2+" "+y2+" l S");
    };
    const label = (x,y,size,str,bold=false,r=.12,g=.18,b=.23) => {
      cmds.push([r,g,b].map(n=>n.toFixed(3)).join(" ")+" rg BT /"+
        (bold?"F2":"F1")+" "+size+" Tf 1 0 0 1 "+x+" "+y+" Tm ("+ascii(str)+") Tj ET");
    };
    // A4 portrait: native iPhone OneDrive/Edge PDF preview works without scripts or stylesheets.
    rect(0,0,595,842,1,1,1);
    rect(0,706,595,136,.070,.200,.245);
    label(34,805,12,"MOONDOG  /  MOBILE SNAPSHOT",true,1,1,1);
    label(34,764,27,"Service drive at a glance",true,1,1,1);
    label(34,738,11,"READ ONLY   -   GENERATED " + summary.generated.slice(0,16).replace("T"," "),false,.79,.91,.93);
    label(34,718,10,"Not live. Refresh from desktop after importing new reports.",false,.78,.89,.92);

    label(34,682,13,"SERVICE WORK IN PROGRESS",true);
    label(34,663,9,"Open RO source: " + summary.openSource + "   |   Working date: " + summary.operatingDate,
      false,.34,.42,.49);
    const cards = [
      ["Open ROs",whole(summary.open)],["Overdue",whole(summary.overdue)],
      ["Due today",whole(summary.due)],["Need update",whole(summary.needsUpdate)]
    ];
    cards.forEach(([name,val],i) => {
      const x=34+(i%2)*268,y=565-Math.floor(i/2)*89;
      rect(x,y,255,77,.945,.966,.973);
      label(x+14,y+49,11,name,false,.32,.42,.47);
      label(x+14,y+14,28,val,true);
    });
    label(35,385,11,"Missing next-action / review plans: " + whole(summary.noPlan),true);

    line(34,365,561,365);
    label(34,340,13,"PERFORMANCE  /  VERIFIED SAPR ONLY",true);
    label(34,320,9,"Last verified SAPR report period end: " + summary.saprDate,false,.34,.42,.49);
    [
      ["MTD gross",money(summary.gross)],["CP ELR",money(summary.elr)],
      ["CP hours / RO",fixed(summary.cpHours,2)],["Closed ROs",whole(summary.closedROs)]
    ].forEach(([name,val],i)=>{
      const x=34+(i%2)*268,y=231-Math.floor(i/2)*65;
      rect(x,y,255,56,.960,.971,.979);
      label(x+12,y+34,10,name,false,.34,.42,.49);
      label(x+12,y+8,19,val,true);
    });
    label(34,130,12,"Advisor production",true);
    if(summary.advisors.length) {
      label(34,112,9,"Anonymized ranking by reported total gross; no employee identities.",false,.34,.42,.49);
      const top=summary.advisors.slice(0,3);
      top.forEach((row,index)=>label(34,96-index*17,10,
        "Rank "+(index+1)+"   Gross "+money(row.gross)+"   CP ELR "+money(row.elr)+
        "   CP ROs "+whole(row.cpRO),false,.16,.27,.33));
    } else {
      label(34,107,10,"No verified, configured advisor breakdown available.",false,.34,.42,.49);
    }
    line(34,39,561,39);
    label(34,26,9,"Aggregate figures only. No names, VINs, RO numbers or narratives.",false,.38,.46,.52);
    label(34,13,9,"Keep in approved company storage. Never a live dashboard.",false,.38,.46,.52);

    const content=cmds.join("\n")+"\n";
    const objects=[
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      "<< /Length "+content.length+" >>\nstream\n"+content+"endstream"
    ];
    let result="%PDF-1.4\n",offsets=[0];
    objects.forEach((obj,i)=>{offsets.push(result.length);result+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
    const crossRefStart=result.length;
    result+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";
    for(const offset of offsets.slice(1))result+=String(offset).padStart(10,"0")+" 00000 n \n";
    result+="trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+
      crossRefStart+"\n%%EOF\n";
    const bytes=new Uint8Array(result.length);
    for(let i=0;i<result.length;i++)bytes[i]=result.charCodeAt(i);
    return bytes;
  }

  async function save(model, api, environment=root) {
    const summary=summarize(model,api);
    const bytes=makePdf(summary);
    const blob=new Blob([bytes],{type:"application/pdf"});
    const filename="MoonDog-Read-Only-"+summary.generated.slice(0,10)+".pdf";
    if(typeof environment.showSaveFilePicker==="function") {
      try {
        const handle=await environment.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]
        });
        const writable=await handle.createWritable();
        try { await writable.write(blob); await writable.close(); }
        catch(error) { try { await writable.abort?.(); } catch(_) {} throw error; }
        return {status:"saved",mode:"picked",filename};
      } catch(error) {
        if(error?.name==="AbortError")return {status:"cancelled",filename};
        throw error;
      }
    }
    const url=environment.URL.createObjectURL(blob),anchor=environment.document.createElement("a");
    anchor.href=url;anchor.download=filename;
    environment.document.body.append(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      environment.setTimeout(()=>environment.URL.revokeObjectURL(url),60000);
    }
    return {status:"downloaded",mode:"download",filename};
  }


  function htmlEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[char]);
  }
  function displayDate(value) {
    if (!value) return "—";
    const text=String(value);
    if (/^20\d\d-\d\d-\d\d$/.test(text.slice(0,10))) return text.slice(0,10);
    const date=new Date(value);
    return Number.isNaN(date.valueOf()) ? text : date.toLocaleString();
  }
  function latestVerifiedSapr(model) {
    return Object.values(model.performance?.snapshots || {}).filter(validSnapshot)
      .sort((a,b)=>String(a.periodEnd).localeCompare(String(b.periodEnd)) ||
        String(a.importedAt||"").localeCompare(String(b.importedAt||""))).at(-1) || null;
  }
  function mobilePageData(model, api, priorities=[], at=new Date()) {
    if (!model?.root || model.connectionState !== "CONNECTED")
      throw new Error("Connect the desktop working folder before publishing the mobile page.");
    const today=typeof api?.date==="function"?api.date():at.toISOString().slice(0,10);
    const statusFor=record=>{
      try { return typeof api?.status==="function" ? api.status(record) : record.management?.status||record.sourceStatus||""; }
      catch(_) { return record.management?.status||record.sourceStatus||""; }
    };
    const closed=record=>{
      try { return typeof api?.closed==="function" ? api.closed(record.management||{}) :
        String(record.management?.status||"").toLowerCase()==="closed"; }
      catch(_) { return false; }
    };
    const records=(model.state?.records||[]).filter(record=>!closed(record)).sort((a,b)=>{
      const pa=a.management?.reviewDate&&a.management.reviewDate<today?0:a.management?.reviewDate===today?1:!a.management?.nextAction?2:3;
      const pb=b.management?.reviewDate&&b.management.reviewDate<today?0:b.management?.reviewDate===today?1:!b.management?.nextAction?2:3;
      return pa-pb||String(a.management?.reviewDate||"9999").localeCompare(String(b.management?.reviewDate||"9999"))||
        Number(b.daysOpen||0)-Number(a.daysOpen||0)||String(a.ro||"").localeCompare(String(b.ro||""),undefined,{numeric:true});
    });
    const sapr=latestVerifiedSapr(model);
    const advisors=sapr?Object.entries(sapr.advisors||{}).map(([code,row])=>{
      const configured=model.settings?.advisors?.[code];
      if(!configured||configured.removed||configured.active===false)return null;
      return {code,name:configured.name||configured.displayName||row.name||code,gross:finite(row.totalGross),
        cpRO:finite(row.cpRO),elr:finite(row.cpElr),hours:finite(row.cpHours)};
    }).filter(Boolean).sort((a,b)=>(b.gross??-Infinity)-(a.gross??-Infinity)):[];

    const reportRows=typeof api?.imports==="function" ? api.imports().map(item=>({
      source:item.source||item.label||"Report",status:item.status||item.state||"",
      period:item.period||item.coverage||item.date||"",updated:item.importedAt||item.updatedAt||item.lastSuccessfulRefreshAt||""
    })) : [];
    return {
      generated:at.toISOString(),today,store:model.settings?.store?.name||"Service Operations",
      openSource:model.state?.source?.sourceModifiedAt||model.state?.source?.importedAt||model.state?.updatedAt||"",
      saprDate:sapr?.periodEnd||"", priorities:(priorities||[]).slice(0,3).map(item=>({
        title:item.title||"Management attention",description:item.description||"",
        next:item.next||item.record?.management?.nextAction||"",ro:item.record?.ro||""
      })),
      counts:{open:records.length,overdue:records.filter(r=>r.management?.reviewDate&&r.management.reviewDate<today).length,
        due:records.filter(r=>r.management?.reviewDate===today).length,
        needsUpdate:records.filter(r=>r.management?.communication==="Needs update").length,
        noPlan:records.filter(r=>!String(r.management?.nextAction||"").trim()||!String(r.management?.reviewDate||"").trim()).length},
      storePerformance:{gross:finite(sapr?.store?.totalGross),elr:finite(sapr?.store?.cpElr),
        hours:finite(sapr?.store?.cpHours),ros:finite(sapr?.store?.totalRO)},
      standards:{gross:finite(model.settings?.performanceStandards?.storeGrossTarget),
        elr:finite(model.settings?.performanceStandards?.cpElr),
        hours:finite(model.settings?.performanceStandards?.cpHoursPerRo)},
      advisors,reportRows,
      records:records.map(record=>({
        ro:record.ro||"",customer:record.customer||"",vehicle:record.vehicle||record.tagNumber||"",
        vin:record.vin||"",advisor:record.advisor||record.advisorCode||"",
        technician:record.management?.currentTechnician||record.technician||record.technicianCode||"",
        sourceStatus:record.sourceStatus||"",status:statusFor(record),
        next:record.management?.nextAction||"",reviewDate:record.management?.reviewDate||"",
        reviewTime:record.management?.reviewTime||"",communication:record.management?.communication||"",
        owner:record.management?.owner||"",note:record.management?.note||"",
        opened:record.opened||record.openedDate||"",daysOpen:record.daysOpen??""
      }))
    };
  }
  function metric(label,value,target,format="whole") {
    const render=format==="money"?money:format==="fixed"?v=>fixed(v,2):whole;
    const targetText=target===null?"":'<small>Target '+htmlEscape(render(target))+'</small>';
    return '<article class="metric"><span>'+htmlEscape(label)+'</span><strong>'+htmlEscape(render(value))+
      '</strong>'+targetText+'</article>';
  }
  function makeHtml(model, api, priorities=[], at=new Date()) {
    const data=mobilePageData(model,api,priorities,at);
    const priorityHtml=data.priorities.length?data.priorities.map((item,index)=>
      '<article class="priority"><span class="rank">'+(index+1)+'</span><div><h3>'+htmlEscape(item.title)+'</h3>'+
      (item.ro?'<p class="muted">RO '+htmlEscape(item.ro)+'</p>':'')+
      (item.description?'<p>'+htmlEscape(item.description)+'</p>':'')+
      (item.next?'<p class="next"><b>Next:</b> '+htmlEscape(item.next)+'</p>':'')+'</div></article>').join(""):
      '<p class="empty">No management priority is currently ready.</p>';
    const advisorHtml=data.advisors.length?data.advisors.map(row=>
      '<tr><td><b>'+htmlEscape(row.name)+'</b><small>'+htmlEscape(row.code)+'</small></td>'+
      '<td>'+htmlEscape(money(row.gross))+'</td><td>'+htmlEscape(whole(row.cpRO))+'</td>'+
      '<td>'+htmlEscape(money(row.elr))+'</td><td>'+htmlEscape(fixed(row.hours,2))+'</td></tr>').join(""):
      '<tr><td colspan="5">No verified advisor SAPR rows available.</td></tr>';
    const reportHtml=data.reportRows.length?data.reportRows.map(row=>
      '<tr><td><b>'+htmlEscape(row.source)+'</b></td><td>'+htmlEscape(row.status||"—")+'</td>'+
      '<td>'+htmlEscape(row.period||"—")+'</td><td>'+htmlEscape(displayDate(row.updated))+'</td></tr>').join(""):
      '<tr><td colspan="4">No report coverage rows available.</td></tr>';
    const roHtml=data.records.length?data.records.map(record=>{
      const due=record.reviewDate&&record.reviewDate<data.today?' overdue':record.reviewDate===data.today?' due':'';
      return '<details class="ro'+due+'"><summary><span><b>RO '+htmlEscape(record.ro)+'</b> · '+htmlEscape(record.customer||"Customer")+
        '</span><span>'+htmlEscape(record.advisor||"Unassigned")+'</span></summary><div class="robody">'+
        '<div><span>Vehicle</span><b>'+htmlEscape(record.vehicle||"—")+'</b>'+(record.vin?'<small>'+htmlEscape(record.vin)+'</small>':'')+'</div>'+
        '<div><span>Status</span><b>'+htmlEscape(record.status||"—")+'</b><small>'+htmlEscape(record.sourceStatus||"")+'</small></div>'+
        '<div><span>Technician</span><b>'+htmlEscape(record.technician||"—")+'</b></div>'+
        '<div><span>Owner</span><b>'+htmlEscape(record.owner||record.advisor||"—")+'</b></div>'+
        '<div class="wide"><span>Next action</span><b>'+htmlEscape(record.next||"No next action")+'</b></div>'+
        '<div><span>Follow-up</span><b>'+htmlEscape(record.reviewDate||"Not set")+(record.reviewTime?' · '+htmlEscape(record.reviewTime):'')+'</b></div>'+
        '<div><span>Customer update</span><b>'+htmlEscape(record.communication||"—")+'</b></div>'+
        '<div><span>Opened / age</span><b>'+htmlEscape(record.opened||"—")+(record.daysOpen!==""?' · '+htmlEscape(record.daysOpen)+' days':'')+'</b></div>'+
        (record.note?'<div class="wide"><span>Manager note</span><p>'+htmlEscape(record.note)+'</p></div>':'')+
        '</div></details>';
    }).join(""):'<p class="empty">No current open ROs.</p>';
    const generated=new Date(data.generated);
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+
      '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer">'+
      '<meta http-equiv="refresh" content="300"><title>MoonDog Mobile · Read Only</title><style>'+
      ':root{color-scheme:light dark;--bg:#f2f6f7;--card:#fff;--text:#17252d;--muted:#60737c;--line:#d5e0e4;--accent:#0e5e71;--warn:#a04f12;--bad:#a22727}'+
      '@media(prefers-color-scheme:dark){:root{--bg:#0d1519;--card:#152126;--text:#eef6f8;--muted:#a7bbc2;--line:#2d424a;--accent:#63bdd0;--warn:#e4a25f;--bad:#f08585}}'+
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'+
      'header{padding:24px 18px 18px;background:#102f39;color:#fff}header h1{font-size:26px;margin:3px 0 5px}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.78}.stamp{font-size:12px;opacity:.8}.readonly{margin-top:12px;padding:8px 10px;border:1px solid #5b8996;border-radius:8px;font-size:12px}'+
      'main{max-width:900px;margin:auto;padding:16px}.section{margin:0 0 22px}.section>h2{font-size:16px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px}.muted,small{color:var(--muted)}'+
      '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.metric{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}.metric span,.metric small{display:block;font-size:11px}.metric strong{display:block;font-size:24px;margin:3px 0}'+
      '.priority{display:grid;grid-template-columns:34px 1fr;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:8px 0}.priority h3{font-size:16px;margin:0 0 4px}.priority p{margin:4px 0}.rank{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700}.next{border-top:1px solid var(--line);padding-top:7px}'+
      '.tablewrap{overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:560px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);font-size:13px}th{font-size:11px;text-transform:uppercase;color:var(--muted)}td small{display:block}'+
      '.ro{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:8px 0;overflow:hidden}.ro.overdue{border-left:4px solid var(--bad)}.ro.due{border-left:4px solid var(--warn)}summary{display:flex;justify-content:space-between;gap:12px;padding:12px;cursor:pointer}.robody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:0 12px 14px;border-top:1px solid var(--line)}.robody>div{padding-top:10px}.robody span,.robody small{display:block;font-size:11px;color:var(--muted)}.robody b{display:block}.wide{grid-column:1/-1}.wide p{margin:3px 0}.empty{padding:14px;background:var(--card);border:1px solid var(--line);border-radius:12px}footer{padding:14px 18px 26px;text-align:center;color:var(--muted);font-size:11px}'+
      '@media(max-width:520px){main{padding:12px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric strong{font-size:21px}.robody{grid-template-columns:1fr}.wide{grid-column:auto}summary{display:block}summary>span{display:block}table{min-width:520px}}'+
      '</style></head><body><header><div class="eyebrow">MOONDOG · PRIVATE MOBILE VIEW</div><h1>'+htmlEscape(data.store)+'</h1>'+
      '<div class="stamp">Updated '+htmlEscape(generated.toLocaleString())+' · Open RO source '+htmlEscape(displayDate(data.openSource))+
      ' · SAPR '+htmlEscape(data.saprDate||"Not verified")+'</div><div class="readonly"><b>READ ONLY</b> · This page is a snapshot generated by the desktop dashboard. It cannot change MoonDog data. Refreshes every 5 minutes while open.</div></header><main>'+
      '<section class="section"><h2>Manager attention</h2>'+priorityHtml+'</section>'+
      '<section class="section"><h2>Service drive now</h2><div class="grid">'+
      metric("Open ROs",data.counts.open,null)+metric("Overdue",data.counts.overdue,null)+
      metric("Due today",data.counts.due,null)+metric("Need customer update",data.counts.needsUpdate,null)+
      metric("Missing plan",data.counts.noPlan,null)+'</div></section>'+
      '<section class="section"><h2>Store performance</h2><p class="muted">Verified SAPR through '+htmlEscape(data.saprDate||"Not verified")+'</p><div class="grid">'+
      metric("MTD gross",data.storePerformance.gross,data.standards.gross,"money")+
      metric("CP ELR",data.storePerformance.elr,data.standards.elr,"money")+
      metric("CP hours / RO",data.storePerformance.hours,data.standards.hours,"fixed")+
      metric("Closed ROs",data.storePerformance.ros,null)+'</div></section>'+
      '<section class="section"><h2>Advisor performance</h2><div class="tablewrap"><table><thead><tr><th>Advisor</th><th>Gross</th><th>CP ROs</th><th>CP ELR</th><th>CP Hrs/RO</th></tr></thead><tbody>'+advisorHtml+'</tbody></table></div></section>'+
      '<section class="section"><h2>Open RO detail</h2><p class="muted">Tap an RO to expand. Current dashboard information only; no editing controls are included.</p>'+roHtml+'</section>'+
      '<section class="section"><h2>Report coverage</h2><div class="tablewrap"><table><thead><tr><th>Source</th><th>Status</th><th>Period</th><th>Updated</th></tr></thead><tbody>'+reportHtml+'</tbody></table></div></section>'+
      '</main><footer>Private operational information. Access is controlled by the SharePoint / Microsoft 365 permissions on the page location.</footer></body></html>';
  }

  const MOBILE_DB="moondog-operations-local", MOBILE_HANDLE_KEY="sharepoint-mobile-page-folder",
    MOBILE_FILENAME="MoonDog-Mobile.html";
  function publisherDb(environment=root) {
    return new Promise((resolve,reject)=>{
      if(!environment.indexedDB){reject(new Error("This browser cannot remember the SharePoint mobile folder."));return;}
      const request=environment.indexedDB.open(MOBILE_DB,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("handles"))request.result.createObjectStore("handles");};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function rememberPublisher(handle,environment=root) {
    const db=await publisherDb(environment);
    await new Promise((resolve,reject)=>{const tx=db.transaction("handles","readwrite");
      tx.objectStore("handles").put(handle,MOBILE_HANDLE_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    db.close();
  }
  async function recallPublisher(environment=root) {
    const db=await publisherDb(environment);
    const handle=await new Promise((resolve,reject)=>{const tx=db.transaction("handles","readonly");
      const request=tx.objectStore("handles").get(MOBILE_HANDLE_KEY);
      request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});
    db.close();return handle;
  }
  async function permission(handle,interactive=false) {
    if(!handle)return "missing";
    if(typeof handle.queryPermission!=="function")return "granted";
    let state=await handle.queryPermission({mode:"readwrite"});
    if(state==="prompt"&&interactive&&typeof handle.requestPermission==="function")
      state=await handle.requestPermission({mode:"readwrite"});
    return state;
  }
  async function publishToHandle(handle,html) {
    if(await permission(handle,false)!=="granted")return {status:"permission-needed"};
    const fileHandle=await handle.getFileHandle(MOBILE_FILENAME,{create:true});
    const bytes=new TextEncoder().encode(html);
    let writable;
    try{writable=await fileHandle.createWritable();await writable.write(bytes);await writable.close();}
    catch(error){try{await writable?.abort?.();}catch(_){}throw error;}
    const actual=new Uint8Array(await(await fileHandle.getFile()).arrayBuffer());
    if(actual.length!==bytes.length||actual.some((value,index)=>value!==bytes[index]))
      throw new Error("The mobile HTML page did not verify after saving.");
    return {status:"published",fileName:MOBILE_FILENAME,bytes:bytes.length,folder:handle.name||""};
  }
  async function connectPublisher(model,api,priorities=[],environment=root) {
    if(typeof environment.showDirectoryPicker!=="function")
      throw new Error("Use desktop Microsoft Edge to connect the SharePoint mobile page folder.");
    let handle;
    try{handle=await environment.showDirectoryPicker({mode:"readwrite",id:"moondog-sharepoint-mobile"});}
    catch(error){if(error?.name==="AbortError")return {status:"cancelled"};throw error;}
    if(await permission(handle,true)!=="granted")return {status:"permission-needed"};
    await rememberPublisher(handle,environment);
    const result=await publishToHandle(handle,makeHtml(model,api,priorities));
    return {...result,connected:true};
  }
  async function autoPublish(model,api,priorities=[],environment=root) {
    let handle;
    try{handle=await recallPublisher(environment);}catch(_){return {status:"not-configured"};}
    if(!handle)return {status:"not-configured"};
    const access=await permission(handle,false);
    if(access!=="granted")return {status:"permission-needed",folder:handle.name||""};
    return publishToHandle(handle,makeHtml(model,api,priorities));
  }

  const api=Object.freeze({summarize,makePdf,save,mobilePageData,makeHtml,publishToHandle,connectPublisher,autoPublish});
  root.MoonDogMobileSnapshot=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);

(function () {
  'use strict';
  const api=globalThis.__moondogDaily,engine=globalThis.MoonDogDailyEngine;
  if(!api||!engine)return;
  const $=id=>document.getElementById(id), model=api.model;
  const state={current:null,events:[],loadedRoot:null,loading:false,busy:false,editing:false,launched:null,searchToken:0,searchResults:[],history:[],error:'',pending:false,selectedPhase:'',mobile:{timer:null,busy:false,status:'',folder:'',updatedAt:''}};
  const names={performance:'SAPR','open-ro':'Open RO',appointments:'Appointments / pre-RO','next-appointments':'Next Appointments',vir:'VIR','menu-sales':'Menu Sales',csi:'CSI',sor:'SOR','appointment-activity':'Appointment Activity',efficiency:'Efficiency','media-asr':'Media ASR — Advisor','media-asr-tech':'Media ASR — Technician','open-ro-summary':'Aggregate WIP','ro-update':'Returned supervisor workbook'};
  const toolNames={home:'Home','assign-next':'Assign Next','open-ro':'Open RO Control',performance:'Advisor Performance',meeting:'Advisor Meeting',tools:'Tools',overview:'Store overview',arrivals:"Today's Arrivals",imports:'Supervisor workbook and detailed imports',settings:'Change how Service Operations Dashboard works',setup:'Reports and setup'};
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
  function discardDraftOk(){return !state.editing||globalThis.confirm('You have an unsaved Home update. Leave this task and discard the draft?');}
  function go(view,anchor=''){if(active()==='home'&&!discardDraftOk())return;api.navigate(view,anchor);}
  function wrap(el,label){if(!el||el.closest('.daily-disclosure'))return;const detail=document.createElement('details');detail.className='daily-disclosure';const summary=document.createElement('summary');summary.textContent=label;el.before(detail);detail.append(summary,el);}

  function installShell(){
    document.body.classList.add('daily-operating');
    const storeName=$('hubStoreName');if(storeName)storeName.textContent=model.settings.store?.code&&model.settings.store?.name?.trim()?model.settings.store.name.trim():'Offline operations';
    const nav=document.querySelector('nav[aria-label="Main navigation"]');
    for(const [key,label] of Object.entries(toolNames)){const el=nav.querySelector(`[data-view="${key}"]`);if(el&&key!=='home')el.textContent=label;}
    const primary=['home','open-ro','assign-next','performance','meeting','tools'];
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
    const navGuard=event=>{if(active()!=='home'||!state.editing)return;if(!discardDraftOk()){event.preventDefault();event.stopImmediatePropagation();}};
    nav.addEventListener('click',navGuard,true);
    globalThis.addEventListener('beforeunload',event=>{if(!state.editing)return;event.preventDefault();event.returnValue='';});
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
    // Refresh requests live in the compact Data Needed strip, never as duplicate Home work cards.
    if(model.state.reviewQueue?.length)items.push({id:'unmatched:questions',type:'questions',title:'Resolve the returned workbook questions',description:'Review unmatched advisor updates before applying them to an RO.',view:'open-ro',rank:3,fingerprint:String(model.state.reviewQueue.length)});
    if(model.assignNext.currentOpenRo)items.push({id:'availability:'+day+':'+hour,type:'availability',title:'Check advisor availability',description:'Confirm who is available before assigning the next RO.',view:'assign-next',rank:12,once:true,fingerprint:day+':'+hour});
    const open=model.state.records.filter(r=>!api.closed(r.management||{})),parts=open.filter(r=>api.statusDetail(r)==='Approved — Waiting Parts'&&!engine.hasFuturePlan(r,day));
    if(parts.length>=3)items.push({id:`parts:${day}`,type:'parts',title:'Review the parts delays',description:`${parts.length} current ROs are waiting on parts. Confirm the next action and customer update with Parts.`,view:'open-ro',rank:8,once:true,fingerprint:day});
    const unresolved=open.filter(r=>r.management?.reviewDate===day||r.management?.communication==='Needs update'||Boolean(engine.stuckWork(r,day)));
    if(hour>=15&&unresolved.length)items.push({id:`tomorrow:${day}`,type:'tomorrow',title:'Make tomorrow ready',description:`Review ${unresolved.length} unresolved follow-up${unresolved.length===1?'':'s'}, customer update${unresolved.length===1?'':'s'}, or finish plan${unresolved.length===1?'':'s'} before closing.`,view:'open-ro',rank:5.5,once:true,fingerprint:JSON.stringify([day,unresolved.map(r=>[r.id,r.management?.updatedAt,r.management?.reviewDate])])});
    // All verified coaching opportunities compete with operational tasks; do not hide advisors in a separate rotation.
    items.push(...engine.coachingTasks(api.latestSapr(),api.advisors(),model.settings.performanceStandards,globalThis.__moondogFreshness.sourceFreshness('sapr',{today:day}).safeForCurrent,day));
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
  function managerPulseRows(){
    const day=today(),open=(model.state.records||[]).filter(r=>!api.closed(r.management||{}));
    const missing=open.filter(r=>!String(r.management?.nextAction||'').trim()||!String(r.management?.reviewDate||'').trim());
    const rows=[
      {key:'open',label:'Open ROs',value:open.length,filter:''},
      {key:'overdue',label:'Overdue',value:open.filter(r=>r.management?.reviewDate&&r.management.reviewDate<day).length,filter:'overdue',urgent:true},
      {key:'due-today',label:'Due today',value:open.filter(r=>r.management?.reviewDate===day).length,filter:'due-today'},
      {key:'missing-action',label:'Missing plan',value:missing.length,filter:'missing-action',urgent:missing.length>0},
      {key:'long-2',label:'2+ days',value:open.filter(r=>Number(r.daysOpen)>=2).length,filter:'long-2'},
      {key:'long-5',label:'5+ days',value:open.filter(r=>Number(r.daysOpen)>=5).length,filter:'long-5',urgent:open.some(r=>Number(r.daysOpen)>=5)},
      {key:'needs-update',label:'Customer update',value:open.filter(r=>r.management?.communication==='Needs update').length,filter:'needs-update',urgent:open.some(r=>r.management?.communication==='Needs update')},
      {key:'comeback',label:'Comebacks',value:open.filter(r=>/comeback/i.test([api.status(r),r.sourceStatus,r.management?.statusDetail].join(' '))).length,filter:'comeback',urgent:open.some(r=>/comeback/i.test([api.status(r),r.sourceStatus,r.management?.statusDetail].join(' ')))}
    ];
    return rows;
  }
  function openPulseFilter(filter){
    go('open-ro');
    queueMicrotask(()=>{
      const control=$('attentionFilter');
      if(control){control.value=filter||'';control.dispatchEvent(new Event('change',{bubbles:true}));}
    });
  }
  function renderManagerPulse(host){
    if(!model.root)return;
    const section=document.createElement('section');section.className='manager-control-pulse';section.setAttribute('aria-label','Manager control pulse');
    const head=document.createElement('div');head.className='manager-control-pulse-head';head.innerHTML='<div><p class="eyebrow">CONTROL PULSE</p><strong>Finish work before starting more</strong></div>';
    head.append(button('Open RO Control',()=>openPulseFilter(''),'link-button'));
    section.append(head);
    const grid=document.createElement('div');grid.className='manager-control-pulse-grid';
    for(const row of managerPulseRows()){
      const card=button('',()=>openPulseFilter(row.filter),'manager-pulse-card'+(row.urgent&&row.value?' urgent':''));
      card.setAttribute('aria-label',row.label+': '+row.value);
      card.innerHTML='<span>'+esc(row.label)+'</span><strong>'+esc(row.value)+'</strong>';
      grid.append(card);
    }
    section.append(grid);host.append(section);
  }
  function allTasks(){return candidates().map(compactTask);}
  function attentionTopThree(){
    if(!model.root)return [];
    const planner=globalThis.ServiceRefreshIntelligence;
    const operational=planner?.topFive(allTasks(),state.events,engine,now()) || allTasks().filter(task=>engine.eligible(task,state.events,now()));
    const needed=planner?.plan(api.reportRefreshRequests(today()),api.refreshHistory(),{at:new Date().toISOString(),today:today(),limit:8})||[];
    const reports=needed.map(item=>({id:'report:'+item.source,type:'report',source:item.source,
      title:'Gather '+item.label+' report',description:[item.range,item.instruction].filter(Boolean).join(' · '),
      next:[item.location,item.instruction].filter(Boolean).join(' · '),view:'tools',rank:item.rank||7,
      fingerprint:JSON.stringify([item.source,item.range,item.instruction])}));
    // One request per source, one current RO per task. Source needs compete with operational risk.
    return [...operational,...reports].sort((a,b)=>(a.rank||7)-(b.rank||7)||
      String(a.deadline||'9999').localeCompare(String(b.deadline||'9999'))||String(a.id).localeCompare(String(b.id)))
      .filter((item,index,items)=>items.findIndex(other=>other.id===item.id)===index).slice(0,3);
  }
  async function publishMobilePage(interactive=false){
    if(!model.root||model.connectionState!=='CONNECTED')return {status:'not-connected'};
    if(state.mobile.busy)return {status:'busy'};
    state.mobile.busy=true;
    try{
      const mobile=globalThis.MoonDogMobileSnapshot;
      if(!mobile)return {status:'unavailable'};
      const result=interactive?
        await mobile.connectPublisher(model,api,attentionTopThree()):
        await mobile.autoPublish(model,api,attentionTopThree());
      state.mobile.status=result.status||'';
      state.mobile.folder=result.folder||state.mobile.folder||'';
      if(result.status==='published')state.mobile.updatedAt=new Date().toISOString();
      return result;
    }catch(error){
      state.mobile.status='error';
      console.warn('Read-only mobile page publish failed:',error?.message||error);
      return {status:'error',error};
    }finally{state.mobile.busy=false;}
  }
  function queueMobilePublish(delay=2500){
    if(state.mobile.timer)clearTimeout(state.mobile.timer);
    state.mobile.timer=setTimeout(()=>{state.mobile.timer=null;void publishMobilePage(false).then(()=>{
      if(active()==='tools'&&$('dailyTools')?.dataset.category==='more')renderTools('more');
    });},delay);
    state.mobile.timer?.unref?.();
  }
  function mobileStatusText(){
    if(state.mobile.status==='published')return 'Auto-updating · last written '+new Date(state.mobile.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+(state.mobile.folder?' · '+state.mobile.folder:'');
    if(state.mobile.status==='permission-needed')return 'Folder remembered · reopen desktop Edge and allow folder access to resume updates.';
    if(state.mobile.status==='not-configured'||!state.mobile.status)return 'Not connected yet.';
    if(state.mobile.status==='error')return 'Last mobile-page update failed. Reconnect the SharePoint page folder.';
    return state.mobile.status.replace(/-/g,' ');
  }
  function openAttention(item){
    if(item.type==='report'){goTools('imports');return;}
    if(item.recordId){state.launched={id:item.id,recordId:item.recordId};api.openEdit(item.recordId);return;}
    go(item.view,item.anchor);
  }
  async function acknowledge(item,kind){
    await log(kind,item,{fingerprint:item.fingerprint,actual:item.actual,
      until:new Date(now()+120*60000).toISOString()});
    state.launched=null;await selectNext();
  }
  function refreshAttentionCount(items){
    const node=document.querySelector('[data-view="home"]');if(!node)return;
    let badge=node.querySelector('.manager-attention-count');
    if(!badge){badge=document.createElement('span');badge.className='manager-attention-count';node.append(badge);}
    badge.hidden=!items.length;badge.textContent=String(items.length);
    node.title=items.length?items.length+' management priorit'+(items.length===1?'y':'ies')+' ready':'Home';
  }
  async function selectNext(){
    state.operatingDate=today();
    state.selectedPhase=engine.phase(now());
    const task=attentionTopThree()[0]||null,prior=state.current?.id;state.current=task;state.editing=false;state.pending=false;state.error='';renderHome();
    if(globalThis.MoonDogWriteAuthority?.canWrite&&task&&task.id!==prior&&active()==='home'&&!(model.settings.setup?.newStorePrepared&&!model.settings.setup?.completedAt))try{await log('surfaced',task);}catch(error){say('This task is available, but its activity could not be recorded. Check folder access before continuing.');}
  }
  async function ready(){
    if(!model.root||model.connectionState!=='CONNECTED'){if(!state.current)renderHome();return;}
    if(state.loadedRoot===model.root){await checkOperatingDate();refreshCurrent();return;}
    if(state.loading)return;state.loading=true;
    try{await loadHistory();state.loadedRoot=model.root;await selectNext();}catch(error){say('Service Operations Dashboard could not read its task history. Check folder access and reconnect.');}finally{state.loading=false;}
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
    if(!state.editing){
      const next=attentionTopThree()[0];
      if(next?.id!==state.current?.id||next?.fingerprint!==state.current?.fingerprint){void action(selectNext);return;}
      if(active()==='home')renderHome();return;
    }
    const fresh=allTasks().find(t=>t.id===state.current?.id);
    if(!fresh||fresh.fingerprint!==state.current?.fingerprint){state.pending=true;const target=$('dailyChanged');if(target)target.hidden=false;}
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
    const original=JSON.stringify(r),m=r.management||{},indicator=api.cdkIndicator(r);
    const writtenBy=r.advisor||r.advisorCode||"Not identified",sourceTech=r.technician||r.technicianCode||"Not identified";
    host.insertAdjacentHTML('beforeend',`<div class="daily-ro-context"><strong>RO ${esc(r.ro)}</strong><span>${esc(r.customer)}</span><span>${esc(r.vehicle||r.tagNumber)}</span><small><b>Written by:</b> ${esc(writtenBy)}${r.advisorCode&&r.advisor!==r.advisorCode?' · '+esc(r.advisorCode):''} &nbsp;·&nbsp; <b>Source technician:</b> ${esc(sourceTech)}</small>${indicator?`<em class="daily-cdk-indicator ${esc(indicator.kind)}">${esc(indicator.text)}</em>`:''}</div>`);
    const form=document.createElement('form');form.id='dailyRoForm';form.className='daily-ro-form';
    const status=document.createElement('select');api.statuses(r).forEach(v=>status.add(new Option(v,v)));
    compactField(form,'Current condition','status',api.status(r),status,Boolean(api.clarification(r))||!m.updatedAt);
    const detail=document.createElement('select'),currentDetail=api.statusDetail(r);
    compactField(form,'Status detail','statusDetail',currentDetail,detail,false);const detailField=detail.closest('.daily-field');
    const other=document.createElement('input');other.maxLength=120;
    compactField(form,'Other status detail','statusDetailOther',m.statusDetailOther||'',other,false);const otherField=other.closest('.daily-field');
    function syncDetailFields(force=false){
      const options=api.statusDetails(status.value);detail.replaceChildren(new Option(options.length?'Choose detail':'No detail needed',''));options.forEach(v=>detail.add(new Option(v,v)));
      if(options.includes(currentDetail)&&!force)detail.value=currentDetail;detailField.hidden=!options.length;
      if(options.length&&(force||!currentDetail)){detail.hidden=false;detailField.querySelector('.daily-field-context').hidden=true;}
      const needsOther=detail.value==='Other';otherField.hidden=!needsOther;
      if(needsOther&&(force||!m.statusDetailOther)){other.hidden=false;otherField.querySelector('.daily-field-context').hidden=true;}
    }
    syncDetailFields(false);status.addEventListener('change',()=>syncDetailFields(true));detail.addEventListener('change',()=>syncDetailFields(true));
    const next=document.createElement('textarea');next.rows=2;next.required=true;compactField(form,'Next action','nextAction',m.nextAction,next,!m.nextAction||task.hard);
    const date=document.createElement('input');date.type='date';date.required=true;compactField(form,'Follow-up date','reviewDate',m.reviewDate,date,!m.reviewDate||m.reviewDate<=today());
    const time=document.createElement('input');time.type='time';compactField(form,'Follow-up time (optional)','reviewTime',m.reviewTime,time,false);
    const comm=document.createElement('select');api.communication.forEach(v=>comm.add(new Option(v||'Not recorded',v)));compactField(form,'Customer communication','communication',m.communication,comm,!m.communication||m.communication==='Needs update');
    const tech=document.createElement('input');tech.maxLength=120;compactField(form,'Current technician','currentTechnician',m.currentTechnician||r.technician||'',tech,false);
    const owner=document.createElement('input');compactField(form,'Follow-up owner','owner',m.owner||r.advisor||'',owner,false);
    const note=document.createElement('details');note.className='daily-note';note.innerHTML='<summary>Add note</summary><label for="daily-note">Update note</label><textarea id="daily-note" name="note" rows="2"></textarea>';note.querySelector('textarea').value=m.note||'';form.append(note);
    const actions=document.createElement('div');actions.className='daily-ro-actions';
    const close=button('This RO is closed',()=>action(async()=>{await api.closeRo(r.id);await selectNext();}),'secondary daily-close-ro');
    const save=document.createElement('button');save.type='submit';save.className='primary daily-primary';save.textContent='Save and continue';actions.append(close,save);form.append(actions);
    form.addEventListener('input',()=>state.editing=true);form.addEventListener('change',()=>state.editing=true);
    form.addEventListener('submit',e=>{e.preventDefault();action(async()=>{const values=Object.fromEntries(new FormData(form));try{await api.saveHome(r.id,original,values);}catch(error){if(JSON.stringify(model.state.records.find(x=>x.id===r.id))!==original){state.pending=true;$("dailyChanged").hidden=false;}throw error;}const updated=compactTask(engine.roTask(model.state.records.find(x=>x.id===r.id),api,today(),now()));const savedTask=updated||task;await log('completed',savedTask,{fingerprint:savedTask.fingerprint,until:new Date(now()+(task.hard?30:120)*60000).toISOString()});await selectNext();});});
    host.append(form);
  }
  function importer(host,task=null){
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.csv,.pdf';input.hidden=true;
    const choose=button(task?`Import ${names[task.source]}`:'Choose a report',()=>input.click(),'primary daily-primary');
    input.addEventListener('change',()=>{const file=input.files[0];if(!file)return;action(async()=>{const imported=await api.importFile(file);if(task&&imported===task.source)await log('completed',task,{until:new Date(now()+60000).toISOString()});await selectNext();if(active()==='tools')renderTools('imports');});});
    host.append(input,choose);
    const hint=document.createElement('p');hint.className='daily-hint';hint.textContent='Or place reports in “01 - DROP REPORTS HERE”. Service Operations Dashboard checks them automatically.';host.append(hint);
  }
  function renderRefreshStrip(host) {
    const planner=globalThis.ServiceRefreshIntelligence;
    if(!planner||!model.root)return;
    const at=new Date().toISOString(),items=planner.plan(api.reportRefreshRequests(today()),api.refreshHistory(),{
      at,today:today(),limit:3
    });
    const yoy=api.priorYearSapr?.();
    const sourceCurrent=globalThis.__moondogFreshness?.sourceFreshness?.('sapr',{today:today()});
    const hasSaprRequest=api.reportRefreshRequests(today()).some(item=>item.source==='performance');
    const usefulYoy=sourceCurrent?.safeForCurrent&&yoy?.status==='needs-history'&&
      yoy.estimatedEnd&&yoy.current?.daysWorked>0;
    if(!items.length&&!usefulYoy)return;
    const section=document.createElement('section');section.className='daily-data-needed';
    const title=document.createElement('h3');title.textContent='Data needed';section.append(title);
    const sources=api.sourceLocations?.()||{};
    for(const item of items){
      const row=document.createElement('div');row.className='daily-needed-row';
      const copy=document.createElement('div'),header=document.createElement('strong'),detail=document.createElement('small');
      header.textContent=item.range?`${item.label} · ${item.range}`:item.label;
      detail.textContent=[sources[item.source]||item.location,item.instruction].filter(Boolean).join(' · ');
      copy.append(header,detail);
      const action=button('Update',()=>{const picker=host.querySelector('#dailyRefreshPicker');picker.dataset.source=item.source;picker.click();},'secondary');
      const later=button('Not now',()=>actionWrap(async()=>{
        await api.recordRefresh(item.source,'not-now');renderHome();
      }),'link-button');
      row.append(copy,action,later);section.append(row);
    }
    if(usefulYoy&&!items.some(item=>item.source==='performance')){
      const record=planner.sourceRecord(api.refreshHistory(),'performance'),until=Date.parse(record.notNowUntil||'');
      if(!Number.isFinite(until)||until<=Date.now()){
        const row=document.createElement('div');row.className='daily-needed-row daily-yoy-hint';
        const detail=document.createElement('div');
        const title=document.createElement('strong');title.textContent='SAPR · Year-over-year comparison';
        const copy=document.createElement('small');
        copy.textContent=`DealerCentral → SAPR · ${yoy.periodStart} to about ${yoy.estimatedEnd} · Match ${yoy.current.daysWorked} working days. Confirm the prior SAPR days-worked count.`;
        detail.append(title,copy);row.append(detail,
          button('Update',()=>{const picker=host.querySelector('#dailyRefreshPicker');picker.dataset.source='performance';picker.click();},'secondary'),
          button('Not now',()=>actionWrap(async()=>{await api.recordRefresh('performance','not-now');renderHome();}),'link-button'));
        section.append(row);
      }
    }
    if(!section.querySelector('.daily-needed-row'))return;
    const input=document.createElement('input');input.type='file';input.id='dailyRefreshPicker';
    input.accept='.xlsx,.xls,.csv,.pdf,.docx';input.hidden=true;
    input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return;
      actionWrap(async()=>{if(input.dataset.source)await api.recordRefresh(input.dataset.source,'requested');await api.importFile(file);await selectNext();});
    });
    host.append(section,input);
  }
  async function actionWrap(fn){await action(fn);}
  function renderOtherPriorities(task,host){
    const extra=attentionTopThree().filter(item=>item.id!==task?.id).slice(0,2);
    if(!extra.length)return;
    const section=document.createElement('section');section.className='daily-next-priorities';
    const heading=document.createElement('h3');heading.textContent='Up next';section.append(heading);
    for(const item of extra){
      const row=document.createElement('div');row.className='daily-priority-row';
      const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=item.title;
      detail.textContent=item.type==='ro'?`RO ${item.record?.ro||''} · ${item.record?.management?.nextAction||'Confirm next action'}`:
        item.next||item.description||'Review the source';
      copy.append(title,detail);row.append(copy);
      if(item.type==='coaching')row.append(button('Advisor Notified',()=>action(()=>acknowledge(item,'completed')),'secondary'));
      else row.append(button(item.type==='report'?'Gather':'Open',()=>openAttention(item),'secondary'));
      row.append(button('Not Now',()=>action(async()=>{
        if(item.type==='report')await api.recordRefresh(item.source,'not-now');
        else await log('deferred',item,{until:engine.deferUntil(item,state.events,now()),fingerprint:item.fingerprint});
        await selectNext();
      }),'link-button'));
      section.append(row);
    }
    host.append(section);
  }

  function renderHome(){
    // Automatic inbox ingestion can change the ranked tasks without a navigation.
    // Never let a completed report request remain the visible primary action.
    // Preserve any in-progress RO draft: only reconcile outside edit mode.
    if(model.root&&state.loadedRoot&&!state.editing){
      const leading=attentionTopThree()[0]||null;
      if(leading?.id!==state.current?.id||leading?.fingerprint!==state.current?.fingerprint)
        state.current=leading;
    }
    const host=$('dailyTask');host.replaceChildren();
    if(model.root){renderRefreshStrip(host);renderManagerPulse(host);}
    // The legacy pulse and data strip remain available in detailed tools, never compete with Top 3.
    host.querySelector('.daily-data-needed')?.remove();
    const pulse=host.querySelector('.manager-control-pulse');
    if(pulse){pulse.querySelectorAll('.manager-pulse-card:not(.urgent)').forEach(card=>card.remove());if(!pulse.querySelector('.manager-pulse-card'))pulse.remove();}
    if(!model.root){host.innerHTML='<p class="eyebrow">Your daily workspace</p><h2>Connect Service Operations Dashboard to begin</h2><p>Your saved work stays in the connected working folder.</p>';host.append(button('Connect working folder',()=>api.connect(),'primary'));return;}
    if(!state.loadedRoot&&!state.current){host.innerHTML='<h2>Loading your saved work…</h2>';return;}
    const top=attentionTopThree();refreshAttentionCount(top);
    const task=state.current;
    if(!task){host.replaceChildren();return;}
    const focus=document.createElement('div');focus.className='daily-main-priority';focus.innerHTML=`<p class="eyebrow">Manager attention · 1 of ${top.length}</p><h2>${esc(task.title)}</h2><p id="dailyError" role="alert" hidden></p><div id="dailyChanged" hidden>New information is available. Your draft is still here. <button type="button">Refresh this task</button></div>`;host.append(focus);
    $('dailyChanged').querySelector('button').onclick=()=>{if(discardDraftOk())action(selectNext);};
    if(task.type==='ro')roForm(task,focus);
    else{
      if(task.description){const p=document.createElement('p');p.className='daily-description';p.textContent=task.description.replace(/TREND DATA NEEDED · SAPR · /,'').replace(/historical snapshot/g,'historical report');focus.append(p);}
      if(task.type==='coaching'){const p=document.createElement('p');p.className='daily-description';p.textContent=`NEXT · ${task.next}`;focus.append(p);
        focus.append(button('View performance',()=>openAttention(task),'secondary'));}
      if(task.source)importer(focus,task);
      else{
        if(task.type==='questions')focus.append(button('View saved questions',()=>showReadOnly('Returned workbook questions',{questions:model.state.reviewQueue})));
        if(task.type!=='coaching')focus.append(button('Open '+(task.type==='settings'?'advisor settings':task.view==='open-ro'?'Open RO Control':task.view==='imports'?'workbook tools':task.view==='assign-next'?'Assign Next':'Advisor Performance'),()=>go(task.view,task.anchor),'primary'));
        focus.append(button(task.type==='coaching'?'Advisor Notified':'Addressed',()=>action(()=>acknowledge(task,'completed'))));
        if(task.type==='coaching')focus.append(button('Not an Issue',()=>action(()=>acknowledge(task,'not-an-issue')),'link-button'));
      }
    }
    const footer=document.createElement('div');footer.className='daily-task-footer';footer.append(button('Not Now',()=>action(async()=>{
      if(task.type==='report')await api.recordRefresh(task.source,'not-now');
      else await log('deferred',task,{until:engine.deferUntil(task,state.events,now()),fingerprint:task.fingerprint});
      await selectNext();})));focus.append(footer);
    renderOtherPriorities(task,host);
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
    const back=button('‹ Change how Service Operations Dashboard works',()=>goTools('settings'));back.classList.add('daily-settings-back');host.prepend(back);
    const selected=new Set(targets.map(el=>el.closest('.card')).filter(Boolean));
    const cards=host.querySelectorAll('.card');cards.forEach(card=>card.classList.toggle('daily-settings-hidden',!selected.has(card)));
    if(category==='advanced')cards.forEach(card=>{if(/diagnostic|new.store|handoff/i.test(card.id+' '+card.className))card.classList.remove('daily-settings-hidden');});
    if(category==='recovery')$('backupRecoverySection')?.classList.remove('daily-settings-hidden');
    if(category==='updates')targets[0].scrollIntoView({block:'start'});
  }
  function goTools(category){go('tools');renderTools(category);}
  function renderTools(category=''){
    const host=$('dailyTools');host.dataset.category=category;host.replaceChildren();
    const title=document.createElement('h2');title.textContent=category?({imports:'Import or refresh data',settings:'Change how Service Operations Dashboard works',recovery:'Back up or recover Service Operations Dashboard',more:'More tools'})[category]:'What are you trying to do?';host.append(title);
    if(category)host.append(button('‹ Tools',()=>renderTools()));
    const options=document.createElement('div');options.className='daily-tool-choices';host.append(options);
    if(!category){[['Import or refresh data','imports'],['Change how Service Operations Dashboard works','settings'],['Back up or recover Service Operations Dashboard','recovery']].forEach(([label,key])=>options.append(button(label,()=>renderTools(key))));host.append(button('More',()=>renderTools('more'),'link-button'));}
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
          details.append(coverage);
          const key=({openRo:'open-ro',sapr:'performance',menu:'menu-sales',nextAppointments:'next-appointments',
            mediaAsr:'media-asr',mediaAsrTech:'media-asr-tech'})[row.key]||
            row.key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
          const sourceInfo=globalThis.ServiceRefreshIntelligence?.catalog?.[key];
          if(sourceInfo){
            const where=document.createElement('div');where.className='daily-source-location';
            const label=document.createElement('small');label.textContent='Get it from: '+(api.sourceLocations?.()?.[key]||sourceInfo.location);
            where.append(label,button('Change location',()=>action(async()=>{
              const prior=api.sourceLocations?.()?.[key]||sourceInfo.location;
              const location=prompt('Where do you get '+sourceInfo.label+'?',prior);
              if(location===null||!location.trim()||location.length>200)return;
              await api.saveSourceLocation(key,location);renderTools('imports');
            }),'link-button'));entry.append(where);
          }
          entry.append(details,button(row.need.state==='ON DEMAND'?'Generate / workbook tools':'Import',()=>row.need.state==='ON DEMAND'?go('imports'):options.querySelector('input[type="file"]').click()));group.append(entry);
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
    if(category==='more'){
      const report=document.createElement('section');report.className='daily-mobile-snapshot';
      const title=document.createElement('h3');title.textContent='Phone view (SharePoint · read only)';
      const explanation=document.createElement('p');
      explanation.textContent='One-time setup: choose the local OneDrive-synced folder that holds your private SharePoint HTML page. MoonDog writes only “MoonDog-Mobile.html” there and refreshes it automatically when dashboard data changes. The phone page has no edit controls and cannot write back to MoonDog.';
      const requirement=document.createElement('p');requirement.className='daily-hint';
      requirement.textContent='SharePoint must allow HTML Pages in the Site Pages library. Access is controlled by your Microsoft 365 / SharePoint permissions, not by MoonDog.';
      const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.textContent=mobileStatusText();
      const connect=button(state.mobile.status==='published'?'Change SharePoint page folder':'Connect SharePoint page folder',async()=>{
        if(!model.root){feedback.textContent='Connect the desktop working folder first.';return;}
        connect.disabled=true;feedback.textContent='Choose the OneDrive-synced SharePoint page folder…';
        const result=await publishMobilePage(true);
        connect.disabled=false;
        feedback.textContent=result.status==='published'?
          'Connected and written. In SharePoint, copy the link to MoonDog-Mobile.html and bookmark that page in mobile Edge.':
          result.status==='cancelled'?'Setup cancelled. Nothing changed.':
          result.status==='permission-needed'?'Folder selected, but write permission was not granted.':
          result.status==='error'?'Could not publish the mobile page. '+(result.error?.message||'Try again.'):mobileStatusText();
      },'primary');
      const refresh=button('Refresh mobile HTML now',async()=>{
        refresh.disabled=true;const result=await publishMobilePage(false);refresh.disabled=false;
        feedback.textContent=result.status==='published'?'Mobile HTML refreshed.':mobileStatusText();
      },'secondary');
      const pdf=button('Save PDF instead',async()=>{
        pdf.disabled=true;feedback.textContent='Preparing PDF…';
        try{const result=await globalThis.MoonDogMobileSnapshot.save(model,api);
          feedback.textContent=result.status==='cancelled'?'PDF save cancelled.':'PDF ready.';}
        catch(error){feedback.textContent='Unable to save PDF. '+(error?.message||'Try again.');}
        finally{pdf.disabled=false;}
      },'link-button');
      report.append(title,explanation,requirement,connect,refresh,pdf,feedback);options.append(report);
      for(const key of ['arrivals','overview','imports','setup'])options.append(button(toolNames[key],()=>go(key)));
    }
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
    for(const [key,label,terms] of [["imports","Import or refresh data","reports import upload"],["settings","Change how Service Operations Dashboard works","settings configuration"],["recovery","Back up or recover Service Operations Dashboard","backup restore recovery support"],["updates","System Updates","stable beta update release"]])if(matches([label,terms],q))add(`tool:${key}`,label,"Tools",()=>key==="updates"?settingsCategory("updates"):goTools(key));
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
  document.addEventListener('moondog-data',()=>queueMobilePublish());
  document.addEventListener('moondog-data',()=>{const name=$('hubStoreName');if(name)name.textContent=model.settings.store?.code&&model.settings.store?.name?.trim()?model.settings.store.name.trim():'Offline operations';});
  function refreshImportCoverage(){if(active()==='tools'&&$('dailyTools').dataset.category==='imports')renderTools('imports');}
  document.addEventListener('moondog-data',refreshImportCoverage);
  document.addEventListener('moondog-imported',refreshImportCoverage);
  // Folder-watch updates publish moondog-data (not always moondog-imported).
  // Re-select immediately when the authoritative source model changes.
  document.addEventListener('moondog-data',()=>{if(!state.editing&&!state.loading&&!state.busy&&model.root)refreshCurrent();});
  document.addEventListener('moondog-imported',()=>queueMobilePublish(1200));
  document.addEventListener('moondog-navigation',e=>{if(e.detail.view==='tools')renderTools();if(e.detail.view==='settings')$('view-settings').querySelectorAll('.daily-settings-hidden').forEach(el=>el.classList.remove('daily-settings-hidden'));if(e.detail.view==='home'&&!state.editing){refreshCurrent();renderHome();}if(e.detail.anchor){const el=$(e.detail.anchor);for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;}});
  document.addEventListener('moondog-imported',()=>{if(!state.busy&&!state.editing)action(async()=>{await loadHistory();await selectNext();});else state.pending=true;});
  document.addEventListener('moondog-saved',e=>{
    queueMobilePublish(1200);
    if(state.launched?.recordId===e.detail.id && e.detail.origin!=='home'){
      const launched=state.launched;state.launched=null;
      void action(async()=>{const updated=allTasks().find(item=>item.id===launched.id)||launched;
        await log('completed',updated,{fingerprint:updated.fingerprint,until:new Date(now()+120*60000).toISOString()});
        go('home');await selectNext();});return;
    }
    if(e.detail.origin!=='home'&&!state.busy){state.pending=true;if(!state.editing)action(selectNext);}
  });
  // Automatic intake completion is an allowed boundary, but never replaces a draft.
  const observer=new MutationObserver(()=>{if($('status').classList.contains('success'))refreshCurrent();});observer.observe($('status'),{childList:true,attributes:true});
  setInterval(checkOperatingDate,30000);
  const mobileHeartbeat=setInterval(()=>queueMobilePublish(1000),300000);mobileHeartbeat?.unref?.();
  window.addEventListener('focus',checkOperatingDate);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkOperatingDate();});
  installThemeToggle();installShell();renderHome();ready();queueMobilePublish(3500);
  globalThis.__moondogDailyUI=Object.freeze({state,candidates:allTasks,selectNext,renderHome,renderTools,searchAll,settingsCategory,ready});
})();
/* Service Operations Dashboard theme Beta 0.10.7-beta.2. */
// BEGIN GENERATED MEETING PRESENTER (see src/meeting-presenter.js)
/* Responsive one-card-at-a-time Advisor Meeting presentation. No copied KPIs. */
(function(root){
  "use strict";
  const api=root.__moondogDaily,model=api?.model;
  if(!api||!model)return;
  const state={enabled:false,paused:false,index:0,timer:null,view:null,controls:null,seconds:30};
  const $=id=>document.getElementById(id);
  function setting(){const prefs=api.presentationSettings?.()||{};return {
    seconds:Number.isInteger(prefs.seconds)&&prefs.seconds>=10&&prefs.seconds<=120?prefs.seconds:30,
    orientation:["auto","landscape","portrait"].includes(prefs.orientation)?prefs.orientation:"auto"
  };}
  function cards(){const parent=$("meetingV3Advisors");if(!parent)return[];
    return [...parent.querySelectorAll(".meeting-v3-advisor")].sort((a,b)=>
      (a.querySelector("h3")?.textContent||"").localeCompare(b.querySelector("h3")?.textContent||"",undefined,{sensitivity:"base",numeric:true}));
  }
  function viewReady(){const view=$("view-meeting");return view?.classList.contains("meeting-scoreboard")?view:null;}
  function stopTimer(){if(state.timer){clearInterval(state.timer);state.timer=null;}}
  function restartTimer(){stopTimer();if(!state.enabled||state.paused||!state.view?.classList.contains("active"))return;
    state.timer=setInterval(()=>{if(document.hidden||!state.view?.classList.contains("active"))return;next();},state.seconds*1000);
  }
  function paint(){
    const view=viewReady();if(!view)return;
    state.view=view;
    const list=cards(),count=1+list.length;
    state.index=Math.max(0,Math.min(state.index,count-1));
    const owner=$("meetingV3Advisors");
    for(const card of list){if(card.parentElement===owner)owner.append(card);}
    const selected=state.index===0?null:list[state.index-1];
    const visible=state.enabled&&view.classList.contains("active");
    view.classList.toggle("presentation-active",visible);
    view.dataset.presenterSlide=selected?"advisor":"store";
    view.dataset.presenterOrientation=setting().orientation;
    for(const card of list)card.dataset.slideActive=String(Boolean(visible&&card===selected));
    if(state.controls){
      const label=state.controls.querySelector("[data-slide-label]");
      if(label)label.textContent=`${selected?selected.querySelector("h3")?.textContent||"Advisor":"Store"} · ${state.index+1} of ${count}`;
      const paused=state.controls.querySelector("[data-pause]");
      if(paused)paused.textContent=state.paused?"Resume":"Pause";
      const overview=state.controls.querySelector("[data-overview]");
      if(overview)overview.textContent=state.enabled?"Show overview":"Start cards";
    }
  }
  function next(){const count=1+cards().length;if(!count)return;
    state.index=(state.index+1)%count;paint();
  }
  function toggle(){state.enabled=!state.enabled;state.paused=false;state.index=0;paint();restartTimer();}
  function pause(){if(!state.enabled)return;state.paused=!state.paused;paint();restartTimer();}
  function activate(){
    const view=viewReady();if(!view)return;
    ensureControls();
    if(!state.enabled){state.enabled=true;state.paused=false;state.index=0;}
    state.seconds=setting().seconds;paint();restartTimer();
  }
  function ensureControls(){
    const view=viewReady();if(!view)return;
    const host=view.querySelector(".meeting-scoreboard-actions");
    if(!host)return;
    let controls=host.querySelector(".meeting-presenter-controls");
    if(!controls){
      controls=document.createElement("div");controls.className="meeting-presenter-controls";
      controls.innerHTML=`<strong data-slide-label>Store · 1 of 1</strong>
        <button type="button" data-pause>Pause</button><button type="button" data-next>Next</button>
        <button type="button" data-fullscreen>Full screen</button>
        <button type="button" data-overview>Show overview</button>`;
      controls.querySelector("[data-pause]").addEventListener("click",pause);
      controls.querySelector("[data-next]").addEventListener("click",()=>{if(!state.enabled)state.enabled=true;next();restartTimer();});
      controls.querySelector("[data-overview]").addEventListener("click",toggle);
      controls.querySelector("[data-fullscreen]").addEventListener("click",async()=>{
        try{if(document.fullscreenElement)await document.exitFullscreen();else await view.requestFullscreen();}
        catch(_){/* Inline 16:9 or 9:16 presentation remains available without browser fullscreen. */}
      });
      host.prepend(controls);
    }
    state.controls=controls;
  }
  function installPreferences(){
    const area=[...document.querySelectorAll("#view-settings .settings-card")].find(card=>
      card.querySelector("h2")?.textContent?.trim()==="Advisor Meeting");
    if(!area||area.querySelector(".meeting-presentation-settings"))return;
    const prefs=setting(),wrap=document.createElement("div");
    wrap.className="meeting-presentation-settings";
    wrap.innerHTML=`<h3>TV meeting cards</h3><p>One Store card, then each advisor by name. The cards repeat.</p>
      <div class="settings-grid">
      <label>Seconds per card<input type="number" min="10" max="120" step="1" data-presenter-seconds></label>
      <label>Screen layout<select data-presenter-orientation>
        <option value="auto">Auto</option><option value="landscape">16:9 (wide)</option>
        <option value="portrait">9:16 (tall)</option></select></label></div>
      <small aria-live="polite" data-presenter-save></small>`;
    const duration=wrap.querySelector("[data-presenter-seconds]"),orientation=wrap.querySelector("[data-presenter-orientation]"),message=wrap.querySelector("[data-presenter-save]");
    duration.value=String(prefs.seconds);orientation.value=prefs.orientation;
    const persist=async()=>{
      const seconds=Number(duration.value);
      if(!Number.isInteger(seconds)||seconds<10||seconds>120){message.textContent="Choose between 10 and 120 seconds.";return;}
      const previous=setting();
      try{
        await api.savePresentationSettings({seconds,orientation:orientation.value});
        state.seconds=seconds;message.textContent="Saved to this working folder.";paint();restartTimer();
      }catch(error){duration.value=String(previous.seconds);orientation.value=previous.orientation;
        message.textContent=error?.message||"Preferences could not be saved in this working folder.";}
    };
    duration.addEventListener("change",persist);orientation.addEventListener("change",persist);
    area.append(wrap);
  }
  document.addEventListener("moondog-navigation",event=>{
    if(event.detail?.view==="meeting")queueMicrotask(activate);
    else if(event.detail?.view){stopTimer();paint();}
  });
  document.addEventListener("moondog-data",()=>{installPreferences();ensureControls();paint();});
  document.addEventListener("moondog-recovered",()=>{stopTimer();state.index=0;state.enabled=false;paint();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopTimer();else restartTimer();});
  window.addEventListener("beforeunload",stopTimer);
  installPreferences();ensureControls();
  if(viewReady()?.classList.contains("active"))activate();
  root.__serviceMeetingPresenter=Object.freeze({next,paint,setting,cards,activate});
})(globalThis);
// END GENERATED MEETING PRESENTER

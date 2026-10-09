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

  const api=Object.freeze({summarize,makePdf,save});
  root.MoonDogMobileSnapshot=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);

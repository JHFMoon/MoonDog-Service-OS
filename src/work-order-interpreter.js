/* Offline work-order interpretation: facts remain proposals until manager review. */
(function(root){"use strict";
const split=s=>String(s||"").replace(/\r/g,"").split(/\n+|(?<=[.;!?])\s+(?=[A-Z0-9])/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
const uncertain=/\b(?:may|might|could|possibly|potentially|suspect|if)\b/i,negative=/\b(?:not|no longer|never|wasn'?t|isn'?t)\b/i;
function analyze(raw){
 const original=String(raw||"").trim(),sentences=split(original),roNumbers=[...new Set([...original.matchAll(/\b(?:RO|R\/O|repair order)\s*(?:#|number)?\s*[:\-]?\s*(\d{5,8})\b/gi)].map(x=>x[1]))];
 const facts=[],events=[],steps=[];
 for(let i=0;i<sentences.length;i++){
 const s=sentences[i],reported=/\bcustomer (?:states|says|reports)\b/i.test(s),speculative=uncertain.test(s),negated=negative.test(s);
 let type=reported?"customer report":/\b(?:technician|tech|verified|diagnosed|found|inspected|tested|confirmed)\b/i.test(s)?"finding":/\b(?:replaced|repaired|installed|performed|completed)\b/i.test(s)?"repair":/\b(?:recommend|suggest|should|needs replacement)\b/i.test(s)?"recommendation":"";
 if(type)facts.push({type,quote:s.slice(0,600),evidence:reported?"reported":speculative?"uncertain":negated?"negative":"stated"});
 if(/\b(?:parts? (?:have |has )?(?:arrived|received)|received parts|no longer waiting (?:on|for) parts?)\b/i.test(s))events.push({type:"parts-clear",index:i,quote:s});
 else if(/\b(?:waiting|awaiting|pending|backorder(?:ed)?)\b.{0,55}\bparts?\b|\bparts?\b.{0,35}\bbackorder(?:ed)?\b/i.test(s)&&!speculative&&!negated)events.push({type:"parts-wait",index:i,quote:s});
 if(/\b(?:authorization received|customer approved|work authorized)\b/i.test(s))events.push({type:"approval-clear",index:i,quote:s});
 else if(/\b(?:waiting|awaiting|pending)\b.{0,65}\b(?:approval|authorization)\b/i.test(s)&&!speculative&&!negated)events.push({type:"approval-wait",index:i,quote:s});
 if(/\b(?:next step|plan is to|will (?:call|contact|order|follow up|verify|diagnose|repair|check)|need to (?:call|contact|order|follow up|verify|diagnose|repair|check))\b/i.test(s)&&!reported&&!speculative)steps.push(s);
 }
 const latest=family=>events.filter(e=>e.type.startsWith(family)).at(-1);
 const blockers=[latest("parts"),latest("approval")].filter(x=>x&&x.type.endsWith("wait")).sort((a,b)=>a.index-b.index);
 const blocker=blockers.at(-1)||null;
 let status=blocker?.type==="approval-wait"?"Pending Authorization":blocker?.type==="parts-wait"&&events.some(x=>x.type==="approval-clear")?"Awaiting Technician Attention":null;
 const inferred={ "parts-wait":"Confirm parts ETA and update the customer.", "approval-wait":"Contact customer for authorization and document the decision." };
 const nextAction=steps.length?{value:steps.at(-1).slice(0,350),source:"explicit",evidence:steps.at(-1)}:blocker?{value:inferred[blocker.type],source:"inferred",evidence:blocker.quote}:null;
 const ownerLine=sentences.find(s=>/^(?:owner|assigned to)\s*:/i.test(s));
 const owner=ownerLine?ownerLine.replace(/^(?:owner|assigned to)\s*:/i,"").trim().slice(0,100):"";
 const recognized=Boolean(facts.length||events.length||steps.length),warnings=[];
 if(!original)warnings.push("Paste a technician story or work-order narrative.");
 if(roNumbers.length>1)warnings.push("Multiple ROs detected; paste one RO at a time.");
 if(!roNumbers.length)warnings.push("RO identifier missing; select a current RO manually.");
 if(!recognized&&original)warnings.push("Text not understood; no data changed.");
 const reviewNote=facts.filter(f=>f.evidence==="stated").slice(0,5).map(f=>f.quote).join("\n").slice(0,1500);
 return {recognized,roNumbers,facts:facts.slice(0,50),blocker,status:status?{value:status,evidence:blocker.quote,source:"inferred"}:null,nextAction,owner,reviewNote,warnings,requiresReview:true};
}
const api=Object.freeze({analyze});root.MoonDogStoryInterpreter=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
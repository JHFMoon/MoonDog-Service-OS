/* MoonDog Paste & Learn — inert, local-first source recognition.
   This module never writes operational data. Destination adapters live in app.js. */
(function(root){
  "use strict";
  const MAX_TEXT=1600000,MAX_ROWS=6000,MAX_RULES=60,MAX_COLUMNS=80;
  const FIELDS=Object.freeze(["ro","status","customer","vin","vehicle","tag","advisor","technician","opened","promised","closed","services","date","description","owner","nextAction"]);
  function normalize(text){
    const source=String(text||"");
    if(source.length>MAX_TEXT)throw Error("Pasted text is too large. Select a smaller section (maximum 1.6 million characters).");
    return source.replace(/\r\n?/g,"\n").replace(/\u00a0/g," ").replace(/\u200b/g,"").replace(/\t/g,"\t");
  }
  function fromHtml(html){
    if(!html)return "";
    if(String(html).length>MAX_TEXT)throw Error("Pasted HTML is too large.");
    if(typeof DOMParser==="undefined")return "";
    const doc=new DOMParser().parseFromString(String(html),"text/html");
    // Parsed nodes are never attached to the live DOM or rendered as markup.
    for(const el of doc.querySelectorAll("script,style,iframe,object,embed,form,svg,link,img,video,audio,template"))el.remove();
    const table=doc.querySelector("table");
    if(!table)return doc.body?.textContent?.slice(0,MAX_TEXT)||"";
    const lines=[];
    for(const tr of table.querySelectorAll("tr")){
      const cells=[...tr.children].filter(el=>["TH","TD"].includes(el.tagName));
      if(cells.length)lines.push(cells.map(cell=>(cell.textContent||"").replace(/[\t\r\n]+/g," ").trim()).join("\t"));
      if(lines.length>MAX_ROWS)throw Error("The pasted HTML table has too many rows.");
    }
    return lines.join("\n");
  }
  function capture(text,html){
    const plain=normalize(text);
    return plain.trim()?plain:normalize(fromHtml(html));
  }
  function lines(text){return normalize(text).split("\n").map(s=>s.trim()).filter(Boolean);}
  const trustedAdapters=new Map();
  function registerAdapter(adapter){
    if(!adapter||!/^[-a-z0-9]{3,70}$/.test(adapter.id||"")||
        typeof adapter.detect!=="function"||typeof adapter.name!=="string"||
        trustedAdapters.has(adapter.id))throw Error("Invalid or duplicate built-in adapter.");
    // Adapter code comes only from the reviewed runtime, never learned settings.
    trustedAdapters.set(adapter.id,Object.freeze({...adapter,writeEnabled:adapter.id==="cdk-repair-orders"}));
  }
  registerAdapter({id:"cdk-repair-orders",name:"CDK Repair Orders",version:"cdk-clipboard-v1",
    detect:text=>/\bCDK\b/i.test(text)&&/\bRepair Orders\b/i.test(text)&&/\bRO\s*#\s*:?/i.test(text),
    evidence:["CDK","Repair Orders","RO #"]});
  function detectFormat(text,rules=[]){
    const sample=lines(text),joined=sample.slice(0,100).join(" ");
    for(const adapter of trustedAdapters.values()){
      if(adapter.detect(joined))return{sourceId:adapter.id,name:adapter.name,status:"recognized",
        writeEnabled:adapter.writeEnabled,version:adapter.version||"1",evidence:adapter.evidence||[]};
    }
    const first=sample[0]||"";
    const headers=first.split("\t").map(x=>x.trim().toLowerCase());
    const match=rules.find(rule=>rule?.enabled&&rule?.approved&&rule?.kind==="table"&&Array.isArray(rule.headers)&&
      rule.headers.length>1&&rule.headers.every(h=>headers.includes(String(h).toLowerCase())));
    if(match)return{sourceId:match.id,name:match.name,status:"recognized",writeEnabled:false,version:match.version,evidence:["Approved column headers"]};
    return{sourceId:"",name:"Unknown text",status:"unknown",writeEnabled:false,version:"",evidence:[]};
  }
  function safeRule(data,previous=[]){
    const clean=s=>String(s||"").trim().slice(0,90);
    const name=clean(data?.name);
    if(name.length<3)throw Error("Give the source a descriptive name.");
    const headers=Array.isArray(data.headers)?data.headers.map(clean).filter(Boolean):[];
    if(headers.length<2||headers.length>MAX_COLUMNS||new Set(headers.map(x=>x.toLowerCase())).size!==headers.length)
      throw Error("A learnable table needs at least two distinct column headers.");
    const sourceFields={};
    for(const [key,value] of Object.entries(data.fields||{})){
      if(FIELDS.includes(key)&&headers.some(h=>h.toLowerCase()===clean(value).toLowerCase()))sourceFields[key]=clean(value);
    }
    if(!Object.keys(sourceFields).length)throw Error("Map at least one column to a field.");
    const id=/^[a-z0-9-]{3,70}$/.test(data.id||"")?data.id:"learned-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,55);
    if(id==="cdk-repair-orders")throw Error("Built-in import definitions cannot be replaced by learned mappings.");
    if(!previous.some(x=>x.id===id)&&previous.length>=MAX_RULES)throw Error("Maximum number of learned layouts reached.");
    const old=previous.find(x=>x.id===id);
    return{id,name,kind:"table",headers,fields:sourceFields,version:(old?.version||0)+1,approved:true,enabled:true,
      writeEnabled:false,updatedAt:new Date().toISOString(),previous:old?{version:old.version,headers:old.headers,fields:old.fields,name:old.name}:null};
  }
  function tablePreview(text,rule){
    const data=lines(text).map(line=>line.split("\t").map(cell=>cell.trim()));
    const headers=(data.shift()||[]).map(h=>h.toLowerCase());
    if(data.length>MAX_ROWS)throw Error("Too many data rows.");
    const errors=[],rows=[];
    for(let i=0;i<data.length;i++){
      const cells=data[i];
      if(cells.length!==headers.length){errors.push({row:i+2,reason:"Unexpected column count"});continue;}
      const row={};
      for(const [field,header] of Object.entries(rule.fields||{})){
        const index=headers.indexOf(String(header).toLowerCase());
        if(index>=0)row[field]=cells[index]||"";
      }
      rows.push(row);
    }
    return{rows,issues:errors};
  }
  function tableHeaders(text){
    const first=lines(text)[0]||"";
    return first.includes("\t")?first.split("\t").map(s=>s.trim()).filter(Boolean).slice(0,MAX_COLUMNS):[];
  }
  root.MoonDogPasteLearn=Object.freeze({normalize,capture,detectFormat,registerAdapter,safeRule,tablePreview,tableHeaders,MAX_TEXT,MAX_ROWS,FIELDS});
})(globalThis);

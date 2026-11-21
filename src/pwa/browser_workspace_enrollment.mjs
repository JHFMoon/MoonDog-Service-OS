/** Pure local enrollment validation. A caller must separately verify the
 * installed software, store UUID, Workspace boundaries and exclusive lock.
 * A display label alone never grants an operational-store capability. */
const FORMAT='moondog-browser-workspace-enrollment';
const fail=message=>{throw Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
function text(value,maximum,required=false){
 if(typeof value!=='string'||/[\x00-\x1f\x7f<>]/.test(value))fail('Invalid dealership enrollment text.');
 const normalized=value.trim().replace(/\s+/g,' ');
 if(normalized.length>maximum||(required&&!normalized))fail('Incomplete dealership enrollment text.');
 return normalized;
}
function profile(value){
 if(!object(value))fail('A dealership name, store code and time zone are required.');
 const name=text(value.name,120,true),code=text(value.code,32,true).toUpperCase(),brand=text(value.brand??'',80);
 if(!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code))fail('Store code must use letters, numbers, periods, underscores or hyphens.');
 let timeZone;
 try{timeZone=new Intl.DateTimeFormat('en-US',{timeZone:text(value.timeZone,100,true)}).resolvedOptions().timeZone;}
 catch(_){fail('Choose a valid dealership time zone.');}
 return Object.freeze({name,code,brand,timeZone});
}
function timestamp(value){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)
  fail('The local enrollment confirmation date is invalid.');
 return value;
}
/** Create metadata only after an explicit local user confirmation. */
export function createOperationalEnrollment({store,confirmed=false,confirmedAt=new Date().toISOString()}={}){
 if(confirmed!==true)fail('Explicit dealership Workspace confirmation is required.');
 return Object.freeze({format:FORMAT,formatVersion:1,mode:'operational',
  confirmedAt:timestamp(confirmedAt),store:profile(store)});
}
/** Preserve synthetic legacy compatibility; unknown/corrupt enrollment fails
 * closed even if its display label happens to start with SYNTHETIC. */
export function inspectBrowserWorkspaceEnrollment(identity){
 if(!object(identity)||typeof identity.label!=='string')fail('Browser Workspace identity is missing.');
 if(!Object.hasOwn(identity,'enrollment')){
  if(!/^SYNTHETIC(?:\s|$)/i.test(identity.label))
   fail('This browser Workspace requires explicit dealership enrollment; it is not a synthetic preview.');
  return Object.freeze({mode:'synthetic',store:null,confirmedAt:null});
 }
 const value=identity.enrollment;
 if(!exact(value,['format','formatVersion','mode','confirmedAt','store'])||value.format!==FORMAT||value.formatVersion!==1||value.mode!=='operational'||
    !exact(value.store,['name','code','brand','timeZone']))fail('Browser Workspace enrollment is invalid or unsupported.');
 const normalized=profile(value.store);
 if(identity.label!==normalized.name||Object.keys(normalized).some(name=>normalized[name]!==value.store[name]))
  fail('Browser Workspace identity does not match its canonical dealership enrollment.');
 return Object.freeze({mode:'operational',store:normalized,confirmedAt:timestamp(value.confirmedAt)});
}

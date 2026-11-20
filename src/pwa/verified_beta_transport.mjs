/** Read-only, pinned-commit transport for MoonDog's existing public Beta JSON.
 * This does not install, stage, activate, update or handle Workspace files.
 * Synthetic-only preview foundation; release manifest authenticity comes from
 * the exact published same-origin Pages main SHA and pinned GitHub tree.
 */
const SITE='https://jhfmoon.github.io/MoonDog-Service-OS/';
const REPO='JHFMoon/MoonDog-Service-OS';
const SHA=/^[0-9a-f]{64}$/, COMMIT=/^[0-9a-f]{40}$/;
const BETA=/^\d+\.\d+\.\d+-beta\.[1-9]\d*$/;
const PUBLIC=/^(?:index\.html|assets\/[A-Za-z0-9._-]+|vendor\/[A-Za-z0-9._-]+)$/;
const MAX_TOTAL=128*1024*1024,MAX_FILE=64*1024*1024,MAX_FILES=350;
const fail=message=>{throw Error(message);};
const asHex=arr=>Array.from(new Uint8Array(arr),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async(data,crypto)=>asHex(await crypto.subtle.digest('SHA-256',data));
function bounded(data,limit){if(!(data instanceof Uint8Array)||data.length===0||data.length>limit)fail('Downloaded Beta content exceeded approved size bounds.');return data;}
function assertResponse(response,url){
 if(!response?.ok||response.redirected||response.url!==url||response.type==='opaque')fail('Untrusted Beta release response or redirect.');
 const length=response.headers?.get?.('content-length');
 if(length!==null&&length!==undefined&&length!==''){
  const size=Number(length);if(!Number.isSafeInteger(size)||size<1||size>MAX_TOTAL)fail('Beta release declared an unsafe download size.');
 }
}
async function fetchBytes(fetchImpl,url,limit){
 const response=await fetchImpl(url,{redirect:'error',credentials:'omit',cache:'no-store',mode:'cors'});
 assertResponse(response,url);
 if(typeof response.body?.getReader!=='function')fail('Beta release requires a bounded streaming response.');
 const reader=response.body.getReader(),blocks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))fail('Beta transport supplied invalid bytes.');
   size+=value.length;if(size>limit)fail('Beta response exceeds approved size.');blocks.push(value);
  }
 }catch(error){try{await reader.cancel();}catch(_){}throw error;}
 const out=new Uint8Array(size);let offset=0;for(const block of blocks){out.set(block,offset);offset+=block.length;}
 return bounded(out,limit);
}
function parseJson(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch(_){fail('Beta release JSON cannot be decoded safely.');}}
function pin(commit,path){if(!COMMIT.test(commit)||!/^[a-z0-9./-]+$/.test(path)||path.includes('..'))fail('Invalid pinned GitHub release path.');
 return 'https://raw.githubusercontent.com/'+REPO+'/'+commit+'/'+path;}
function decodeStrict64(value){
 if(typeof value!=='string'||!value||value.length>Math.ceil(MAX_FILE/3)*4+8||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)))
  fail('Beta runtime file has invalid base64 content.');
 const decoded=atob(value);if(decoded.length>MAX_FILE)fail('Beta runtime file too large.');
 const bytes=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
 return bytes;
}
function requireManifest(manifest){
 const beta=manifest?.beta;
 if(manifest?.stable?.version!=='0.10.17'||!BETA.test(beta?.version||'')||!SHA.test(beta?.sha256||''))
  fail('Published Beta manifest does not preserve the approved Stable channel.');
 const expected='https://raw.githubusercontent.com/'+REPO+'/main/updates/packages/moondog-'+beta.version+'.json';
 if(beta.packageUrl!==expected)fail('Published Beta manifest package authority differs from reviewed source.');
 return beta;
}
/** All SHA anchors and hashes are verified before any package file is returned. */
export async function fetchVerifiedPinnedBeta({siteUrl=SITE,fetchImpl,crypto}={}){
 if(siteUrl!==SITE||typeof fetchImpl!=='function'||typeof crypto?.subtle?.digest!=='function')fail('Trusted MoonDog Pages origin and WebCrypto are required.');
 const latestBytes=await fetchBytes(fetchImpl,SITE+'site-version.json',256*1024);
 const latest=parseJson(latestBytes),commit=latest?.mainSha;
 if(!COMMIT.test(commit||''))fail('Live published source authority is invalid.');
 const manifestBytes=await fetchBytes(fetchImpl,pin(commit,'updates/manifest.json'),256*1024);
 const beta=requireManifest(parseJson(manifestBytes));
 const packagePath='updates/packages/moondog-'+beta.version+'.json';
 const packageBytes=await fetchBytes(fetchImpl,pin(commit,packagePath),MAX_TOTAL);
 if(await digest(packageBytes,crypto)!==beta.sha256)fail('Pinned Beta package SHA-256 mismatch.');
 const pkg=parseJson(packageBytes);
 if(pkg?.formatVersion!==1||pkg?.version!==beta.version||!Array.isArray(pkg.approvedFiles)||
    !Array.isArray(pkg.files)||pkg.files.length<5||pkg.files.length>MAX_FILES||pkg.approvedFiles.length!==pkg.files.length)
  fail('Pinned Beta package has invalid runtime inventory.');
 let total=0;const names=new Set(),entries=[];
 for(let i=0;i<pkg.files.length;i++){
  const item=pkg.files[i],path=item?.path;
  if(path!==pkg.approvedFiles[i]||!PUBLIC.test(path||'')||names.has(path)||item.action!=='put'||!SHA.test(item.sha256||''))
   fail('Beta package has duplicate or unapproved runtime paths.');
  names.add(path);
  const content=decodeStrict64(item.contentBase64);
  total+=content.byteLength;if(total>MAX_TOTAL)fail('Beta runtime inventory exceeds safe size.');
  if(await digest(content,crypto)!==item.sha256)fail('Beta runtime file SHA-256 mismatch: '+path);
  entries.push(Object.freeze({path,bytes:content,sha256:item.sha256}));
 }
 if(!names.has('index.html')||!names.has('assets/app.js'))fail('Beta runtime entrypoint is missing.');
 return Object.freeze({version:beta.version,mainSha:commit,packageHash:beta.sha256,
  files:Object.freeze(entries),verified:true,installed:false,productionReady:false});
}

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const{createHash,webcrypto}=require('node:crypto');
const context=vm.createContext({TextDecoder,Uint8Array,atob,crypto:webcrypto});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','updates/package-plan.js'),'utf8'),context);
const hash=value=>createHash('sha256').update(value).digest('hex');
const missing=()=>Object.assign(Error('synthetic missing'),{name:'NotFoundError'});
const root={queryPermission:async()=> 'granted',getDirectoryHandle:async()=>{throw missing();},getFileHandle:async()=>{throw missing();}};
async function plan(contentBase64,sha256){
 const bytes=Buffer.from(JSON.stringify({formatVersion:1,version:'1.1.0',approvedFiles:['assets/large.js'],
  files:[{path:'assets/large.js',action:'put',sha256,contentBase64}]}));
 return context.MoonDogPackagePlan.dryRun({verifiedPackage:{status:'verified',version:'1.1.0',bytes,sha256:hash(bytes)},
  appDirectoryHandle:root,trustedAllowlist:['assets/large.js']});
}
test('large verified software entries do not overflow the Base64 validator regex stack',async()=>{
 const bytes=Buffer.alloc(5*1024*1024,65),value=bytes.toString('base64');
 const result=await plan(value,hash(bytes));assert.equal(result.rejected.length,0);assert.deepEqual(Array.from(result.add),['assets/large.js']);
 const changed=await plan('R'+value.slice(1),hash(bytes));assert.equal(changed.rejected[0].reason,'file-hash-mismatch');
});
test('linear Base64 validation preserves strict alphabet and padding rejection',async()=>{
 for(const value of ['A===','AAAA====','AA=A','AA\n=','AA%=','AAA','ＡＡ==']){
  const result=await plan(value,hash(Buffer.alloc(0)));assert.equal(result.rejected.length,1,value);
 }
 for(const value of ['','AA==','AAA=','AAAA']){
  const result=await plan(value,hash(Buffer.from(value,'base64')));assert.equal(result.rejected.length,0,value);
 }
});

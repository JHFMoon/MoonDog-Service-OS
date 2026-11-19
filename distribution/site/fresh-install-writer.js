/* Browser-only, verified Stable ZIP installer. New empty installations only.
 * Reads a locally selected ZIP; no uploads, existing-store writes or auto-Fresh. */
(function (root) {
  "use strict";
  const PACKAGE = "Service Operations Dashboard/";
  const MAX_ARCHIVE = 256 * 1024 * 1024;
  const MAX_FILE = 64 * 1024 * 1024;
  const MAX_UNPACKED = 192 * 1024 * 1024;
  const MAX_ENTRIES = 350;
  const MARKER = "MOONDOG-INSTALL-INCOMPLETE.txt";
  const REQUIRED_DIRS = Object.freeze([
    "System Files/Workspace/",
    "System Files/Workspace/data/",
    "System Files/Workspace/data/history/",
    "System Files/Workspace/backups/",
    "System Files/Workspace/imports/",
    "System Files/Workspace/exports/",
    "System Files/Workspace/support/",
    "System Files/Workspace/01 - DROP REPORTS HERE/"
  ]);
  const text = new TextDecoder("utf-8", {fatal:true});
  const encoder = new TextEncoder();
  const fail = message => {throw new Error(message);};
  function bytesEqual(a,b) {
    if(a.length!==b.length)return false;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
    return true;
  }
  async function digest(bytes) {
    if(!root.crypto?.subtle)fail("Secure SHA-256 verification is unavailable.");
    const result = new Uint8Array(await root.crypto.subtle.digest("SHA-256",bytes));
    return Array.from(result,value=>value.toString(16).padStart(2,"0")).join("");
  }
  function safeSegment(name) {
    return Boolean(name) && !/[\x00-\x1f\\:*?"<>|]/.test(name) &&
      name!=="." && name!==".." && !/[. ]$/.test(name) &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
  }
  function installationName(value) {
    const name=String(value||"").trim();
    if(name.length>72 || !safeSegment(name) || name.includes("/"))
      fail("Choose a simple new folder name without slashes or Windows-reserved characters.");
    return name;
  }
  function safeRelative(path,directory) {
    if(typeof path!=="string" || !path.startsWith(PACKAGE) || path.includes("\\"))
      fail("The archive has an unexpected installation path.");
    const relative=path.slice(PACKAGE.length);
    if(relative==="" && directory)return "";
    const parts=(directory?relative.slice(0,-1):relative).split("/");
    if(!parts.length || parts.some(part=>!safeSegment(part)))
      fail("The archive contains an unsafe file or folder name.");
    return relative;
  }
  function parseZip(buffer) {
    const data=new Uint8Array(buffer),dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
    if(data.length<22 || data.length>MAX_ARCHIVE)fail("The selected archive is incomplete or too large.");
    const u16=(i)=>{if(i<0||i+2>data.length)fail("The archive index is incomplete.");return dv.getUint16(i,true);};
    const u32=(i)=>{if(i<0||i+4>data.length)fail("The archive index is incomplete.");return dv.getUint32(i,true);};
    let end=-1;
    for(let i=data.length-22;i>=Math.max(0,data.length-22-65535);i--){
      if(u32(i)===0x06054b50 && i+22+u16(i+20)===data.length){end=i;break;}
    }
    if(end<0 || u16(end+4)!==0 || u16(end+6)!==0 ||
        u16(end+8)!==u16(end+10) || u16(end+10)<4 ||
        u16(end+10)>MAX_ENTRIES || u16(end+10)===0xffff)
      fail("This is not a supported single-disk MoonDog ZIP.");
    const count=u16(end+10),centralSize=u32(end+12),centralAt=u32(end+16);
    if(centralSize===0xffffffff || centralAt===0xffffffff ||
       centralAt+centralSize!==end)fail("The ZIP file index is unsupported or damaged.");
    let offset=centralAt,total=0;
    const entries=new Map();
    for(let i=0;i<count;i++){
      if(u32(offset)!==0x02014b50 || offset+46>end)fail("The ZIP index is damaged.");
      const flags=u16(offset+8),method=u16(offset+10);
      const packed=u32(offset+20),unpacked=u32(offset+24);
      const nameSize=u16(offset+28),extraSize=u16(offset+30),commentSize=u16(offset+32);
      const localAt=u32(offset+42),mode=u32(offset+38)>>>16;
      const next=offset+46+nameSize+extraSize+commentSize;
      if(next>end || !nameSize || packed===0xffffffff || unpacked===0xffffffff ||
         (flags & 0x0001)!==0 || ![0,8].includes(method) || unpacked>MAX_FILE ||
         (mode & 0xf000)===0xa000)fail("Unsupported or unsafe ZIP entry.");
      const name=text.decode(data.subarray(offset+46,offset+46+nameSize));
      const directory=name.endsWith("/");
      const relative=safeRelative(name,directory);
      if(entries.has(relative))fail("The installation ZIP has duplicate paths.");
      if(u32(localAt)!==0x04034b50 || u16(localAt+8)!==method)
        fail("The ZIP member header is damaged.");
      const localFlags=u16(localAt+6),localNameSize=u16(localAt+26),localExtraSize=u16(localAt+28);
      const bodyAt=localAt+30+localNameSize+localExtraSize;
      if(localFlags!==flags || bodyAt+packed>centralAt ||
         !bytesEqual(data.subarray(localAt+30,localAt+30+localNameSize),
           data.subarray(offset+46,offset+46+nameSize)))
        fail("The archive member index disagrees with its file.");
      total+=unpacked;
      if(total>MAX_UNPACKED)fail("The installation ZIP expands beyond the safe limit.");
      entries.set(relative,{relative,directory,packed,unpacked,method,bodyAt});
      offset=next;
    }
    if(offset!==end)fail("The ZIP index contains unexpected trailing data.");
    return {data,entries};
  }
  async function inflate(archive,entry) {
    if(entry.method===0){
      if(entry.packed!==entry.unpacked)fail("The stored file size is inconsistent.");
      return archive.data.slice(entry.bodyAt,entry.bodyAt+entry.packed);
    }
    if(typeof root.DecompressionStream!=="function" || !root.Blob)
      fail("This browser cannot safely unpack the MoonDog ZIP. Use Microsoft Edge.");
    let stream;
    try{
      stream=new root.Blob([archive.data.subarray(entry.bodyAt,entry.bodyAt+entry.packed)])
        .stream().pipeThrough(new root.DecompressionStream("deflate-raw"));
    }catch(_){fail("This browser does not support the required ZIP decompression.");}
    const output=new Uint8Array(entry.unpacked),reader=stream.getReader();
    let position=0;
    try{
      while(true){
        const step=await reader.read();
        if(step.done)break;
        if(position+step.value.byteLength>output.length)fail("A ZIP member exceeds its declared size.");
        output.set(step.value,position);position+=step.value.byteLength;
      }
    }catch(error){
      try{await reader.cancel();}catch(_){}
      throw error;
    }
    if(position!==output.length)fail("A ZIP member was not fully extracted.");
    return output;
  }
  async function inspectVerifiedZip(buffer,expectedHash,expectedVersion) {
    if(!/^[a-f0-9]{64}$/.test(expectedHash||"") ||
       !/^\d+\.\d+\.\d+$/.test(expectedVersion||""))
      fail("Verified official release details are missing.");
    if(await digest(buffer)!==expectedHash)
      fail("The ZIP differs from the approved Stable release. No installation was made.");
    const archive=parseZip(buffer);
    const manifestEntry=archive.entries.get("INSTALLATION-MANIFEST.json");
    if(!manifestEntry || manifestEntry.directory || manifestEntry.unpacked>2*1024*1024)
      fail("The official installation inventory is missing.");
    let manifest;
    try{manifest=JSON.parse(text.decode(await inflate(archive,manifestEntry)));}
    catch(_){fail("The installation inventory is unreadable.");}
    if(manifest.format!=="service-operations-dashboard-clean-install" ||
       manifest.formatVersion!==1 || manifest.version!==expectedVersion ||
       manifest.packageRoot!=="Service Operations Dashboard" ||
       manifest.launcher!=="00 - OPEN DASHBOARD.html" ||
       manifest.applicationRoot!=="System Files" ||
       manifest.workspaceRoot!=="System Files/Workspace" ||
       manifest.updateChannel!=="stable" ||
       manifest.workspaceProtectedFromUpdates!==true ||
       !Array.isArray(manifest.files) || !manifest.files.length)
      fail("The archive does not match the approved new-install layout.");
    for(const directory of REQUIRED_DIRS)
      if(!archive.entries.get(directory)?.directory)
        fail("The new installation is missing an empty Workspace directory.");
    const approved=new Map();
    for(const item of manifest.files){
      const name=String(item?.path||"");
      if(approved.has(name) || !safeRelative(PACKAGE+name,false) ||
         !Number.isSafeInteger(item.size) || item.size<0 ||
         !/^[a-f0-9]{64}$/.test(item.sha256||""))
        fail("The installation inventory contains a duplicate or invalid file.");
      if(name.startsWith("System Files/Workspace/") &&
         name!=="System Files/Workspace/README.txt")
        fail("A clean package must never contain initialized dealership data.");
      approved.set(name,item);
    }
    // The original immutable Stable 0.10.17 ZIP has no root index.html bridge.
    // Only the launcher, application entry, and private Workspace boundary are required.
    // Do not synthesize unlisted application files during a verified install.
    for(const required of ["00 - OPEN DASHBOARD.html","System Files/index.html",
      "System Files/Workspace/README.txt"])
      if(!approved.has(required))fail("The package is missing its launcher or private-data boundary.");
    for(const [name,entry] of archive.entries){
      if(entry.directory){
        if(name!=="" && !REQUIRED_DIRS.includes(name))
          fail("The ZIP has an unexpected directory.");
      }else if(name!=="INSTALLATION-MANIFEST.json" && !approved.has(name)){
        fail("The ZIP contains a file outside the approved installation inventory.");
      }
    }
    if(archive.entries.size!==approved.size+1+REQUIRED_DIRS.length+1)
      fail("The installation inventory does not match the ZIP contents.");
    const files=[];
    for(const [name,item] of approved){
      const entry=archive.entries.get(name);
      if(!entry || entry.directory || entry.unpacked!==item.size)
        fail("The ZIP and installation inventory disagree.");
      const bytes=await inflate(archive,entry);
      if(await digest(bytes)!==item.sha256)fail("A packaged application file failed SHA-256 verification.");
      files.push({path:name,bytes,sha256:item.sha256});
    }
    files.push({path:"INSTALLATION-MANIFEST.json",
      bytes:await inflate(archive,manifestEntry),sha256:null});
    const directories=new Set(REQUIRED_DIRS);
    for(const file of files){
      const parts=file.path.split("/");
      for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join("/")+"/");
    }
    return {version:manifest.version,files,
      directories:[...directories].sort((a,b)=>a.split("/").length-b.split("/").length)};
  }
  function missing(error){return error && error.name==="NotFoundError";}
  async function hasFile(folder,name){
    try{await folder.getFileHandle(name,{create:false});return true;}
    catch(error){if(missing(error))return false;throw error;}
  }
  async function hasFolder(folder,name){
    try{await folder.getDirectoryHandle(name,{create:false});return true;}
    catch(error){if(missing(error))return false;throw error;}
  }
  async function rootIsUnsafe(parent){
    // Names alone are not proof. Check exact known layout entries; never read report data.
    if(await hasFile(parent,"INSTALLATION-MANIFEST.json") ||
       await hasFile(parent,"00 - OPEN DASHBOARD.html"))return true;
    if((await hasFile(parent,"index.html")) &&
       ((await hasFolder(parent,"Workspace")) || (await hasFolder(parent,"assets"))))return true;
    if(await hasFolder(parent,"System Files")){
      const system=await parent.getDirectoryHandle("System Files",{create:false});
      if(await hasFolder(system,"Workspace") || await hasFile(system,"index.html"))
        return true; // Preserve even partial application roots.
    }
    if(await hasFile(parent,"settings.json") || await hasFile(parent,"current-state.json"))
      return true;
    if(await hasFolder(parent,"data")){
      const data=await parent.getDirectoryHandle("data",{create:false});
      if(await hasFile(data,"settings.json") || await hasFile(data,"current-state.json") ||
         await hasFolder(parent,"backups") || await hasFolder(parent,"imports") ||
         await hasFolder(parent,"history"))
        return true; // Recognize even partially recovered private Workspace state.
    }
    return false;
  }
  async function newDirectory(rootDir,path){
    let current=rootDir;
    for(const segment of path.replace(/\/$/,"").split("/")){
      current=await current.getDirectoryHandle(segment,{create:true});
    }
    return current;
  }
  async function fileHandle(rootDir,path){
    const parts=path.split("/"),name=parts.pop();
    const dir=parts.length?await newDirectory(rootDir,parts.join("/")):rootDir;
    // A new folder is not exclusive: another tab or sync process may add files
    // after the initial empty check. Never knowingly replace their bytes.
    if(await hasFile(dir,name) || await hasFolder(dir,name))
      fail("An unexpected file appeared during installation. No existing file was overwritten.");
    return dir.getFileHandle(name,{create:true});
  }
  async function assertOnlyApprovedFiles(rootDir,packageData){
    const expectedFiles=new Set(packageData.files.map(item=>item.path));
    const expectedDirs=new Set(packageData.directories);
    async function inspect(dir,prefix){
      for await(const entry of dir.values()){
        if(!entry || typeof entry.name!=="string")
          fail("The installation contains an unexpected entry.");
        const path=prefix+entry.name;
        if(entry.kind==="directory"){
          if(!expectedDirs.has(path+"/"))
            fail("An unapproved directory appeared during installation.");
          await inspect(entry,path+"/");
        }else if(entry.kind==="file"){
          // The inventory commits after this inspection; our marker is temporary.
          if(path!==MARKER && !expectedFiles.has(path))
            fail("An unapproved file appeared during installation.");
        }else fail("The installation contains an unexpected entry.");
      }
    }
    await inspect(rootDir,"");
  }
  async function writeReadBack(rootDir,path,bytes,hash) {
    const file=await fileHandle(rootDir,path);
    const output=await file.createWritable();
    try{await output.write(bytes);await output.close();}
    catch(error){try{await output.abort?.();}catch(_){}throw error;}
    const read=new Uint8Array(await (await file.getFile()).arrayBuffer());
    if(read.length!==bytes.length || !bytesEqual(read,bytes) ||
       (hash && await digest(read)!==hash))
      fail("The installed file could not be verified after writing.");
  }
  async function install({file,sha256,version,folderName,onProgress}={}) {
    const name=installationName(folderName||"Service Operations Dashboard");
    if(!file || !Number.isSafeInteger(file.size) || file.size<22 ||
       file.size>MAX_ARCHIVE || !/^[a-f0-9]{64}$/.test(sha256||"") ||
       !/^\d+\.\d+\.\d+$/.test(version||""))
      fail("Choose and verify the official Stable ZIP before installing.");
    if(typeof root.showDirectoryPicker!=="function")
      fail("Choose a directory using Microsoft Edge on the Windows computer.");
    const status=typeof onProgress==="function"?onProgress:()=>{};
    // Ask from the user's click, before any asynchronous digest or network action.
    const parent=await root.showDirectoryPicker({mode:"readwrite",id:"moondog-new-store-parent"});
    if(!parent || parent.kind!=="directory" ||
       typeof parent.getDirectoryHandle!=="function")fail("A parent folder was not selected.");
    if(typeof parent.queryPermission==="function" &&
       await parent.queryPermission({mode:"readwrite"})!=="granted")
      fail("Write access was not granted. Nothing was installed.");
    if(await rootIsUnsafe(parent))
      fail("The selected folder looks like an existing MoonDog or private Workspace. Choose its parent instead.");
    if(await hasFolder(parent,name) || await hasFile(parent,name))
      fail("That installation folder already exists. No files were changed. Choose a different new folder name.");
    if(typeof root.confirm!=="function" || !root.confirm(
      "Create a brand-new MoonDog "+version+" folder named \""+name+"\" inside \""+
      String(parent.name||"the selected location")+"\"? Existing folders will not be changed."))
      return {status:"cancelled"};
    status("Verifying the official ZIP and its application file inventory…");
    const buffer=await file.arrayBuffer();
    const packageData=await inspectVerifiedZip(buffer,sha256,version);
    // Recheck after asynchronous validation; no existing directory may be adopted.
    if(await rootIsUnsafe(parent) || await hasFolder(parent,name) || await hasFile(parent,name))
      fail("The selected location changed or already contains that installation. Nothing was written.");
    status("Creating a new installation folder…");
    let destination=null,created=false;
    try{
      destination=await parent.getDirectoryHandle(name,{create:true});
      created=true;
      for await(const _ of destination.values())
        fail("The new folder is not empty. Installation stopped without overwriting files.");
      const marker=encoder.encode("MoonDog new installation is incomplete. Preserve this folder; do not use it as a working store until a clean install is verified.\n");
      await writeReadBack(destination,MARKER,marker,null);
      for(const directory of packageData.directories)await newDirectory(destination,directory);
      let written=0;
      for(const item of packageData.files){
        // The inventory is committed last, so an interrupted copy cannot claim completeness.
        if(item.path==="INSTALLATION-MANIFEST.json")continue;
        await writeReadBack(destination,item.path,item.bytes,item.sha256);
        written++;
        status("Installing verified application files: "+written+" of "+(packageData.files.length-1)+"…");
      }
      // Reject unexpected concurrent additions without reading private file data;
      // do not commit the manifest for an unrecognized root.
      await assertOnlyApprovedFiles(destination,packageData);
      const manifest=packageData.files.find(item=>item.path==="INSTALLATION-MANIFEST.json");
      await writeReadBack(destination,manifest.path,manifest.bytes,null);
      await destination.removeEntry(MARKER);
      if(await hasFile(destination,MARKER))
        fail("The incomplete-install marker could not be cleared.");
      status("Verified installation created. Open the launcher in Edge to complete Guided Setup.");
      return {status:"installed",version:packageData.version,folderName:name,files:written+1};
    }catch(error){
      if(created){
        const failure=new Error("Installation did not finish. A partial NEW folder may remain. Keep it untouched, use a different new folder after checking, and do not use it as a working store. Reason: "+String(error?.message||"write failed"));
        failure.partial=true;
        throw failure;
      }
      throw error;
    }
  }
  const api=Object.freeze({installationName,parseZip,inspectVerifiedZip,install});
  root.MoonDogFreshInstall=api;
  if(typeof module!=="undefined")module.exports=api;
})(globalThis);

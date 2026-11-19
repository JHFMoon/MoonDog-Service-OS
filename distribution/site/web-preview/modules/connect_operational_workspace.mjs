/**
 * Early-stage authenticated browser Workspace bridge for the *existing* MoonDog
 * FileSystemHandle runtime. Does not publish the app, enable real-store data,
 * or alter user-visible Windows folders. Read-only application binaries;
 * only System Files/Workspace can mutate, subject to the app's write guard.
 *
 * The returned object is not structured-cloneable into IndexedDB. Every new
 * web-app session must reconnect through this module and independently verify
 * the installed application before exposing a handle. That is intentional.
 */
import {inspectVerifiedBrowserInstallation} from './install_verified_browser_store.mjs';

const WORKSPACE = 'System Files/Workspace';
const STORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = message => { throw new Error(message); };
const safePart = name => typeof name === 'string' && name.length > 0 && name !== '.' &&
  name !== '..' && !/[\\/\x00-\x1f]/.test(name);
const editablePath = path => path.startsWith(WORKSPACE + '/');
const traversalPath = (base, name) => base ? `${base}/${name}` : name;

/**
 * Acquires a persistent tab-exclusive Web Lock before the app is connected.
 * Fail-closed when a lock or verified install is unavailable. Cross-tab direct
 * OPFS writes by hostile/uncooperative code are not protected by Web Locks;
 * caller must still use MoonDog's protected revision/journal write authority.
 */
export async function openVerifiedOperationalWorkspace({storage,crypto,locks,storeId,version,expectedManifestHash}={}) {
  if(!STORE_ID.test(storeId||'')||typeof locks?.request!=='function')
    fail('Verified browser store identity and cross-tab locking are required.');
  if(typeof storage?.getDirectory!=='function')fail('Origin-private storage is not available.');

  let release, acquired, rejected;
  let active = false, finished = false;
  const hold = new Promise(resolve => {release = resolve;});
  const ready = new Promise((resolve,reject)=>{acquired=resolve;rejected=reject;});
  const task = locks.request('moondog-pwa-operational-'+storeId,
    {mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock){rejected(new Error('Another MoonDog tab is already using this browser store.'));return;}
      active = true;acquired();
      try{await hold;}finally{active=false;}
    });
  // Avoid an unhandled rejection when a browser locks implementation fails.
  const done = Promise.resolve(task).catch(error => {rejected(error);throw error;});
  try {
    await ready;
    const proof = await inspectVerifiedBrowserInstallation({storage,crypto,storeId,version,expectedManifestHash});
    if(!proof.applicationVerified || proof.identity.storeId!==storeId)
      fail('Browser application verification did not authorize this store.');

    const originals = new WeakMap();
    const assertActive = () => {if(!active || finished)fail('This MoonDog browser session is closed.');};
    const unwrap = input => originals.get(input) || null;
    function wrapFile(file,path){
      const result = Object.freeze({
        kind:'file',name:file.name,
        async getFile(){assertActive();return file.getFile();},
        async createWritable(options){
          assertActive();if(!editablePath(path))fail('Browser application assets are read-only.');
          const stream = await file.createWritable(options);
          return Object.freeze({
            write(...args){assertActive();return stream.write(...args);},
            seek(...args){assertActive();return stream.seek(...args);},
            truncate(...args){assertActive();return stream.truncate(...args);},
            close(){assertActive();return stream.close();},
            abort(...args){return stream.abort(...args);}
          });
        },
        isSameEntry(other){assertActive();const target=unwrap(other);return target ? file.isSameEntry(target) : Promise.resolve(false);},
        queryPermission: async ({mode='read'}={}) => active && !finished && (mode!=='readwrite'||editablePath(path))?'granted':'denied',
        requestPermission: async ({mode='read'}={}) => active && !finished && (mode!=='readwrite'||editablePath(path))?'granted':'denied'
      });
      originals.set(result,file);return result;
    }
    function wrapDir(dir,path=''){
      const result = Object.freeze({
        kind:'directory',name:dir.name,
        async getFileHandle(name,{create=false}={}){
          assertActive();if(!safePart(name))fail('Unsafe browser file name.');
          const next=traversalPath(path,name);
          if(create && !editablePath(next)){
            // A caller may request create=true for a file that already exists;
            // never allow it to create a new non-Workspace application file.
            return wrapFile(await dir.getFileHandle(name,{create:false}),next);
          }
          return wrapFile(await dir.getFileHandle(name,{create}),next);
        },
        async getDirectoryHandle(name,{create=false}={}){
          assertActive();if(!safePart(name))fail('Unsafe browser directory name.');
          const next=traversalPath(path,name);
          // Existing trusted runtime and Workspace root may be traversed, but
          // only child directories *inside* Workspace can be created.
          if(create && !editablePath(next))return wrapDir(await dir.getDirectoryHandle(name,{create:false}),next);
          return wrapDir(await dir.getDirectoryHandle(name,{create}),next);
        },
        async removeEntry(name,opts){
          assertActive();if(!safePart(name))fail('Unsafe browser entry name.');
          const next=traversalPath(path,name);
          if(!editablePath(next))fail('Cannot remove browser application files or store identity.');
          return dir.removeEntry(name,opts);
        },
        async *entries(){
          assertActive();for await(const [name,handle] of dir.entries()){
            assertActive();if(!safePart(name))fail('Unsafe browser entry name.');
            const next=traversalPath(path,name);
            yield [name,handle.kind==='directory'?wrapDir(handle,next):wrapFile(handle,next)];
          }
        },
        async *values(){for await(const [,handle] of this.entries())yield handle;},
        async *keys(){for await(const [name] of this.entries())yield name;},
        [Symbol.asyncIterator](){return this.entries();},
        async resolve(other){assertActive();const target=unwrap(other);return target ? dir.resolve(target) : null;},
        isSameEntry(other){assertActive();const target=unwrap(other);return target ? dir.isSameEntry(target) : Promise.resolve(false);},
        queryPermission:async()=>active&&!finished?'granted':'denied',
        requestPermission:async()=>active&&!finished?'granted':'denied'
      });
      originals.set(result,dir);return result;
    }
    const handle = wrapDir(proof.store);
    return Object.freeze({
      storeId,handle,version,
      operationalModelConnected:false,externalBackupVerified:false,productionReady:false,
      async close(){if(finished)return;finished=true;release();await done;}
    });
  } catch(error){
    finished=true;release();await done.catch(()=>{});throw error;
  }
}
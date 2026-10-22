(function (global) {
  "use strict";
  // This is a local write gate, not a cross-computer lock or authentication.
  const testEnabled = global.location?.protocol === "test:" && global.__MOONDOG_TEST_WRITE_AUTHORITY__ === true;
  delete global.__MOONDOG_TEST_WRITE_AUTHORITY__;
  let editable = false;
  // Local permission to finish an explicitly in-progress whole-state restore.
  // On another tab or after reload, a durable restore marker blocks editing.
  let localRestoreOwner = null;
  let interruptedRecovery = false;
  let nativeRoot = null;
  let loadedRevision = null;
  const ID_KEY = "authoritative-computer-v1";
  const DB_NAME = "moondog-operations-local";
  const WORKSPACE = ["System Files", "Workspace"];
  const MARKER = [...WORKSPACE, "data", "write-authority.json"];
  const REVISION = [...WORKSPACE, "data", "store-revision.json"];
  const encoder = new TextEncoder();
  const sessionIdentities = new Map();
  let transientValidation = false;
  const transientValidationDelays = [0, 150, 400, 900, 1800];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function transientInterfaceState(error) { return ["AbortError","InvalidStateError","NotReadableError","UnknownError","TimeoutError"].includes(error?.name) || /state cached in an interface object|state had changed since it was read from disk|changed since it was read from disk/i.test(String(error?.message || "")); }
  const notify = () => global.dispatchEvent?.(new Event("moondog-write-authority"));
  function setEditable(value) { value = Boolean(value); if (editable === value) return; editable = value; notify(); }
  function setTransientValidation(value) { value = Boolean(value); if (transientValidation === value) return; transientValidation = value; notify(); }
  async function localIdentity(markerDigest) {
    if (sessionIdentities.has(markerDigest)) return sessionIdentities.get(markerDigest);
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("handles")) request.result.createObjectStore("handles"); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readonly"), request = tx.objectStore("handles").get(`${ID_KEY}:${markerDigest}`);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }); } finally { db.close(); }
    } catch (_) { return null; }
  }
  async function saveLocalIdentity(secret, markerDigest) {
    sessionIdentities.set(markerDigest, secret);
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("handles")) request.result.createObjectStore("handles"); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try { await new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(secret, `${ID_KEY}:${markerDigest}`);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); } finally { db.close(); }
      return true;
    } catch (_) { return false; }
  }
  async function at(root, path, create = false) {
    let dir = root;
    for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(path.at(-1), { create });
  }
  async function read(root, path) { return JSON.parse(await (await (await at(root, path)).getFile()).text()); }
  async function write(root, path, value) {
    const handle = await at(root, path, true), writable = await handle.createWritable();
    try { await writable.write(JSON.stringify(value) + "\n"); await writable.close(); }
    catch (error) { await writable.abort?.().catch(() => {}); throw error; }
    if (JSON.stringify(await read(root, path)) !== JSON.stringify(value)) throw Error("Authority read-back verification failed.");
  }
  async function digest(secret) {
    const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function validRevision(value) { return value?.schemaVersion === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0; }
  async function readBytes(root, path) {
    try { return new Uint8Array(await (await (await at(root, path)).getFile()).arrayBuffer()); }
    catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  }
  const sameBytes = (left, right) => left === null && right === null || left !== null && right !== null && left.length === right.length && left.every((byte, index) => byte === right[index]);
  const validByteList = value => Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  async function writeBytesRaw(root, path, bytes) {
    const handle = await at(root, path, true), stream = await handle.createWritable();
    try { await stream.write(bytes); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch (_) {} throw error; }
    if (!sameBytes(await readBytes(root, path), bytes)) throw Error("Recovery read-back failed.");
  }
  async function removeRaw(root, path) {
    const parent = path.slice(0, -1).reduce(async (prior, name) => (await prior).getDirectoryHandle(name), Promise.resolve(root));
    try { await (await parent).removeEntry(path.at(-1)); }
    catch (error) { if (error.name !== "NotFoundError") throw error; }
    if (!await absent(root, path)) throw Error("Recovery removal did not verify.");
  }
  async function absent(root, path) {
    const parent = path.slice(0, -1).reduce(async (prior, name) => (await prior).getDirectoryHandle(name), Promise.resolve(root));
    for (const method of ["getFileHandle", "getDirectoryHandle"]) {
      try { await (await parent)[method](path.at(-1)); return false; }
      catch (error) { if (error.name !== "NotFoundError" && error.name !== "TypeMismatchError") throw error; }
    }
    return true;
  }
  async function journalsIn(directory, prefix = "") {
    const found = [];
    for await (const [name, child] of directory.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (name.startsWith(".moondog-txn-")) found.push(path);
      else if (child.kind === "directory") found.push(...await journalsIn(child, path));
    }
    return found;
  }
  async function recoverPending(root, revision) {
    for (const journalPath of await journalsIn(root)) {
      const journal = await read(root, journalPath.split("/"));
      const target = String(journal?.target || "").split("/");
      const parent = journalPath.split("/").slice(0, -1).join("/");
      if (!target.length || target.some(part => !part || part === "." || part === "..") || target.slice(0, -1).join("/") !== parent ||
          !["moondog-write-v1", "moondog-delete-v1", "moondog-create-v1"].includes(journal.format))
        throw Error("Interrupted transaction requires controlled recovery.");
      if (journal.format === "moondog-write-v1" && journal.revisionBefore === null) {
        if (journal.before !== null && !validByteList(journal.before) || !validByteList(journal.after)) throw Error("Legacy journal bytes are invalid.");
        const before = journal.before === null ? null : new Uint8Array(journal.before);
        const after = new Uint8Array(journal.after);
        const current = await readBytes(root, target);
        if (!sameBytes(current, before) && !sameBytes(current, after)) throw Error("Legacy transaction differs from both recorded states.");
        await removeRaw(root, journalPath.split("/"));
        continue;
      }
      if (!Number.isSafeInteger(journal.revisionBefore) || journal.revisionBefore < 0 ||
          ![journal.revisionBefore, journal.revisionBefore + 1].includes(revision.revision))
        throw Error("Interrupted transaction revision is inconsistent.");
      if (journal.format === "moondog-write-v1") {
        if (journal.before !== null && !validByteList(journal.before) || journal.after !== null && !validByteList(journal.after)) throw Error("Write journal bytes are invalid.");
        const before = journal.before === null ? null : new Uint8Array(journal.before);
        const after = journal.after === null ? null : new Uint8Array(journal.after);
        const current = await readBytes(root, target);
        if (revision.revision === journal.revisionBefore) {
          // Another tab or a stale OneDrive handle can replace the target while
          // the journal revision remains unchanged. Never roll unrelated bytes
          // back to an older snapshot or remove a newly-created independent file.
          if (!sameBytes(current, before) && !sameBytes(current, after))
            throw Error("Uncommitted write journal conflicts with independent file changes; requires controlled recovery.");
          // Comparing followed by an automatic rollback has a cross-tab and
          // OneDrive time-of-check/time-of-use window. Leave potentially
          // committed bytes untouched; a separate controlled restore is needed.
          if (!sameBytes(current, before))
            throw Error("Uncommitted write journal requires controlled recovery.");
        } else if (after === null || !sameBytes(current, after)) throw Error("Committed write differs from its journal.");
      } else if (journal.format === "moondog-delete-v1") {
        if (!["file", "empty-directory"].includes(journal.kind)) throw Error("Delete journal type is invalid.");
        if (journal.kind === "file" && !validByteList(journal.before)) throw Error("Delete journal bytes are invalid.");
        if (revision.revision === journal.revisionBefore) {
          if (journal.kind === "file") {
            const before = new Uint8Array(journal.before), current = await readBytes(root, target);
            if (!sameBytes(current, null) && !sameBytes(current, before))
              throw Error("Uncommitted delete journal conflicts with independent file changes; requires controlled recovery.");
            if (current === null)
              throw Error("Uncommitted delete journal requires controlled recovery.");
          } else {
            // A completed but uncommitted empty-directory deletion can race
            // another writer. Do not recreate the old directory or dismiss
            // its journal without exclusive ownership of that path.
            throw Error("Uncommitted delete journal requires controlled recovery.");
          }
        } else {
          if (!await absent(root, target)) throw Error("Committed deletion differs from its journal.");
        }
      } else {
        if (!["file", "directory"].includes(journal.kind)) throw Error("Create journal type is invalid.");
        if (revision.revision === journal.revisionBefore) {
          if (!await absent(root, target)) {
            // We cannot distinguish an unfinished blank creation from an
            // independently written file after a cross-tab/OneDrive race.
            // Refuse destructive automatic deletion, even for empty objects.
            throw Error("Uncommitted create journal requires controlled recovery.");
          }
        } else if (await absent(root, target)) throw Error("Committed creation differs from its journal.");
      }
      await removeRaw(root, journalPath.split("/"));
    }
  }
  async function validate(root = nativeRoot, ask = false) {
    // Temporary open-editing mode: any connected workspace with browser-granted
    // read/write folder permission may edit. The former single-computer identity
    // gate is intentionally disabled until a replacement coordination model exists.
    root = originals.get(root) || root;
    if (!root) { setTransientValidation(false); setEditable(false); loadedRevision = null; return false; }
    let lastTransient = false;
    for (let attempt = 0; attempt < transientValidationDelays.length; attempt += 1) {
      if (transientValidationDelays[attempt]) await sleep(transientValidationDelays[attempt]);
      try {
        let permission = await root.queryPermission({ mode: "readwrite" });
        if (permission !== "granted" && ask && attempt === 0) permission = await root.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") throw denied();
        // Check the durable restore hold before repairing any transaction
        // journals or initializing a missing revision. After a crash those
        // writes could modify a partial restore before the owner reviews it.
        // Only the still-running initiating session may validate the hold.
        const pendingRestore=await readBytes(root,["System Files","Workspace","data","restore-in-progress.json"]);
        if(pendingRestore!==null){
          let recorded;
          try{recorded=JSON.parse(new TextDecoder().decode(pendingRestore));}catch(_){}
          if(!localRestoreOwner || recorded?.restoreId!==localRestoreOwner)
            throw Error("Another restore owns the durable hold; controlled recovery is required.");
        }
        let revision = null;
        try { revision = await read(root, REVISION); }
        catch (error) {
          if (error.name !== "NotFoundError" && !(error instanceof SyntaxError)) throw error;
        }
        if (!validRevision(revision)) {
          revision = { schemaVersion: 1, revision: 0 };
          await write(root, REVISION, revision);
        }
        if (!activeToken) {
          try { await recoverPending(root, revision); }
          catch (error) {
            // A pending current transaction cannot be resolved with an atomic
            // file compare-and-swap across Edge tabs or OneDrive devices.
            // Fail closed for those cases; leave the journal and target intact.
            if (/Uncommitted (?:write|delete|create) journal .*controlled recovery\./.test(String(error?.message || ""))) {
              console.warn("MoonDog: uncommitted journal requires controlled recovery; editing disabled.", error);
              throw error;
            }
            // An unrelated legacy journal can remain for later review, but its
            // existence alone does not establish a recoverable current write.
            console.warn("MoonDog: unrelated legacy transaction journal left in place.", error);
          }
          revision = await read(root, REVISION);
          if (!validRevision(revision)) {
            revision = { schemaVersion: 1, revision: 0 };
            await write(root, REVISION, revision);
          }
        }
        nativeRoot = root; loadedRevision = revision.revision; setTransientValidation(false); setEditable(true); return true;
      } catch (error) {
        lastTransient = transientInterfaceState(error);
        if (!lastTransient) { setTransientValidation(false); break; }
      }
    }
    setTransientValidation(lastTransient); setEditable(false); loadedRevision = null; return false;
  }
  async function provision(root) { return validate(root, true); }
  async function canProvision() { return false; }
  async function recoverOwner(root) { return validate(root, true); }
  async function assertInterruptedRecovery(root, restoreId, expectedRevision) {
    const permission = await root.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") throw denied();
    const bytes = await readBytes(root, [...WORKSPACE, "data", "restore-in-progress.json"]);
    let marker;
    try { marker = bytes && JSON.parse(new TextDecoder().decode(bytes)); } catch (_) {}
    if (!marker || marker.restoreId !== restoreId) throw denied();
    const revision = await read(root, REVISION);
    if (!validRevision(revision) || revision.revision !== expectedRevision) throw denied();
    return revision;
  }
  let tail = Promise.resolve(), activeToken = null;
  async function beginMutation(restoreId) {
    requireWrite(restoreId);
    let release;
    const previous = tail;
    tail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => {});
    try{requireWrite(restoreId);}catch(error){release();throw error;}
    const root = nativeRoot, expected = loadedRevision;
    if (interruptedRecovery && restoreId === localRestoreOwner) {
      try { await assertInterruptedRecovery(root, restoreId, expected); }
      catch (error) { release(); throw error; }
    } else if (!(testEnabled && !root) && (!await validate(root) || loadedRevision !== expected)) {
      setEditable(false); release(); throw denied();
    }
    const token = { root, expected, release, restoreId };
    activeToken = token;
    return token;
  }
  function requireToken(token, restore = false) { if (!token || token !== activeToken) throw denied(); if (!restore) requireWrite(token.restoreId); }
  async function completeMutation(token) {
    if (!token || token !== activeToken) throw denied();
    requireWrite(token.restoreId);
    let revisionWriteStarted = false;
    try {
      if (testEnabled && !token.root) { activeToken = null; token.release(); return; }
      const root = token.root, expected = token.expected;
      if (interruptedRecovery && token.restoreId === localRestoreOwner) {
        await assertInterruptedRecovery(root, token.restoreId, expected);
      } else if (!await validate(root) || loadedRevision !== expected) throw denied();
      const current = await read(root, REVISION);
      if (!validRevision(current) || current.revision !== expected) throw denied();
      revisionWriteStarted = true;
      await write(root, REVISION, { schemaVersion: 1, revision: expected + 1 });
      loadedRevision = expected + 1;
      activeToken = null; token.release();
    } catch (error) {
      if (revisionWriteStarted) try {
        const current = await read(token.root, REVISION);
        if (validRevision(current) && current.revision === token.expected + 1)
          await write(token.root, REVISION, { schemaVersion: 1, revision: token.expected });
      } catch (_) {}
      setEditable(false);
      throw error;
    }
  }
  function cancelMutation(token) { if (token === activeToken) { activeToken = null; token.release(); } }
  async function mutation(operation,restoreId) {
    const token = await beginMutation(restoreId);
    try { const result = await operation(); await completeMutation(token); return result; }
    catch (error) { cancelMutation(token); throw error; }
  }
  async function journaledDelete(path, options = {}) {
    requireWrite(options.restoreId);
    if (protectedPath(path) || path === [...WORKSPACE, "data"].join("/") && options.recursive) throw denied();
    const parts = path.split("/"), name = parts.at(-1);
    if (parts.some(part => !part || part === "." || part === "..") || name.startsWith(".moondog-txn-")) throw denied();
    const root = nativeRoot;
    if (!root) throw denied();
    const parent = await parts.slice(0, -1).reduce(async (prior, part) => (await prior).getDirectoryHandle(part), Promise.resolve(root));
    let kind, before = null;
    try { before = await readBytes(root, parts); kind = "file"; }
    catch (error) { if (error.name !== "TypeMismatchError") throw error; }
    if (!kind) {
      const directory = await parent.getDirectoryHandle(name);
      for await (const _ of directory.entries()) throw Error("Nonempty directory removal needs a separate verified recovery path.");
      kind = "empty-directory";
    }
    const token = await beginMutation(options.restoreId);
    const journalPath = [...parts.slice(0, -1), `.moondog-txn-${crypto.randomUUID()}.json`];
    const journal = { format: "moondog-delete-v1", target: path, kind, before: kind === "file" ? Array.from(before) : null, revisionBefore: token.expected };
    let touched = false;
    try {
      await writeBytesRaw(root, journalPath, encoder.encode(JSON.stringify(journal)));
      if (kind === "file" && !sameBytes(await readBytes(root, parts), before)) throw Error("File changed during deletion.");
      if (kind === "empty-directory") for await (const _ of (await parent.getDirectoryHandle(name)).entries()) throw Error("Directory changed during deletion.");
      touched = true;
      await parent.removeEntry(name, options);
      if (!await absent(root, parts)) throw Error("Removal did not verify.");
      await completeMutation(token);
      try { await removeRaw(root, journalPath); } catch (_) {}
    } catch (error) {
      // A failed removal may race a second tab/OneDrive writer. Restoring a
      // prior file or recreating a directory after touching the target could
      // overwrite independent state. Retain the journal and require recovery.
      if (touched) setEditable(false);
      else try { await removeRaw(root, journalPath); }
      catch (_) { setEditable(false); }
      cancelMutation(token);
      throw error;
    }
  }
  async function journaledCreate(path, kind,options={}) {
    requireWrite(options.restoreId);
    const parts = path.split("/"), name = parts.at(-1), root = nativeRoot;
    if (!root || parts.some(part => !part || part === "." || part === "..") || protectedPath(path)) throw denied();
    const parent = await parts.slice(0, -1).reduce(async (prior, part) => (await prior).getDirectoryHandle(part), Promise.resolve(root));
    if (!await absent(root, parts)) throw Error("File or directory already exists.");
    const token = await beginMutation(options.restoreId);
    const journalPath = [...parts.slice(0, -1), `.moondog-txn-${crypto.randomUUID()}.json`];
    const journal = { format: "moondog-create-v1", target: path, kind, revisionBefore: token.expected };
    let touched = false;
    try {
      await writeBytesRaw(root, journalPath, encoder.encode(JSON.stringify(journal)));
      if (!await absent(root, parts)) throw Error("File or directory changed during creation.");
      touched = true;
      const child = await parent[kind === "file" ? "getFileHandle" : "getDirectoryHandle"](name, { create: true });
      if (await absent(root, parts)) throw Error("Creation did not verify.");
      await completeMutation(token);
      try { await removeRaw(root, journalPath); } catch (_) {}
      return child;
    } catch (error) {
      // A newly created name may already belong to an independent writer.
      // Never automatically delete it after an attempted create.
      if (touched) setEditable(false);
      else try { await removeRaw(root, journalPath); }
      catch (_) { setEditable(false); }
      cancelMutation(token);
      throw error;
    }
  }
  const originals = new WeakMap();
  const denied = () => new DOMException("This Dashboard is read-only. Your draft has not been saved.", "NoModificationAllowedError");
  function requireWrite(restoreId) {
    // During controlled restart recovery only the exact marker owner may write;
    // the ordinary UI remains read-only until the hold has been verified away.
    if (interruptedRecovery) {
      if (!localRestoreOwner || restoreId !== localRestoreOwner) throw denied();
      return;
    }
    // Ordinary same-page mutations must not interleave between restore files.
    // Only operations explicitly carrying this restore's session ID may write.
    if(!editable || localRestoreOwner && restoreId!==localRestoreOwner)throw denied();
  }
  function wrapWritable(writable, handle, before, path) {
    return Object.freeze({
      write(value) { requireWrite(); return writable.write(value); },
      truncate(value) { requireWrite(); return writable.truncate(value); },
      seek(value) { requireWrite(); return writable.seek(value); },
      close() { requireWrite(); if (testEnabled && !nativeRoot) return mutation(async () => { await writable.close(); await handle.getFile(); });
        return (async () => {
          const token = await beginMutation(), parts = path.split("/"), journalPath = [...parts.slice(0, -1), `.moondog-txn-${crypto.randomUUID()}.json`];
          const journal = { format: "moondog-write-v1", target: path, before: Array.from(before), after: null, revisionBefore: token.expected };
          let closed = false;
          try {
            await writeBytesRaw(token.root, journalPath, encoder.encode(JSON.stringify(journal)));
            if (!sameBytes(await readBytes(token.root, parts), before)) throw Error("File changed during write.");
            await writable.close(); closed = true;
            const after = await readBytes(token.root, parts);
            if (after === null) throw Error("Direct write did not verify.");
            journal.after = Array.from(after);
            await writeBytesRaw(token.root, journalPath, encoder.encode(JSON.stringify(journal)));
            await completeMutation(token);
            try { await removeRaw(token.root, journalPath); } catch (_) {}
          } catch (error) {
            if (!closed) try { await writable.abort(); } catch (_) {}
            let recovered = !closed;
            if (closed) try { await writeBytesRaw(token.root, parts, before); recovered = true; } catch (_) {}
            if (recovered) try { await removeRaw(token.root, journalPath); } catch (_) { setEditable(false); }
            if (!recovered) setEditable(false);
            cancelMutation(token);
            throw error;
          }
        })(); },
      abort() { return writable.abort(); }
    });
  }
  const protectedPath = path => path === MARKER.join("/") || path === REVISION.join("/");
  function wrapFile(handle, path = "") {
    const wrapped = {
      kind: "file", name: handle.name,
      getFile: (...args) => handle.getFile(...args),
      isSameEntry: other => handle.isSameEntry(originals.get(other) || other),
      async createWritable(...args) { requireWrite(); if (protectedPath(path)) throw denied(); const snapshot = await handle.getFile(); const before = new Uint8Array(await (snapshot.arrayBuffer?.() || encoder.encode(await snapshot.text()))); return wrapWritable(await handle.createWritable(...args), handle, before, path); },
      queryPermission: options => handle.queryPermission(options),
      requestPermission: options => handle.requestPermission(options)
    };
    originals.set(wrapped, handle);
    return wrapped;
  }
  function wrapDirectory(handle, prefix = "") {
    const wrapped = {
      kind: "directory", name: handle.name,
      async getFileHandle(name, options = {}) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (options.create && protectedPath(path)) throw denied();
        if (options.create && !editable) {
          // Existing files remain readable even when callers pass create:true.
          return wrapFile(await handle.getFileHandle(name, { create: false }), path);
        }
        if (options.create && editable && nativeRoot) {
          try { return wrapFile(await handle.getFileHandle(name, { create: false }), path); }
          catch (error) { if (error.name !== "NotFoundError") throw error; }
          return wrapFile(await journaledCreate(path, "file"), path);
        }
        return wrapFile(await handle.getFileHandle(name, options), path);
      },
      async getDirectoryHandle(name, options = {}) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (options.create && !editable) return wrapDirectory(await handle.getDirectoryHandle(name, { create: false }), path);
        if (options.create && editable && nativeRoot) {
          try { return wrapDirectory(await handle.getDirectoryHandle(name, { create: false }), path); }
          catch (error) { if (error.name !== "NotFoundError") throw error; }
          return wrapDirectory(await journaledCreate(path, "directory"), path);
        }
        return wrapDirectory(await handle.getDirectoryHandle(name, options), path);
      },
      removeEntry(name, options) { requireWrite(); const path = prefix ? `${prefix}/${name}` : name; if (protectedPath(path) || path === [...WORKSPACE, "data"].join("/") && options?.recursive) throw denied(); return journaledDelete(path, options); },
      resolve(other) { return handle.resolve(originals.get(other) || other); },
      isSameEntry(other) { return handle.isSameEntry(originals.get(other) || other); },
      queryPermission: options => handle.queryPermission(options),
      requestPermission: options => handle.requestPermission(options),
      async *entries() {
        for await (const [name, child] of handle.entries())
          yield [name, child.kind === "directory" ? wrapDirectory(child, prefix ? `${prefix}/${name}` : name) : wrapFile(child, prefix ? `${prefix}/${name}` : name)];
      },
      async *keys() { for await (const [name] of this.entries()) yield name; },
      async *values() { for await (const [, child] of this.entries()) yield child; },
      [Symbol.asyncIterator]() { return this.entries(); }
    };
    originals.set(wrapped, handle);
    return wrapped;
  }
  const authority = {
    get canWrite() { return editable; },
    get mode() { return editable ? "EDITABLE" : "FOLDER PERMISSION REQUIRED"; },
    get transientValidation() { return transientValidation; },
    requireWrite,
    wrapDirectory,
    // A test build must opt in before loading this module. Normal builds cannot enable writes.
    provision,
    canProvision,
    recoverOwner,
    validate,
    mutation,
    journaledDelete,
    beginMutation,
    completeMutation,
    cancelMutation,
    requireToken,
    get loadedRevision() { return loadedRevision; },
    enableForTest() {
      if (!testEnabled) throw denied();
      setEditable(true);
    },
    async beginRestore(restoreId) {
      requireWrite();
      if(typeof restoreId!=="string" || !/^[a-f0-9-]{36}$/i.test(restoreId) || localRestoreOwner)
        throw denied();
      // Wait for this tab's prior queued mutations, then refuse any hold
      // already owned by another tab. No distributed CAS is available.
      await tail.catch(()=>{});
      requireWrite();
      if(!await validate(nativeRoot) ||
         await readBytes(nativeRoot,["System Files","Workspace","data","restore-in-progress.json"])!==null)
        throw denied();
      localRestoreOwner=restoreId;
    },
    async beginInterruptedRecovery(root, restoreId) {
      if (typeof restoreId!=="string" || !/^[a-f0-9-]{36}$/i.test(restoreId) || localRestoreOwner || activeToken)
        throw denied();
      await tail.catch(()=>{});
      root = originals.get(root) || root;
      if (!root || await root.queryPermission({mode:"readwrite"}) !== "granted") throw denied();
      const pending = await readBytes(root, [...WORKSPACE, "data", "restore-in-progress.json"]);
      let marker;
      try { marker = pending && JSON.parse(new TextDecoder().decode(pending)); } catch (_) {}
      if (!marker || marker.restoreId !== restoreId) throw denied();
      const revision = await read(root, REVISION);
      if (!validRevision(revision)) throw denied();
      // Defer normal journal auto-recovery until the app has classified all
      // live files and explicitly resolved only backup-covered transactions.
      nativeRoot = root;
      loadedRevision = revision.revision;
      localRestoreOwner = restoreId;
      interruptedRecovery = true;
      setTransientValidation(false);
      setEditable(false);
      return true;
    },
    async finishInterruptedRecovery(restoreId) {
      if (!interruptedRecovery || !localRestoreOwner || restoreId !== localRestoreOwner || activeToken)
        throw denied();
      const root = nativeRoot;
      await assertInterruptedRecovery(root, restoreId, loadedRevision);
      const next = {schemaVersion:1, revision:loadedRevision + 1};
      await write(root, REVISION, next);
      loadedRevision = next.revision;
      await assertInterruptedRecovery(root, restoreId, loadedRevision);
      const markerPath = [...WORKSPACE, "data", "restore-in-progress.json"];
      await removeRaw(root, markerPath);
      if (!await absent(root, markerPath)) throw Error("Interrupted restore marker removal failed verification.");
      localRestoreOwner = null;
      interruptedRecovery = false;
      if (!await validate(root)) throw denied();
      return true;
    },
    abortInterruptedRecovery(restoreId) {
      if (interruptedRecovery && localRestoreOwner === restoreId) {
        localRestoreOwner = null;
        interruptedRecovery = false;
        setEditable(false);
        loadedRevision = null;
        nativeRoot = null;
      }
    },
    endRestore() { localRestoreOwner = null; },
    disable() { localRestoreOwner = null; interruptedRecovery = false; setTransientValidation(false); setEditable(false); loadedRevision = null; nativeRoot = null; }
  };
  global.MoonDogWriteAuthority = Object.freeze(authority);
})(globalThis);

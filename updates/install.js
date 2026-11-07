(function (global) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const BACKUP_PREFIX = "MoonDog-Update-Backup-";
  const COMPATIBILITY_BACKUP = "origin-compatibility/index.html";
  const LAUNCHER_PATH = "00 - OPEN DASHBOARD.html";
  // Exact reviewed launcher layouts: trusted clean-install output and legacy source wrapper.
  const LAUNCHER_BYTES = encoder.encode("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta http-equiv=\"refresh\" content=\"0; url=System%20Files/index.html\"><title>Service Operations Dashboard</title></head>\n<body><p>Opening Service Operations Dashboard\u2026 <a href=\"System%20Files/index.html\">Continue</a></p>\n<script>location.replace(\"System Files/index.html\");</script></body></html>\n");
  const LEGACY_LAUNCHER_BYTES = encoder.encode("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"refresh\" content=\"0; url=index.html\"><title>Service Operations Dashboard</title></head>\n<body><p>Opening Service Operations Dashboard\u2026 <a href=\"index.html\">Continue</a></p><script>location.replace(\"index.html\");</script></body></html>\n");
  const ORIGIN_BACKUPS = { "index.html": COMPATIBILITY_BACKUP,
    "00 - OPEN DASHBOARD.html": "origin-compatibility/launcher.html" };
  // Reviewed dependency authority: distribution/dependencies.json, schema 1.
  const DEPENDENCY_HASHES = {
    "vendor/jszip.min.js": "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e",
    "vendor/xlsx.full.min.js": "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41",
    "vendor/pdf.min.js": "e786c55638a36ca8192fe97a4aeeb5a78ac16de0cf31a2fb491b5cb84e9dcdd9",
    "vendor/pdf.worker.min.js": "df20aeb7d05ee7246889f25f1e2bc882c6264b042a8b4148cdc563dc3c553691"
};
  const IDENTITY_FILE = "MOONDOG_UPDATE_IDENTITY.json";
  const IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  // Software authority matches unchanged Stable 0.10.17. Repair bytes are
  // carried in inert comments of existing allowlisted package files, keeping
  // individual entries compatible with older installed update clients.
  const RECOVERY_SOFTWARE = Object.freeze({"vendor/jszip.min.js":{"sha256":"acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e","required":true},"vendor/xlsx.full.min.js":{"sha256":"cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41","required":true},"vendor/pdf.min.js":{"sha256":"e786c55638a36ca8192fe97a4aeeb5a78ac16de0cf31a2fb491b5cb84e9dcdd9","required":true},"vendor/pdf.worker.min.js":{"sha256":"df20aeb7d05ee7246889f25f1e2bc882c6264b042a8b4148cdc563dc3c553691","required":true},"vendor/JSZIP-LICENSE.txt":{"sha256":"566c953c6090b1218ca6217dd7359d45dde46581968586dc607d59a78af6a9c4","required":false},"vendor/PDFJS-LICENSE.txt":{"sha256":"0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594","required":false},"vendor/SHEETJS-LICENSE.txt":{"sha256":"4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64","required":false},"vendor/THIRD_PARTY_NOTICES.md":{"sha256":"a77733a48f158a02866b9de7bbe5b5454228270759ec9949883c8855fb7f2dcc","required":false}});
  const RECOVERY_CARRIERS = Object.freeze(["assets/arrivals.css","assets/assign-next.css","assets/clarity.css","assets/daily-ops.css","assets/developer-center.css","assets/meeting.css","assets/operational.css","assets/performance.css"]);

  // A browser-origin lock coordinates tabs where Web Locks is available. The
  // in-realm guard also covers browsers without that API. Neither is a lock
  // against another device or an external synchronizer.
  let operationActive = false;
  async function exclusive(operation) {
    if (operationActive) return { status: "busy", reason: "Another application update is active." };
    operationActive = true;
    try {
      if (global.navigator?.locks?.request) {
        return await global.navigator.locks.request("moondog-application-update-v1",
          { mode: "exclusive", ifAvailable: true }, lock => lock ? operation() :
            { status: "busy", reason: "Another browser tab is updating MoonDog." });
      }
      return await operation();
    } finally { operationActive = false; }
  }

  async function installationId(app, create = false) {
    const bytes = await read(app, IDENTITY_FILE);
    if (bytes !== null) {
      let value;
      try { value = JSON.parse(decoder.decode(bytes)); } catch (_) {}
      if (value?.schemaVersion !== 1 || !IDENTITY.test(value.installationId || ""))
        throw new Error("Application recovery identity is invalid; local recovery review is required.");
      return value.installationId;
    }
    if (!create) return null;
    const id = global.crypto.randomUUID();
    await write(app, IDENTITY_FILE, encoder.encode(JSON.stringify({ schemaVersion: 1, installationId: id })));
    return id;
  }

  function structure(contents, verifiedPackage, trustedAllowlist) {
    const required = contents.files.filter(entry => entry.action === "put");
    const directories = new Set();
    for (const path of [...required.map(entry => entry.path), ...trustedAllowlist.filter(path => /\.(?:js|css|html)$/.test(path))]) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
    }
    return { schemaVersion: 1, layout: "system-files-v1", version: verifiedPackage.version,
      packageSha256: verifiedPackage.sha256,
      requiredFiles: required.map(({path, sha256}) => ({path, sha256})),
      requiredDirectories: [...directories].sort(),
      requiredExistingFiles: trustedAllowlist.filter(path => /\.(?:js|css|html)$/.test(path) &&
        !contents.files.some(entry => entry.path === path)).map(path => ({ path, sha256: DEPENDENCY_HASHES[path] || null })),
      optionalFiles: trustedAllowlist.filter(path => !/\.(?:js|css|html)$/.test(path) &&
        !contents.files.some(entry => entry.path === path)),
      protectedBoundary: "System Files/Workspace",
      recoveryLocation: "System Files/Workspace/backups/system-updates",
      supportedLayouts: ["system-files-v1", "distribution-launcher-v1", "source-launcher-v1"],
      allowedTransformations: ["restore-package-files", "restore-reviewed-dependencies", "create-application-directories", "refresh-origin-page"] };
  }

  async function recoverySoftware(contents, subtle) {
    let serialized = "";
    for (let index = 0; index < RECOVERY_CARRIERS.length; index++) {
      const path = RECOVERY_CARRIERS[index];
      const entry = contents.files.find(item => item.path === path && item.action === "put");
      if (!entry) throw new Error("The verified package lacks reviewed software recovery data.");
      const bytes = Uint8Array.from(global.atob(entry.contentBase64), character => character.charCodeAt(0));
      if (await digest(bytes, subtle) !== entry.sha256.toLowerCase())
        throw new Error("Reviewed software recovery carrier failed verification.");
      const text = new TextDecoder("utf-8", {fatal:true}).decode(bytes);
      const begin = "/* BEGIN MOONDOG REVIEWED SOFTWARE DATA " + (index + 1) + "/8\n";
      const end = "\nEND MOONDOG REVIEWED SOFTWARE DATA */";
      const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
      if (start < 0 || finish < 0 || text.lastIndexOf(begin) !== start || text.lastIndexOf(end) !== finish)
        throw new Error("Reviewed software recovery carrier is missing or ambiguous.");
      serialized += text.slice(start + begin.length, finish);
      if (serialized.length > 4 * 1024 * 1024) throw new Error("Reviewed recovery data exceeds its safe bound.");
    }
    const data = JSON.parse(serialized);
    if (!data || Array.isArray(data) || Object.keys(data).sort().join("|") !== Object.keys(RECOVERY_SOFTWARE).sort().join("|"))
      throw new Error("Reviewed software recovery catalog is invalid.");
    return data;
  }

  async function dependencyRepairs(app, contents, trustedAllowlist, subtle) {
    const repairs = [];
    let data = null;
    for (const [path, authority] of Object.entries(RECOVERY_SOFTWARE)) {
      if (!trustedAllowlist.includes(path) || contents.files.some(entry => entry.path === path)) continue;
      const original = await read(app, path);
      const expected = DEPENDENCY_HASHES[path] || authority.sha256;
      // Existing optional notices, including annotations, are preserved.
      if (original !== null && (!authority.required || await digest(original, subtle) === expected)) continue;
      if (!data) data = await recoverySoftware(contents, subtle);
      const payload = data[path];
      if (global.MoonDogApplyDesignModel.isProtected(path) || authority.sha256 !== expected ||
          !payload || payload.sha256 !== expected || payload.required !== authority.required ||
          Object.keys(payload).sort().join(",") !== "contentBase64,required,sha256" || typeof payload.contentBase64 !== "string")
        throw new Error("Reviewed software recovery authority is invalid: " + path);
      const bytes = Uint8Array.from(global.atob(payload.contentBase64), character => character.charCodeAt(0));
      if (await digest(bytes, subtle) !== expected)
        throw new Error("Reviewed software recovery bytes failed verification: " + path);
      repairs.push({path,action:"put",sha256:expected,contentBase64:payload.contentBase64,restoresMissing:original === null});
    }
    return repairs;
  }

  async function applicationDiagnosis(app, trustedAllowlist, plan, repairs) {
    const known = new Set(trustedAllowlist.map(path => global.MoonDogApplyDesignModel.canonicalPath(path)));
    let unknownPreserved = 0, inspected = 0, missingDirectories = 0;
    // Only list application directories, never private Workspace/report trees.
    for (const name of ["assets", "vendor"]) {
      let directory;
      try { directory = await app.getDirectoryHandle(name, {create:false}); }
      catch (error) { if (error?.name === "NotFoundError") {missingDirectories++;continue;} throw error; }
      for await (const [entry, handle] of directory.entries()) {
        if (++inspected > 4096) throw new Error("Application inventory is too large for safe automatic repair.");
        let path;
        try { path = global.MoonDogApplyDesignModel.canonicalPath(name + "/" + entry); } catch (_) {}
        if (handle?.kind !== "file" || !known.has(path)) unknownPreserved++;
      }
    }
    return {schemaVersion:1,missingDirectories,unknownPreserved,
      missingSoftware:plan.add.length + repairs.filter(entry => entry.restoresMissing).length,
      replacedSoftware:plan.replace.length + repairs.filter(entry => !entry.restoresMissing).length};
  }

  async function verifyExistingStructure(app, definition, subtle, planned = new Set()) {
    for (const item of definition.requiredExistingFiles) {
      if (planned.has(item.path)) continue;
      const bytes = await read(app, item.path);
      if (bytes === null || !bytes.byteLength ||
          (item.sha256 && await digest(bytes, subtle) !== item.sha256))
        throw new Error("Required software outside this repair package is missing or damaged: " + item.path +
          ". Use a separately extracted verified installation; preserve the existing Workspace.");
    }
  }

  async function verifyStructure(app, definition, subtle) {
    await verifyExistingStructure(app, definition, subtle);
    for (const path of definition.requiredDirectories) {
      let directory = app;
      for (const part of path.split("/")) directory = await directory.getDirectoryHandle(part, { create: false });
    }
    for (const item of definition.requiredFiles) {
      const bytes = await read(app, item.path);
      if (bytes === null || await digest(bytes, subtle) !== item.sha256.toLowerCase())
        throw new Error("Required application file verification failed: " + item.path);
    }
  }

  function compatibilityBytes(applicationHtml) {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(applicationHtml);
    if (!/<!doctype html>\s*<html\s+lang="en"><head>/i.test(source) ||
        source.toLowerCase().split("<head>").length !== 2 || /<base\b/i.test(source)) {
      throw new Error("Application HTML cannot produce the origin compatibility page.");
    }
    return encoder.encode(source.replace("<head>", '<head><base href="System Files/">'));
  }

  function fileRoot(item, app, workspace) { return item.scope === "workspace" ? workspace : app; }
  function backupPath(item) { return item.scope === "workspace" ? ORIGIN_BACKUPS[item.path] : item.path; }

  async function digest(bytes, subtle) {
    const value = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function permission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") throw new Error("Folder access is unavailable.");
    let result = await handle.queryPermission({ mode: "readwrite" });
    if (result !== "granted" && typeof handle.requestPermission === "function") {
      result = await handle.requestPermission({ mode: "readwrite" });
    }
    if (result !== "granted") throw new Error("Folder write permission was not granted.");
  }
  async function assertAuthority(app) {
    // Application updates are authorized by explicit browser folder permission,
    // verified package hashes, the approved path plan, rollback backup, and
    // read-back verification. Operational editing policy must not block updates.
    try { await permission(app); }
    catch (_) { throw new Error("Folder write permission was lost; application files were not changed further."); }
  }

  async function assertTarget(app, workspace, identity = null) {
    await assertAuthority(workspace);
    const system = await workspace.getDirectoryHandle("System Files", { create: false });
    if (typeof system.isSameEntry !== "function" || !(await system.isSameEntry(app)))
      throw new Error("Application folder does not belong to the selected installation.");
    await system.getDirectoryHandle("Workspace", { create: false });
    if (await read(system, "MOONDOG_FRESH_RESET_PENDING.json") !== null)
      throw new Error("Interrupted Fresh recovery must be resolved before an application update.");
    if (identity !== null && await installationId(app) !== identity)
      throw new Error("Application recovery identity changed; further writes are blocked.");
  }

  async function backupRoot(app, create = false) {
    if (!app || typeof app.getDirectoryHandle !== "function") throw new Error("Application folder is unavailable.");
    const system = await app.getDirectoryHandle("System Files", { create: false });
    const workspace = await system.getDirectoryHandle("Workspace", { create: false });
    const backups = await workspace.getDirectoryHandle("backups", { create });
    return backups.getDirectoryHandle("system-updates", { create });
  }

  async function listBackups(app, strict = false) {
    let root;
    try { root = await backupRoot(app); }
    catch (error) {
      // An absent inventory directory is different from a failed inventory read.
      if (error?.name === "NotFoundError") return [];
      throw error;
    }
    // Enumerate names first, then read bounded batches. OneDrive reads can
    // be slow, but unbounded concurrent journal reads can starve the UI.
    const candidates = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory" && name.startsWith(BACKUP_PREFIX)) {
        if (!/^[A-Za-z0-9-]+$/.test(name)) {
          if (strict) throw new Error("An unrecognized update backup name requires local recovery review.");
          continue;
        }
        candidates.push([name, handle]);
        if (candidates.length > 4096) throw new Error("Update recovery inventory is too large for safe automatic inspection.");
      }
    }
    const names = [];
    for (let index = 0; index < candidates.length; index += 6) {
      const batch = await Promise.all(candidates.slice(index, index + 6).map(async ([name, handle]) => {
        let bytes;
        try { bytes = await read(handle, "journal.json"); }
        catch (error) {
          // A OneDrive lock, permission loss, or read failure must not silently
          // suppress a potentially recoverable, interrupted update.
          throw error;
        }
        if (bytes === null) {
          if (strict) throw new Error("An update backup has no journal; preserve it for local recovery review.");
          return null; // Legacy listing omits nonrecoverable entries; install is strict.
        }
        let record;
        try { record = JSON.parse(decoder.decode(bytes)); }
        catch (error) {
          // A damaged journal in a recognized update backup must not be
          // treated as proof that no transaction needs recovery.
          if (error instanceof SyntaxError) throw new Error("Existing update recovery journal is unreadable.");
          throw error;
        }
        if (!record || !["prepared", "applying", "verified", "restored"].includes(record.status) ||
            !Array.isArray(record.inventory)) {
          throw new Error("Existing update recovery journal is invalid.");
        }
        return ["applying", "prepared"].includes(record.status) ? name : null;
      }));
      for (const name of batch) if (name) names.push(name);
    }
    return names.sort().reverse();
  }

  async function parent(root, relative, create = false) {
    const parts = relative.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
    return { folder, name: parts.at(-1) };
  }

  async function read(root, relative) {
    try {
      const { folder, name } = await parent(root, relative);
      return new Uint8Array(await (await (await folder.getFileHandle(name, { create: false })).getFile()).arrayBuffer());
    } catch (error) {
      if (error && error.name === "NotFoundError") return null;
      throw error;
    }
  }

  async function write(root, relative, bytes, createDirectories = false) {
    const { folder, name } = await parent(root, relative, createDirectories);
    const handle = await folder.getFileHandle(name, { create: true });
    let writable;
    // Retry only opening a stream, before bytes have been written. A failed
    // write or close has uncertain persistence and must go through rollback.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { writable = await handle.createWritable(); break; }
      catch (error) {
        if (!["NotReadableError", "AbortError"].includes(error?.name) || attempt === 2) throw error;
        if (typeof global.setTimeout === "function")
          await new Promise(resolve => global.setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    try { await writable.write(bytes); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
    const actual = await read(root, relative);
    if (!actual || await digest(actual, global.crypto.subtle) !== await digest(bytes, global.crypto.subtle)) {
      throw new Error("File read-back verification failed: " + relative);
    }
  }

  async function remove(root, relative) {
    let folder, name;
    try { ({ folder, name } = await parent(root, relative)); }
    catch (error) { if (error && error.name === "NotFoundError") return; throw error; }
    try { await folder.removeEntry(name); }
    catch (error) { if (!error || error.name !== "NotFoundError") throw error; }
    if (await read(root, relative) !== null) throw new Error("File removal verification failed: " + relative);
  }

  async function journal(folder, value) {
    await write(folder, "journal.json", encoder.encode(JSON.stringify(value)));
  }

  async function progress(callback, value) {
    if (typeof callback !== "function") return;
    try { await callback(value); } catch (_) { /* Progress reporting must never interrupt installation. */ }
  }

  async function restore(app, workspace, backup, inventory, subtle, onProgress, startPercent = 0, endPercent = 100, identity = null) {
    const span = Math.max(0, endPercent - startPercent), total = Math.max(inventory.length, 1);
    // Validate every existing backup before restoring even the first file.
    // A corrupt later member must never produce a partially restored application.
    for (const item of inventory) {
      await assertTarget(app, workspace, identity);
      if (!item.existed) continue;
      const savedBytes = await read(backup, backupPath(item));
      if (!savedBytes || await digest(savedBytes, subtle) !== item.sha256) {
        throw new Error("Backup verification failed: " + item.path);
      }
    }
    for (let index = 0; index < inventory.length; index += 1) {
      await assertTarget(app, workspace, identity);
      const item = inventory[index];
      await progress(onProgress, { phase: "rollback", percent: Math.round(startPercent + span * (index / total) * .7),
        label: "Restoring previous version", detail: "Restoring " + (index + 1) + " of " + inventory.length + " files" });
      await assertTarget(app, workspace, identity);
      if (!item.existed) await remove(fileRoot(item, app, workspace), item.path);
      else {
        const bytes = await read(backup, backupPath(item));
        if (!bytes || await digest(bytes, subtle) !== item.sha256) throw new Error("Backup verification failed: " + item.path);
        await write(fileRoot(item, app, workspace), item.path, bytes, item.scope !== "workspace");
      }
    }
    for (let index = 0; index < inventory.length; index += 1) {
      const item = inventory[index];
      await progress(onProgress, { phase: "rollback", percent: Math.round(startPercent + span * (.7 + .3 * ((index + 1) / total))),
        label: "Verifying restored files", detail: "Checking " + (index + 1) + " of " + inventory.length + " files" });
      const bytes = await read(fileRoot(item, app, workspace), item.path);
      if (item.existed ? !bytes || await digest(bytes, subtle) !== item.sha256 : bytes !== null) {
        throw new Error("Rollback verification failed: " + item.path);
      }
    }
  }

  async function applyUnlocked({ verifiedPackage, appDirectoryHandle: app, workspaceDirectoryHandle,
    trustedAllowlist, expectedPlan, confirmed = false, onProgress = null,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    if (!subtle || !global.MoonDogPackagePlan || !global.MoonDogApplyDesignModel) return { status: "unavailable" };
    const workspace = workspaceDirectoryHandle || app;
    let backup = null;
    let inventory = null;
    let identity = null;
    try {
      await progress(onProgress, { phase: "verify-package", percent: 3, label: "Verifying update package", detail: "Checking package integrity" });
      if (!verifiedPackage || verifiedPackage.status !== "verified" || verifiedPackage.migrationRequired ||
          !ArrayBuffer.isView(verifiedPackage.bytes) || verifiedPackage.bytes.byteLength > 64 * 1024 * 1024 ||
          !/^[0-9a-f]{64}$/.test(verifiedPackage.sha256) ||
          await digest(verifiedPackage.bytes, subtle) !== verifiedPackage.sha256) {
        return { status: "rejected", reason: "Package verification is missing or invalid." };
      }
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      await progress(onProgress, { phase: "permission", percent: 8, label: "Preparing installation", detail: "Confirming folder access" });
      await permission(workspace);
      await assertTarget(app, workspace, identity);
      // Never layer a new update over an unresolved prior transaction.
      // Inventory update journals only; do not enumerate store reports.
      let pending;
      try { pending = await listBackups(workspace, true); }
      catch (error) { return {status:"recovery-required",reason:error.message}; }
      if (pending.length) {
        // Authorizing this exact Beta package also authorizes safe software-only
        // reconciliation of one fully verified, installation-bound transaction.
        // Legacy, ambiguous, corrupt or wrong-store recovery remains blocked.
        const stop = reason => ({ status: "recovery-required", reason, backupName: pending[0] });
        if (verifiedPackage.channel !== "beta" || pending.length !== 1)
          return stop("An earlier application update needs local recovery review before another update.");
        const initialPlan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage,
          appDirectoryHandle: app, trustedAllowlist, subtle });
        if (initialPlan.rejected.length || !expectedPlan || JSON.stringify(initialPlan) !== JSON.stringify(expectedPlan))
          return { status: "rejected", reason: "The approved file preview changed or was rejected." };
        const options = { appDirectoryHandle: app, workspaceDirectoryHandle: workspace,
          backupName: pending[0], trustedAllowlist, subtle };
        const inspection = await recoverUnlocked({ ...options, inspectOnly: true });
        if (inspection.status !== "recoverable") return stop("An earlier application update needs recovery. " + (inspection.reason || "Recovery could not be verified."));
        const recovered = await recoverUnlocked({ ...options, confirmed: true,
          onProgress: event => progress(onProgress, { phase: "repair-recovery", percent: 8 + Math.round((event.percent || 0) * .03),
            label: "Repairing", detail: "Recovering the verified interrupted application update" }) });
        if (recovered.status !== "restored") return stop(recovered.reason || "Interrupted software recovery did not complete.");
        if ((await listBackups(workspace, true)).length)
          return stop("Another interrupted application update appeared; local review is required.");
        // The package and selected installation are unchanged. Rebuild its
        // software plan after verified recovery; do not reuse a stale preview.
        if (await digest(verifiedPackage.bytes, subtle) !== verifiedPackage.sha256)
          return { status: "rejected", reason: "The authorized package changed during recovery." };
        expectedPlan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage,
          appDirectoryHandle: app, trustedAllowlist, subtle });
      }
      const missingEntry = trustedAllowlist.includes("index.html") && await read(app, "index.html") === null;
      if (missingEntry) {
        // An unstartable clean installation can identify itself using its
        // software-only manifest. Never infer identity from dealership files.
        let manifest;
        try { manifest = JSON.parse(decoder.decode(await read(workspace, "INSTALLATION-MANIFEST.json"))); }
        catch (_) {}
        if (manifest?.format !== "service-operations-dashboard-clean-install" || manifest.formatVersion !== 1 ||
            manifest.applicationRoot !== "System Files" || manifest.workspaceRoot !== "System Files/Workspace" ||
            manifest.launcher !== LAUNCHER_PATH || manifest.workspaceProtectedFromUpdates !== true ||
            !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(manifest.version || "") ||
            !Array.isArray(manifest.files) || !manifest.files.some(item => item?.path === "System Files/index.html" &&
              /^[0-9a-f]{64}$/.test(item.sha256 || "")))
          throw new Error("The connected application folder has no index.html or recognized clean-install identity.");
      }
      // Never invent a missing private Workspace or cross an interrupted Fresh
      // boundary. Both checks are read-only and precede all new update writes.
      const selectedSystem = await workspace.getDirectoryHandle("System Files", { create: false });
      if (typeof selectedSystem.isSameEntry !== "function" || !(await selectedSystem.isSameEntry(app)))
        throw new Error("Application folder does not belong to the selected installation.");
      await selectedSystem.getDirectoryHandle("Workspace", { create: false });
      if (await read(selectedSystem, "MOONDOG_FRESH_RESET_PENDING.json") !== null)
        throw new Error("Interrupted Fresh recovery must be resolved before an application update.");
      // A missing approved script is repairable from a verified package.
      // Keep the index.html/root-identity check above: an unrecognized
      // installation must never be constructed from arbitrary folder access.
      await progress(onProgress, { phase: "plan", percent: 12, label: "Preparing file changes", detail: "Rechecking the approved update plan" });
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage,
        appDirectoryHandle: app, trustedAllowlist, subtle });
      if (plan.rejected.length || !expectedPlan || JSON.stringify(plan) !== JSON.stringify(expectedPlan)) {
        return { status: "rejected", reason: "The approved file preview changed or was rejected." };
      }
      const contents = JSON.parse(decoder.decode(verifiedPackage.bytes));
      // A missing required app script is repairable only when this exact
      // verified package carries its approved replacement. Never report an
      // incomplete installation as successfully updated.
      if (trustedAllowlist.includes("assets/app.js") && await read(app, "assets/app.js") === null &&
          !contents.files.some(entry => entry.path === "assets/app.js" && entry.action === "put")) {
        throw new Error("Required application script is missing from the verified repair package.");
      }
      if (missingEntry && !contents.files.some(entry => entry.path === "index.html" && entry.action === "put"))
        throw new Error("Required application entry is missing from the verified repair package.");
      const definition = structure(contents, verifiedPackage, trustedAllowlist);
      const repairs = await dependencyRepairs(app, contents, trustedAllowlist, subtle);
      await verifyExistingStructure(app, definition, subtle, new Set(repairs.map(entry => entry.path)));
      const diagnosis = await applicationDiagnosis(app, trustedAllowlist, plan, repairs);
      await progress(onProgress, { phase: "health-check", percent: 14, label: "Checking",
        detail: "Checking trusted application structure; private Workspace files are preserved" });
      const htmlEntry = contents.files.find(entry => entry.path === "index.html");
      if (htmlEntry?.action === "delete") throw new Error("The application entry cannot be deleted.");
      let compatibility = null;
      if (workspace !== app && htmlEntry) {
        const existing = await read(workspace, "index.html");
        if (existing !== null && !decoder.decode(existing).includes('<base href="System Files/">'))
          throw new Error("The origin compatibility page is missing or unrecognized.");
        compatibility = compatibilityBytes(Uint8Array.from(global.atob(htmlEntry.contentBase64), c => c.charCodeAt(0)));
      }
      // The named root launcher is software authority from reviewed source,
      // not inferred from dealership data. Unknown/custom contents are retained
      // and block automatic repair rather than being overwritten.
      const launcher = await read(workspace, LAUNCHER_PATH);
      const canonicalLauncherHash = await digest(LAUNCHER_BYTES, subtle);
      const legacyLauncherHash = await digest(LEGACY_LAUNCHER_BYTES, subtle);
      const launcherHash = launcher === null ? canonicalLauncherHash : await digest(launcher, subtle);
      if (launcher !== null && ![canonicalLauncherHash, legacyLauncherHash].includes(launcherHash))
        throw new Error("The named application launcher is unrecognized; preserve it for local review.");
      const installedFiles = [...contents.files, ...repairs];
      const targets = [...contents.files.filter(entry => !plan.unchanged.includes(entry.path)), ...repairs];
      inventory = [];
      for (let index = 0; index < trustedAllowlist.length; index += 1) {
        const item = trustedAllowlist[index];
        await progress(onProgress, { phase: "inventory", percent: Math.round(16 + 9 * ((index + 1) / Math.max(trustedAllowlist.length, 1))),
          label: "Preparing rollback safety", detail: "Reading " + (index + 1) + " of " + trustedAllowlist.length + " application files" });
        const original = await read(app, item);
        inventory.push({ path: item, existed: original !== null,
          sha256: original === null ? null : await digest(original, subtle), bytes: original });
      }
      if (compatibility) {
        const original = await read(workspace, "index.html");
        inventory.push({ path: "index.html", scope: "workspace", existed: original !== null,
          sha256: original === null ? null : await digest(original, subtle), bytes: original });
      }
      inventory.push({ path: LAUNCHER_PATH, scope: "workspace", existed: launcher !== null,
        sha256: launcher === null ? null : launcherHash, bytes: launcher });
      identity = await installationId(app, true);
      const backupName = BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + "-" + global.crypto.randomUUID();
      await assertTarget(app, workspace, identity);
      const root = await backupRoot(workspace, true);
      try {
        await root.getDirectoryHandle(backupName, { create: false });
        throw new Error("Update backup already exists; no application files changed.");
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }
      await assertTarget(app, workspace, identity);
      backup = await root.getDirectoryHandle(backupName, { create: true });
      const record = inventory.map(({ path, scope, existed, sha256 }) => ({ path, ...(scope ? { scope } : {}), existed, sha256 }));
      for (let index = 0; index < inventory.length; index += 1) {
        await assertTarget(app, workspace, identity);
        const item = inventory[index];
        await progress(onProgress, { phase: "backup", percent: Math.round(25 + 20 * ((index + 1) / Math.max(inventory.length, 1))),
          label: "Backing up current files", detail: "Backing up " + (index + 1) + " of " + inventory.length + " files" });
        await assertTarget(app, workspace, identity);
        if (item.existed) await write(backup, backupPath(item), item.bytes, true);
      }
      await assertTarget(app, workspace, identity);
      await journal(backup, { status: "prepared", installationId: identity, inventory: record });
      for (let index = 0; index < inventory.length; index += 1) {
        const item = inventory[index];
        await progress(onProgress, { phase: "backup-verify", percent: Math.round(45 + 10 * ((index + 1) / Math.max(inventory.length, 1))),
          label: "Verifying rollback backup", detail: "Checking " + (index + 1) + " of " + inventory.length + " files" });
        const current = await read(fileRoot(item, app, workspace), item.path);
        if (item.existed ? !current || await digest(current, subtle) !== item.sha256 : current !== null) {
          throw new Error("Application files changed during backup; nothing was installed.");
        }
      }
      await assertTarget(app, workspace, identity);
      await journal(backup, { status: "applying", installationId: identity, inventory: record });
      try {
        for (let index = 0; index < targets.length; index += 1) {
          await assertTarget(app, workspace, identity);
          const entry = targets[index];
          await progress(onProgress, { phase: "apply", percent: Math.round(55 + 25 * ((index + 1) / Math.max(targets.length, 1))),
            label: "Repairing", detail: "Updating " + (index + 1) + " of " + targets.length + " changed files" });
          await assertTarget(app, workspace, identity);
          if (entry.action === "put") await write(app, entry.path, Uint8Array.from(global.atob(entry.contentBase64), c => c.charCodeAt(0)), true);
          else await remove(app, entry.path);
        }
        if (compatibility) {
          await assertTarget(app, workspace, identity);
          await write(workspace, "index.html", compatibility);
        }
        if (launcher === null) {
          await assertTarget(app, workspace, identity);
          await write(workspace, LAUNCHER_PATH, LAUNCHER_BYTES);
        }
        for (let index = 0; index < installedFiles.length; index += 1) {
          const entry = installedFiles[index];
          await progress(onProgress, { phase: "verify-install", percent: Math.round(80 + 18 * ((index + 1) / Math.max(installedFiles.length, 1))),
            label: "Verifying", detail: "Checking " + (index + 1) + " of " + installedFiles.length + " verified software files" });
          const current = await read(app, entry.path);
          if (entry.action === "put" ? !current || await digest(current, subtle) !== entry.sha256.toLowerCase() : current !== null) {
            throw new Error("Installed file verification failed: " + entry.path);
          }
        }
        if (compatibility && await digest(await read(workspace, "index.html"), subtle) !== await digest(compatibility, subtle))
          throw new Error("Origin compatibility verification failed.");
        if (await digest(await read(workspace, LAUNCHER_PATH), subtle) !== launcherHash)
          throw new Error("Application launcher verification failed.");
        await verifyStructure(app, definition, subtle);
        if (await installationId(app) !== identity) throw new Error("Application recovery identity changed.");
        await assertTarget(app, workspace, identity);
        await journal(backup, { status: "verified", installationId: identity, inventory: record,
          structure: { schemaVersion: definition.schemaVersion, layout: definition.layout,
            packageSha256: definition.packageSha256,
            requiredFileCount: definition.requiredFiles.length + definition.requiredExistingFiles.length,
            dependencyRepairs: repairs.length, diagnosis,
            launcherSha256: launcherHash },
          verifiedUpdate: { version: verifiedPackage.version, channel: verifiedPackage.channel,
            sha256: verifiedPackage.sha256.toLowerCase(), verifiedAt: new Date().toISOString() } });
        await progress(onProgress, { phase: "complete", percent: 100, label: "Ready", detail: "Application structure and installed package bytes verified" });
        return { status: "installed", version: verifiedPackage.version, backupName };
      } catch (error) {
        try {
          await progress(onProgress, { phase: "rollback", percent: 80, label: "Update failed — restoring previous version", detail: "Rollback is in progress" });
          await restore(app, workspace, backup, record, subtle, onProgress, 80, 98, identity);
          await assertTarget(app, workspace, identity);
          await journal(backup, { status: "restored", installationId: identity, inventory: record });
          await progress(onProgress, { phase: "rolled-back", percent: 100, label: "Previous version restored", detail: "Rollback completed and verified" });
          return { status: "rolled-back", reason: error.message, backupName };
        } catch (restoreError) {
          return { status: "recovery-required", reason: restoreError.message, backupName };
        }
      }
    } catch (error) {
      return { status: "stopped", reason: error.message, backupName: backup && backup.name };
    }
  }

  async function recoverUnlocked({ appDirectoryHandle: app, workspaceDirectoryHandle, backupName,
    trustedAllowlist, confirmed = false, inspectOnly = false, onProgress = null,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed && !inspectOnly) return { status: "confirmation-required" };
    const workspace = workspaceDirectoryHandle || app;
    let identity = null;
    try {
      await progress(onProgress, { phase: "recovery", percent: 5, label: "Preparing recovery", detail: "Checking the rollback backup" });
      if (!subtle || !global.MoonDogApplyDesignModel) throw new Error("Recovery verification is unavailable.");
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      if (typeof backupName !== "string" || !backupName.startsWith(BACKUP_PREFIX) ||
          !/^[A-Za-z0-9-]+$/.test(backupName)) throw new Error("Invalid update backup name.");
      if (inspectOnly && await workspace.queryPermission({mode:"readwrite"}) !== "granted")
        throw new Error("Local read/write permission is required before recovery can be verified.");
      await permission(workspace);
      await assertTarget(app, workspace, identity);
      const root = await backupRoot(workspace);
      const backup = await root.getDirectoryHandle(backupName, { create: false });
      const bytes = await read(backup, "journal.json");
      if (!bytes) throw new Error("Backup journal is missing.");
      const record = JSON.parse(decoder.decode(bytes));
      if (!record || !["applying", "prepared", "restored"].includes(record.status) ||
          !Array.isArray(record.inventory) ||
          ![trustedAllowlist.length, trustedAllowlist.length + 1, trustedAllowlist.length + 2].includes(record.inventory.length)) {
        throw new Error("Backup journal cannot be used for recovery.");
      }
      if (!IDENTITY.test(record.installationId || "") ||
          await installationId(app) !== record.installationId)
        throw new Error("Backup belongs to another or unverified installation; local recovery review is required.");
      identity = record.installationId;
      const expected = new Set(trustedAllowlist.map(path => global.MoonDogApplyDesignModel.canonicalPath(path)));
      const originSeen = new Set();
      for (const item of record.inventory) {
        if (item?.scope === "workspace" && Object.hasOwn(ORIGIN_BACKUPS, item.path) && !originSeen.has(item.path) &&
            workspace !== app && typeof item.existed === "boolean" &&
            (item.existed ? /^[0-9a-f]{64}$/.test(item.sha256) : item.sha256 === null)) {
          originSeen.add(item.path);
          continue;
        }
        if (!item || typeof item.path !== "string" || !expected.delete(global.MoonDogApplyDesignModel.canonicalPath(item.path)) ||
            item.scope !== undefined ||
            global.MoonDogApplyDesignModel.isProtected(item.path) || typeof item.existed !== "boolean" ||
            (item.existed ? !/^[0-9a-f]{64}$/.test(item.sha256) : item.sha256 !== null)) {
          throw new Error("Backup journal contains an unapproved file.");
        }
      }
      if (expected.size || record.inventory.length !== trustedAllowlist.length + originSeen.size)
        throw new Error("Backup journal is incomplete.");
      // Inspect every original byte before declaring automatic recovery safe.
      // This path never writes, requests permission, creates files or journals.
      if (inspectOnly) {
        if (!["prepared", "applying"].includes(record.status))
          throw new Error("This journal is not an unfinished application update.");
        for (const item of record.inventory) {
          await assertTarget(app, workspace, identity);
          if (!item.existed) continue;
          const original = await read(backup, backupPath(item));
          if (original === null || await digest(original, subtle) !== item.sha256)
            throw new Error("Backup verification failed: " + item.path);
        }
        return { status: "recoverable", backupName };
      }
      await progress(onProgress, { phase: "recovery", percent: 15, label: "Restoring previous version", detail: "Backup verified" });
      await restore(app, workspace, backup, record.inventory, subtle, onProgress, 15, 95, identity);
      await assertTarget(app, workspace, identity);
      await journal(backup, { status: "restored", installationId: record.installationId, inventory: record.inventory });
      await progress(onProgress, { phase: "complete", percent: 100, label: "Recovery complete", detail: "Original application files were verified restored" });
      return { status: "restored" };
    } catch (error) {
      return { status: "recovery-required", reason: error.message };
    }
  }

  const apply = options => exclusive(() => applyUnlocked(options));
  const recover = options => exclusive(() => recoverUnlocked(options));
  const inspectRecovery = options => recoverUnlocked({ ...options, confirmed: false, inspectOnly: true, onProgress: null });
  global.MoonDogUpdateInstall = { apply, recover, listBackups, inspectRecovery };
})(globalThis);

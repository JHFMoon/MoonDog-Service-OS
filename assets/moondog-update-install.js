(function (global) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const BACKUP_PREFIX = "MoonDog-Update-Backup-";
  const COMPATIBILITY_BACKUP = "origin-compatibility/index.html";
  // Reviewed dependency authority: distribution/dependencies.json, schema 1.
  const DEPENDENCY_HASHES = {
    "vendor/jszip.min.js": "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e",
    "vendor/xlsx.full.min.js": "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41",
    "vendor/pdf.min.js": "e786c55638a36ca8192fe97a4aeeb5a78ac16de0cf31a2fb491b5cb84e9dcdd9",
    "vendor/pdf.worker.min.js": "df20aeb7d05ee7246889f25f1e2bc882c6264b042a8b4148cdc563dc3c553691"
};
  const IDENTITY_FILE = "MOONDOG_UPDATE_IDENTITY.json";
  const IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    for (const entry of required) {
      const parts = entry.path.split("/");
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
      supportedLayouts: ["system-files-v1"],
      allowedTransformations: ["restore-package-files", "create-application-directories", "refresh-origin-page"] };
  }

  async function verifyExistingStructure(app, definition, subtle) {
    for (const item of definition.requiredExistingFiles) {
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
  function backupPath(item) { return item.scope === "workspace" ? COMPATIBILITY_BACKUP : item.path; }

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

  async function listBackups(app) {
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
      if (handle.kind === "directory" && name.startsWith(BACKUP_PREFIX) &&
          /^[A-Za-z0-9-]+$/.test(name)) candidates.push([name, handle]);
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
        if (bytes === null) return null; // Missing journal is not recoverable.
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
    const writable = await handle.createWritable();
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
      const pending = await listBackups(workspace);
      if (pending.length) return {
        status: "recovery-required",
        reason: "An earlier application update needs recovery before another update.",
        backupName: pending[0]
      };
      if (trustedAllowlist.includes("index.html") && await read(app, "index.html") === null) {
        throw new Error("The connected application folder has no index.html.");
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
      const definition = structure(contents, verifiedPackage, trustedAllowlist);
      await verifyExistingStructure(app, definition, subtle);
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
      const targets = contents.files.filter(entry => !plan.unchanged.includes(entry.path));
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
        for (let index = 0; index < contents.files.length; index += 1) {
          const entry = contents.files[index];
          await progress(onProgress, { phase: "verify-install", percent: Math.round(80 + 18 * ((index + 1) / Math.max(contents.files.length, 1))),
            label: "Verifying", detail: "Checking " + (index + 1) + " of " + contents.files.length + " package files" });
          const current = await read(app, entry.path);
          if (entry.action === "put" ? !current || await digest(current, subtle) !== entry.sha256.toLowerCase() : current !== null) {
            throw new Error("Installed file verification failed: " + entry.path);
          }
        }
        if (compatibility && await digest(await read(workspace, "index.html"), subtle) !== await digest(compatibility, subtle))
          throw new Error("Origin compatibility verification failed.");
        await verifyStructure(app, definition, subtle);
        if (await installationId(app) !== identity) throw new Error("Application recovery identity changed.");
        await assertTarget(app, workspace, identity);
        await journal(backup, { status: "verified", installationId: identity, inventory: record,
          structure: { schemaVersion: definition.schemaVersion, layout: definition.layout,
            packageSha256: definition.packageSha256, requiredFileCount: definition.requiredFiles.length },
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
    trustedAllowlist, confirmed = false, onProgress = null,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    const workspace = workspaceDirectoryHandle || app;
    let identity = null;
    try {
      await progress(onProgress, { phase: "recovery", percent: 5, label: "Preparing recovery", detail: "Checking the rollback backup" });
      if (!subtle || !global.MoonDogApplyDesignModel) throw new Error("Recovery verification is unavailable.");
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      if (typeof backupName !== "string" || !backupName.startsWith(BACKUP_PREFIX) ||
          !/^[A-Za-z0-9-]+$/.test(backupName)) throw new Error("Invalid update backup name.");
      await permission(workspace);
      await assertTarget(app, workspace, identity);
      const root = await backupRoot(workspace);
      const backup = await root.getDirectoryHandle(backupName, { create: false });
      const bytes = await read(backup, "journal.json");
      if (!bytes) throw new Error("Backup journal is missing.");
      const record = JSON.parse(decoder.decode(bytes));
      if (!record || !["applying", "prepared", "restored"].includes(record.status) ||
          !Array.isArray(record.inventory) ||
          ![trustedAllowlist.length, trustedAllowlist.length + 1].includes(record.inventory.length)) {
        throw new Error("Backup journal cannot be used for recovery.");
      }
      if (!IDENTITY.test(record.installationId || "") ||
          await installationId(app) !== record.installationId)
        throw new Error("Backup belongs to another or unverified installation; local recovery review is required.");
      identity = record.installationId;
      const expected = new Set(trustedAllowlist.map(path => global.MoonDogApplyDesignModel.canonicalPath(path)));
      let compatibilitySeen = false;
      for (const item of record.inventory) {
        if (item?.scope === "workspace" && item.path === "index.html" && !compatibilitySeen &&
            workspace !== app && typeof item.existed === "boolean" &&
            (item.existed ? /^[0-9a-f]{64}$/.test(item.sha256) : item.sha256 === null)) {
          compatibilitySeen = true;
          continue;
        }
        if (!item || typeof item.path !== "string" || !expected.delete(global.MoonDogApplyDesignModel.canonicalPath(item.path)) ||
            item.scope !== undefined ||
            global.MoonDogApplyDesignModel.isProtected(item.path) || typeof item.existed !== "boolean" ||
            (item.existed ? !/^[0-9a-f]{64}$/.test(item.sha256) : item.sha256 !== null)) {
          throw new Error("Backup journal contains an unapproved file.");
        }
      }
      if (expected.size || record.inventory.length !== trustedAllowlist.length + Number(compatibilitySeen))
        throw new Error("Backup journal is incomplete.");
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
  global.MoonDogUpdateInstall = { apply, recover, listBackups };
})(globalThis);

(function (global) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const BACKUP_PREFIX = "MoonDog-Update-Backup-";
  const COMPATIBILITY_BACKUP = "origin-compatibility/index.html";

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
    const gate = global.MoonDogWriteAuthority;
    if (gate && (!gate.canWrite || typeof gate.validate === "function" && !await gate.validate(app)))
      throw new Error("Editing authority was lost; application files were not changed further.");
  }

  async function backupRoot(app, create = false) {
    if (!app || typeof app.getDirectoryHandle !== "function") throw new Error("Application folder is unavailable.");
    const system = await app.getDirectoryHandle("System Files", { create: false });
    const workspace = await system.getDirectoryHandle("Workspace", { create: false });
    const backups = await workspace.getDirectoryHandle("backups", { create });
    return backups.getDirectoryHandle("system-updates", { create });
  }

  async function listBackups(app) {
    try {
      const root = await backupRoot(app);
      const names = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind !== "directory" || !name.startsWith(BACKUP_PREFIX) ||
            !/^[A-Za-z0-9-]+$/.test(name)) continue;
        try {
          const record = JSON.parse(decoder.decode(await read(handle, "journal.json")));
          if (["applying", "prepared"].includes(record?.status)) names.push(name);
        } catch (_) { /* A malformed record is not offered for recovery. */ }
      }
      return names.sort().reverse();
    } catch (error) {
      if (error?.name === "NotFoundError") return [];
      throw error;
    }
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

  async function restore(app, workspace, backup, inventory, subtle, onProgress, startPercent = 0, endPercent = 100) {
    const span = Math.max(0, endPercent - startPercent), total = Math.max(inventory.length, 1);
    for (let index = 0; index < inventory.length; index += 1) {
      await assertAuthority(workspace);
      const item = inventory[index];
      await progress(onProgress, { phase: "rollback", percent: Math.round(startPercent + span * (index / total) * .7),
        label: "Restoring previous version", detail: "Restoring " + (index + 1) + " of " + inventory.length + " files" });
      await assertAuthority(workspace);
      if (!item.existed) await remove(fileRoot(item, app, workspace), item.path);
      else {
        const bytes = await read(backup, backupPath(item));
        if (!bytes || await digest(bytes, subtle) !== item.sha256) throw new Error("Backup verification failed: " + item.path);
        await write(fileRoot(item, app, workspace), item.path, bytes);
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

  async function apply({ verifiedPackage, appDirectoryHandle: app, workspaceDirectoryHandle,
    trustedAllowlist, expectedPlan, confirmed = false, onProgress = null,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    if (global.MoonDogWriteAuthority && !global.MoonDogWriteAuthority.canWrite)
      return { status: "read-only", reason: "Editing authority is required before installing an update." };
    if (!subtle || !global.MoonDogPackagePlan || !global.MoonDogApplyDesignModel) return { status: "unavailable" };
    const workspace = workspaceDirectoryHandle || app;
    let backup = null;
    let inventory = null;
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
      await assertAuthority(workspace);
      if (trustedAllowlist.includes("index.html") && await read(app, "index.html") === null) {
        throw new Error("The connected application folder has no index.html.");
      }
      if (trustedAllowlist.includes("assets/app.js") && await read(app, "assets/app.js") === null) {
        throw new Error("The connected application folder has no application script.");
      }
      await progress(onProgress, { phase: "plan", percent: 12, label: "Preparing file changes", detail: "Rechecking the approved update plan" });
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage,
        appDirectoryHandle: app, trustedAllowlist, subtle });
      if (plan.rejected.length || !expectedPlan || JSON.stringify(plan) !== JSON.stringify(expectedPlan)) {
        return { status: "rejected", reason: "The approved file preview changed or was rejected." };
      }
      const contents = JSON.parse(decoder.decode(verifiedPackage.bytes));
      const htmlEntry = contents.files.find(entry => entry.path === "index.html");
      if (htmlEntry?.action === "delete") throw new Error("The application entry cannot be deleted.");
      let compatibility = null;
      if (workspace !== app && htmlEntry) {
        const existing = await read(workspace, "index.html");
        if (!existing || !decoder.decode(existing).includes('<base href="System Files/">'))
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
        inventory.push({ path: "index.html", scope: "workspace", existed: true,
          sha256: await digest(original, subtle), bytes: original });
      }
      const backupName = BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + "-" + global.crypto.randomUUID();
      await assertAuthority(workspace);
      const root = await backupRoot(workspace, true);
      try {
        await root.getDirectoryHandle(backupName, { create: false });
        throw new Error("Update backup already exists; no application files changed.");
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }
      await assertAuthority(workspace);
      backup = await root.getDirectoryHandle(backupName, { create: true });
      const record = inventory.map(({ path, scope, existed, sha256 }) => ({ path, ...(scope ? { scope } : {}), existed, sha256 }));
      for (let index = 0; index < inventory.length; index += 1) {
        await assertAuthority(workspace);
        const item = inventory[index];
        await progress(onProgress, { phase: "backup", percent: Math.round(25 + 20 * ((index + 1) / Math.max(inventory.length, 1))),
          label: "Backing up current files", detail: "Backing up " + (index + 1) + " of " + inventory.length + " files" });
        await assertAuthority(workspace);
        if (item.existed) await write(backup, backupPath(item), item.bytes, true);
      }
      await assertAuthority(workspace);
      await journal(backup, { status: "prepared", inventory: record });
      for (let index = 0; index < inventory.length; index += 1) {
        const item = inventory[index];
        await progress(onProgress, { phase: "backup-verify", percent: Math.round(45 + 10 * ((index + 1) / Math.max(inventory.length, 1))),
          label: "Verifying rollback backup", detail: "Checking " + (index + 1) + " of " + inventory.length + " files" });
        const current = await read(fileRoot(item, app, workspace), item.path);
        if (item.existed ? !current || await digest(current, subtle) !== item.sha256 : current !== null) {
          throw new Error("Application files changed during backup; nothing was installed.");
        }
      }
      await assertAuthority(workspace);
      await journal(backup, { status: "applying", inventory: record });
      try {
        for (let index = 0; index < targets.length; index += 1) {
          await assertAuthority(workspace);
          const entry = targets[index];
          await progress(onProgress, { phase: "apply", percent: Math.round(55 + 25 * ((index + 1) / Math.max(targets.length, 1))),
            label: "Applying update", detail: "Updating " + (index + 1) + " of " + targets.length + " changed files" });
          await assertAuthority(workspace);
          if (entry.action === "put") await write(app, entry.path, Uint8Array.from(global.atob(entry.contentBase64), c => c.charCodeAt(0)));
          else await remove(app, entry.path);
        }
        if (compatibility) {
          await assertAuthority(workspace);
          await write(workspace, "index.html", compatibility);
        }
        for (let index = 0; index < contents.files.length; index += 1) {
          const entry = contents.files[index];
          await progress(onProgress, { phase: "verify-install", percent: Math.round(80 + 18 * ((index + 1) / Math.max(contents.files.length, 1))),
            label: "Verifying installed files", detail: "Checking " + (index + 1) + " of " + contents.files.length + " package files" });
          const current = await read(app, entry.path);
          if (entry.action === "put" ? !current || await digest(current, subtle) !== entry.sha256.toLowerCase() : current !== null) {
            throw new Error("Installed file verification failed: " + entry.path);
          }
        }
        if (compatibility && await digest(await read(workspace, "index.html"), subtle) !== await digest(compatibility, subtle))
          throw new Error("Origin compatibility verification failed.");
        await assertAuthority(workspace);
        await journal(backup, { status: "verified", inventory: record });
        await progress(onProgress, { phase: "complete", percent: 100, label: "Update installed", detail: "Installation verified successfully" });
        return { status: "installed", version: verifiedPackage.version, backupName };
      } catch (error) {
        try {
          await progress(onProgress, { phase: "rollback", percent: 80, label: "Update failed — restoring previous version", detail: "Rollback is in progress" });
          await restore(app, workspace, backup, record, subtle, onProgress, 80, 98);
          await assertAuthority(workspace);
          await journal(backup, { status: "restored", inventory: record });
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

  async function recover({ appDirectoryHandle: app, workspaceDirectoryHandle, backupName,
    trustedAllowlist, confirmed = false, onProgress = null,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    if (global.MoonDogWriteAuthority && !global.MoonDogWriteAuthority.canWrite)
      return { status: "read-only", reason: "Editing authority is required before recovering an update." };
    const workspace = workspaceDirectoryHandle || app;
    try {
      await progress(onProgress, { phase: "recovery", percent: 5, label: "Preparing recovery", detail: "Checking the rollback backup" });
      if (!subtle || !global.MoonDogApplyDesignModel) throw new Error("Recovery verification is unavailable.");
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      if (typeof backupName !== "string" || !backupName.startsWith(BACKUP_PREFIX) ||
          !/^[A-Za-z0-9-]+$/.test(backupName)) throw new Error("Invalid update backup name.");
      await permission(workspace);
      await assertAuthority(workspace);
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
      const expected = new Set(trustedAllowlist.map(path => global.MoonDogApplyDesignModel.canonicalPath(path)));
      let compatibilitySeen = false;
      for (const item of record.inventory) {
        if (item?.scope === "workspace" && item.path === "index.html" && !compatibilitySeen &&
            workspace !== app && item.existed === true && /^[0-9a-f]{64}$/.test(item.sha256)) {
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
      await restore(app, workspace, backup, record.inventory, subtle, onProgress, 15, 95);
      await assertAuthority(workspace);
      await journal(backup, { status: "restored", inventory: record.inventory });
      await progress(onProgress, { phase: "complete", percent: 100, label: "Recovery complete", detail: "Original application files were verified restored" });
      return { status: "restored" };
    } catch (error) {
      return { status: "recovery-required", reason: error.message };
    }
  }

  global.MoonDogUpdateInstall = { apply, recover, listBackups };
})(globalThis);

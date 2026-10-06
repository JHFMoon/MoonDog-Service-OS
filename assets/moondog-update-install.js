(function (global) {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const BACKUP_PREFIX = "MoonDog-Update-Backup-";

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

  async function backupRoot(app, create = false) {
    if (!app || typeof app.getDirectoryHandle !== "function") throw new Error("Application folder is unavailable.");
    const backups = await app.getDirectoryHandle("backups", { create });
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

  async function restore(app, backup, inventory, subtle) {
    for (const item of inventory) {
      if (!item.existed) await remove(app, item.path);
      else {
        const bytes = await read(backup, item.path);
        if (!bytes || await digest(bytes, subtle) !== item.sha256) throw new Error("Backup verification failed: " + item.path);
        await write(app, item.path, bytes);
      }
    }
    for (const item of inventory) {
      const bytes = await read(app, item.path);
      if (item.existed ? !bytes || await digest(bytes, subtle) !== item.sha256 : bytes !== null) {
        throw new Error("Rollback verification failed: " + item.path);
      }
    }
  }

  async function apply({ verifiedPackage, appDirectoryHandle: app,
    trustedAllowlist, expectedPlan, confirmed = false, subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    if (!subtle || !global.MoonDogPackagePlan || !global.MoonDogApplyDesignModel) return { status: "unavailable" };
    let backup = null;
    let inventory = null;
    try {
      if (!verifiedPackage || verifiedPackage.status !== "verified" || verifiedPackage.migrationRequired ||
          !ArrayBuffer.isView(verifiedPackage.bytes) || verifiedPackage.bytes.byteLength > 64 * 1024 * 1024 ||
          !/^[0-9a-f]{64}$/.test(verifiedPackage.sha256) ||
          await digest(verifiedPackage.bytes, subtle) !== verifiedPackage.sha256) {
        return { status: "rejected", reason: "Package verification is missing or invalid." };
      }
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      await permission(app);
      if (trustedAllowlist.includes("index.html") && await read(app, "index.html") === null) {
        throw new Error("The connected application folder has no index.html.");
      }
      if (trustedAllowlist.includes("assets/app.js") && await read(app, "assets/app.js") === null) {
        throw new Error("The connected application folder has no application script.");
      }
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage,
        appDirectoryHandle: app, trustedAllowlist, subtle });
      if (plan.rejected.length || !expectedPlan || JSON.stringify(plan) !== JSON.stringify(expectedPlan)) {
        return { status: "rejected", reason: "The approved file preview changed or was rejected." };
      }
      const contents = JSON.parse(decoder.decode(verifiedPackage.bytes));
      const targets = contents.files.filter(entry => !plan.unchanged.includes(entry.path));
      inventory = [];
      for (const item of trustedAllowlist) {
        const original = await read(app, item);
        inventory.push({ path: item, existed: original !== null,
          sha256: original === null ? null : await digest(original, subtle), bytes: original });
      }
      const backupName = BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + "-" + global.crypto.randomUUID();
      const root = await backupRoot(app, true);
      try {
        await root.getDirectoryHandle(backupName, { create: false });
        throw new Error("Update backup already exists; no application files changed.");
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
      }
      backup = await root.getDirectoryHandle(backupName, { create: true });
      const record = inventory.map(({ path, existed, sha256 }) => ({ path, existed, sha256 }));
      for (const item of inventory) {
        if (item.existed) await write(backup, item.path, item.bytes, true);
      }
      await journal(backup, { status: "prepared", inventory: record });
      for (const item of inventory) {
        const current = await read(app, item.path);
        if (item.existed ? !current || await digest(current, subtle) !== item.sha256 : current !== null) {
          throw new Error("Application files changed during backup; nothing was installed.");
        }
      }
      await journal(backup, { status: "applying", inventory: record });
      try {
        for (const entry of targets) {
          if (entry.action === "put") await write(app, entry.path, Uint8Array.from(global.atob(entry.contentBase64), c => c.charCodeAt(0)));
          else await remove(app, entry.path);
        }
        for (const entry of contents.files) {
          const current = await read(app, entry.path);
          if (entry.action === "put" ? !current || await digest(current, subtle) !== entry.sha256.toLowerCase() : current !== null) {
            throw new Error("Installed file verification failed: " + entry.path);
          }
        }
        await journal(backup, { status: "verified", inventory: record });
        return { status: "installed", version: verifiedPackage.version, backupName };
      } catch (error) {
        try {
          await restore(app, backup, record, subtle);
          await journal(backup, { status: "restored", inventory: record });
          return { status: "rolled-back", reason: error.message, backupName };
        } catch (restoreError) {
          return { status: "recovery-required", reason: restoreError.message, backupName };
        }
      }
    } catch (error) {
      return { status: "stopped", reason: error.message, backupName: backup && backup.name };
    }
  }

  async function recover({ appDirectoryHandle: app, backupName,
    trustedAllowlist, confirmed = false, subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!confirmed) return { status: "confirmation-required" };
    try {
      if (!subtle || !global.MoonDogApplyDesignModel) throw new Error("Recovery verification is unavailable.");
      global.MoonDogApplyDesignModel.plan([], trustedAllowlist);
      if (typeof backupName !== "string" || !backupName.startsWith(BACKUP_PREFIX) ||
          !/^[A-Za-z0-9-]+$/.test(backupName)) throw new Error("Invalid update backup name.");
      await permission(app);
      const root = await backupRoot(app);
      const backup = await root.getDirectoryHandle(backupName, { create: false });
      const bytes = await read(backup, "journal.json");
      if (!bytes) throw new Error("Backup journal is missing.");
      const record = JSON.parse(decoder.decode(bytes));
      if (!record || !["applying", "prepared", "restored"].includes(record.status) ||
          !Array.isArray(record.inventory) || record.inventory.length !== trustedAllowlist.length) {
        throw new Error("Backup journal cannot be used for recovery.");
      }
      const expected = new Set(trustedAllowlist.map(path => global.MoonDogApplyDesignModel.canonicalPath(path)));
      for (const item of record.inventory) {
        if (!item || typeof item.path !== "string" || !expected.delete(global.MoonDogApplyDesignModel.canonicalPath(item.path)) ||
            global.MoonDogApplyDesignModel.isProtected(item.path) || typeof item.existed !== "boolean" ||
            (item.existed ? !/^[0-9a-f]{64}$/.test(item.sha256) : item.sha256 !== null)) {
          throw new Error("Backup journal contains an unapproved file.");
        }
      }
      if (expected.size) throw new Error("Backup journal is incomplete.");
      await restore(app, backup, record.inventory, subtle);
      await journal(backup, { status: "restored", inventory: record.inventory });
      return { status: "restored" };
    } catch (error) {
      return { status: "recovery-required", reason: error.message };
    }
  }

  global.MoonDogUpdateInstall = { apply, recover, listBackups };
})(globalThis);

(function (global) {
  "use strict";

  const HASH = /^[0-9a-fA-F]{64}$/;
  const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$/;
  const BLOCKED_DIRS = new Set([
    "data", "history", "backup", "backups", "reports", "exports", "logs", "temp", "tmp",
    "settings", "state", "local-state", "customers", "employees", "contacts", "repair-orders",
    "ro-data", "store-data", "operational-data"
  ]);
  const BLOCKED_FILES = new Set([
    "current-state.json", "settings.json", "appointments.json", "advisor-performance.json",
    "operational-metrics.json", "assign-next.json", "auto-import.json",
    "meeting-cycle.json", "recovery.json"
  ]);
  const BLOCKED_EXTENSIONS = new Set([
    ".xlsx", ".xls", ".xlsm", ".csv", ".pdf", ".zip", ".7z", ".rar",
    ".log", ".tmp", ".bak", ".key", ".pem", ".exe", ".msi",
    ".py", ".ps1", ".bat", ".cmd", ".dll", ".node", ".sh"
  ]);

  function canonical(path) {
    if (typeof path !== "string" || !path || path.startsWith("/") ||
        /[\\:%\u0000-\u001f]/.test(path)) throw new Error("invalid-path");
    const parts = path.split("/");
    if (parts.some(part => !part || part === "." || part === ".." ||
        /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
      throw new Error("invalid-path");
    }
    return parts.map(part => part.toLowerCase()).join("/");
  }

  function protectedPath(path) {
    const parts = canonical(path).split("/");
    const name = parts.pop();
    if (parts.some(part => BLOCKED_DIRS.has(part) || part.includes("files to learn") ||
        part.includes("drop reports here") || part.includes("report inbox") ||
        part.includes("report-inbox"))) return true;
    const dot = name.lastIndexOf(".");
    const extension = dot < 0 ? "" : name.slice(dot);
    return BLOCKED_FILES.has(name) || BLOCKED_EXTENSIONS.has(extension) ||
      name === ".env" || name.startsWith(".env.") ||
      name.startsWith("credentials") || name.startsWith("secrets") ||
      (name.endsWith(".json") && (name.endsWith("-state.json") || name.startsWith("local-")));
  }

  function emptyPlan() {
    return { add: [], replace: [], delete: [], unchanged: [], rejected: [] };
  }

  function reject(path, reason) {
    const result = emptyPlan();
    result.rejected.push({ path, reason });
    return result;
  }

  async function sha256(bytes, subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error("invalid-content");
    }
    return Uint8Array.from(global.atob(value), character => character.charCodeAt(0));
  }

  async function readLocal(root, path) {
    const parts = path.split("/");
    let folder = root;
    try {
      for (const part of parts.slice(0, -1)) {
        folder = await folder.getDirectoryHandle(part, { create: false });
      }
      const handle = await folder.getFileHandle(parts[parts.length - 1], { create: false });
      const file = await handle.getFile();
      if (file.size > 64 * 1024 * 1024) throw new Error("local-file-too-large");
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error && error.name === "NotFoundError") return null;
      throw error;
    }
  }

  async function dryRun({ verifiedPackage, appDirectoryHandle, trustedAllowlist,
    subtle = global.crypto && global.crypto.subtle } = {}) {
    if (!verifiedPackage || verifiedPackage.status !== "verified" ||
        !ArrayBuffer.isView(verifiedPackage.bytes) || !subtle) return reject("<package>", "unverified");
    let packageData;
    try {
      packageData = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(verifiedPackage.bytes));
    } catch (_) {
      return reject("<package>", "invalid-json");
    }
    if (!packageData || Object.keys(packageData).sort().join(",") !==
        "approvedFiles,files,formatVersion,version" || packageData.formatVersion !== 1 ||
        !VERSION.test(packageData.version) || packageData.version !== verifiedPackage.version ||
        !Array.isArray(packageData.approvedFiles) || !Array.isArray(packageData.files) ||
        packageData.files.length < 1 || packageData.files.length > 512 ||
        packageData.approvedFiles.length !== packageData.files.length ||
        !Array.isArray(trustedAllowlist)) return reject("<package>", "invalid-format");

    const trusted = new Set();
    try {
      for (const path of trustedAllowlist) trusted.add(canonical(path));
    } catch (_) {
      return reject("<catalog>", "invalid-path");
    }
    const listed = new Set();
    const entries = new Map();
    try {
      for (const path of packageData.approvedFiles) {
        const key = canonical(path);
        if (listed.has(key) || protectedPath(path) || !trusted.has(key)) {
          return reject(path, "protected-or-unknown");
        }
        listed.add(key);
      }
      for (const file of packageData.files) {
        const key = canonical(file.path);
        if (!listed.has(key) || entries.has(key) || !HASH.test(file.sha256)) {
          return reject(file.path, "invalid-entry");
        }
        if (file.action === "put" &&
            Object.keys(file).sort().join(",") === "action,contentBase64,path,sha256") {
          const bytes = decodeBase64(file.contentBase64);
          if (await sha256(bytes, subtle) !== file.sha256.toLowerCase()) {
            return reject(file.path, "file-hash-mismatch");
          }
          entries.set(key, { path: file.path, action: "put", hash: file.sha256.toLowerCase() });
        } else if (file.action === "delete" &&
            Object.keys(file).sort().join(",") === "action,path,sha256") {
          entries.set(key, { path: file.path, action: "delete", hash: file.sha256.toLowerCase() });
        } else {
          return reject(file.path, "invalid-entry");
        }
      }
    } catch (_) {
      return reject("<package>", "invalid-entry");
    }
    if (entries.size !== listed.size) return reject("<package>", "list-mismatch");
    if (!appDirectoryHandle || typeof appDirectoryHandle.queryPermission !== "function") {
      return reject("<folder>", "unavailable");
    }
    try {
      if (await appDirectoryHandle.queryPermission({ mode: "read" }) !== "granted") {
        return reject("<folder>", "permission-required");
      }
      const result = emptyPlan();
      for (const entry of entries.values()) {
        const local = await readLocal(appDirectoryHandle, entry.path);
        if (local === null) {
          result[entry.action === "put" ? "add" : "unchanged"].push(entry.path);
          continue;
        }
        const localHash = await sha256(local, subtle);
        if (entry.action === "delete") {
          if (localHash !== entry.hash) return reject(entry.path, "current-hash-mismatch");
          result.delete.push(entry.path);
        } else {
          result[localHash === entry.hash ? "unchanged" : "replace"].push(entry.path);
        }
      }
      return result;
    } catch (_) {
      return reject("<folder>", "read-failed");
    }
  }

  global.MoonDogPackagePlan = { dryRun };
})(globalThis);

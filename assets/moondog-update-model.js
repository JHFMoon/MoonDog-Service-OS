(function (global) {
  "use strict";

  const blockedDirectories = new Set([
    "data", "history", "backup", "backups", "reports", "exports", "logs", "temp", "tmp",
    "settings", "state", "local-state", "customers", "employees", "contacts", "repair-orders",
    "ro-data", "store-data", "operational-data"
  ]);
  const blockedFiles = new Set([
    "current-state.json", "settings.json", "appointments.json", "advisor-performance.json",
    "operational-metrics.json", "assign-next.json", "auto-import.json",
    "meeting-cycle.json", "recovery.json"
  ]);
  const blockedExtensions = new Set([
    ".xlsx", ".xls", ".xlsm", ".csv", ".pdf", ".zip", ".7z", ".rar",
    ".log", ".tmp", ".bak", ".key", ".pem", ".exe", ".msi",
    ".py", ".ps1", ".bat", ".cmd", ".dll", ".node", ".sh"
  ]);

  function canonicalPath(path) {
    if (typeof path !== "string" || !path || path.startsWith("/") ||
        /[\\:%\u0000-\u001f]/.test(path)) throw new Error("Invalid relative path");
    const parts = path.split("/");
    if (parts.some(part => !part || part === "." || part === ".." ||
        /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
      throw new Error("Invalid relative path");
    }
    return parts.map(part => part.toLowerCase()).join("/");
  }

  function isProtected(path) {
    const parts = canonicalPath(path).split("/");
    const name = parts.pop();
    if (parts.some(part => blockedDirectories.has(part) ||
        part.includes("files to learn") || part.includes("drop reports here") ||
        part.includes("report inbox") || part.includes("report-inbox"))) return true;
    const dot = name.lastIndexOf(".");
    const extension = dot < 0 ? "" : name.slice(dot);
    return blockedFiles.has(name) || blockedExtensions.has(extension) ||
      name === ".env" || name.startsWith(".env.") ||
      name.startsWith("credentials") || name.startsWith("secrets") ||
      (name.endsWith(".json") && (name.endsWith("-state.json") || name.startsWith("local-")));
  }

  function plan(entries, trustedAllowlist) {
    if (!Array.isArray(entries) || !Array.isArray(trustedAllowlist)) throw new Error("Invalid inventory");
    const allowed = new Set(trustedAllowlist.map(path => {
      if (isProtected(path)) throw new Error("Protected path in trusted catalog");
      return canonicalPath(path);
    }));
    const seen = new Set();
    return entries.map(entry => {
      const key = canonicalPath(entry.path);
      if (isProtected(entry.path) || !allowed.has(key) || seen.has(key)) {
        throw new Error("Forbidden or duplicate application file");
      }
      seen.add(key);
      return { key, bytes: Uint8Array.from(entry.bytes) };
    });
  }

  // In-memory reference model only. It makes no File System Access API calls.
  function simulate({ installedFiles, entries, trustedAllowlist, failAfterWrite }) {
    const targets = plan(entries, trustedAllowlist);
    const files = new Map(Array.from(installedFiles, ([path, bytes]) =>
      [canonicalPath(path), Uint8Array.from(bytes)]));
    const backup = new Map();
    const events = [];
    for (const path of trustedAllowlist) {
      const key = canonicalPath(path);
      backup.set(key, files.has(key) ? Uint8Array.from(files.get(key)) : null);
      events.push({ step: "backup", path: key });
    }
    try {
      for (const target of targets) {
        files.set(target.key, Uint8Array.from(target.bytes));
        events.push({ step: "write", path: target.key });
        if (target.key === failAfterWrite) throw new Error("Simulated write failure");
      }
      return { status: "applied-in-memory", files, backup, events };
    } catch (_) {
      for (const target of targets.slice().reverse()) {
        const original = backup.get(target.key);
        if (original === null) files.delete(target.key);
        else files.set(target.key, Uint8Array.from(original));
        events.push({ step: "restore", path: target.key });
      }
      return { status: "restored-in-memory", files, backup, events };
    }
  }

  global.MoonDogApplyDesignModel = { canonicalPath, isProtected, plan, simulate };
})(globalThis);

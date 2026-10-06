(function (global) {
  "use strict";
  const host = document.getElementById("view-settings");
  if (!host) return;
  const version = String(global.MoonDogInstalledVersion || "");
  const baseComparisonVersion = /^\d+\.\d+\.\d+/.exec(version)?.[0] || "";
  let comparisonVersion = baseComparisonVersion;
  let installedVersion = version;
  let inspectedRoot = null;
  const betaMarker = "\n/* MoonDog controlled Beta update test 0.10.7-beta.1; no style changes. */\n";
  function compatible(minimum) {
    if (!/^\d+\.\d+\.\d+$/.test(minimum) || !comparisonVersion) return false;
    const installed = /^\d+\.\d+\.\d+/.exec(comparisonVersion)?.[0].split(".").map(Number);
    if (!installed) return false;
    const required = minimum.split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (installed[index] !== required[index]) return installed[index] > required[index];
    }
    return true;
  }
  const key = "moondog-public-update-preferences-v1";
  let saved = {};
  try { saved = JSON.parse(global.localStorage.getItem(key) || "{}"); } catch (_) {}
  const state = { channel: saved.channel === "beta" ? "beta" : "stable",
    lastCheck: saved.lastCheck || null, check: null, backup: null,
    recoveryRequired: saved.recoveryRequired === true, busy: false };
  const appRoot = () => global.__moondogSettingsModel?.root || null;
  async function inspectInstalledTestVersion() {
    const root = appRoot();
    if (!root || root === inspectedRoot) return;
    inspectedRoot = root;
    installedVersion = version;
    comparisonVersion = baseComparisonVersion;
    state.check = null;
    field("updateInstalledVersion").textContent = installedVersion || "Unknown";
    render();
    try {
      const assets = await root.getDirectoryHandle("assets", { create: false });
      const stylesheet = await assets.getFileHandle("product-settings.css", { create: false });
      const content = await (await stylesheet.getFile()).text();
      if (content.endsWith(betaMarker)) {
        installedVersion = "0.10.7-beta.1";
        comparisonVersion = installedVersion;
        state.check = null;
        field("updateInstalledVersion").textContent = installedVersion;
        render();
      }
    } catch (_) { /* The baseline version remains authoritative if the marker cannot be read. */ }
  }
  const card = document.createElement("section");
  card.className = "card settings-card";
  card.id = "settings-update";
  card.innerHTML = '<h2>System Updates</h2><p>Service Operations Hub checks its public update source. Installation always requires your approval.</p>' +
    '<div><strong>Installed version:</strong> <span id="updateInstalledVersion"></span></div>' +
    '<label>Update channel <select id="updateChannel"><option value="stable">Stable</option><option value="beta">Beta (opt in)</option></select></label>' +
    '<div><strong>Last check:</strong> <span id="updateLastCheck"></span></div>' +
    '<div><strong>Availability:</strong> <span id="updateAvailability" role="status"></span></div>' +
    '<div class="button-row"><button type="button" id="checkMoonDogUpdate">Check for Updates</button>' +
    '<button type="button" id="selectUpdateBackup">Choose separate backup folder</button>' +
    '<button type="button" id="installMoonDogUpdate" class="primary" disabled>Install Update</button>' +
    '<button type="button" id="recoverMoonDogUpdate">Recover interrupted update</button></div>' +
    '<p id="updateFolders" class="settings-note">Connect Service Operations Hub and choose a separate backup folder before installation.</p>' +
    '<pre id="updatePlan" hidden></pre><p id="updateStatus" role="status" aria-live="polite"></p>';
  host.append(card);
  const field = id => card.querySelector("#" + id);
  const channel = field("updateChannel");
  const availability = field("updateAvailability");
  const status = field("updateStatus");
  const planText = field("updatePlan");
  const installButton = field("installMoonDogUpdate");
  channel.value = state.channel;
  field("updateInstalledVersion").textContent = installedVersion || "Unknown";

  function save() {
    try { global.localStorage.setItem(key, JSON.stringify({ channel: state.channel,
      lastCheck: state.lastCheck, recoveryRequired: state.recoveryRequired })); } catch (_) {}
  }
  function render() {
    field("updateLastCheck").textContent = state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "Never";
    const result = state.check;
    availability.textContent = result?.status === "newer-version" ?
      `${result.channel === "beta" ? "Beta" : "Stable"} ${result.version} available` :
      result?.status === "up-to-date" ? "No newer update" :
      result?.status === "incompatible" ? `New version requires ${result.minimumCompatibleVersion}` :
      result?.status === "unavailable" ? "GitHub unavailable" :
      result?.status === "invalid-input" ? "Installed version cannot be compared" : "Not checked";
    field("updateFolders").textContent = `Connected application folder: ${appRoot()?.name || "not connected"}. Backup folder: ${state.backup?.name || "not chosen"}.`;
    installButton.disabled = state.busy || state.recoveryRequired || result?.status !== "newer-version" || !appRoot() || !state.backup;
    field("checkMoonDogUpdate").disabled = state.busy;
  }

  async function check(manual) {
    if (state.busy) return;
    state.busy = true; render();
    try {
      const result = await global.MoonDogUpdateCheck.check({ currentVersion: comparisonVersion,
        channel: state.channel, manual });
      state.lastCheck = new Date().toISOString();
      state.check = result;
      save();
      if (manual && result.status === "unavailable") status.textContent = "Could not reach GitHub. Try again later.";
      else if (manual && result.status === "invalid-input") status.textContent = "The installed version cannot be compared.";
      else if (manual) status.textContent = "Update check complete.";
    } finally { state.busy = false; render(); }
  }

  channel.addEventListener("change", () => {
    state.channel = channel.value === "beta" ? "beta" : "stable";
    state.check = null;
    save(); render();
  });
  field("checkMoonDogUpdate").addEventListener("click", () => check(true));
  async function choose(which) {
    if (!global.showDirectoryPicker) { status.textContent = "Folder access is unavailable in this browser."; return; }
    try {
      state[which] = await global.showDirectoryPicker({ mode: "readwrite" });
      status.textContent = "Folder selected. No application files changed.";
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "Folder selection failed: " + error.message;
    }
    render();
  }
  field("selectUpdateBackup").addEventListener("click", () => choose("backup"));
  installButton.addEventListener("click", async () => {
    if (state.busy || state.check?.status !== "newer-version" || !appRoot() || !state.backup) return;
    state.busy = true; render();
    planText.hidden = true;
    try {
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      if (catalog.length < 7) throw new Error("Installed application file catalog is unavailable.");
      status.textContent = "Verifying update package...";
      const verified = await global.MoonDogPackageVerification.verify({ channel: state.check.channel });
      if (verified.status === "no-package") throw new Error("No update package has been published.");
      if (verified.status !== "verified" || verified.version !== state.check.version ||
          verified.channel !== state.check.channel || verified.migrationRequired ||
          !compatible(verified.minimumCompatibleVersion)) {
        throw new Error("The update package is unavailable, changed, or requires an unsupported migration.");
      }
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage: verified,
        appDirectoryHandle: appRoot(), trustedAllowlist: catalog });
      const summary = ["Add", "Replace", "Delete", "Unchanged", "Rejected"].map(label =>
        `${label}: ${plan[label.toLowerCase()].length ? plan[label.toLowerCase()].map(item =>
          typeof item === "string" ? item : `${item.path} (${item.reason})`).join(", ") : "none"}`).join("\n");
      planText.textContent = summary;
      planText.hidden = false;
      if (plan.rejected.length) throw new Error("Update rejected. No application files changed.");
      status.textContent = "Review the file changes before confirming.";
      if (!global.confirm(`Install Service Operations Hub ${verified.version}?\n\n${summary}\n\nA separate backup will be verified before any application file is changed.`)) {
        status.textContent = "Installation cancelled. No application files changed.";
        return;
      }
      const outcome = await global.MoonDogUpdateInstall.apply({ verifiedPackage: verified,
        appDirectoryHandle: appRoot(), backupDirectoryHandle: state.backup,
        trustedAllowlist: catalog, expectedPlan: plan, confirmed: true });
      status.textContent = outcome.status === "installed" ?
        `Update verified. Restart Service Operations Hub to use version ${outcome.version}. Backup: ${outcome.backupName}.` :
        outcome.status === "rolled-back" ? `Update failed and original app files were verified restored. Backup: ${outcome.backupName}.` :
        outcome.status === "recovery-required" ? `Update stopped. Recovery is required from ${outcome.backupName}; do not retry installation. ${outcome.reason}` :
        `Update stopped without a verified installation. ${outcome.reason || outcome.status}`;
      if (outcome.status === "recovery-required") { state.recoveryRequired = true; save(); }
      if (outcome.status === "installed") {
        state.check = null;
        if (outcome.version === "0.10.7-beta.1") {
          installedVersion = outcome.version;
          comparisonVersion = outcome.version;
          field("updateInstalledVersion").textContent = installedVersion;
        }
      }
    } catch (error) {
      status.textContent = error.message || "Update stopped before installation.";
    } finally { state.busy = false; render(); }
  });
  field("recoverMoonDogUpdate").addEventListener("click", async () => {
    if (state.busy) return;
    if (!appRoot() || !global.showDirectoryPicker) {
      status.textContent = "Connect Service Operations Hub in a browser with folder access first.";
      return;
    }
    try {
      const backup = await global.showDirectoryPicker({ mode: "readwrite" });
      if (!global.confirm(`Restore Service Operations Hub application files from ${backup.name}? Confirm this is the backup folder created by the interrupted update.`)) return;
      state.busy = true; render();
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      const outcome = await global.MoonDogUpdateInstall.recover({ appDirectoryHandle: appRoot(),
        backupDirectoryHandle: backup, trustedAllowlist: catalog, confirmed: true });
      status.textContent = outcome.status === "restored" ?
        "Original application files were verified restored. Restart Service Operations Hub." :
        `Recovery could not be verified. Keep the backup intact. ${outcome.reason || ""}`;
      if (outcome.status === "restored") { state.recoveryRequired = false; save(); }
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "Recovery stopped: " + error.message;
    } finally { state.busy = false; render(); }
  });
  render();
  document.addEventListener("moondog-data", () => { render(); inspectInstalledTestVersion(); });
  inspectInstalledTestVersion();
  const today = new Date().toLocaleDateString("en-CA");
  if (!state.lastCheck || new Date(state.lastCheck).toLocaleDateString("en-CA") !== today) check(false);
})(globalThis);

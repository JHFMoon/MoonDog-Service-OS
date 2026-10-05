(function (global) {
  "use strict";
  const host = document.getElementById("view-settings");
  if (!host) return;
  const version = String(global.MoonDogInstalledVersion || "");
  const comparisonVersion = /^\d+\.\d+\.\d+/.exec(version)?.[0] || "";
  function compatible(minimum) {
    if (!/^\d+\.\d+\.\d+$/.test(minimum) || !comparisonVersion) return false;
    const installed = comparisonVersion.split(".").map(Number);
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
    lastCheck: saved.lastCheck || null, check: null, app: null, backup: null,
    recoveryRequired: saved.recoveryRequired === true, busy: false };
  const card = document.createElement("section");
  card.className = "card settings-card";
  card.id = "settings-update";
  card.innerHTML = '<h2>Update MoonDog</h2><p>Updates are checked through the public MoonDog repository. Installation always requires your approval.</p>' +
    '<div><strong>Installed version:</strong> <span id="updateInstalledVersion"></span></div>' +
    '<label>Update channel <select id="updateChannel"><option value="stable">Stable</option><option value="beta">Beta (opt in)</option></select></label>' +
    '<div><strong>Last check:</strong> <span id="updateLastCheck"></span></div>' +
    '<div><strong>Availability:</strong> <span id="updateAvailability" role="status"></span></div>' +
    '<div class="button-row"><button type="button" id="checkMoonDogUpdate">Check for Updates</button>' +
    '<button type="button" id="selectUpdateApp">Choose MoonDog folder</button>' +
    '<button type="button" id="selectUpdateBackup">Choose separate backup folder</button>' +
    '<button type="button" id="installMoonDogUpdate" class="primary" disabled>Install Update</button>' +
    '<button type="button" id="recoverMoonDogUpdate">Recover interrupted update</button></div>' +
    '<p id="updateFolders" class="settings-note">Select both folders before installation.</p>' +
    '<pre id="updatePlan" hidden></pre><p id="updateStatus" role="status" aria-live="polite"></p>';
  host.append(card);
  const field = id => card.querySelector("#" + id);
  const channel = field("updateChannel");
  const availability = field("updateAvailability");
  const status = field("updateStatus");
  const planText = field("updatePlan");
  const installButton = field("installMoonDogUpdate");
  channel.value = state.channel;
  field("updateInstalledVersion").textContent = version || "Unknown";

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
    field("updateFolders").textContent = `MoonDog folder: ${state.app?.name || "not chosen"}. Backup folder: ${state.backup?.name || "not chosen"}.`;
    installButton.disabled = state.busy || state.recoveryRequired || result?.status !== "newer-version" || !state.app || !state.backup;
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
  field("selectUpdateApp").addEventListener("click", () => choose("app"));
  field("selectUpdateBackup").addEventListener("click", () => choose("backup"));
  installButton.addEventListener("click", async () => {
    if (state.busy || state.check?.status !== "newer-version" || !state.app || !state.backup) return;
    state.busy = true; render();
    planText.hidden = true;
    try {
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      if (catalog.length < 7) throw new Error("Installed application file catalog is unavailable.");
      status.textContent = "Verifying update package...";
      const verified = await global.MoonDogPackageVerification.verify();
      if (verified.status === "no-package") throw new Error("No update package has been published.");
      if (verified.status !== "verified" || verified.version !== state.check.version ||
          verified.channel !== state.check.channel || verified.migrationRequired ||
          !compatible(verified.minimumCompatibleVersion)) {
        throw new Error("The update package is unavailable, changed, or requires an unsupported migration.");
      }
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage: verified,
        appDirectoryHandle: state.app, trustedAllowlist: catalog });
      const summary = ["Add", "Replace", "Delete", "Unchanged", "Rejected"].map(label =>
        `${label}: ${plan[label.toLowerCase()].length ? plan[label.toLowerCase()].map(item =>
          typeof item === "string" ? item : `${item.path} (${item.reason})`).join(", ") : "none"}`).join("\n");
      planText.textContent = summary;
      planText.hidden = false;
      if (plan.rejected.length) throw new Error("Update rejected. No application files changed.");
      status.textContent = "Review the file changes before confirming.";
      if (!global.confirm(`Install MoonDog ${verified.version}?\n\n${summary}\n\nA separate backup will be verified before any application file is changed.`)) {
        status.textContent = "Installation cancelled. No application files changed.";
        return;
      }
      const outcome = await global.MoonDogUpdateInstall.apply({ verifiedPackage: verified,
        appDirectoryHandle: state.app, backupDirectoryHandle: state.backup,
        trustedAllowlist: catalog, expectedPlan: plan, confirmed: true });
      status.textContent = outcome.status === "installed" ?
        `Update verified. Restart MoonDog to use version ${outcome.version}. Backup: ${outcome.backupName}.` :
        outcome.status === "rolled-back" ? `Update failed and original app files were verified restored. Backup: ${outcome.backupName}.` :
        outcome.status === "recovery-required" ? `Update stopped. Recovery is required from ${outcome.backupName}; do not retry installation. ${outcome.reason}` :
        `Update stopped without a verified installation. ${outcome.reason || outcome.status}`;
      if (outcome.status === "recovery-required") { state.recoveryRequired = true; save(); }
      if (outcome.status === "installed") state.check = null;
    } catch (error) {
      status.textContent = error.message || "Update stopped before installation.";
    } finally { state.busy = false; render(); }
  });
  field("recoverMoonDogUpdate").addEventListener("click", async () => {
    if (state.busy) return;
    if (!state.app || !global.showDirectoryPicker) {
      status.textContent = "Choose the MoonDog folder in a browser with folder access first.";
      return;
    }
    try {
      const backup = await global.showDirectoryPicker({ mode: "readwrite" });
      if (!global.confirm(`Restore MoonDog application files from ${backup.name}? Confirm this is the backup folder created by the interrupted update.`)) return;
      state.busy = true; render();
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      const outcome = await global.MoonDogUpdateInstall.recover({ appDirectoryHandle: state.app,
        backupDirectoryHandle: backup, trustedAllowlist: catalog, confirmed: true });
      status.textContent = outcome.status === "restored" ?
        "Original application files were verified restored. Restart MoonDog." :
        `Recovery could not be verified. Keep the backup intact. ${outcome.reason || ""}`;
      if (outcome.status === "restored") { state.recoveryRequired = false; save(); }
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "Recovery stopped: " + error.message;
    } finally { state.busy = false; render(); }
  });
  render();
  const today = new Date().toLocaleDateString("en-CA");
  if (!state.lastCheck || new Date(state.lastCheck).toLocaleDateString("en-CA") !== today) check(false);
})(globalThis);

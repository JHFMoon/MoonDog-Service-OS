(function (global) {
  "use strict";
  const host = document.getElementById("view-settings");
  if (!host) return;
  const version = String(global.MoonDogInstalledVersion || "");
  const baseComparisonVersion = /^\d+\.\d+\.\d+/.exec(version)?.[0] || "";
  const declaredBetaVersion = /^\d+\.\d+\.\d+-beta\.\d+$/.test(version) ? version : "";
  let comparisonVersion = declaredBetaVersion || baseComparisonVersion;
  let installedVersion = comparisonVersion;
  let installedChannel = declaredBetaVersion ? "beta" : "stable";
  let inspectedRoot = null;
  const betaMarker = "\n/* MoonDog controlled Beta update test 0.10.7-beta.1; no style changes. */\n";
  const beta2Marker = "\n/* Service Operations Hub theme Beta 0.10.7-beta.2. */\n";
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
    lastCheck: saved.lastCheck || null, check: null, checkFor: null,
    recoveryRequired: saved.recoveryRequired === true, hasRecoverable: false, busy: false };
  const appRoot = () => global.__moondogSettingsModel?.root || null;
  function clearPlan() { planText.textContent = ""; planText.hidden = true; }
  function currentOffer() {
    const result = state.check, stamp = state.checkFor;
    return ["newer-version", "channel-switch"].includes(result?.status) &&
      stamp?.channel === state.channel && stamp.version === comparisonVersion &&
      stamp.root === appRoot() && /^https:\/\//.test(result.packageUrl || "") &&
      /^[0-9a-f]{64}$/.test(result.sha256 || "");
  }
  async function refreshRecovery() {
    try { state.hasRecoverable = !!appRoot() &&
      (await global.MoonDogUpdateInstall.listBackups(appRoot())).length > 0; }
    catch (_) { state.hasRecoverable = false; }
    render();
  }
  async function inspectInstalledTestVersion() {
    const root = appRoot();
    if (!root || root === inspectedRoot) return;
    inspectedRoot = root;
    installedVersion = declaredBetaVersion || baseComparisonVersion;
    installedChannel = declaredBetaVersion ? "beta" : "stable";
    comparisonVersion = installedVersion;
    state.check = null;
    state.checkFor = null;
    clearPlan();
    field("updateInstalledVersion").textContent = installedVersion || "Unknown";
    field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";
    render();
    try {
      const assets = await root.getDirectoryHandle("assets", { create: false });
      const stylesheet = await assets.getFileHandle("product-settings.css", { create: false });
      const content = await (await stylesheet.getFile()).text();
      if (baseComparisonVersion === "0.10.6" && content.endsWith(betaMarker)) {
        installedVersion = "0.10.7-beta.1";
        installedChannel = "beta";
        comparisonVersion = installedVersion;
        state.check = null;
        field("updateInstalledVersion").textContent = installedVersion;
        field("updateInstalledChannel").textContent = "Beta";
        render();
      }
    } catch (_) { /* The baseline version remains authoritative if the marker cannot be read. */ }
    try {
      const assets = await root.getDirectoryHandle("assets", { create: false });
      const script = await assets.getFileHandle("daily-ops.js", { create: false });
      if (baseComparisonVersion === "0.10.6" && (await (await script.getFile()).text()).endsWith(beta2Marker)) {
        installedVersion = "0.10.7-beta.2";
        installedChannel = "beta";
        comparisonVersion = installedVersion;
        state.check = null;
        state.checkFor = null;
        field("updateInstalledVersion").textContent = installedVersion;
        field("updateInstalledChannel").textContent = "Beta";
        render();
      }
    } catch (_) { /* The baseline or Beta 1 marker remains authoritative. */ }
    refreshRecovery();
  }
  const card = document.createElement("section");
  card.className = "card settings-card";
  card.id = "settings-update";
  card.innerHTML = '<h2>System Updates</h2><p>Service Operations Hub checks its public update source. Installation always requires your approval.</p>' +
    '<div><strong>Installed version:</strong> <span id="updateInstalledVersion"></span></div>' +
    '<div><strong>Installed channel:</strong> <span id="updateInstalledChannel"></span></div>' +
    '<label>Update channel <select id="updateChannel"><option value="stable">Stable</option><option value="beta">Beta (opt in)</option></select></label>' +
    '<div><strong>Last check:</strong> <span id="updateLastCheck"></span></div>' +
    '<div><strong>Availability:</strong> <span id="updateAvailability" role="status"></span></div>' +
    '<p id="updateChannelNote" class="settings-note"></p>' +
    '<div class="button-row"><button type="button" id="checkMoonDogUpdate">Check for Updates</button>' +
    '<button type="button" id="installMoonDogUpdate" class="primary" disabled>Install Update</button>' +
    '<button type="button" id="recoverMoonDogUpdate" hidden>Recover interrupted update</button></div>' +
    '<p id="updateFolders" class="settings-note">Connect Service Operations Hub before installation. Update rollback backups are saved in backups/system-updates/ inside the connected workspace.</p>' +
    '<pre id="updatePlan" hidden></pre><p id="updateStatus" role="status" aria-live="polite"></p>';
  const settingsSections = host.querySelector(".settings-sections");
  if (!settingsSections) return;
  settingsSections.append(card);
  const field = id => card.querySelector("#" + id);
  const channel = field("updateChannel");
  const availability = field("updateAvailability");
  const status = field("updateStatus");
  const planText = field("updatePlan");
  const installButton = field("installMoonDogUpdate");
  channel.value = state.channel;
  field("updateInstalledVersion").textContent = installedVersion || "Unknown";
  field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";

  function save() {
    try { global.localStorage.setItem(key, JSON.stringify({ channel: state.channel,
      lastCheck: state.lastCheck, recoveryRequired: state.recoveryRequired })); } catch (_) {}
  }
  function render() {
    field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";
    field("updateChannelNote").textContent = state.channel === "beta" ?
      "Beta is the test channel. A verified return to Stable remains available." :
      "Stable is the normal operating channel.";
    field("updateLastCheck").textContent = state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "Never";
    const result = state.check;
    availability.textContent = result?.status === "newer-version" ?
      `${result.channel === "beta" ? "Beta" : "Stable"} ${result.version} available` :
      result?.status === "channel-switch" ? `Return to Stable ${result.version} available` :
      result?.status === "up-to-date" ? "No newer update" :
      result?.status === "incompatible" ? `New version requires ${result.minimumCompatibleVersion}` :
      result?.status === "unavailable" ? "GitHub unavailable" :
      result?.status === "invalid-input" ? "Installed version cannot be compared" : "Not checked";
    field("updateFolders").textContent = `Connected application folder: ${appRoot()?.name || "not connected"}. Update rollback backups: backups/system-updates/.`;
    installButton.textContent = result?.status === "channel-switch" ? "Return to Stable" :
      result?.channel === "beta" ? "Install Beta" : "Install Update";
    installButton.disabled = state.busy || state.recoveryRequired || !currentOffer();
    field("checkMoonDogUpdate").disabled = state.busy;
    channel.disabled = state.busy;
    field("recoverMoonDogUpdate").hidden = !state.recoveryRequired && !state.hasRecoverable;
  }

  async function check(manual) {
    if (state.busy) return;
    const checkedChannel = state.channel, checkedVersion = comparisonVersion, checkedRoot = appRoot();
    state.check = null;
    state.checkFor = null;
    clearPlan();
    state.busy = true; render();
    try {
      const result = await global.MoonDogUpdateCheck.check({ currentVersion: checkedVersion,
        channel: checkedChannel, manual });
      if (checkedChannel !== state.channel || checkedVersion !== comparisonVersion || checkedRoot !== appRoot()) return;
      state.lastCheck = new Date().toISOString();
      state.check = result;
      if (["newer-version", "channel-switch"].includes(result.status)) {
        state.checkFor = { channel: checkedChannel, version: checkedVersion, root: checkedRoot };
      }
      save();
      if (manual && result.status === "unavailable") status.textContent = "Could not reach GitHub. Try again later.";
      else if (manual && result.status === "invalid-input") status.textContent = "The installed version cannot be compared.";
      else if (manual) status.textContent = "Update check complete.";
    } finally { state.busy = false; render(); }
  }

  channel.addEventListener("change", () => {
    state.channel = channel.value === "beta" ? "beta" : "stable";
    state.check = null;
    state.checkFor = null;
    clearPlan();
    save(); render();
  });
  field("checkMoonDogUpdate").addEventListener("click", () => check(true));
  installButton.addEventListener("click", async () => {
    if (state.busy || !currentOffer()) return;
    const offered = state.check, offeredFor = state.checkFor;
    state.busy = true; render();
    clearPlan();
    try {
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      if (catalog.length < 7) throw new Error("Installed application file catalog is unavailable.");
      status.textContent = "Verifying update package...";
      const verified = await global.MoonDogPackageVerification.verify({ channel: offered.channel });
      if (verified.status === "no-package") throw new Error("No update package has been published.");
      if (verified.status !== "verified" || verified.version !== offered.version ||
          verified.channel !== offered.channel || verified.sha256 !== offered.sha256 ||
          offeredFor.channel !== state.channel || offeredFor.version !== comparisonVersion ||
          offeredFor.root !== appRoot() || verified.migrationRequired ||
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
      if (!global.confirm(`Install Service Operations Hub ${verified.version}?\n\n${summary}\n\nA rollback backup in backups/system-updates/ will be verified before any application file is changed.`)) {
        status.textContent = "Installation cancelled. No application files changed.";
        return;
      }
      const outcome = await global.MoonDogUpdateInstall.apply({ verifiedPackage: verified,
        appDirectoryHandle: appRoot(),
        trustedAllowlist: catalog, expectedPlan: plan, confirmed: true });
      status.textContent = outcome.status === "installed" ?
        `Update verified. Restart Service Operations Hub to use version ${outcome.version}. Rollback backup saved in backups/system-updates/.` :
        outcome.status === "rolled-back" ? "Update failed and original app files were verified restored. Rollback backup saved in backups/system-updates/." :
        outcome.status === "recovery-required" ? `Update stopped. Recovery is required from backups/system-updates/; do not retry installation. ${outcome.reason}` :
        `Update stopped without a verified installation. ${outcome.reason || outcome.status}`;
      if (outcome.status === "recovery-required") { state.recoveryRequired = true; save(); }
      if (outcome.status === "installed") {
        state.check = null;
        state.checkFor = null;
        clearPlan();
        installedVersion = outcome.version;
        comparisonVersion = outcome.version;
        installedChannel = verified.channel;
        field("updateInstalledVersion").textContent = installedVersion;
        field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";
      }
    } catch (error) {
      status.textContent = error.message || "Update stopped before installation.";
    } finally { state.busy = false; render(); if (state.recoveryRequired) refreshRecovery(); }
  });
  field("recoverMoonDogUpdate").addEventListener("click", async () => {
    if (state.busy) return;
    if (!appRoot()) {
      status.textContent = "Connect Service Operations Hub in a browser with folder access first.";
      return;
    }
    try {
      const backups = await global.MoonDogUpdateInstall.listBackups(appRoot());
      if (!backups.length) { status.textContent = "No update rollback backups were found in backups/system-updates/."; return; }
      const selection = backups.length === 1 ? "1" : global.prompt(`Select an update backup number from backups/system-updates/:\n\n${backups.map((_, index) => `Backup ${index + 1}`).join("\n")}`, "1");
      const backupName = /^\d+$/.test(selection || "") ? backups[Number(selection) - 1] : null;
      if (!backupName) { status.textContent = "Recovery cancelled or backup not found."; return; }
      if (!global.confirm(`Restore Service Operations Hub application files from update backup ${selection} in backups/system-updates/?`)) return;
      state.busy = true; render();
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      const outcome = await global.MoonDogUpdateInstall.recover({ appDirectoryHandle: appRoot(),
        backupName, trustedAllowlist: catalog, confirmed: true });
      status.textContent = outcome.status === "restored" ?
        "Original application files were verified restored. Restart Service Operations Hub." :
        `Recovery could not be verified. Keep the backup intact. ${outcome.reason || ""}`;
      if (outcome.status === "restored") { state.recoveryRequired = false; save(); await refreshRecovery(); }
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "Recovery stopped: " + error.message;
    } finally { state.busy = false; render(); }
  });
  render();
  document.addEventListener("moondog-data", () => { render(); inspectInstalledTestVersion(); refreshRecovery(); });
  inspectInstalledTestVersion();
  const today = new Date().toLocaleDateString("en-CA");
  if (!state.lastCheck || new Date(state.lastCheck).toLocaleDateString("en-CA") !== today) check(false);
})(globalThis);

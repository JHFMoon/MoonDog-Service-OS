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
  const beta2Marker = "\n/* Service Operations Dashboard theme Beta 0.10.7-beta.2. */\n";
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
  // Chromium file:// origins may share localStorage across independent local
  // launchers. Never import an unscoped recovery hold or channel preference
  // from another store. A verified installed Beta defaults to its own channel.
  const localLauncher = global.location?.protocol === "file:" &&
    typeof global.location.pathname === "string" && Boolean(global.location.pathname);
  const key = localLauncher
    ? "moondog-public-update-preferences-v2:" + global.location.pathname
    : "moondog-public-update-preferences-v1";
  let saved = {};
  try { saved = JSON.parse(global.localStorage.getItem(key) || "{}"); } catch (_) {}
  const state = { channel: saved.channel === "beta" ? "beta" : saved.channel === "stable" ? "stable" : declaredBetaVersion ? "beta" : "stable",
    lastCheck: saved.lastCheck || null, lastAutomatic: saved.lastAutomatic || "",
    dismissed: saved.dismissed || null, check: null, checkFor: null,
    recoveryRequired: saved.recoveryRequired === true, hasRecoverable: false, autoRecoverable: false,
    recoveryScanPending: false, recoveryScanFailed: false, busy: false, progress: null,
    progressChangedAt: 0, progressStalled: false, freshResetUnresolved: false,
    postUpdateFresh: null, postUpdateScanPending: false, postUpdateScanFailed: false,
    postUpdateScanError: "", postUpdateScanCompleted: false };
  let postUpdateScanGeneration = 0, recoveryScanGeneration = 0;
  const appRoot = () => global.__moondogSettingsModel?.applicationRoot || null;
  const applicationFiles = async () => {
    // applicationRoot is the selected top-level installation folder, which
    // contains System Files; Workspace is nested below and is NOT the target.
    const installation = appRoot();
    if (!installation) throw new Error("Connect the Service Operations Dashboard installation first.");
    return installation.getDirectoryHandle("System Files", { create: false });
  };
  function clearPlan() { planText.textContent = ""; planText.hidden = true; }
  function postUpdateReady() {
    const receipt=state.postUpdateFresh;
    return Boolean(receipt && receipt.root===appRoot() && receipt.version===declaredBetaVersion &&
      receipt.channel==="beta" && !currentOffer());
  }
  function freshAvailable() {
    const target=appRoot();
    const newerOffer=currentOffer() && state.check?.status==="newer-version";
    const verifiedFollowup=postUpdateReady() && !state.postUpdateScanPending && !state.postUpdateScanFailed;
    return Boolean(target && declaredBetaVersion && installedChannel==="beta" &&
      state.channel==="beta" && (newerOffer || verifiedFollowup) &&
      !state.busy && !state.recoveryRequired && !state.freshResetUnresolved && !state.hasRecoverable &&
      !state.recoveryScanPending && !state.recoveryScanFailed &&
      typeof target.isSameEntry==="function" && typeof target.resolve==="function" &&
      typeof global.__moondogFreshInstallation?.resetSelectedFreshInstallation==="function");
  }
  function currentOffer() {
    const result = state.check, stamp = state.checkFor;
    return ["newer-version", "channel-switch"].includes(result?.status) &&
      stamp?.channel === state.channel && stamp.version === comparisonVersion &&
      stamp.root === appRoot() && /^https:\/\//.test(result.packageUrl || "") &&
      /^[0-9a-f]{64}$/.test(result.sha256 || "");
  }
  // A legacy Beta can only install the new runtime first. After reload, a
  // *new* manual Fresh choice is possible only when this exact installation
  // contains a verified installer journal for the version currently running.
  // Shared localStorage and folder names never provide reset authorization.
  async function readVerifiedPostUpdate(root, version) {
    if (!root || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) return null;
    let backups;
    try {
      const system=await root.getDirectoryHandle("System Files",{create:false});
      const workspace=await system.getDirectoryHandle("Workspace",{create:false});
      const backupRoot=await workspace.getDirectoryHandle("backups",{create:false});
      backups=await backupRoot.getDirectoryHandle("system-updates",{create:false});
    } catch(error) {
      if(error?.name==="NotFoundError")return null;
      throw error;
    }
    let receipt=null,checked=0;
    for await (const [name,folder] of backups.entries()) {
      if(folder.kind!=="directory" || !/^MoonDog-Update-Backup-[A-Za-z0-9-]+$/.test(name))continue;
      if(++checked>5000)throw new Error("Too many update journals to verify Fresh safely.");
      let journal;
      try {journal=await folder.getFileHandle("journal.json",{create:false});}
      catch(error){if(error?.name==="NotFoundError")continue;throw error;}
      let record;
      try {record=JSON.parse(await (await journal.getFile()).text());}
      catch(_) {throw new Error("An update journal could not be verified; Fresh is blocked.");}
      if(record?.status!=="verified" || record.verifiedUpdate?.version!==version)continue;
      const update=record.verifiedUpdate;
      if(update.channel!=="beta" || !/^[a-f0-9]{64}$/.test(update.sha256||"") ||
          !Number.isFinite(Date.parse(update.verifiedAt||"")))
        throw new Error("The current Beta update journal is incomplete; Fresh is blocked.");
      if(receipt)throw new Error("Multiple matching Beta update journals require manual review.");
      receipt={root,status:"installed",channel:"beta",version,sha256:update.sha256,backupName:name};
    }
    return receipt;
  }
  async function inspectPostUpdateFresh() {
    // File:// folders can be temporarily unavailable while OneDrive syncs.
    // An earlier failed/slow scan must not overwrite a later successful scan.
    const root=appRoot(),generation=++postUpdateScanGeneration;
    state.postUpdateFresh=null;
    state.postUpdateScanFailed=false;
    state.postUpdateScanError="";
    state.postUpdateScanCompleted=false;
    if(!root || !declaredBetaVersion){state.postUpdateScanPending=false;render();return;}
    state.postUpdateScanPending=true;
    render();
    try{
      const receipt=await readVerifiedPostUpdate(root,declaredBetaVersion);
      if(root===appRoot() && generation===postUpdateScanGeneration){
        state.postUpdateFresh=receipt;
        state.postUpdateScanCompleted=true;
      }
    }catch(error){
      if(root===appRoot() && generation===postUpdateScanGeneration){
        // Do not auto-authorize Fresh or invent a missing verified receipt.
        state.postUpdateScanFailed=true;
        state.postUpdateScanError=String(error?.message||error?.name||"Journal read failed.").slice(0,240);
      }
    }finally{
      if(root===appRoot() && generation===postUpdateScanGeneration){
        state.postUpdateScanPending=false;
        render();
      }
    }
  }
  const recoveryHold = () => state.recoveryScanPending || state.recoveryScanFailed ||
    ((state.recoveryRequired || state.hasRecoverable) && !state.autoRecoverable);
  async function refreshRecovery() {
    const root = appRoot(), generation = ++recoveryScanGeneration;
    if (!root) {
      state.hasRecoverable = false; state.autoRecoverable = false; state.recoveryScanFailed = false;
      state.recoveryScanPending = false; render(); return;
    }
    state.recoveryScanPending = true; state.autoRecoverable = false;
    render();
    try {
      const backups = await global.MoonDogUpdateInstall.listBackups(root);
      if (root !== appRoot() || generation !== recoveryScanGeneration) return;
      state.hasRecoverable = backups.length > 0;
      state.recoveryScanFailed = false;
      if (backups.length === 1 && typeof global.MoonDogUpdateInstall.inspectRecovery === "function") {
        const app = await root.getDirectoryHandle("System Files", {create:false});
        const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
          "assets/moondog-update-verify.js", "assets/moondog-update-plan.js", "assets/moondog-update-model.js",
          "assets/moondog-update-install.js", "assets/moondog-update-settings.js"])];
        const proof = await global.MoonDogUpdateInstall.inspectRecovery({appDirectoryHandle:app,
          workspaceDirectoryHandle:root,backupName:backups[0],trustedAllowlist:catalog});
        if (root !== appRoot() || generation !== recoveryScanGeneration) return;
        state.autoRecoverable = proof.status === "recoverable";
      }
    } catch (_) {
      if (root !== appRoot() || generation !== recoveryScanGeneration) return;
      // Unknown recovery inventory must fail closed. A second update could
      // overwrite an interrupted rollback while OneDrive is unreadable.
      state.hasRecoverable = true;
      state.recoveryScanFailed = true;
    } finally {
      if (root === appRoot() && generation === recoveryScanGeneration) {
        state.recoveryScanPending = false;
        render();
      }
    }
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
      const assets = await (await applicationFiles()).getDirectoryHandle("assets", { create: false });
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
      const assets = await (await applicationFiles()).getDirectoryHandle("assets", { create: false });
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
    void inspectPostUpdateFresh();
  }
  const card = document.createElement("section");
  card.className = "card settings-card";
  card.id = "settings-update";
  card.innerHTML = '<h2>System Updates</h2><p>Service Operations Dashboard checks its verified public update source. Installing an update always requires your approval.</p>' +
    '<div><strong>Installed version:</strong> <span id="updateInstalledVersion"></span></div>' +
    '<div><strong>Installed channel:</strong> <span id="updateInstalledChannel"></span></div>' +
    '<label>Update channel <select id="updateChannel"><option value="stable">Stable</option><option value="beta">Beta (opt in)</option></select></label>' +
    '<div><strong>Last update check:</strong> <span id="updateLastCheck"></span></div>' +
    '<div><strong>Availability:</strong> <span id="updateAvailability" role="status"></span></div>' +
    '<p id="updateChannelNote" class="settings-note"></p>' +
    '<div class="button-row"><button type="button" id="checkMoonDogUpdate">Check for Updates</button>' +
    '<button type="button" id="installMoonDogUpdate" class="primary" disabled>Update Current Installation</button>' +
    '<button type="button" id="freshMoonDogUpdate" class="danger" disabled>Update to Fresh Installation</button>' +
    '<button type="button" id="retryMoonDogFreshCheck" hidden>Retry Fresh Verification</button>' +
    '<button type="button" id="recoverMoonDogUpdate" hidden>Recover interrupted update</button></div>' +
    '<p id="updateChoiceNote" class="settings-note">Update Current Installation preserves all dealership data. Fresh Installation permanently removes data only from the selected copy, after verified installation and additional confirmations. Fresh is unavailable until the isolated reset passes safety verification.</p>' +
    '<p id="updateFolders" class="settings-note">Connect Service Operations Dashboard before installation. Update rollback backups are saved in System Files/Workspace/backups/system-updates/ inside the connected workspace.</p>' +
    '<div id="updateProgress" class="update-progress" aria-live="polite"><div class="update-progress-head"><strong id="updateProgressLabel">Ready for updates</strong><span id="updateProgressPercent">Ready</span></div><div id="updateProgressTrack" class="update-progress-track" role="progressbar" aria-label="Update progress" aria-valuemin="0" aria-valuemax="100" aria-valuetext="Idle"><span id="updateProgressBar"></span></div><small id="updateProgressDetail">Select Check for Updates to begin.</small><small id="updateProgressState" role="status">IDLE</small></div>' +
    '<style>.update-progress #updateProgressState{display:block;margin-top:5px;font-weight:600}.update-progress.stalled #updateProgressState{color:#9a4b15}.update-progress-track #updateProgressBar.indeterminate{width:38%!important;animation:moondog-update-working 1.7s ease-in-out infinite alternate}@keyframes moondog-update-working{from{transform:translateX(0)}to{transform:translateX(145%)}}@media(prefers-reduced-motion:reduce){.update-progress-track #updateProgressBar.indeterminate{animation:none}}</style>' +
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
  const freshButton = field("freshMoonDogUpdate");
  channel.value = state.channel;
  field("updateInstalledVersion").textContent = installedVersion || "Unknown";
  field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";

  function save() {
    try { global.localStorage.setItem(key, JSON.stringify({ channel: state.channel,
      lastCheck: state.lastCheck, lastAutomatic: state.lastAutomatic,
      dismissed: state.dismissed, recoveryRequired: state.recoveryRequired })); } catch (_) {}
  }
  // The dashboard only retrieves manifest metadata; full packages remain user-initiated.
  const localDay = (at = new Date()) => [at.getFullYear(), String(at.getMonth() + 1).padStart(2, "0"), String(at.getDate()).padStart(2, "0")].join("-");
  const main = typeof document.querySelector === "function" ? document.querySelector("main") : null;
  let notice = null, note = null;
  if (main && typeof main.insertBefore === "function") {
    notice = document.createElement("aside");
    notice.className = "moondog-update-notice"; notice.hidden = true;
    notice.setAttribute("aria-label", "Available application update");
    notice.innerHTML = '<div class="update-notice-row"><strong data-update-title></strong><div class="update-notice-actions"><button type="button" data-update-install>Install Update</button><button type="button" data-update-changes>View Changes</button><button type="button" data-update-later>Not Now</button></div></div><p data-update-notes hidden></p>';
    main.insertBefore(notice, document.getElementById("status"));
    note = notice.querySelector("[data-update-notes]");
    const style = document.createElement("style");
    style.textContent = '.moondog-update-notice{margin:8px 16px;padding:10px 14px;border:1px solid #b5c9d1;border-left:3px solid #3d7b9b;border-radius:8px;background:var(--surface,#f7fafb);color:var(--text,#24333d);font-size:13px}.moondog-update-notice[hidden],.moondog-update-notice [hidden]{display:none!important}.update-notice-row,.update-notice-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.update-notice-row{justify-content:space-between}.update-notice-actions button{padding:5px 9px;font-size:12px}.moondog-update-notice p{margin:8px 0 0;white-space:pre-wrap;line-height:1.4}';
    document.head?.append(style);
    notice.querySelector("[data-update-install]").addEventListener("click", () => { if (currentOffer()) installButton.click(); });
    notice.querySelector("[data-update-changes]").addEventListener("click", () => {
      note.hidden = !note.hidden;
      notice.querySelector("[data-update-changes]").textContent = note.hidden ? "View Changes" : "Hide Changes";
    });
    notice.querySelector("[data-update-later]").addEventListener("click", () => {
      state.dismissed = { day: localDay(), channel: state.channel, version: state.check?.version };
      save(); paintNotice();
    });
  }
  function paintNotice() {
    if (!notice) return;
    const offered = currentOffer(), value = state.check;
    const dismissed = state.dismissed?.day === localDay() && state.dismissed?.channel === state.channel && state.dismissed?.version === value?.version;
    notice.hidden = !offered || dismissed || recoveryHold() || (state.hasRecoverable && state.channel !== "beta");
    if (notice.hidden) return;
    notice.querySelector("[data-update-title]").textContent = (value.status === "channel-switch" ? "Return to Stable " : value.channel === "beta" ? "Beta " : "Stable ") + value.version + " available";
    notice.querySelector("[data-update-install]").textContent = value.status === "channel-switch" ? "Return to Stable" : "Update Current Installation";
    note.textContent = value.releaseNotes || "No release notes were provided for this update.";
  }
  let reloadScheduled = false;
  function reloadVerifiedUpdate(version) {
    if (reloadScheduled || !version) return;
    const manualReload = () => {
      status.textContent = `Update ${version} installed and verified. Automatic reload was unavailable; refresh this tab to load the new version.`;
      field("updateProgressDetail").textContent = "Press Ctrl+R to load the installed update.";
    };
    if (typeof global.location?.reload !== "function" || typeof global.setTimeout !== "function") {
      manualReload();
      return;
    }
    reloadScheduled = true;
    status.textContent = `Update ${version} installed and verified. Reloading Service Operations Dashboard automatically...`;
    global.setTimeout(() => {
      try { global.location.reload(); }
      catch (_) { reloadScheduled = false; manualReload(); }
    }, 900);
  }
  function flushUi() {
    return new Promise(resolve => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; resolve(); } };
      global.setTimeout(finish, 20);
      if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(() => global.requestAnimationFrame(finish));
    });
  }
  function paintUpdateProgress() {
    const progress = state.progress, box = field("updateProgress");
    // Keep the bar visible at rest. Unknown duration must not appear as zero percent.
    box.hidden = false;
    const measurable = progress && progress.percent !== null;
    field("updateProgressLabel").textContent = progress?.label || "Ready for updates";
    field("updateProgressPercent").textContent = measurable ? progress.percent + "%" : progress ? "Working" : "Ready";
    field("updateProgressDetail").textContent = progress?.detail || "Select Check for Updates to begin.";
    const bar = field("updateProgressBar");
    bar.style.width = measurable ? progress.percent + "%" : progress ? "38%" : "0%";
    bar.className = progress && !measurable ? "indeterminate" : "";
    const track = field("updateProgressTrack");
    if (measurable) track.setAttribute("aria-valuenow", String(progress.percent));
    else track.removeAttribute?.("aria-valuenow");
    track.setAttribute("aria-valuetext", state.progressStalled ? "Stalled: no progress for 30 seconds" :
      measurable ? progress.percent + " percent" : progress ? "Working, duration unknown" : "Idle");
    const phase = progress?.phase || "idle";
    const finished = ["complete", "rolled-back", "error"].includes(phase);
    field("updateProgressState").textContent = state.progressStalled ? "STALLED · No progress for 30 seconds" :
      phase === "error" ? "STOPPED · Action needed" :
      finished ? phase === "rolled-back" ? "ROLLBACK VERIFIED" : "COMPLETE" :
      progress ? "WORKING · " + (progress.label || "Processing") : "IDLE";
    box.className = "update-progress" + (state.progressStalled ? " stalled warning" :
      phase === "rollback" || phase === "rolled-back" ? " warning" :
      phase === "error" ? " error" : phase === "complete" ? " complete" : "");
  }
  async function setProgress(value) {
    const pct = value?.percent;
    const percent = pct !== null && pct !== undefined && Number.isFinite(Number(pct))
      ? Math.max(0, Math.min(100, Math.round(Number(pct)))) : null;
    const next = value ? { ...value, percent } : null;
    if (next?.phase !== state.progress?.phase || next?.label !== state.progress?.label ||
      next?.detail !== state.progress?.detail || next?.percent !== state.progress?.percent) {
      state.progressChangedAt = Date.now();
      state.progressStalled = false;
    }
    state.progress = next;
    paintUpdateProgress();
    await flushUi();
  }
  function clearProgress() {
    state.progress = null;
    state.progressStalled = false;
    state.progressChangedAt = 0;
    paintUpdateProgress();
  }
  function checkProgressStall() {
    const active = state.busy && state.progress && !["complete", "rolled-back", "error"].includes(state.progress.phase);
    if (!active || !state.progressChangedAt || Date.now() - state.progressChangedAt < 30000 ||
        state.progressStalled) return;
    state.progressStalled = true;
    paintUpdateProgress();
  }
  function render() {
    field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";
    field("updateChannelNote").textContent = (state.channel === "beta" ?
      "Beta is the test channel. A verified return to Stable remains available." :
      "Stable is the normal operating channel.") +
      (state.recoveryScanFailed ? " Recovery backups could not be checked. Reconnect folder access before installing another update." :
        state.recoveryScanPending ? " Checking recovery backups before permitting installation." :
        state.autoRecoverable ? " A verified interrupted software update will recover when you authorize the next Beta update. Your Workspace is preserved." :
        state.hasRecoverable ? " Resolve the interrupted update recovery before installing another update." : "");
    field("updateLastCheck").textContent = state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "Never";
    const result = state.check;
    availability.textContent = result?.status === "newer-version" ?
      `${result.channel === "beta" ? "Beta" : "Stable"} ${result.version} available` :
      result?.status === "channel-switch" ? `Return to Stable ${result.version} available` :
      result?.status === "up-to-date" ? "No newer update" :
      result?.status === "incompatible" ? `New version requires ${result.minimumCompatibleVersion}` :
      result?.status === "unavailable" ? "GitHub unavailable" :
      result?.status === "invalid-input" ? "Installed version cannot be compared" :
      installedChannel === state.channel ? `Installed ${installedChannel === "beta" ? "Beta" : "Stable"} ${installedVersion}; check for newer builds` : "Not checked";
    field("updateFolders").textContent = `Selected installation folder (parent of System Files): ${appRoot()?.name || "not connected"}. Runtime: System Files/. Dealership data: System Files/Workspace/. Update rollback backups: System Files/Workspace/backups/system-updates/.`;
    installButton.textContent = result?.status === "channel-switch" ? "Return to Stable" :
      "Update Current Installation";
    installButton.disabled = state.busy || state.freshResetUnresolved || recoveryHold() || !currentOffer() ||
      (state.hasRecoverable && state.channel !== "beta");
    freshButton.hidden = state.channel !== "beta" || result?.status === "channel-switch";
    freshButton.textContent = postUpdateReady() ? "Finish Fresh After Verified Update" : "Update to Fresh Installation";
    freshButton.disabled = !freshAvailable();
    field("updateChoiceNote").textContent = freshButton.hidden ?
      "Update Current Installation preserves all dealership information." :
      freshAvailable() ?
        (postUpdateReady() ?
          "The selected installation has a verified update journal for this running Beta. Finish Fresh requires selecting the exact installation again and two destructive confirmations. No new update is needed; this resets only its Workspace." :
          "Ready: the selected parent installation folder is shown above. Fresh permanently erases only its Workspace, including reports, settings, history and internal backups. Two separate warnings require your approval; the launcher and app runtime remain.") :
        state.postUpdateScanFailed ?
          "Fresh verification could not read the selected installation's update journal: " + state.postUpdateScanError +
          " Reconnect the correct working folder if needed, then select Retry Fresh Verification. No files were deleted." :
        state.postUpdateScanCompleted && !state.postUpdateFresh && !currentOffer() ?
          "No verified update journal matches the running Beta in this installation. Fresh is blocked; a ZIP copy alone is not proof of an in-app update. Reconnect the original updated folder or select Retry Fresh Verification. No data was deleted." :
          "Fresh requires either a newer verified Beta offer or a verified Beta update journal matching the installed version, plus connected folder access and no pending recovery. No files are deleted automatically.";
    const retryFresh=field("retryMoonDogFreshCheck");
    retryFresh.hidden = state.channel!=="beta" || !declaredBetaVersion || !appRoot() ||
      (!state.postUpdateScanFailed && (state.postUpdateScanPending || postUpdateReady() || !state.postUpdateScanCompleted));
    retryFresh.disabled=state.busy || state.postUpdateScanPending || state.recoveryScanPending;
    if(state.freshResetUnresolved)
      field("updateChoiceNote").textContent="Fresh Installation is unresolved in this tab after a verified update. Do not retry updates or use this copy until its durable recovery hold is reviewed. Other installations are unaffected.";
    field("checkMoonDogUpdate").disabled = state.busy;
    channel.disabled = state.busy;
    field("recoverMoonDogUpdate").hidden = !state.recoveryRequired && !state.hasRecoverable && !state.recoveryScanFailed;
    field("recoverMoonDogUpdate").textContent = state.recoveryScanFailed ? "Retry recovery check" : "Recover interrupted update";
    paintNotice();
  }

  async function check(manual) {
    if (state.busy) return;
    const checkedChannel = state.channel, checkedVersion = comparisonVersion, checkedRoot = appRoot();
    state.check = null;
    state.checkFor = null;
    clearPlan();
    clearProgress();
    state.busy = true;
    if (manual) {
      render(); // Automatic manifest checks never display checking state.
      await setProgress({ phase: "check", percent: null, label: "Checking for updates",
        detail: "Reading the verified update manifest" });
    }
    try {
      const result = await global.MoonDogUpdateCheck.check({ currentVersion: checkedVersion,
        channel: checkedChannel, manual });
      if (checkedChannel !== state.channel || checkedVersion !== comparisonVersion || checkedRoot !== appRoot()) return;
      // An offline/invalid automatic result is not a completed check. Retry later.
      if(!["silent","unavailable","invalid-input"].includes(result.status))
        state.lastCheck = new Date().toISOString();
      state.check = result;
      if (manual) state.dismissed = null;
      if (["newer-version", "channel-switch"].includes(result.status)) {
        state.checkFor = { channel: checkedChannel, version: checkedVersion, root: checkedRoot };
      }
      save();
      if (manual && result.status === "unavailable") status.textContent = "Could not reach GitHub. Try again later.";
      else if (manual && result.status === "invalid-input") status.textContent = "The installed version cannot be compared.";
      else if (manual) status.textContent = "Update check complete.";
      if (manual) await setProgress({ phase: result.status === "unavailable" || result.status === "invalid-input" ? "error" : "complete",
        percent: result.status === "unavailable" ? null : 100,
        label: result.status === "unavailable" ? "Update check unavailable" : "Update check complete",
        detail: result.status === "newer-version" ? "Verified update available. Choose an installation option." :
          result.status === "unavailable" ? "GitHub unavailable; retry when connected." : "Manifest check finished." });
    } catch (error) {
      if (manual) {
        status.textContent = "Update check stopped: " + (error?.message || "Unknown error");
        await setProgress({ phase: "error", percent: null, label: "Update check stopped",
          detail: error?.message || "Check could not finish." });
      }
    } finally { state.busy = false; render(); }
  }

  channel.addEventListener("change", () => {
    state.channel = channel.value === "beta" ? "beta" : "stable";
    // A successful check of the old channel must not delay checking this one.
    state.lastCheck = null;
    state.lastAutomatic = "";
    state.check = null;
    state.checkFor = null;
    clearPlan();
    clearProgress();
    save(); render();
    global.setTimeout?.(checkInBackground, 1500);
  });
  field("checkMoonDogUpdate").addEventListener("click", async () => {
    await check(true);
    // A manual update check must also recheck a previously failed Fresh journal,
    // otherwise the button can remain stuck after OneDrive read access returns.
    if(declaredBetaVersion && appRoot())await inspectPostUpdateFresh();
  });
  field("retryMoonDogFreshCheck").addEventListener("click", async () => {
    if(state.busy || state.postUpdateScanPending || !appRoot())return;
    await inspectPostUpdateFresh();
    if(state.postUpdateScanFailed)
      status.textContent="Fresh verification still blocked: "+state.postUpdateScanError;
    else if(!state.postUpdateFresh)
      status.textContent="No matching verified Beta update journal in this selected installation. No files were deleted.";
    else status.textContent="Verified Beta journal found in the selected installation. Fresh may now be selected with explicit confirmations.";
  });
  freshButton.addEventListener("click", async () => {
    if(!freshAvailable())return;
    // Chromium may share a saved IndexedDB handle between file launchers.
    // The user must explicitly choose THIS installation, before any awaits
    // that would lose Edge's transient folder-picker activation.
    const current=appRoot();
    if(typeof global.showDirectoryPicker!=="function"){
      status.textContent="Fresh Installation requires an Edge folder picker; no update was started.";
      return;
    }
    let chosen;
    try{chosen=await global.showDirectoryPicker({id:"moondog-fresh-selected-copy",mode:"readwrite"});}
    catch(error){
      if(error?.name!=="AbortError")
        status.textContent="Fresh Installation folder selection failed. No update was started.";
      return;
    }
    if(current!==appRoot()||!chosen||typeof chosen.isSameEntry!=="function"||
        !(await chosen.isSameEntry(current))){
      status.textContent="Selected folder does not match the connected installation. No update or deletion was performed.";
      return;
    }
    return postUpdateReady() ? finishPostUpdateFresh(chosen) : installUpdate(true,chosen);
  });
  installButton.addEventListener("click", () => installUpdate(false));
  async function finishPostUpdateFresh(confirmedRoot) {
    if(!freshAvailable() || !postUpdateReady() || !confirmedRoot)return;
    const selectedRoot=appRoot(),receipt=state.postUpdateFresh;
    let resetStarted=false,finished=false;
    state.busy=true;render();
    try{
      if(selectedRoot!==appRoot() || !(await confirmedRoot.isSameEntry(selectedRoot)))
        throw new Error("The installation folder changed. No data was deleted.");
      await setProgress({phase:"fresh-check",percent:null,label:"Verifying completed Beta update",
        detail:"Checking this installation's durable update journal and recovery status"});
      await refreshRecovery();
      if(selectedRoot!==appRoot() || state.recoveryRequired || state.hasRecoverable ||
          state.recoveryScanPending || state.recoveryScanFailed)
        throw new Error("Update recovery or installation identity is unresolved. Fresh is blocked.");
      // Re-read immediately before reset. A cached or cross-store browser value
      // can never become a destructive installer receipt.
      const current=await readVerifiedPostUpdate(selectedRoot,declaredBetaVersion);
      if(selectedRoot!==appRoot() || !current || current.backupName!==receipt.backupName ||
          current.sha256!==receipt.sha256 || current.version!==installedVersion)
        throw new Error("This installation's verified Beta update receipt changed. No data was deleted.");
      const reset=global.__moondogFreshInstallation?.resetSelectedFreshInstallation;
      if(typeof reset!=="function")throw new Error("Fresh reset is not available.");
      resetStarted=true;
      const outcome=await reset({selectedRoot,expectedRoot:selectedRoot,verifiedInstall:current,
        onProgress:event=>setProgress({...event,percent:event.percent??null})});
      if(outcome?.status==="cancelled"){
        status.textContent="Fresh Installation cancelled. Existing store data is preserved.";
        clearProgress();
      }else if(outcome?.status==="fresh"){
        finished=true;
        state.postUpdateFresh=null;
        status.textContent="Selected Workspace cleared and verified. Reloading Guided Setup.";
        await setProgress({phase:"complete",percent:100,label:"Fresh Installation verified",
          detail:"Only the selected installation was reset; loading Guided Setup"});
      }else throw new Error("Fresh reset was not verified.");
    }catch(error){
      // App.js marks ONLY contention detected before creating the durable
      // reset hold or touching Workspace data. A busy preflight is retryable;
      // an unknown failure after reset invocation remains fail-closed.
      const safePreflight=resetStarted && error?.code==="MOONDOG_FRESH_PRECHECK_BUSY" &&
        error?.freshMutationStarted===false;
      if(resetStarted&&!safePreflight)state.freshResetUnresolved=true;
      status.textContent=safePreflight?
        "Fresh did not start: another Workspace task was active. No Fresh data was deleted. Try again after the task finishes.":
        (resetStarted?"Fresh Installation unresolved. ":"")+
        (error?.message||"Fresh could not be verified.");
      await setProgress({phase:"error",percent:null,
        label:safePreflight?"Fresh postponed safely":"Fresh Installation blocked",
        detail:safePreflight?
          "Another Workspace task is active. No Fresh reset started. Retry after it finishes.":
          error?.message||"No clean-store state can be claimed."});
    }finally{
      state.busy=false;render();
      if(finished)reloadVerifiedUpdate(installedVersion);
    }
  }
  async function installUpdate(fresh = false, confirmedRoot = null) {
    if (fresh && (!freshAvailable()||!confirmedRoot)) return;
    // Never reconstruct a destructive choice or installation identity from shared storage.
    const selectedRoot = appRoot();
    if(fresh && !(await confirmedRoot.isSameEntry(selectedRoot))){
      status.textContent="Selected folder no longer matches the connected installation. No update was started.";
      return;
    }
    if (state.busy || recoveryHold() || !currentOffer() || (state.hasRecoverable && state.channel !== "beta")) return;
    const offered = state.check, offeredFor = state.checkFor;
    let verifiedReloadVersion = null, verifiedInstalledVersion = null,
      freshOutcomeStatus = null, freshPostInstall = false;
    state.busy = true; render();
    clearPlan();
    await setProgress({ phase: "verify-package", percent: 5, label: "Verifying update package", detail: "Downloading and checking the selected update" });
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
      await setProgress({ phase: "verify-package", percent: 15, label: "Update package verified", detail: "Package integrity confirmed" });
      await setProgress({ phase: "plan", percent: 20, label: "Preparing file changes", detail: "Building a safe installation plan" });
      // Use the selected installation as the authority for both the runtime
      // and rollback Workspace; a concurrent reconnect must not mix stores.
      if (!selectedRoot || typeof selectedRoot.getDirectoryHandle !== "function" || selectedRoot !== appRoot())
        throw new Error("Selected installation changed before update preview; no files were modified.");
      const selectedSystem = await selectedRoot.getDirectoryHandle("System Files", { create: false });
      if (selectedRoot !== appRoot())
        throw new Error("Selected installation changed while opening runtime; no files were modified.");
      const plan = await global.MoonDogPackagePlan.dryRun({ verifiedPackage: verified,
        appDirectoryHandle: selectedSystem, trustedAllowlist: catalog });
      if (selectedRoot !== appRoot())
        throw new Error("Selected installation changed during update preview; no files were modified.");
      await setProgress({ phase: "plan", percent: 25, label: "File changes ready", detail: "Review the planned application changes" });
      const summary = ["Add", "Replace", "Delete", "Unchanged", "Rejected"].map(label =>
        `${label}: ${plan[label.toLowerCase()].length ? plan[label.toLowerCase()].map(item =>
          typeof item === "string" ? item : `${item.path} (${item.reason})`).join(", ") : "none"}`).join("\n");
      planText.textContent = summary;
      planText.hidden = false;
      if (plan.rejected.length) throw new Error("Update rejected. No application files changed.");
      status.textContent = "Review the file changes before confirming.";
      if (!global.confirm(`Install Service Operations Dashboard ${verified.version}?\n\n${summary}\n\n${state.autoRecoverable ? "The verified interrupted software update will be safely recovered first. Your Workspace is preserved.\n\n" : ""}A rollback backup in System Files/Workspace/backups/system-updates/ will be verified before any application file is changed.`)) {
        status.textContent = "Installation cancelled. No application files changed.";
        clearProgress();
        return;
      }
      // Always verify recovery immediately before the first install mutation,
      // even if the initial connection event has not completed its scan.
      await refreshRecovery();
      if (recoveryHold() || (state.hasRecoverable && verified.channel !== "beta") || offeredFor.root !== appRoot()) {
        throw new Error("Update recovery backups are unresolved or cannot be verified. Check folder access and resolve recovery before installing.");
      }
      await setProgress({ phase: "install", percent: 28, label: "Starting installation", detail: "Please keep this window open" });
      if (selectedRoot !== appRoot())
        throw new Error("Selected installation changed before update installation; no files were modified.");
      const outcome = await global.MoonDogUpdateInstall.apply({ verifiedPackage: verified,
        appDirectoryHandle: selectedSystem, workspaceDirectoryHandle: selectedRoot,
        trustedAllowlist: catalog, expectedPlan: plan, confirmed: true,
        onProgress: event => setProgress({ ...event, percent: Math.round(28 + (Math.max(0, Math.min(100, Number(event.percent) || 0)) * .72)) }) });
      status.textContent = outcome.status === "installed" ?
        `Update verified. Reloading to use version ${outcome.version}. Rollback backup saved in System Files/Workspace/backups/system-updates/.` :
        outcome.status === "rolled-back" ? "Update failed and original app files were verified restored. Rollback backup saved in System Files/Workspace/backups/system-updates/." :
        outcome.status === "recovery-required" ? `Update stopped. Recovery is required from System Files/Workspace/backups/system-updates/; do not retry installation. ${outcome.reason}` :
        `Update stopped without a verified installation. ${outcome.reason || outcome.status}`;
      if (outcome.status === "recovery-required") { state.recoveryRequired = true; save(); await setProgress({ phase: "error", percent: state.progress?.percent || 90, label: "Recovery required", detail: "Installation stopped. Use the recovery action before trying another update." }); }
      else if (outcome.status === "rolled-back") await setProgress({ phase: "rolled-back", percent: 100, label: "Previous version restored", detail: "The update failed, but rollback completed and was verified." });
      else if (outcome.status !== "installed") await setProgress({ phase: "error", percent: state.progress?.percent || 25, label: "Update stopped", detail: outcome.reason || "Installation did not complete." });
      if (outcome.status === "installed") {
        state.recoveryRequired=false;state.autoRecoverable=false;state.hasRecoverable=false;save();
        verifiedInstalledVersion=outcome.version;
        if (fresh) {
          freshPostInstall = true;
          // The selected root, channel and exact package receipt must match
          // after the verified install and before any deletion request.
          if (selectedRoot !== appRoot() || selectedRoot !== offeredFor.root ||
              verified.channel !== "beta" || state.channel !== "beta" ||
              verified.version !== outcome.version ||
              !/^[0-9a-f]{64}$/.test(verified.sha256 || ""))
            throw new Error("Fresh reset blocked: verified Beta receipt or selected installation changed.");
          await refreshRecovery();
          if (selectedRoot !== appRoot() || state.recoveryRequired || state.hasRecoverable ||
              state.recoveryScanPending || state.recoveryScanFailed)
            throw new Error("Fresh reset blocked: update recovery is unresolved.");
          const reset = global.__moondogFreshInstallation?.resetSelectedFreshInstallation;
          if (typeof reset !== "function")
            throw new Error("Fresh reset unavailable in this runtime.");
          await setProgress({phase:"fresh-check",percent:null,label:"Verifying Fresh Installation",
            detail:"Verified Beta installed; checking the exact selected Workspace"});
          const freshOutcome = await reset({
            selectedRoot, expectedRoot:selectedRoot,
            verifiedInstall:{status:"installed",version:outcome.version,
              channel:verified.channel,sha256:verified.sha256,backupName:outcome.backupName},
            onProgress:event=>setProgress({...event,percent:event.percent??null})
          });
          if (freshOutcome.status === "cancelled") {
            freshOutcomeStatus = "cancelled";
            status.textContent = "Beta installed and verified. Fresh deletion cancelled; existing dealership data remains.";
          } else if (freshOutcome.status === "fresh") {
            freshOutcomeStatus = "fresh";
            status.textContent = "Beta installed, selected Workspace reset verified. Reloading into Guided Setup.";
          } else throw new Error("Fresh reset returned no verified completion.");
        }
        // This receipt is written ONLY after the installer has verified the new
        // runtime. The next version's connected app may then run local follow-up.
        // No Workspace contents or source files are included in this marker.
        // A Fresh reset cleared the selected Workspace, including learned sources.
        // Never publish its update receipt into a browser-profile-wide key:
        // another installation sharing this origin must remain independent.
        if(freshOutcomeStatus!=="fresh") {
          try {
            global.localStorage?.setItem("moondog-verified-update-followup-v1",
              JSON.stringify({ version: outcome.version, verifiedAt: new Date().toISOString() }));
          } catch (_) { /* Browser storage may be restricted; manual source retry remains available. */ }
        }
        state.check = null;
        state.checkFor = null;
        state.dismissed = null;
        clearPlan();
        installedVersion = outcome.version;
        comparisonVersion = outcome.version;
        installedChannel = verified.channel;
        field("updateInstalledVersion").textContent = installedVersion;
        field("updateInstalledChannel").textContent = installedChannel === "beta" ? "Beta" : "Stable";
        await setProgress({phase:"complete",percent:100,
          label:freshOutcomeStatus==="fresh"?"Fresh Installation verified":"Update installed",
          detail:freshOutcomeStatus==="fresh"?"Selected Workspace reset verified. Reloading into Guided Setup.":
            freshOutcomeStatus==="cancelled"?"Deletion cancelled. Existing data preserved; reloading verified Beta.":
              "Installation verified. Reloading the dashboard automatically..."});
        verifiedReloadVersion = outcome.version;
      }
    } catch (error) {
      // A verified Beta followed by an explicitly typed, pre-mutation busy
      // rejection is NOT an interrupted Fresh deletion. The source reset
      // function emits this code only before writing the durable reset marker.
      // Reload the verified Beta so the user's next Fresh choice can be made
      // against the exact installed journal, after background tasks settle.
      const safePreflight=Boolean(fresh&&freshPostInstall&&verifiedInstalledVersion &&
        error?.code==="MOONDOG_FRESH_PRECHECK_BUSY" &&
        error?.freshMutationStarted===false);
      if(safePreflight){
        installedVersion=verifiedInstalledVersion;
        comparisonVersion=verifiedInstalledVersion;
        installedChannel="beta";
        field("updateInstalledVersion").textContent=installedVersion;
        field("updateInstalledChannel").textContent="Beta";
        state.check=null;state.checkFor=null;state.dismissed=null;
        state.postUpdateFresh=null;clearPlan();
        // Do not automatically reload while another Workspace operation is
        // active: that could interrupt the unrelated writer which caused this
        // safe preflight rejection in the first place.
        status.textContent="Beta "+verifiedInstalledVersion+
          " installed and verified. Fresh did not start because another Workspace task was active. No data was deleted by Fresh. After the other task finishes, refresh this tab.";
        await setProgress({phase:"complete",percent:100,
          label:"Beta installed; Fresh safely deferred",
          detail:"Leave the window open while Workspace work finishes. Then press Ctrl+R to load the verified Beta and choose Finish Fresh."});
      }else{
        // Unknown failures after an installer succeeded may involve deletion.
        // Preserve the tab hold and any installation-specific recovery marker.
        if(fresh && freshPostInstall) state.freshResetUnresolved=true;
        status.textContent = (fresh && freshPostInstall
          ? "Fresh Installation incomplete; updates in this tab are blocked. "
          : "")+(error.message || "Update stopped before installation.");
        await setProgress({ phase: "error", percent: state.progress?.percent || 5,
          label: "Update stopped", detail: error.message || "Installation could not continue." });
      }
    } finally {
      state.busy = false;
      render();
      if (state.recoveryRequired) refreshRecovery();
      // Reload only after verified installation, receipt and success UI have completed.
      // Rejected, cancelled, rolled-back and recovery-required outcomes never reload.
      if (verifiedReloadVersion) reloadVerifiedUpdate(verifiedReloadVersion);
    }
  }
  field("recoverMoonDogUpdate").addEventListener("click", async () => {
    if (state.busy || state.recoveryScanPending) return;
    if (!appRoot()) {
      status.textContent = "Connect Service Operations Dashboard in a browser with folder access first.";
      return;
    }
    if (state.recoveryScanFailed) {
      // A retry may update the recovery inventory, but it must never directly
      // trigger installation or restore. User approval remains separate.
      await refreshRecovery();
      status.textContent = state.recoveryScanFailed ?
        "Recovery backup check failed. Check folder access and try again. No files were changed." :
        state.hasRecoverable ?
          "Interrupted update backups were found. Select Recover interrupted update to review a restore." :
          "Recovery check complete. No interrupted update backups were found.";
      return;
    }
    // Recovery must pin the same selected installation for its rollback files
    // and Workspace. Reconnecting another store during any await fails closed.
    const recoveryRoot = appRoot();
    try {
      const backups = await global.MoonDogUpdateInstall.listBackups(recoveryRoot);
      if (recoveryRoot !== appRoot())
        throw new Error("Selected installation changed while checking recovery backups. Nothing was restored.");
      if (!backups.length) { status.textContent = "No update rollback backups were found in System Files/Workspace/backups/system-updates/."; return; }
      const selection = backups.length === 1 ? "1" : global.prompt(`Select an update backup number from System Files/Workspace/backups/system-updates/:\n\n${backups.map((_, index) => `Backup ${index + 1}`).join("\n")}`, "1");
      const backupName = /^\d+$/.test(selection || "") ? backups[Number(selection) - 1] : null;
      if (!backupName) { status.textContent = "Recovery cancelled or backup not found."; return; }
      if (!global.confirm(`Restore Service Operations Dashboard application files from update backup ${selection} in selected installation “${recoveryRoot.name || "MoonDog"}”?`)) return;
      if (recoveryRoot !== appRoot())
        throw new Error("Selected installation changed after recovery confirmation. Nothing was restored.");
      state.busy = true; render();
      await setProgress({ phase: "recovery", percent: 5, label: "Preparing recovery", detail: "Checking the selected rollback backup" });
      const catalog = [...new Set([...(global.__moondogMaintenance?.runtimePaths || []), "assets/moondog-update-check.js",
        "assets/moondog-update-verify.js", "assets/moondog-update-plan.js",
        "assets/moondog-update-model.js", "assets/moondog-update-install.js",
        "assets/moondog-update-settings.js"])];
      const recoverySystem = await recoveryRoot.getDirectoryHandle("System Files", { create: false });
      if (recoveryRoot !== appRoot())
        throw new Error("Selected installation changed while opening recovery files. Nothing was restored.");
      const outcome = await global.MoonDogUpdateInstall.recover({ appDirectoryHandle: recoverySystem,
        workspaceDirectoryHandle: recoveryRoot, backupName, trustedAllowlist: catalog,
        confirmed: true, onProgress: event => setProgress(event) });
      if (recoveryRoot !== appRoot())
        throw new Error("Selected installation changed during recovery. Verify the original store before proceeding.");
      status.textContent = outcome.status === "restored" ?
        "Original application files were verified restored. Restart Service Operations Dashboard." :
        `Recovery could not be verified. Keep the backup intact. ${outcome.reason || ""}`;
      if (outcome.status === "restored") { state.recoveryRequired = false; save(); await setProgress({ phase: "complete", percent: 100, label: "Recovery complete", detail: "Original application files were verified restored." }); await refreshRecovery(); }
      else await setProgress({ phase: "error", percent: state.progress?.percent || 15, label: "Recovery could not be verified", detail: outcome.reason || "Keep the rollback backup intact." });
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "Recovery stopped: " + error.message;
      await setProgress({ phase: "error", percent: state.progress?.percent || 5, label: "Recovery stopped", detail: error.message || "Recovery could not continue." });
    } finally { state.busy = false; render(); }
  });
  // Lightweight visible-only metadata checks. Newly published Betas should
  // not wait until tomorrow; unavailable manifests get a bounded retry.
  const AUTOMATIC_RECHECK_MS = 30 * 60 * 1000;
  const AUTOMATIC_RETRY_MS = 5 * 60 * 1000;
  function checkInBackground() {
    if (document.hidden || !appRoot() || state.busy) return;
    const at = Date.now();
    const checkedAt = Date.parse(state.lastCheck || "") || 0;
    const attemptedAt = Date.parse(state.lastAutomatic || "") || 0;
    if (checkedAt > 0 && at >= checkedAt && at - checkedAt < AUTOMATIC_RECHECK_MS) return;
    if (attemptedAt > 0 && at >= attemptedAt && at - attemptedAt < AUTOMATIC_RETRY_MS) return;
    state.lastAutomatic = new Date(at).toISOString();
    save();
    void check(false); // No package download or user-visible error on automatic checks.
  }
  function scheduleNextCheck() {
    const timer = global.setTimeout?.(() => { checkInBackground(); scheduleNextCheck(); }, AUTOMATIC_RETRY_MS);
    timer?.unref?.(); // Node UI tests must not remain open; browsers use normal timers.
  }
  paintUpdateProgress();
  global.setInterval?.(checkProgressStall, 5000);
  render();
  document.addEventListener("moondog-data", () => { render(); inspectInstalledTestVersion(); refreshRecovery(); global.setTimeout?.(checkInBackground, 1500); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) global.setTimeout?.(checkInBackground, 1500); });
  global.addEventListener?.("focus", () => global.setTimeout?.(checkInBackground, 1500));
  inspectInstalledTestVersion();
  global.setTimeout?.(checkInBackground, 2000);
  scheduleNextCheck();
})(globalThis);

#!/usr/bin/env node
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL, fileURLToPath } from "node:url";

const launcher = process.argv[2];
if (!launcher) throw new Error("usage: smoke_beta_package.mjs <clean-install-launcher.html>");

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installRoot = path.dirname(path.resolve(launcher));
const appRoot = path.join(installRoot, "System Files");
const manifest = JSON.parse(fs.readFileSync(path.join(repository, "updates/manifest.json"), "utf8"));
const beta = manifest.beta;
const packageName = `moondog-${beta.version}.json`;
const packagePath = `updates/packages/${packageName}`;
const expectedPackageUrl = `https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/${packagePath}`;
const packageBytes = fs.readFileSync(path.join(repository, packagePath));
const packageHash = createHash("sha256").update(packageBytes).digest("hex");
if (beta.packageUrl !== expectedPackageUrl || beta.sha256 !== packageHash) {
  throw new Error("The Beta manifest does not identify the exact local package bytes.");
}
if (manifest.stable.version !== "0.10.17" || beta.migrationRequired !== false) {
  throw new Error("Beta smoke requires the unchanged Stable channel and a no-migration Beta.");
}

const runtimeSource = fs.readFileSync(path.join(repository, "assets/app.js"), "utf8");
const runtimeCatalog = runtimeSource.match(/const HANDOFF_RUNTIME_PATHS=(\[[^;]+\]);/s);
if (!runtimeCatalog) throw new Error("The reviewed runtime path catalog is unavailable.");
const trustedAllowlist = JSON.parse(runtimeCatalog[1]).filter(file => file === "index.html" || file.startsWith("assets/"));

const notFound = () => Object.assign(new Error("File or directory not found."), { name: "NotFoundError" });
function directoryHandle(folderPath) {
  return {
    name: path.basename(folderPath),
    kind: "directory",
    _path: folderPath,
    isSameEntry: async other => other?._path === folderPath,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getDirectoryHandle: async (name, options = {}) => {
      if (!name || name !== path.basename(name) || name === "." || name === "..") throw new Error("Invalid directory name.");
      const child = path.join(folderPath, name);
      if (!fs.existsSync(child)) {
        if (!options.create) throw notFound();
        fs.mkdirSync(child);
      }
      if (!fs.statSync(child).isDirectory()) throw new Error("Expected a directory.");
      return directoryHandle(child);
    },
    getFileHandle: async (name, options = {}) => {
      if (!name || name !== path.basename(name) || name === "." || name === "..") throw new Error("Invalid file name.");
      const filePath = path.join(folderPath, name);
      if (!fs.existsSync(filePath) && !options.create) throw notFound();
      if (fs.existsSync(filePath) && !fs.statSync(filePath).isFile()) throw new Error("Expected a file.");
      return {
        getFile: async () => {
          if (!fs.existsSync(filePath)) throw notFound();
          const bytes = fs.readFileSync(filePath);
          return { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
        createWritable: async () => {
          let bytes;
          return {
            write: async value => { bytes = Buffer.from(value); },
            close: async () => { fs.writeFileSync(filePath, bytes); },
            abort: async () => {}
          };
        }
      };
    },
    removeEntry: async name => {
      if (!name || name !== path.basename(name) || name === "." || name === "..") throw new Error("Invalid entry name.");
      const entry = path.join(folderPath, name);
      if (!fs.existsSync(entry)) throw notFound();
      fs.rmSync(entry, { recursive: false });
    },
    entries: async function* () {
      for (const name of fs.readdirSync(folderPath)) {
        const entry = path.join(folderPath, name);
        yield [name, fs.statSync(entry).isDirectory() ? directoryHandle(entry) : null];
      }
    }
  };
}

// This is an untouched extracted clean-install layout. The smoke test must
// never fabricate the compatibility page that the installed updater requires.
const compatibilityIndex = path.join(installRoot, "index.html");
const stableHtml = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
if (!/<!doctype html>\s*<html\s+lang="en"><head>/i.test(stableHtml) ||
    stableHtml.toLowerCase().split("<head>").length !== 2 || /<base\b/i.test(stableHtml)) {
  throw new Error("Clean-install HTML cannot produce a safe origin compatibility page.");
}
const expectedCompatibility = stableHtml.replace("<head>", '<head><base href="System Files/">');
if (!fs.existsSync(compatibilityIndex)) {
  throw new Error("Unmodified clean-install ZIP has no root index.html; fresh-install update is not safe.");
}
if (fs.readFileSync(compatibilityIndex, "utf8") !== expectedCompatibility) {
  throw new Error("Clean-install root index.html does not match the bundled application.");
}
const syntheticState = path.join(appRoot, "Workspace", "data", "current-state.json");
fs.mkdirSync(path.dirname(syntheticState), { recursive: true });
fs.writeFileSync(syntheticState, '{"synthetic":true}\n');
const originalStateHash = createHash("sha256").update(fs.readFileSync(syntheticState)).digest("hex");

const context = vm.createContext({ URL, TextDecoder, TextEncoder, Uint8Array, atob, crypto: webcrypto });
for (const file of ["verify", "package-plan", "apply-design-model", "install"]) {
  vm.runInContext(fs.readFileSync(path.join(repository, "updates", `${file}.js`), "utf8"), context);
}
const manifestUrl = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json";
const fetcher = async url => {
  if (url === manifestUrl) return { ok: true, json: async () => manifest };
  if (url === beta.packageUrl) {
    let sent = false;
    return {
      ok: true,
      headers: { get: () => String(packageBytes.length) },
      body: { getReader: () => ({
        read: async () => sent ? { done: true } : (sent = true, { done: false, value: packageBytes }),
        cancel: async () => {}
      }) }
    };
  }
  throw new Error("Unexpected package verification URL.");
};

const verifiedPackage = await context.MoonDogPackageVerification.verify({
  channel: "beta", fetcher, subtle: webcrypto.subtle
});
if (verifiedPackage.status !== "verified" || verifiedPackage.version !== beta.version) {
  throw new Error(`Beta package verification failed: ${verifiedPackage.status} ${verifiedPackage.reason || ""}`);
}
const installation = JSON.parse(fs.readFileSync(path.join(installRoot, "INSTALLATION-MANIFEST.json"), "utf8"));
if (installation.version !== manifest.stable.version || installation.updateChannel !== "stable") {
  throw new Error("The Beta update did not start from the current Stable clean-install layout.");
}
const appDirectoryHandle = directoryHandle(appRoot);
const workspaceDirectoryHandle = directoryHandle(installRoot);
const expectedPlan = await context.MoonDogPackagePlan.dryRun({
  verifiedPackage, appDirectoryHandle, trustedAllowlist, subtle: webcrypto.subtle
});
if (expectedPlan.rejected.length || expectedPlan.add.length || expectedPlan.delete.length) {
  throw new Error(`Beta package plan was not a valid in-place runtime update: ${JSON.stringify(expectedPlan)}`);
}
const ordinaryStarted = performance.now();
const result = await context.MoonDogUpdateInstall.apply({
  verifiedPackage, appDirectoryHandle, workspaceDirectoryHandle,
  trustedAllowlist, expectedPlan, confirmed: true, subtle: webcrypto.subtle
});
if (result.status !== "installed" || result.version !== beta.version) {
  throw new Error(`Beta package installation failed: ${JSON.stringify(result)}`);
}
if (createHash("sha256").update(fs.readFileSync(syntheticState)).digest("hex") !== originalStateHash) {
  throw new Error("The Beta update changed protected synthetic Workspace state.");
}
console.log("Verified Stable-to-Beta installation and protected synthetic Workspace invariance", beta.version);
const ordinaryUpdateMs = performance.now() - ordinaryStarted;

// Damage only this clean-install smoke fixture, after its synthetic state was
// created and verified above. Use the real verified package and installer;
// never manufacture repaired runtime bytes or invoke Fresh.
const repairedPaths = ["index.html", "assets/app.js"];
for (const relative of repairedPaths) fs.unlinkSync(path.join(appRoot, relative));
const repairPlan = await context.MoonDogPackagePlan.dryRun({
  verifiedPackage, appDirectoryHandle, trustedAllowlist, subtle: webcrypto.subtle
});
assert.equal(repairPlan.rejected.length, 0);
const repairEvents = [];
const repairStarted = performance.now();
const repaired = await context.MoonDogUpdateInstall.apply({
  verifiedPackage, appDirectoryHandle, workspaceDirectoryHandle, trustedAllowlist,
  expectedPlan: repairPlan, confirmed: true, subtle: webcrypto.subtle,
  onProgress: event => repairEvents.push({phase: event.phase, label: event.label})
});
const repairMs = performance.now() - repairStarted;
assert.equal(repaired.status, "installed", repaired.reason);
for (const label of ["Checking", "Repairing", "Verifying"])
  assert.ok(repairEvents.some(event => event.label === label), `Missing installer phase: ${label}`);
const installedHashes = () => repairedPaths.map(relative =>
  createHash("sha256").update(fs.readFileSync(path.join(appRoot, relative))).digest("hex"));
const repairedHashes = installedHashes();
for (const [index, relative] of repairedPaths.entries()) {
  const entry = JSON.parse(packageBytes).files.find(file => file.path === relative && file.action === "put");
  assert.ok(entry, `Verified package must carry repair bytes: ${relative}`);
  assert.equal(repairedHashes[index], entry.sha256, `Repaired bytes differ from verified package: ${relative}`);
}
const repeatPlan = await context.MoonDogPackagePlan.dryRun({
  verifiedPackage, appDirectoryHandle, trustedAllowlist, subtle: webcrypto.subtle
});
const repeatStarted = performance.now();
const repeated = await context.MoonDogUpdateInstall.apply({
  verifiedPackage, appDirectoryHandle, workspaceDirectoryHandle, trustedAllowlist,
  expectedPlan: repeatPlan, confirmed: true, subtle: webcrypto.subtle
});
const repeatUpdateMs = performance.now() - repeatStarted;
assert.equal(repeated.status, "installed", repeated.reason);
assert.deepEqual(installedHashes(), repairedHashes);
assert.equal(createHash("sha256").update(fs.readFileSync(syntheticState)).digest("hex"), originalStateHash);
console.log("Synthetic production updater repair timing", JSON.stringify({
  scope: "single local filesystem sample per path; VM production installer; excludes browser permission, network and physical-device latency; phase callbacks are not rendered UX proof",
  ordinaryUpdateMs, repairMs, repeatUpdateMs, repairedPaths
}));

const browser = await chromium.launch({ headless: true, channel: process.env.MOONDOG_BROWSER_CHANNEL || undefined });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
try {
  await page.goto(pathToFileURL(path.resolve(launcher)).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForURL(url => url.protocol === "file:" && url.pathname.endsWith("/index.html"), { timeout: 10000 });
  await page.waitForFunction(expected => globalThis.MoonDogInstalledVersion === expected, beta.version, { timeout: 15000 });
  const runtime = await page.evaluate(() => ({
    version: globalThis.MoonDogInstalledVersion,
    title: document.title,
    ready: document.readyState
  }));
  if (runtime.version !== beta.version || runtime.ready !== "complete" ||
      !/Service Operations Dashboard/i.test(runtime.title) || pageErrors.length) {
    throw new Error(`Installed Beta runtime did not launch cleanly: ${JSON.stringify({ runtime, pageErrors })}`);
  }
  const workbookSource = new TextDecoder().decode(
    Buffer.from(JSON.parse(packageBytes).files.find(file => file.path === "assets/app.js")?.contentBase64 || "", "base64")
  );
  // Exercise the actual packaged generator with the browser's pinned XLSX,
  // ZIP and XML implementations. No connected Workspace or real identities.
  const sourceText = workbookSource || runtimeSource;
  function section(start, end) {
    const a = sourceText.indexOf(start), b = sourceText.indexOf(end, a + start.length);
    if (a < 0 || b <= a) throw new Error(`Workbook smoke extraction failed: ${start}`);
    return sourceText.slice(a, b);
  }
  const workbookHarness = [
    section("  async function protectEditableWorkbook(", "  function workbookSheetName("),
    section("  function workbookSheetName(", "  function validateReturnedWorkbookFreshness("),
    section("  function workbookIssuanceId(", "  async function validateReturnedWorkbookIssuance("),
    section("  async function workbookBytes(", "  async function generateWorkbook("),
    section("  function selectableHandoffAdvisors()", "  const selectedHandoffCodes"),
    section("  const selectedHandoffCodes", "  async function generateAdvisorHandoffWorkbook(")
  ].join("\n");
  const workbookResult = await page.evaluate(async source => {
    const model = {settings: {storeName: "Synthetic", advisors: {}}, state: {records: []}};
    const names = {};
    for (let i = 1; i <= 9; i++) {
      const code = String(100 + i), name = i === 9 ? "Synthetic / long advisor name exceeding Excel limits" : `Synthetic Advisor ${i}`;
      names[code] = name;
      model.settings.advisors[code] = {number: code, name, active: i !== 8};
      model.state.records.push({id: `synthetic-${i}`, ro: `DEMO-${i}`, advisorCode: code, advisor: name, management: {}});
    }
    const make = new Function("model", "ADVISOR_NAMES", `
      const text = value => String(value ?? ""), norm = value => text(value).trim().toLowerCase();
      const RETURN_ID_HEADER="__MoonDog RO ID", RETURN_BASELINE_HEADER="__MoonDog Last Update", RETURN_STATUS_ID_HEADER="__MoonDog Status ID", RETURN_ISSUANCE_CELL="Q1";
      const supervisorAdvisorCodes=()=>Object.keys(ADVISOR_NAMES), statusForRecord=()=>"Open", normalizeCommunication=value=>value||"", resolveStatusId=()=>"open", managementStatuses=()=>["Open"], COMMUNICATION_STATUSES=["", "Contacted"], validAdvisorIdentity=(code,name)=>Boolean(code&&name);
      const ui={"view-open-ro":document.querySelector("#view-open-ro")}, run=operation=>operation();
      const generateAdvisorHandoffWorkbook=()=>{throw Error("Selection smoke must not write a Workspace");};
      ${source}
      return {workbookBytes,validateWorkbookBytes,selectableHandoffAdvisors,ensureAdvisorHandoffUi,renderAdvisorHandoff};
    `);
    const api = make(model, names), all = Object.keys(names);
    model.root = {};
    document.getElementById("handoffTools")?.remove();
    api.ensureAdvisorHandoffUi();
    document.getElementById("handoffToggle").click();
    if (!document.getElementById("handoffGenerate").disabled) throw Error("Zero-selection export is enabled");
    const boxes=[...document.querySelectorAll("#handoffList input")];
    if(boxes.length!==9)throw Error("Handoff UI has a fixed advisor limit");
    for(const count of [1,3]) {
      document.getElementById("handoffClear").click();
      for(let i=0;i<count;i++) { const box=document.querySelectorAll("#handoffList input")[i]; box.checked=true; box.dispatchEvent(new Event("change",{bubbles:true})); }
      if(!document.getElementById("handoffCount").textContent.startsWith(count+" of 9")||document.getElementById("handoffGenerate").disabled)throw Error("Handoff subset selection failed");
    }
    document.getElementById("handoffSelectAll").click();
    if(!document.getElementById("handoffCount").textContent.startsWith("9 of 9"))throw Error("Select all failed");
    document.getElementById("handoffClear").click();
    if(!document.getElementById("handoffGenerate").disabled)throw Error("Clear left export enabled");
    if (api.selectableHandoffAdvisors().length !== 9) throw Error("Handoff roster lost an advisor");
    let emptyRejected = false;
    try { await api.workbookBytes("", [], true); } catch (_) { emptyRejected = true; }
    if (!emptyRejected) throw Error("Empty handoff was accepted");
    for (const codes of [[all[0]], all.slice(0, 3), all]) {
      const bytes = await api.workbookBytes("", codes, true);
      const validation = await api.validateWorkbookBytes(bytes, "", codes, true);
      if (validation.recordCount !== codes.length || validation.expectedSheets.length !== codes.length) throw Error("Handoff count mismatch");
    }
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const official = await api.workbookBytes(id);
    const validation = await api.validateWorkbookBytes(official, id);
    if (validation.issuanceId !== id || validation.recordCount !== 9) throw Error("Official issuance did not round-trip");
    return {advisors: 9, subsets: [1, 3, 9], uiSelections: [0,1,3,9], emptyRejected, officialIssuance: "verified"};
  }, workbookHarness);
  console.log("Verified packaged Supervisor Workbook and outbound handoff XLSX round trips", workbookResult);

  // Render the installed Settings update UI in the real file:// browser.
  // The earlier smoke uses the production verified-package installer and real
  // synthetic filesystem. This second UI-only probe substitutes explicit
  // callbacks and never writes a local Workspace or application file.
  const syntheticNextVersion = beta.version.replace(/beta\.(\d+)$/,
    (_whole, number) => "beta." + (Number(number) + 1));
  assert.notEqual(syntheticNextVersion, beta.version);
  await page.locator('.nav-item[data-view="settings"]').click({timeout:8000});
  await page.locator("#settings-update").waitFor({state:"visible", timeout:8000});
  await page.evaluate(nextVersion => {
    const missing = () => Object.assign(new Error("Synthetic missing entry"), {name:"NotFoundError"});
    const system = {name:"System Files", getDirectoryHandle:async () => {throw missing();}};
    const root = {
      name:"Synthetic repair UX installation",
      getDirectoryHandle:async (name, options) => {
        if(name==="System Files" && options?.create===false)return system;
        throw missing();
      }
    };
    globalThis.__moondogSettingsModel = {
      ...(globalThis.__moondogSettingsModel || {}), applicationRoot:root
    };
    globalThis.MoonDogUpdateInstall.listBackups = async () => [];
    globalThis.MoonDogUpdateCheck.check = async () =>
      new Promise(resolve => {
        globalThis.__moondogResolveCheck = () => resolve({
          status:"newer-version", version:nextVersion, channel:"beta",
          packageUrl:"https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/synthetic",
          sha256:"a".repeat(64)
        });
      });
    globalThis.MoonDogPackageVerification.verify = async () => ({
      status:"verified", version:nextVersion, channel:"beta",
      sha256:"a".repeat(64), migrationRequired:false,
      minimumCompatibleVersion:"0.10.9"
    });
    globalThis.MoonDogPackagePlan.dryRun = async () => ({
      add:[], replace:["assets/app.js"], delete:[], unchanged:[], rejected:[]
    });
    globalThis.MoonDogUpdateInstall.apply = async ({onProgress}) =>
      new Promise(resolve => {
        globalThis.__moondogEmitRepairPhase = event => onProgress(event);
        globalThis.__moondogFinishRepair = () => resolve({
          status:"stopped",reason:"Synthetic permission denied; no files changed."
        });
      });
    globalThis.confirm = () => true;
    const channel = document.getElementById("updateChannel");
    channel.value = "beta";
    channel.dispatchEvent(new Event("change", {bubbles:true}));
    document.dispatchEvent(new Event("moondog-data"));
  }, syntheticNextVersion);
  await page.evaluate(() => document.getElementById("checkMoonDogUpdate").click());
  await page.waitForFunction(() =>
    document.getElementById("updateProgressLabel")?.textContent==="Checking for updates");
  assert.equal(await page.locator("#updateProgress").isVisible(), true);
  await page.evaluate(() => globalThis.__moondogResolveCheck());
  await page.waitForFunction(() =>
    document.getElementById("installMoonDogUpdate")?.disabled===false);
  await page.evaluate(() => document.getElementById("installMoonDogUpdate").click());
  await page.waitForFunction(() =>
    typeof globalThis.__moondogEmitRepairPhase==="function");
  for (const event of [
    {phase:"check",label:"Checking",percent:10,detail:"Inspecting synthetic application files"},
    {phase:"repair",label:"Repairing",percent:55,detail:"Restoring synthetic verified software"},
    {phase:"verify",label:"Verifying",percent:85,detail:"Checking synthetic repaired hashes"}
  ]) {
    await page.evaluate(value => globalThis.__moondogEmitRepairPhase(value), event);
    await page.waitForFunction(label =>
      document.getElementById("updateProgressLabel")?.textContent===label, event.label);
    assert.equal(await page.locator("#updateProgress").isVisible(), true);
    assert.match(await page.locator("#updateProgressState").textContent(), /WORKING/);
  }
  await page.evaluate(() => globalThis.__moondogFinishRepair());
  await page.waitForFunction(() =>
    document.getElementById("updateProgressState")?.textContent.includes("STOPPED"));
  assert.match(await page.locator("#updateStatus").textContent(),
    /Synthetic permission denied; no files changed/);
  assert.equal(pageErrors.length, 0);
  console.log("Verified browser-rendered update progression and stopped-error UX using synthetic callback driver; not browser permission or real file repair proof.");
  console.log("Verified repaired Beta installation and repeat update launched through file://", runtime);
} finally {
  await browser.close();
}

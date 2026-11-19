#!/usr/bin/env node
// Real Chromium smoke of the public Repair Center UI with synthetic in-memory folders.
// Never selects a real directory or accesses dealership records.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const arg = process.argv[2];
if (!arg || !["--local", "--live"].includes(arg)) {
  throw Error("Usage: node scripts/smoke_repair_center.mjs --local <dir> | --live <base-url> <full-main-sha>");
}
const expectedSha = arg === "--live" ? process.argv[4] : null;
const base = arg === "--local"
  ? pathToFileURL(path.resolve(process.argv[3], "index.html")).href
  : new URL(process.argv[3]).href;
const checkerUrl = arg === "--local"
  ? pathToFileURL(path.resolve(process.argv[3], "check-installation.html")).href
  : new URL("check-installation.html", base).href;
const repairUrl = arg === "--local"
  ? pathToFileURL(path.resolve(process.argv[3], "repair-moondog.html")).href
  : new URL("repair-moondog.html", base).href;
const siteBase = arg === "--local" ? null : new URL("./", base).href;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const issues = [];
  page.on("pageerror", error => issues.push(String(error)));
  if (siteBase) {
    assert.match(expectedSha ?? "", /^[0-9a-f]{40}$/);
    // GitHub Pages CDN propagation may lag the successful deploy action.
    // Require an exact SHA rather than mistaking a stale 200 response for success.
    let verified = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const response = await page.request.get(
          new URL("site-version.json?verify=" + expectedSha + "-" + attempt, siteBase).href,
          { headers: { "Cache-Control": "no-cache" }, timeout: 10000 }
        );
        if (response.status() === 200) {
          const metadata = await response.json();
          verified = metadata.mainSha === expectedSha && /^\d+\.\d+\.\d+$/.test(metadata.stableVersion ?? "");
        }
      } catch (_) { /* Retry only an unchanged, newly deployed public site. */ }
      if (verified) break;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    assert.ok(verified, "Live site-version.json never matched the exact deployed main SHA");
  }
  await page.goto(siteBase ? base + "?verified=" + expectedSha : base, { waitUntil: "load" });
  assert.match(await page.title(), /MoonDog Repair Center/);
  assert.match(await page.locator("h1").innerText(), /Fix your dashboard/);
  assert.match(await page.locator("h1").innerText(), /Keep your data/);
  const check = page.getByRole("link", { name: "Check my installation" });
  assert.ok((await check.getAttribute("href")).includes("check-installation.html"));
  assert.equal(await page.getByRole("link", { name: "Check my installation" }).count(), 1, "One primary starting action");
  await page.getByText("Where do I get the approved repair tool?").click();
  const repair = page.getByRole("link", { name: "Get verified repair tool" });
  assert.equal(await repair.getAttribute("href"), "./repair-moondog.html", "Novices must not have to navigate GitHub");
  assert.ok(await page.getByRole("link", { name: "Check my installation" }).isVisible());
  assert.ok(await page.getByText("I don't know where MoonDog is saved").count(), "Novice folder-help is present");
  assert.equal(issues.length, 0, "Landing page JavaScript must not throw");
  if (siteBase) {

    await page.waitForFunction(() => document.getElementById("releaseMeta")?.textContent?.startsWith("Stable "), null, {timeout:15000});
    assert.match(await page.locator("#releaseMeta").textContent(), /ZIP SHA-256 [a-f0-9]{64}/);
  }
  await page.close();

  // The actual approved repair tool must be served from the same public site,
  // not a confusing developer-download page. Merely opening it must not write.
  const repairPage = await browser.newPage();
  const repairErrors = [];
  repairPage.on("pageerror", err => repairErrors.push(String(err)));
  const repairResponse = await repairPage.goto(siteBase ? repairUrl + "?verified=" + expectedSha : repairUrl, { waitUntil: "load" });
  if (siteBase) assert.equal(repairResponse.status(), 200, "Verified repair tool must be publicly reachable");
  assert.match(await repairPage.title(), /Repair MoonDog/);
  assert.equal(await repairPage.locator("#repair").isDisabled(), true, "No repair is possible before explicit folder choice");
  assert.equal(await repairPage.locator("#choose").isEnabled(), true);
  assert.match(await repairPage.locator("#status").innerText(), /Nothing has changed/);
  assert.deepEqual(repairErrors, [], "Self-contained repair tool must load without script errors");
  await repairPage.close();

  // Fresh website installer: real official clean-install ZIP, browser-native
  // extraction, and synthetic memory-only folder handles. No real local writes.
  const freshInstallUrl = arg==="--local"
    ? pathToFileURL(path.resolve(process.argv[3],"fresh-install.html")).href
    : new URL("fresh-install.html",base).href;
  const freshPage=await browser.newPage();
  freshPage.setDefaultTimeout(25000);
  const freshErrors=[];
  freshPage.on("pageerror",err=>freshErrors.push(String(err)));
  if(arg==="--local"){
    const zipPath=path.join(process.cwd(),"dist","Service-Operations-Dashboard.zip");
    assert.ok(fs.existsSync(zipPath),"Clean Install browser smoke requires the official generated Stable ZIP");
    const zipBytes=fs.readFileSync(zipPath);
    const stableVersion=JSON.parse(fs.readFileSync(
      path.join(process.cwd(),"updates","manifest.json"),"utf8")).stable.version;
    const {createHash}=await import("node:crypto");
    const sha256=createHash("sha256").update(zipBytes).digest("hex");
    await freshPage.addInitScript(({stableVersion,sha256})=>{
      const allowedAsset="https://github.com/JHFMoon/MoonDog-Service-OS/releases/latest/download/Service-Operations-Dashboard.zip";
      const oldFetch=window.fetch.bind(window);
      window.fetch=(resource,options)=>String(resource).includes("latest.json")
        ? Promise.resolve(new Response(JSON.stringify({
          asset:allowedAsset,version:stableVersion,sha256
        }),{status:200,headers:{"Content-Type":"application/json"}}))
        : oldFetch(resource,options);
      const notFound=()=>Object.assign(new Error("Synthetic entry not found"),{name:"NotFoundError"});
      const wrongType=()=>Object.assign(new Error("Synthetic entry has another type"),{name:"TypeMismatchError"});
      const shared={writes:0};
      const folder=(name)=>{
        const entries=new Map();
        return {
          kind:"directory",name,entries,
          queryPermission:async()=> "granted",
          getDirectoryHandle:async(key,options={})=>{
            let item=entries.get(key);
            if(!item&&!options.create)throw notFound();
            if(!item){item=folder(key);entries.set(key,item);}
            if(item.kind!=="directory")throw wrongType();
            return item;
          },
          getFileHandle:async(key,options={})=>{
            let item=entries.get(key);
            if(!item&&!options.create)throw notFound();
            if(!item){
              item={kind:"file",name:key,bytes:new Uint8Array(0),
                async createWritable(){
                  let pending=null;
                  return {
                    write:async data=>{pending=new Uint8Array(data);},
                    close:async()=>{if(!pending)throw Error("Missing synthetic file write");item.bytes=pending;shared.writes++;},
                    abort:async()=>{}
                  };
                },
                getFile:async()=>new File([item.bytes],key)
              };
              entries.set(key,item);
            }
            if(item.kind!=="file")throw wrongType();
            return item;
          },
          values:()=>entries.values(),
          removeEntry:async key=>{if(!entries.delete(key))throw notFound();}
        };
      };
      const parent=folder("Synthetic Installation Parent");
      window.__syntheticFreshParent=parent;
      window.__syntheticFreshStats=shared;
      Object.defineProperty(window,"showDirectoryPicker",{configurable:true,
        value:async(options)=>{if(options?.mode!=="readwrite")throw Error("Wrong picker mode");return parent;}});
      window.confirm=()=>true;
    },{stableVersion,sha256});
    await freshPage.goto(freshInstallUrl,{waitUntil:"load"});
    await freshPage.locator("#freshConfirm").check();
    await freshPage.locator("#zipFile").setInputFiles({
      name:"Service-Operations-Dashboard.zip",mimeType:"application/zip",buffer:zipBytes
    });
    await freshPage.locator("#verify").click();
    await freshPage.waitForFunction(()=>document.getElementById("autoInstall")?.disabled===false,
      null,{timeout:25000});
    await freshPage.locator("#installFolderName").fill("MoonDog Synthetic Web Install");
    await freshPage.locator("#autoInstall").click();
    await freshPage.waitForFunction(()=>document.getElementById("installResult")?.textContent
      ?.startsWith("INSTALLED AND VERIFIED"),null,{timeout:75000});
    const proof=await freshPage.evaluate(()=>{
      const parent=window.__syntheticFreshParent;
      const root=parent?.entries.get("MoonDog Synthetic Web Install");
      const system=root?.entries.get("System Files");
      const workspace=system?.entries.get("Workspace");
      return {
        onlyOne:parent?.entries.size===1,
        launcher:root?.entries.get("00 - OPEN DASHBOARD.html")?.kind==="file",
        rootIndex:root?.entries.get("index.html")?.kind==="file",
        installationManifest:root?.entries.get("INSTALLATION-MANIFEST.json")?.kind==="file",
        systemIndex:system?.entries.get("index.html")?.kind==="file",
        workspace:workspace?.kind==="directory",
        noPrivateSettings:!workspace?.entries.get("data")?.entries.has("settings.json"),
        noIncompleteMarker:!root?.entries.has("MOONDOG-INSTALL-INCOMPLETE.txt"),
        writes:window.__syntheticFreshStats.writes,
        confirmed:!document.getElementById("installedNext").hidden
      };
    });
    assert.equal(proof.onlyOne,true,"Install must create one new child only");
    for(const property of ["launcher","rootIndex","installationManifest","systemIndex",
      "workspace","noPrivateSettings","noIncompleteMarker","confirmed"])
      assert.equal(proof[property],true,"Fresh install browser proof: "+property);
    assert.ok(proof.writes>12,"Real Stable ZIP inventory must be written and read back");
    assert.deepEqual(freshErrors,[],"Verified browser installer must not throw");
    console.log("Browser proof: official Stable ZIP → synthetic folder → local Guided Setup handoff PASS");
  }else{
    await freshPage.goto(freshInstallUrl+"?verified="+expectedSha,{waitUntil:"load"});
    assert.equal(await freshPage.locator("#autoInstall").isDisabled(),true,
      "The public website must never write before selecting and verifying a local ZIP");
    assert.deepEqual(freshErrors,[],"Published install page must not throw");
  }
  await freshPage.close();

  for (const scenario of ["complete", "missing-journal", "unfinished", "missing-app", "missing-workspace", "unreadable", "wrong-folder", "system-files-only", "no-backups"]) {
    const p = await browser.newPage();
    p.setDefaultTimeout(15000);
    const errors = [];
    p.on("pageerror", error => errors.push(String(error)));
    await p.addInitScript(({ scenario }) => {
      function notFound() { return Object.assign(new Error("Synthetic file not present"), { name: "NotFoundError" }); }
      function file(text, fail = false) {
        return { kind: "file", getFile: async () => {
          if (fail) throw Object.assign(new Error("Synthetic access lost"), { name: "NotReadableError" });
          return { size: text.length, text: async () => text };
        } };
      }
      function directory(name, entries = {}) {
        return {
          kind: "directory", name,
          getDirectoryHandle: async (key, options = {}) => {
            if (options.create) throw Error("Unsafe synthetic directory write request");
            if (entries[key]?.kind === "directory") return entries[key];
            throw notFound();
          },
          getFileHandle: async (key, options = {}) => {
            if (options.create) throw Error("Unsafe synthetic file write request");
            if (entries[key]?.kind === "file") return entries[key];
            throw notFound();
          },
          entries: async function* () { yield* Object.entries(entries); }
        };
      }
      const status = scenario === "unfinished" ? "applying" : "verified";
      const journal = file(JSON.stringify({ status, inventory: [] }), scenario === "unreadable");
      const recovery = directory("MoonDog-Update-Backup-SYNTHETIC", scenario === "missing-journal" ? {} : { "journal.json": journal });
      const backups = directory("backups", {
        "system-updates": directory("system-updates", { "MoonDog-Update-Backup-SYNTHETIC": recovery })
      });
      const workspace = directory("Workspace", scenario === "no-backups" ? {} : { backups });
      const app = directory("assets", scenario === "missing-app" ? {} : { "app.js": file("synthetic generic software") });
      const system = directory("System Files", {
        "index.html": file("synthetic generic software"),
        assets: app,
        ...(scenario === "missing-workspace" ? {} : { Workspace: workspace })
      });
      const root = scenario === "wrong-folder" ? directory("My Documents", {})
        : scenario === "system-files-only" ? system
        : directory("Dashboard Interface", {
          "00 - OPEN DASHBOARD.html": file("synthetic launcher"),
          "INSTALLATION-MANIFEST.json": file("synthetic manifest"),
          "System Files": system
        });
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async options => {
          if (options?.mode !== "read") throw Error("Checker requested write access");
          return root;
        }
      });
    }, { scenario });
    await p.goto(siteBase ? checkerUrl + "?verified=" + expectedSha : checkerUrl, { waitUntil: "load" });
    await p.getByRole("button", { name: "Choose folder and check" }).click();
    const result = await p.locator("#result").textContent();
    const summary = await p.locator("#quickResult").innerText();
    assert.equal(await p.locator("#technicalDetails").isVisible(), true, "Technician details can be expanded");
    assert.equal(await p.locator("#technicalDetails").evaluate(e => e.open), false, "Novices do not see diagnostic wall by default");
    assert.match(summary, /No files were changed or uploaded/);
    const expected = {
      "complete": /FOLDER CHECK PASSED/,
      "missing-journal": /UPDATE BLOCKED[\s\S]*has no journal\.json/,
      "unfinished": /UPDATE BLOCKED[\s\S]*unfinished update/,
      "missing-app": /SOFTWARE REPAIR NEEDED[\s\S]*MISSING: System Files\/assets\/app\.js/,
      "missing-workspace": /UPDATE BLOCKED[\s\S]*Workspace is missing/,
      "unreadable": /UPDATE BLOCKED[\s\S]*could not be verified/,
      "wrong-folder": /WRONG FOLDER/,
      "system-files-only": /PARTIAL CHECK/,
      "no-backups": /FOLDER CHECK PASSED/
    }[scenario];
    assert.match(result, expected, scenario);
    assert.match(result, /No files were changed or uploaded/);
    const nextKind = {
      "complete": "Passed", "no-backups": "Passed",
      "missing-journal": "Blocked", "unfinished": "Blocked",
      "missing-app": "Repair", "missing-workspace": "Blocked",
      "unreadable": "Blocked", "wrong-folder": "Wrong",
      "system-files-only": "Partial"
    }[scenario];
    assert.equal(await p.locator("#next" + nextKind).isVisible(), true, "Next-step panel must match outcome");
    if (nextKind === "Blocked") {
      assert.equal(await p.locator("#nextRepair").isVisible(), false, "Never suggest repair for blocked recovery");
    }
    assert.equal(errors.length, 0, "Checker JavaScript must not throw: " + scenario);
    await p.close();
    console.log("Browser proof:", scenario, "PASS");
  }
  console.log("Repair Center browser smoke PASS for", arg === "--live" ? "published website" : "local Pages staging");
} finally {
  await browser.close();
}

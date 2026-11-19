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
  assert.match(await repair.getAttribute("href"), /^https:\/\/github\.com\/JHFMoon\/MoonDog-Service-OS\/blob\/main\/repair-moondog\.html$/);
  assert.ok(await page.getByRole("link", { name: "Check my installation" }).isVisible());
  assert.ok(await page.getByText("I don't know where MoonDog is saved").count(), "Novice folder-help is present");
  assert.equal(issues.length, 0, "Landing page JavaScript must not throw");
  if (siteBase) {

    await page.waitForFunction(() => document.getElementById("releaseMeta")?.textContent?.startsWith("Stable "), null, {timeout:15000});
    assert.match(await page.locator("#releaseMeta").textContent(), /ZIP SHA-256 [a-f0-9]{64}/);
  }
  await page.close();

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

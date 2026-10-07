#!/usr/bin/env node
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const index = process.argv[2];
if (!index) throw new Error("usage: smoke_clean_install.mjs <index.html>");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));

try {
  await page.goto(pathToFileURL(path.resolve(index)).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() =>
    typeof globalThis.JSZip === "function" &&
    globalThis.XLSX &&
    globalThis.pdfjsLib &&
    typeof globalThis.pdfjsLib.getDocument === "function",
    null,
    { timeout: 15000 }
  );
  const versions = await page.evaluate(() => ({
    jszip: globalThis.JSZip?.version,
    xlsx: globalThis.XLSX?.version,
    pdfjs: globalThis.pdfjsLib?.version,
    app: globalThis.MoonDogInstalledVersion
  }));
  if (versions.jszip !== "3.10.1") throw new Error("JSZip version mismatch: " + JSON.stringify(versions));
  if (versions.xlsx !== "0.20.3") throw new Error("SheetJS version mismatch: " + JSON.stringify(versions));
  if (versions.pdfjs !== "5.6.205") throw new Error("PDF.js version mismatch: " + JSON.stringify(versions));
  if (!/^\d+\.\d+\.\d+/.test(String(versions.app || ""))) throw new Error("Application version was not exposed: " + JSON.stringify(versions));

  const relevant = pageErrors.filter(message =>
    /pdf|jszip|xlsx|syntaxerror|referenceerror/i.test(message)
  );
  if (relevant.length) throw new Error("Browser runtime errors:\n" + relevant.join("\n---\n"));
  console.log("Clean-install browser smoke test passed", versions);
} finally {
  await browser.close();
}

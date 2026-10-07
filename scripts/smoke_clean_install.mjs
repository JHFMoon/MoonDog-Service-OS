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

  const pdfResult = await page.evaluate(async () => {
    try {
    const stream = "BT /F1 18 Tf 72 720 Td (MOONDOG) Tj ET\n";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
    ];
    let body = "%PDF-1.4\n";
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(body.length);
      body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xref = body.length;
    body += "xref\n0 6\n0000000000 65535 f \n";
    for (const offset of offsets.slice(1)) {
      body += String(offset).padStart(10, "0") + " 00000 n \n";
    }
    body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const task = globalThis.pdfjsLib.getDocument({ data: new TextEncoder().encode(body) });
    try {
      const document = await task.promise;
      const firstPage = await document.getPage(1);
      const content = await firstPage.getTextContent();
      return { ok: true, text: content.items.map(item => item.str || "").join(" ") };
    } finally {
      await task.destroy();
    }
    } catch (error) {
      return {
        ok: false,
        name: String(error?.name || ""),
        message: String(error?.message || error || ""),
        stack: String(error?.stack || "")
      };
    }
  });
  if (!pdfResult.ok) throw new Error("PDF.js parse failed: " + JSON.stringify(pdfResult));
  if (!/MOONDOG/.test(pdfResult.text)) throw new Error("PDF.js could not extract text from a local in-memory PDF: " + pdfResult.text);

  const relevant = pageErrors.filter(message =>
    /pdf|jszip|xlsx|syntaxerror|referenceerror/i.test(message)
  );
  if (relevant.length) throw new Error("Browser runtime errors:\n" + relevant.join("\n---\n"));
  console.log("Clean-install browser smoke test passed", versions);
} finally {
  await browser.close();
}

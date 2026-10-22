#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)("playwright");
import { pathToFileURL } from "node:url";
import path from "node:path";

const index = process.argv[2];
if (!index) throw new Error("usage: smoke_distribution.mjs <launcher.html>");

const browser = await chromium.launch({ headless: true, channel: process.env.MOONDOG_BROWSER_CHANNEL || undefined });
const page = await browser.newPage();
const pageErrors = [];
const applicationRoot = path.join(path.dirname(path.resolve(index)), "System Files");
const workerProbeDir = path.join(applicationRoot, `__xlsx-worker-probe-${process.pid}`);
const workerProbePath = path.join(workerProbeDir, "probe.js");
page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));

try {
  await mkdir(workerProbeDir);
  await writeFile(workerProbePath, [
    "importScripts('../vendor/xlsx.full.min.js');",
    "self.onmessage = (event) => {",
    "  try {",
    "    const book = XLSX.read(event.data, { type: 'array', raw: true });",
    "    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });",
    "    self.postMessage({ ok: true, sheetNames: book.SheetNames, rows });",
    "  } catch (error) {",
    "    self.postMessage({ ok: false, error: String(error?.message || error) });",
    "  }",
    "};",
    ""
  ].join("\n"), "utf8");

  await page.addInitScript(() => { globalThis.__MOONDOG_ENABLE_XLSX_SMOKE = true; });
  await page.goto(pathToFileURL(path.resolve(index)).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForURL(url => url.protocol === "file:" && url.pathname.endsWith("/index.html"), { timeout: 10000 });
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

  const xlsxSource = await readFile(path.join(applicationRoot, "vendor", "xlsx.full.min.js"), "utf8");
  const workerProbe = await page.evaluate(async ({ probePath, xlsxSource }) => {
    let vendorRead = { method: "", length: 0, error: "" };
    try {
      const response = await fetch(new URL("vendor/xlsx.full.min.js", location.href));
      const source = await response.text();
      vendorRead = { method: "fetch", length: source.length, error: "" };
    } catch (error) {
      vendorRead.error = String(error?.message || error);
    }
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["probe"], ["synthetic"]]), "Probe");
    const encoded = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const buffer = encoded instanceof ArrayBuffer
      ? encoded
      : encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    const cspMeta = Array.from(document.querySelectorAll("meta[http-equiv]"))
      .filter(meta => meta.httpEquiv.toLowerCase() === "content-security-policy")
      .map(meta => meta.content);
    let workerConstructed = false;
    let workerError = "";
    try {
      const worker = new Worker(new URL(probePath, location.href));
      workerConstructed = true;
      worker.terminate();
    } catch (error) {
      workerError = String(error?.message || error);
    }
    let transferProbe = { ok: false, detached: false, rows: null, error: "" };
    const fallbackBuffer = buffer.slice(0);
    let transferWorker;
    let transferUrl;
    try {
      const parserSource = [
        "self.onmessage = event => {",
        "  try {",
        "    const book = XLSX.read(event.data, { type: 'array', raw: true });",
        "    self.postMessage({ ok: true, book });",
        "  } catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }",
        "};"
      ].join("\n");
      transferUrl = URL.createObjectURL(new Blob([xlsxSource, "\n", parserSource], { type: "text/javascript" }));
      transferWorker = new Worker(transferUrl);
      transferProbe.ok = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 10000);
        transferWorker.onmessage = event => {
          clearTimeout(timer);
          transferProbe.error = event.data?.error || "";
          transferProbe.sheetNames = event.data?.book?.SheetNames || null;
          try {
            const returnedBook = event.data?.book;
            const returnedRows = XLSX.utils.sheet_to_json(returnedBook?.Sheets?.Probe, { header: 1, raw: true });
            transferProbe.rows = returnedRows;
            resolve(event.data?.ok === true &&
              returnedBook?.SheetNames?.[0] === "Probe" &&
              JSON.stringify(returnedRows) === JSON.stringify([["probe"], ["synthetic"]]));
          } catch (error) {
            transferProbe.error = String(error?.message || error);
            resolve(false);
          }
        };
        transferWorker.onerror = event => {
          clearTimeout(timer);
          transferProbe.error = String(event.message || "Blob worker failed");
          resolve(false);
        };
        transferWorker.postMessage(buffer, [buffer]);
        transferProbe.detached = buffer.byteLength === 0;
      });
    } catch (error) {
      transferProbe.error = String(error?.message || error);
    } finally {
      transferWorker?.terminate();
      if (transferUrl) URL.revokeObjectURL(transferUrl);
    }
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });",
        "    self.postMessage({ ok: true, sheetNames: book.SheetNames, rows });",
        "  } catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }",
        "};"
      ].join("\n");
      transferUrl = URL.createObjectURL(new Blob([xlsxSource, "\n", parserSource], { type: "text/javascript" }));
      transferWorker = new Worker(transferUrl);
      transferProbe.ok = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 10000);
        transferWorker.onmessage = event => {
          clearTimeout(timer);
          transferProbe.rows = event.data?.rows || null;
          transferProbe.error = event.data?.error || "";
          resolve(event.data?.ok === true &&
            event.data?.sheetNames?.[0] === "Probe" &&
            JSON.stringify(event.data?.rows) === JSON.stringify([["probe"], ["synthetic"]]));
        };
        transferWorker.onerror = event => {
          clearTimeout(timer);
          transferProbe.error = String(event.message || "Blob worker failed");
          resolve(false);
        };
        transferWorker.postMessage(buffer, [buffer]);
        transferProbe.detached = buffer.byteLength === 0;
      });
    } catch (error) {
      transferProbe.error = String(error?.message || error);
    } finally {
      transferWorker?.terminate();
      if (transferUrl) URL.revokeObjectURL(transferUrl);
    }
    const rows = XLSX.utils.sheet_to_json(
      XLSX.read(fallbackBuffer, { type: "array", raw: true }).Sheets.Probe,
      { header: 1, raw: true }
    );
    return {
      protocol: location.protocol,
      origin: location.origin,
      cspMeta,
      vendorRead,
      workerConstructed,
      workerError,
      transferProbe,
      fallbackParsed: JSON.stringify(rows) === JSON.stringify([["probe"], ["synthetic"]]),
      rows
    };
  }, { probePath: `__xlsx-worker-probe-${process.pid}/probe.js`, xlsxSource });

  if (workerProbe.protocol !== "file:") {
    throw new Error("Worker feasibility probe did not run under the packaged opaque file origin: " + JSON.stringify(workerProbe));
  }
  if (workerProbe.cspMeta.length) throw new Error("Unexpected CSP meta policy affected the packaged worker probe: " + JSON.stringify(workerProbe.cspMeta));
  if (workerProbe.workerConstructed) throw new Error("Static file worker construction unexpectedly succeeded; extend this probe to verify transfer and worker parsing before drawing a conclusion.");
  if (!/cannot be accessed from origin ['"]null['"]/i.test(workerProbe.workerError)) {
    throw new Error("Static file worker failed for an unexpected reason: " + JSON.stringify(workerProbe));
  }
  if (!workerProbe.transferProbe.ok || !workerProbe.transferProbe.detached) {
    throw new Error("Synthetic SheetJS Blob-worker parse or ArrayBuffer transfer probe failed: " + JSON.stringify(workerProbe.transferProbe));
  }
  if (!workerProbe.fallbackParsed) throw new Error("Synchronous SheetJS fallback failed after file worker denial: " + JSON.stringify(workerProbe));
  console.log("Packaged file:// worker feasibility:", JSON.stringify({
    protocol: workerProbe.protocol,
    origin: workerProbe.origin,
    cspMeta: workerProbe.cspMeta.length,
    vendorSourceRead: workerProbe.vendorRead,
    staticWorkerConstructed: workerProbe.workerConstructed,
    staticWorkerError: workerProbe.workerError,
    blobWorkerSheetJsParseAndTransfer: workerProbe.transferProbe,
    synchronousFallbackParsed: workerProbe.fallbackParsed
  }));


  const largeWorkbookProbe = await page.evaluate(async ({ xlsxSource }) => {
    const rowCount = 25000;
    const rows = [["id", "ordinal", "category", "amount", "active", "description"]];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(["synthetic-" + index, index, "repair-order", index * 1.25, index % 2 === 0, "synthetic workbook row " + index]);
    }
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Large Probe");
    const encoded = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const workbookBuffer = encoded instanceof ArrayBuffer
      ? encoded
      : encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    const parserSource = [
      "self.onmessage = event => {",
      "  const started = performance.now();",
      "  try {",
      "    const parsed = XLSX.read(event.data, { type: 'array', raw: true });",
      "    self.postMessage({ ok: true, book: parsed, workerParseMs: performance.now() - started });",
      "  } catch (error) { self.postMessage({ ok: false, error: String(error?.message || error) }); }",
      "};"
    ].join("\n");
    const workerUrl = URL.createObjectURL(new Blob([xlsxSource, "\n", parserSource], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    const workerRuns = [];
    const syncRuns = [];
    try {
      for (let sample = 0; sample < 3; sample += 1) {
        let ticks = 0;
        let maxHeartbeatGapMs = 0;
        let lastTick = performance.now();
        const heartbeat = setInterval(() => {
          const now = performance.now();
          maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastTick);
          lastTick = now;
          ticks += 1;
        }, 20);
        const started = performance.now();
        const transfer = workbookBuffer.slice(0);
        let reply;
        let elapsedMs = 0;
        try {
          reply = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Large workbook Blob Worker timed out.")), 30000);
            worker.onmessage = event => {
              clearTimeout(timeout);
              resolve(event.data);
            };
            worker.onerror = event => {
              clearTimeout(timeout);
              reject(new Error(String(event.message || "Large workbook Blob Worker failed.")));
            };
            worker.postMessage(transfer, [transfer]);
          });
          elapsedMs = performance.now() - started;
        } finally {
          await new Promise(resolve => setTimeout(resolve, 25));
          clearInterval(heartbeat);
        }
        const returnedSheet = reply?.book?.Sheets?.["Large Probe"];
        const returnedRows = returnedSheet ? XLSX.utils.sheet_to_json(returnedSheet, { header: 1, raw: true }) : [];
        if (!reply?.ok || reply.book?.SheetNames?.[0] !== "Large Probe" ||
            returnedRows.length !== rowCount + 1 ||
            returnedRows[1]?.[0] !== "synthetic-0" ||
            returnedRows[returnedRows.length - 1]?.[0] !== "synthetic-" + (rowCount - 1) || ticks < 1) {
          throw new Error("Large workbook worker clone or main-thread heartbeat was incomplete: " + JSON.stringify({ ok: reply?.ok, rowCount: returnedRows.length, ticks, error: reply?.error }));
        }
        workerRuns.push({ elapsedMs, workerParseMs: reply.workerParseMs, clonedRows: returnedRows.length, ticks, maxHeartbeatGapMs });
      }
      for (let sample = 0; sample < 3; sample += 1) {
        let ticks = 0;
        let maxHeartbeatGapMs = 0;
        let lastTick = performance.now();
        const heartbeat = setInterval(() => {
          const now = performance.now();
          maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastTick);
          lastTick = now;
          ticks += 1;
        }, 20);
        const started = performance.now();
        const parsed = XLSX.read(workbookBuffer.slice(0), { type: "array", raw: true });
        const parsedRows = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, raw: true });
        const elapsedMs = performance.now() - started;
        await new Promise(resolve => setTimeout(resolve, 25));
        clearInterval(heartbeat);
        if (parsedRows.length !== rowCount + 1 || parsedRows[1]?.[0] !== "synthetic-0" ||
            parsedRows[parsedRows.length - 1]?.[0] !== "synthetic-" + (rowCount - 1)) {
          throw new Error("Synchronous fallback did not preserve the complete large workbook.");
        }
        syncRuns.push({ elapsedMs, ticks, maxHeartbeatGapMs });
      }
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
    return { rowCount, workbookBytes: workbookBuffer.byteLength, workerRuns, syncRuns };
  }, { xlsxSource });

  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  };
  console.log("Packaged large XLSX responsiveness:", JSON.stringify({
    rows: largeWorkbookProbe.rowCount,
    workbookBytes: largeWorkbookProbe.workbookBytes,
    workerRoundTrip: {
      p50Ms: percentile(largeWorkbookProbe.workerRuns.map(run => run.elapsedMs), 0.5),
      p95Ms: percentile(largeWorkbookProbe.workerRuns.map(run => run.elapsedMs), 0.95),
      maxHeartbeatGapMs: Math.max(...largeWorkbookProbe.workerRuns.map(run => run.maxHeartbeatGapMs)),
      heartbeats: largeWorkbookProbe.workerRuns.map(run => run.ticks)
    },
    workerParseOnly: {
      p50Ms: percentile(largeWorkbookProbe.workerRuns.map(run => run.workerParseMs), 0.5),
      p95Ms: percentile(largeWorkbookProbe.workerRuns.map(run => run.workerParseMs), 0.95)
    },
    synchronous: {
      p50Ms: percentile(largeWorkbookProbe.syncRuns.map(run => run.elapsedMs), 0.5),
      p95Ms: percentile(largeWorkbookProbe.syncRuns.map(run => run.elapsedMs), 0.95),
      maxHeartbeatGapMs: Math.max(...largeWorkbookProbe.syncRuns.map(run => run.maxHeartbeatGapMs)),
      heartbeats: largeWorkbookProbe.syncRuns.map(run => run.ticks)
    }
  }));

  const productionXlsxProbe = await page.evaluate(async ({ xlsxSource }) => {
    if (typeof globalThis.__moondogXlsxSmoke?.prepare !== "function") {
      throw new Error("Packaged production XLSX parser hook was not initialized.");
    }
    globalThis.__moondogXlsxSmoke.setVendorSource(xlsxSource);
    const rowCount = 25000;
    const rows = [["id", "ordinal", "category", "amount", "active", "description"]];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(["synthetic-" + index, index, "repair-order", index * 1.25, index % 2 === 0, "synthetic workbook row " + index]);
    }
    const sourceBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(sourceBook, XLSX.utils.aoa_to_sheet(rows), "Production Probe");
    const encoded = XLSX.write(sourceBook, { bookType: "xlsx", type: "array" });
    const sourceBytes = encoded instanceof ArrayBuffer
      ? new Uint8Array(encoded)
      : new Uint8Array(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
    if (sourceBytes.byteLength < 512 * 1024) throw new Error("Synthetic production XLSX fixture did not cross the worker threshold: " + sourceBytes.byteLength);
    const options = { type: "array", raw: true };
    async function measure(parse) {
      let ticks = 0;
      let maxHeartbeatGapMs = 0;
      let lastTick = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastTick);
        lastTick = now;
        ticks += 1;
      }, 20);
      let book;
      let parseMs = 0;
      let materializationMs = 0;
      try {
        const parseStarted = performance.now();
        book = await parse();
        parseMs = performance.now() - parseStarted;
        const materializationStarted = performance.now();
        const parsedRows = XLSX.utils.sheet_to_json(book.Sheets["Production Probe"], { header: 1, raw: true });
        materializationMs = performance.now() - materializationStarted;
        if (parsedRows.length !== rowCount + 1 ||
            parsedRows[1]?.[0] !== "synthetic-0" ||
            parsedRows[parsedRows.length - 1]?.[0] !== "synthetic-" + (rowCount - 1) ||
            JSON.stringify(parsedRows) !== JSON.stringify(rows)) {
          throw new Error("Production XLSX parser did not preserve all synthetic rows.");
        }
        await new Promise(resolve => setTimeout(resolve, 25));
        return { parseMs, materializationMs, ticks, maxHeartbeatGapMs, parsedRows: parsedRows.length };
      } finally {
        clearInterval(heartbeat);
      }
    }
    const workerRuns = [];
    const syncRuns = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const bytes = sourceBytes.slice();
      workerRuns.push(await measure(() => globalThis.__moondogXlsxSmoke.prepare(bytes, options)));
    }
    for (let sample = 0; sample < 3; sample += 1) {
      const bytes = sourceBytes.slice();
      syncRuns.push(await measure(() => XLSX.read(bytes, options)));
    }
    const workerStatus = globalThis.__moondogXlsxSmoke.workerStatus();
    if (!workerStatus.active || workerStatus.disabled) throw new Error("Production intake worker did not stay active for the packaged XLSX probe: " + JSON.stringify(workerStatus));
    return { rowCount, workbookBytes: sourceBytes.byteLength, workerStatus, workerRuns, syncRuns };
  }, { xlsxSource });
  const productionPercentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  };
  const summarizeProductionRuns = runs => ({
    parserP50Ms: productionPercentile(runs.map(run => run.parseMs), 0.5),
    parserP95Ms: productionPercentile(runs.map(run => run.parseMs), 0.95),
    materializationP50Ms: productionPercentile(runs.map(run => run.materializationMs), 0.5),
    materializationP95Ms: productionPercentile(runs.map(run => run.materializationMs), 0.95),
    maxHeartbeatGapMs: Math.max(...runs.map(run => run.maxHeartbeatGapMs)),
    heartbeatTicks: runs.map(run => run.ticks),
    parsedRows: runs.map(run => run.parsedRows)
  });
  console.log("Packaged production XLSX parser responsiveness:", JSON.stringify({
    rows: productionXlsxProbe.rowCount,
    workbookBytes: productionXlsxProbe.workbookBytes,
    worker: summarizeProductionRuns(productionXlsxProbe.workerRuns),
    synchronous: summarizeProductionRuns(productionXlsxProbe.syncRuns)
  }));

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
      for (const offset of offsets.slice(1)) body += String(offset).padStart(10, "0") + " 00000 n \n";
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

  const relevant = pageErrors.filter(message => /pdf|jszip|xlsx|syntaxerror|referenceerror/i.test(message));
  if (relevant.length) throw new Error("Browser runtime errors:\n" + relevant.join("\n---\n"));

  console.log("Clean-install browser smoke test passed", versions);
} finally {
  await browser.close();
  await rm(workerProbeDir, { recursive: true, force: true });
}

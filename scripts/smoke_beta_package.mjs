#!/usr/bin/env node
import { chromium } from "playwright";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const launcher = process.argv[2];
if (!launcher) throw new Error("usage: smoke_beta_package.mjs <clean-install-launcher.html>");

const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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

const compatibilityIndex = path.join(installRoot, "index.html");
if (!fs.existsSync(compatibilityIndex)) {
  const stableHtml = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  if (!stableHtml.includes("<head>") || stableHtml.toLowerCase().includes("<base")) {
    throw new Error("Clean-install HTML cannot create the updater compatibility bridge.");
  }
  fs.writeFileSync(compatibilityIndex, stableHtml.replace("<head>", '<head><base href="System Files/">'));
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

const browser = await chromium.launch({ headless: true });
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
  console.log("Verified Beta update installed and launched", runtime);
} finally {
  await browser.close();
}

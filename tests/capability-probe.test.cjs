const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "updates", "capability-probe.js"), "utf8");
function load(capabilities) {
  const context = vm.createContext(capabilities);
  vm.runInContext(source, context);
  return context.MoonDogCapabilityProbe.probe;
}

test("reports browser capabilities without opening a picker or touching a folder", async () => {
  let pickerCalls = 0;
  const probe = load({ isSecureContext: true, FileSystemHandle: function () {},
    FileSystemDirectoryHandle: function () {}, showDirectoryPicker: () => { pickerCalls += 1; },
    crypto: { subtle: { digest() {} } } });
  const result = await probe();
  assert.equal(result.secureContext, true);
  assert.equal(result.fileSystemAccessApiAvailable, true);
  assert.equal(result.directoryPickerAvailable, true);
  assert.equal(result.webCryptoAvailable, true);
  assert.equal(result.permissionResult, "not-tested-no-disposable-handle");
  assert.equal(result.exception, null);
  assert.equal(pickerCalls, 0);
});

test("queries only the supplied disposable handle without requesting permission", async () => {
  let requests = 0;
  const probe = load({ isSecureContext: true });
  const result = await probe({ queryPermission: async options => {
    assert.equal(options.mode, "readwrite"); return "prompt";
  }, requestPermission: async () => { requests += 1; } });
  assert.equal(result.permissionResult, "prompt");
  assert.equal(requests, 0);
});

test("preserves the exact browser exception name and message", async () => {
  const probe = load({ isSecureContext: false });
  const result = await probe({ queryPermission: async () => {
    throw new DOMException("Policy denied this handle", "SecurityError");
  } });
  assert.equal(result.secureContext, false);
  assert.equal(result.permissionResult, "error");
  assert.equal(result.exception.name, "SecurityError");
  assert.equal(result.exception.message, "Policy denied this handle");
});

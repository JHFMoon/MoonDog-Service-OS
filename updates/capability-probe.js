(function (global) {
  "use strict";

  async function probe(directoryHandle = null) {
    const result = {
      secureContext: global.isSecureContext === true,
      fileSystemAccessApiAvailable: typeof global.FileSystemHandle === "function" &&
        typeof global.FileSystemDirectoryHandle === "function",
      directoryPickerAvailable: typeof global.showDirectoryPicker === "function",
      permissionResult: "not-tested-no-disposable-handle",
      webCryptoAvailable: typeof global.crypto?.subtle?.digest === "function",
      exception: null
    };
    if (directoryHandle !== null) {
      try {
        result.permissionResult = await directoryHandle.queryPermission({ mode: "readwrite" });
      } catch (error) {
        result.permissionResult = "error";
        result.exception = { name: error.name, message: error.message };
      }
    }
    return result;
  }

  global.MoonDogCapabilityProbe = { probe };
})(globalThis);

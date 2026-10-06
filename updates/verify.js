(function (global) {
  "use strict";

  const MANIFEST_URL = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json";
  const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
  const HASH = /^[0-9a-fA-F]{64}$/;

  function allowedPackageUrl(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
      return (url.hostname === "raw.githubusercontent.com" &&
        url.pathname.startsWith("/JHFMoon/MoonDog-Service-OS/")) ||
        (url.hostname === "github.com" &&
        url.pathname.startsWith("/JHFMoon/MoonDog-Service-OS/releases/download/"));
    } catch (_) {
      return false;
    }
  }

  async function readBounded(response) {
    const declared = Number(response.headers && response.headers.get("content-length"));
    if (declared > MAX_PACKAGE_BYTES) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PACKAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function verify(options) {
    const { channel = "stable", fetcher = global.fetch, subtle = global.crypto && global.crypto.subtle } = options || {};
    if (!fetcher || !subtle) return { status: "unavailable" };
    if (!["stable", "beta"].includes(channel)) return { status: "rejected", reason: "invalid-channel" };
    const requestOptions = { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };
    try {
      const manifestResponse = await fetcher(MANIFEST_URL, requestOptions);
      if (!manifestResponse.ok) return { status: "unavailable" };
      const manifest = await manifestResponse.json();
      const release = manifest?.[channel];
      const versionPattern = channel === "stable" ? /^\d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+-beta\.\d+$/;
      if (!release || !versionPattern.test(release.version) ||
          !/^\d+\.\d+\.\d+$/.test(release.minimumCompatibleVersion) ||
          typeof release.migrationRequired !== "boolean" ||
          (channel === "beta" && release.migrationRequired)) {
        return { status: "rejected", reason: "invalid-metadata" };
      }
      if (release.packageUrl === null && release.sha256 === null) return { status: "no-package" };
      if (!allowedPackageUrl(release.packageUrl) || typeof release.sha256 !== "string" ||
          !HASH.test(release.sha256)) return { status: "rejected", reason: "invalid-metadata" };

      const packageResponse = await fetcher(release.packageUrl, requestOptions);
      if (!packageResponse.ok) return { status: "unavailable" };
      const bytes = await readBounded(packageResponse);
      if (!bytes) return { status: "rejected", reason: "package-too-large" };
      const digest = await subtle.digest("SHA-256", bytes);
      const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== release.sha256.toLowerCase()) {
        return { status: "rejected", reason: "hash-mismatch" };
      }
      return { status: "verified", bytes, sha256: actual, channel, version: release.version,
        migrationRequired: release.migrationRequired,
        minimumCompatibleVersion: release.minimumCompatibleVersion };
    } catch (_) {
      return { status: "unavailable" };
    }
  }

  global.MoonDogPackageVerification = { verify };
})(globalThis);

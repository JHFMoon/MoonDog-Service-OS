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
    const { fetcher = global.fetch, subtle = global.crypto && global.crypto.subtle } = options || {};
    if (!fetcher || !subtle) return { status: "unavailable" };
    const requestOptions = { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };
    try {
      const manifestResponse = await fetcher(MANIFEST_URL, requestOptions);
      if (!manifestResponse.ok) return { status: "unavailable" };
      const manifest = await manifestResponse.json();
      if (manifest.packageUrl === null && manifest.sha256 === null) return { status: "no-package" };
      if (!allowedPackageUrl(manifest.packageUrl) || typeof manifest.sha256 !== "string" ||
          !HASH.test(manifest.sha256) || !["stable", "beta"].includes(manifest.channel)) {
        return { status: "rejected", reason: "invalid-metadata" };
      }
      const version = manifest.channel === "stable" ? manifest.stableVersion : manifest.betaVersion;
      if (typeof version !== "string") return { status: "rejected", reason: "invalid-metadata" };

      const packageResponse = await fetcher(manifest.packageUrl, requestOptions);
      if (!packageResponse.ok) return { status: "unavailable" };
      const bytes = await readBounded(packageResponse);
      if (!bytes) return { status: "rejected", reason: "package-too-large" };
      const digest = await subtle.digest("SHA-256", bytes);
      const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== manifest.sha256.toLowerCase()) {
        return { status: "rejected", reason: "hash-mismatch" };
      }
      return { status: "verified", bytes, sha256: actual, channel: manifest.channel, version };
    } catch (_) {
      return { status: "unavailable" };
    }
  }

  global.MoonDogPackageVerification = { verify };
})(globalThis);

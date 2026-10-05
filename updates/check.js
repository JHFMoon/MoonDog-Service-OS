(function (global) {
  "use strict";

  const MANIFEST_URL = "https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/manifest.json";
  const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

  function parseVersion(value) {
    if (typeof value !== "string") return null;
    const match = VERSION.exec(value);
    if (!match) return null;
    const numbers = match.slice(1).map((part) => part === undefined ? null : Number(part));
    return numbers.every((part) => part === null || Number.isSafeInteger(part)) ? numbers : null;
  }

  function compareVersions(left, right) {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return Math.sign(left[index] - right[index]);
    }
    if (left[3] === null && right[3] !== null) return 1;
    if (left[3] !== null && right[3] === null) return -1;
    return Math.sign((left[3] || 0) - (right[3] || 0));
  }

  async function check(options) {
    const { currentVersion, channel = "stable", manual = false, fetcher = global.fetch } = options || {};
    const current = parseVersion(currentVersion);
    if (!current || !["stable", "beta"].includes(channel)) {
      return manual ? { status: "invalid-input" } : { status: "silent" };
    }

    try {
      const response = await fetcher(MANIFEST_URL, {
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error("Manifest unavailable");
      const manifest = await response.json();
      const stable = parseVersion(manifest.stableVersion);
      const beta = manifest.betaVersion === null ? null : parseVersion(manifest.betaVersion);
      const minimum = parseVersion(manifest.minimumCompatibleVersion);
      if (!stable || !minimum || (manifest.betaVersion !== null && !beta) ||
          !["stable", "beta"].includes(manifest.channel)) {
        throw new Error("Invalid manifest");
      }

      let version = manifest.stableVersion;
      let selected = stable;
      let selectedChannel = "stable";
      if (channel === "beta" && beta && compareVersions(beta, stable) > 0) {
        version = manifest.betaVersion;
        selected = beta;
        selectedChannel = "beta";
      }
      if (compareVersions(selected, current) <= 0) {
        return { status: "up-to-date", channel: selectedChannel, version };
      }
      if (compareVersions(current, minimum) < 0) {
        return { status: "incompatible", channel: selectedChannel, version,
          minimumCompatibleVersion: manifest.minimumCompatibleVersion };
      }
      return { status: "newer-version", channel: selectedChannel, version };
    } catch (_) {
      return manual ? { status: "unavailable" } : { status: "silent" };
    }
  }

  global.MoonDogUpdateCheck = { check };
})(globalThis);

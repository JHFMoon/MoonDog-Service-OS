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
      const stableRelease = manifest?.stable;
      const betaRelease = manifest?.beta;
      const stable = parseVersion(stableRelease?.version);
      const beta = parseVersion(betaRelease?.version);
      if (!stable || stable[3] !== null || !beta || beta[3] === null ||
          !parseVersion(stableRelease.minimumCompatibleVersion) ||
          !parseVersion(betaRelease.minimumCompatibleVersion)) {
        throw new Error("Invalid manifest");
      }

      let release = stableRelease;
      let selectedChannel = "stable";
      if (channel === "beta" && compareVersions(beta, stable) > 0) {
        release = betaRelease;
        selectedChannel = "beta";
      }
      const version = release.version;
      const selected = parseVersion(version);
      if (compareVersions(selected, current) <= 0) {
        return { status: "up-to-date", channel: selectedChannel, version };
      }
      if (compareVersions(current, parseVersion(release.minimumCompatibleVersion)) < 0) {
        return { status: "incompatible", channel: selectedChannel, version,
          minimumCompatibleVersion: release.minimumCompatibleVersion };
      }
      return { status: "newer-version", channel: selectedChannel, version };
    } catch (_) {
      return manual ? { status: "unavailable" } : { status: "silent" };
    }
  }

  global.MoonDogUpdateCheck = { check };
})(globalThis);

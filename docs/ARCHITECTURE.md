# Architecture

## Authority and direction

This public repository defines product structure, distributable code, and future update logic. The installed application runs on the end user's machine. It owns its local operational state, reports, settings, history, and recovery files.

```text
GitHub: public source and verified update artifacts
                    |
                    | user-applied download only
                    v
Local MoonDog installation: application + private operational data
```

There is no automatic path from the local installation to GitHub for dealership data. No EXE or registry change is part of this foundation.

## Client runtime

The end-user application remains browser-only: HTML, CSS, JavaScript, and JSON. It requires no Python, Node, EXE, PowerShell, or other external runtime on end-user PCs. Python in this repository is limited to CI and repository tests.

## Future update contract

Stable is the default channel; beta is opt-in. A future update definition should identify its version, channel, compatible installed versions, artifact location and integrity value, and rollback instructions. The local application must show the proposed change, let the user apply it, verify it before replacement, preserve local data, and support rollback if application fails.

The plain-JSON `updates/manifest.json` is a contract placeholder. Its `0.0.0` version values and null package URL and SHA-256 hash mean no update is available. It does not trigger downloads or installation.

The prepared Settings control in `updates/settings-ui.js` shows installed version, Stable/Beta choice, last check, and availability. A silent check is limited to once per local day. Installation requires a manual click, a verified package, a dry-run file summary, two separate user-selected folders, and explicit confirmation. The browser transaction backs up and verifies approved app files before writing, verifies installed bytes, and rolls back on failure. Protected operational files never enter the trusted application catalog. An interrupted transaction retains a journal for explicit recovery after folder reconnection. Production integration awaits browser validation; no automatic install or release package exists yet.

`updates/check.html` and `updates/check.js` are a browser-only version check. The local installation supplies its installed version, or a user enters it on the page. The checker reads only the fixed public GitHub manifest URL, sends no operational data or URL parameters, and compares version numbers. Stable is selected by default; Beta requires selection. An automatic check stays silent if GitHub is unavailable; a manual check shows a short error. The check never downloads a package, changes files, or applies an update.

After a successful future update, a Files to Learn rescan may run on the local machine. It must not upload the files or their derived observations. No release artifact is published in Phase 1.

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

Stable is the default channel; Beta is opt-in. Each channel has its own version, package URL, SHA-256, minimum compatible version, migration flag, and release notes. The local application shows the proposed change, lets the user apply it, verifies it before replacement, preserves local data, and supports rollback if application fails.

The plain-JSON `updates/manifest.json` publishes independent packages for Stable `0.10.6` and Beta `0.10.7-beta.2`. Beta 2 changes only `assets/daily-ops.css` and `assets/daily-ops.js` to add a browser-local Light/Dark control; the retained Beta 1 package changed only `assets/product-settings.css`. The Stable package restores exact pre-Beta bytes of all three files. Selecting Stable while a Beta is installed offers a normal, user-confirmed channel downgrade through the same backup, verification, and rollback path. The update page reads the markers from the connected application folder to report installed version and channel after restart. Beta publication rejects migration-required releases or packages whose touched files lack a verified Stable restoration entry.

The local Service Operations Hub Tools → Change how Service Operations Hub works → System Updates page uses `updates/settings-ui.js` to show installed version, Stable/Beta choice, last check, and availability. A silent check is limited to once per local day. Installation requires a manual click, a verified package, a dry-run file summary, the already-connected application root, and explicit confirmation. The updater creates a unique rollback record under the protected `backups/system-updates/` directory inside that root; no backup folder picker is required. The browser transaction backs up and verifies approved app files before writing, verifies installed bytes, and rolls back on failure. Update packages cannot contain or change any `backups/` path. Disaster/full-system backups remain separate. Protected operational files never enter the trusted application catalog. An interrupted transaction retains a journal for explicit recovery from that protected directory after folder reconnection. Installation is never automatic.

Normal housekeeping excludes `backups/system-updates/` entirely; only the updater and explicit recovery inspect or write that subtree. The installed Hub still runs from local files without internet. Internet is used only for update checks and package downloads; OneDrive sync remains the existing workspace transport.

`updates/check.html` and `updates/check.js` are a browser-only version check. The local installation supplies its installed version, or a user enters it on the page. The checker reads only the fixed public GitHub manifest URL, sends no operational data or URL parameters, and compares version numbers. Stable is selected by default; Beta requires selection. An automatic check stays silent if GitHub is unavailable; a manual check shows a short error. The check never downloads a package, changes files, or applies an update.

After a successful future update, a Files to Learn rescan may run on the local machine. It must not upload the files or their derived observations. Update packages contain application-core files only. The existing production workspace/computer remains the sole supported Work location. Multi-device Work coordination is deferred; no OneDrive heartbeat file is used as a cross-device lock.

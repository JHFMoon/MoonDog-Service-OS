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

After a successful future update, a Files to Learn rescan may run on the local machine. It must not upload the files or their derived observations. No updater or release artifact is implemented in Phase 1.

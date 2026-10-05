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

## Future update contract

Stable is the default channel; beta is opt-in. A future update definition should identify its version, channel, compatible installed versions, artifact location and integrity value, and rollback instructions. The local application must show the proposed change, let the user apply it, verify it before replacement, preserve local data, and support rollback if application fails.

After a successful update, a Files to Learn rescan may run on the local machine. It must not upload the files or their derived observations. No updater, update manifest, or release artifact is implemented in Phase 1.

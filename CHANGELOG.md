# Changelog

This file summarizes user-relevant release milestones. The Git commit history remains the detailed engineering record.

## 0.10.8-beta.2 — current Beta

- Uses the operating system Light/Dark preference on first run until the user makes an explicit theme choice.
- Makes the installed Beta/Stable channel visible immediately in System Updates.
- Labels Beta installation actions explicitly and keeps the verified Stable-return path visible.
- Refreshes runtime build metadata to October 6, 2026.
- Adds repository runtime mirrors for the browser updater and a test that prevents those mirrors from drifting.

## 0.10.8-beta.1

- Moves the generic application core, including `index.html` and `assets/app.js`, under GitHub source authority.
- Reads store/employee/report-specific parser mappings from protected local configuration instead of embedding dealership identity in public source.
- Preserves the browser-local Light/Dark theme.
- Keeps the installed Hub offline-capable.
- Uses the existing verified dry-run, backup, readback, rollback, and recovery update path.

## 0.10.7 — current Stable

- Establishes the sanitized generic application source as the Stable restoration baseline.
- Covers every application file touched by the current Beta path.
- Keeps dealership configuration and operational data local.

## 0.10.7-beta.2

- Added the browser-local Light/Dark mode control.
- Proved GitHub → update package → System Updates → local installation end to end.

## 0.10.7-beta.1

- Controlled no-op Beta used to prove package verification, channel switching, install, and Stable return behavior.

## 0.10.6

- Pre-Beta Stable baseline retained for compatibility/history.

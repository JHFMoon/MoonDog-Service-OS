# Changelog

This file summarizes user-relevant release milestones. The Git commit history remains the detailed engineering record.

## 0.10.9-beta.1 — current Beta

- Moves store performance targets, required thresholds, gross minimum/stretch values, and dollar goals out of public application defaults.
- Preserves target values already saved in the connected local settings file.
- Adds local-only fields for store gross, Dealer NPS, VIR, Menu, Media Viewed, Texting, CP ELR, and CP Hours / RO.
- Leaves newly introduced local target fields unconfigured until the manager enters them.
- Adds publication checks that reject numeric literals in protected target keys and public goal/target text.
- Uses sanitized Stable 0.10.8 as the reversible return baseline.

## 0.10.8 — current Stable

- Sanitized restoration baseline with store performance targets removed from public defaults.
- Preserves protected local operational data and locally saved settings during updates and rollback.

## 0.10.8-beta.3

- Replaces a stale “reconnecting” banner with a verified connected state after folder restoration completes.
- Shows installed-version availability more clearly after an update and labels the Beta install action consistently even before a fresh check.
- Gives the System Updates panel more useful desktop width when it is the selected Tools section.
- Adds focused regression coverage for the screenshot-state issues.

## 0.10.8-beta.2

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

## 0.10.7

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

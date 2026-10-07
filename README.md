# Service Operations Dashboard

[![Publication check](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml/badge.svg)](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml)

This repository is the public source, clean-install distribution authority, and update authority for the generic **Service Operations Dashboard**. The installed application runs locally in the browser and remains offline-capable for normal operations. GitHub is used only for source control and software distribution; dealership operational data stays in the connected local/company-controlled workspace.

See [Source and data boundary](docs/SOURCE-OF-TRUTH.md), [Data Boundary](docs/DATA-BOUNDARY.md), [Architecture](docs/ARCHITECTURE.md), [Offline distribution](docs/DISTRIBUTION.md), [Stable release process](docs/RELEASE-PROCESS.md), and [CHANGELOG.md](CHANGELOG.md).

## Current channels

- **Stable:** `0.10.16` ([GitHub Release](https://github.com/JHFMoon/MoonDog-Service-OS/releases/tag/v0.10.16))
- **Beta:** `0.10.15-beta.1` (optional next-version preview carrying forward Stable 0.10.14)

Stable 0.10.16 prevents temporary OneDrive/file-ingestion synchronization conflicts from being mistaken for lost owner editing authority. Transient File System Access state changes are retried automatically, the UI shows a neutral workspace-updating state, and owner recovery remains reserved for a persistent authority problem. It requires the layout-aware updater from version `0.10.9` or later. Older 0.10.8-era installations remain intentionally incompatible.

A version is considered **Stable** only when the matching formal GitHub Release exists at tag `v<version>` and contains the exact updater package declared by the Stable manifest. The Stable manifest points to the SHA-256-verified file under the matching GitHub Release **tag** using GitHub's browser-compatible raw service. The matching formal GitHub Release and its verified asset are still required; a manifest-only version is not a completed Stable publication.

## Clean offline install

Each Stable release can publish a complete clean-install asset named:

`Service-Operations-Dashboard.zip`

The ZIP is built by GitHub Actions from the explicit reviewed runtime catalog. It contains the complete browser runtime, pinned third-party browser libraries, a launcher, an installation manifest, and an empty protected Workspace. It contains **no initialized store configuration or dealership operational data**.

End-user flow:

1. Download the Stable ZIP.
2. Extract it to a normal folder.
3. Open `00 - OPEN DASHBOARD.html` in Microsoft Edge.
4. Choose the extracted folder as the working folder.
5. Designate the authoritative editing computer.
6. Complete Guided Setup.
7. Use Settings → System Updates for future verified updates.

The GitHub Pages site is only a download storefront. It does not process or store dealership data and does not build the package in the browser.

## Installed layout

The normal visible installation is:

```text
Dashboard Interface/
├── 00 - OPEN DASHBOARD.html
└── System Files/
```

A root `index.html` compatibility document may remain hidden on migrated Windows installations so Edge keeps the original `file://` document path and its browser-local storage context.

Inside `System Files/`:

- application/runtime files live at the top level, under `assets/`, and under `vendor/`;
- protected operational state lives under `Workspace/`;
- System Updates changes only approved application/runtime files;
- rollback backups live under `Workspace/backups/system-updates/`;
- backup retention is automatic and bounded: validated full backups are kept densely for 30 days, then one per month for 12 months, with the newest three always preserved and a fresh rolling backup every 30 days; resolved system-update rollbacks keep at most 3 for 30 days; restore-safety backups keep at most 2 for 30 days; automatic pre-change backups keep at most 50 for 30 days.

The connected workspace is not a multi-writer database. One browser installation is designated as the authoritative writer. A copied or independently synchronized workspace does not inherit write authority and remains read-only.

## Update safety

System Updates verifies the public manifest and package SHA-256, performs a protected-path dry run, requires explicit installation approval, creates and verifies a rollback backup before writes, verifies installed bytes, and rolls back or exposes recovery if verification cannot complete.

Stable 0.10.16 publishes only generic application changes. It does not publish or overwrite customer, employee, advisor, technician, RO, VIN, report, history, settings, backup, or store-specific source-adapter data.

## Repository boundary

All reviewed first-party browser runtime files used by the current application are tracked here. Third-party license notices are tracked here. The clean-install release workflow obtains the pinned JSZip, PDF.js, and SheetJS browser libraries from their versioned upstream distributions, converts PDF.js to the classic local browser format required by the `file://` runtime, and embeds the resulting verified runtime files in the release ZIP.

Generated clean-install ZIP files are release artifacts, not tracked source. The build is deterministic and produces a SHA-256 checksum plus a per-file installation manifest.

**GitHub may contain the product. GitHub may never contain the dealership.**

See [Operating Intelligence](docs/OPERATING-INTELLIGENCE.md) for Home refresh prompts, locally learned update cadence, SAPR working-day comparisons, and responsive meeting cards.

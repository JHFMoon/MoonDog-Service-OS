# Service Operations Dashboard

[![Publication check](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml/badge.svg)](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml)

This repository is the public source and update authority for the generic **Service Operations Dashboard**. The installed application runs locally in the browser and remains offline-capable for normal operations. GitHub is used only for source control and software update distribution; dealership operational data stays in the connected local/company-controlled workspace.

See [Source and data boundary](docs/SOURCE-OF-TRUTH.md), [Data Boundary](docs/DATA-BOUNDARY.md), [Architecture](docs/ARCHITECTURE.md), and [CHANGELOG.md](CHANGELOG.md).

## Current channels

- **Stable:** `0.10.10`
- **Beta:** `0.10.9-beta.8` (historical opt-in channel)

Stable 0.10.10 is the validated architecture used by the current migrated installation. It requires updater version `0.10.9` or later because older 0.10.8-era installations do not have the layout-aware updater needed to safely separate application files from protected workspace data.

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
- rollback backups live under `Workspace/backups/system-updates/`.

The connected workspace is not a multi-writer database. One browser installation is designated as the authoritative writer. A copied or independently synchronized workspace does not inherit write authority and remains read-only.

## Update safety

System Updates verifies the public manifest and package SHA-256, performs a protected-path dry run, requires explicit installation approval, creates and verifies a rollback backup before writes, verifies installed bytes, and rolls back or exposes recovery if verification cannot complete.

Stable 0.10.10 publishes only generic application changes. It does not publish or overwrite customer, employee, advisor, technician, RO, VIN, report, history, settings, backup, or store-specific source-adapter data.

## Repository boundary

All reviewed first-party browser runtime files used by the current application are tracked here. Third-party license notices are also tracked. The pinned JSZip, PDF.js, and SheetJS browser binary bundles remain installed runtime dependencies and are not currently mirrored in this public repository, so this repository by itself is not yet a complete clean-install archive.

That limitation does **not** affect the validated 0.10.9 → 0.10.10 update path because the migrated 0.10.9 installation already contains the pinned vendor bundles.

**GitHub may contain the product. GitHub may never contain the dealership.**
